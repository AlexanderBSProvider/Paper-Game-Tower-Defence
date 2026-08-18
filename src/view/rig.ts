// Cut-out риг: персонаж збирається з частин-масок за rigs.json, а рухається
// процедурними модифікаторами — жодних кейфреймів. Слайдери редактора потім
// правлять рівно ці числа.
//
// Щокадру кожна частина скидається в базовий трансформ, далі модифікатори
// застосовуються в порядку запису: одні задають значення (bob, sway, squash),
// інші додають зверху (swing, recoil). Тому в даних sway йде перед swing.
//
// Кожна частина — це суглоб (Container) зі спрайтом усередині, і дитина
// чіпляється до суглоба, а не до спрайта. Спрайт масштабований текстурою
// (1.5 клітинки / 75 px = 0.02), тож дитина спрайта поїхала б у 50 разів
// ближче до піво́та; суглоб тримає координати в чистих клітинках.

import { Container, Sprite, Texture } from '../../lib/pixi.min.mjs';
import type { Look, Mod, Rig, RigDef, Vec2 } from '../types.js';

/** Частина рига в зібраному вигляді: суглоб, спрайт і базовий трансформ. */
interface Node {
  joint: Container;
  spr: Sprite;
  mods: Mod[];
  x0: number;
  y0: number;
  rot0: number;
  /** щоб натовп не дихав в унісон */
  phase: number;
}

/** Стан, з якого модифікатори беруть силу: його задає гра. */
interface Ctx {
  moving: boolean;
  attack: number;
  hit: number;
  dead: boolean;
  aim: number | null;
}

type ModFn = (n: Node, m: Mod, t: number, ctx: Ctx, g: number) => void;

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const ph = (n: Node, m: Mod) => n.phase + (m.phase ?? 0);

const MODS: Record<string, ModFn> = {
  // дихання
  bob(n, m, t, ctx, g) {
    n.joint.y = n.y0 + (m.amp ?? 0) * g * Math.sin((t * (m.freq ?? 0) + ph(n, m)) * TAU);
  },
  // покачування
  sway(n, m, t, ctx, g) {
    n.joint.rotation = n.rot0 + (m.amp ?? 0) * D2R * g * Math.sin((t * (m.freq ?? 0) + ph(n, m)) * TAU);
  },
  // стискання-розтягування; зберігає видимий об'єм
  squash(n, m, t, ctx, g) {
    const s = (m.amp ?? 0) * g * Math.sin((t * (m.freq ?? 0) + ph(n, m)) * TAU);
    n.joint.scale.set(1 - s, 1 + s);
  },
  // кліпання: частина стискається по вертикалі на мить
  blink(n, m, t) {
    const period = m.every ?? 3.5;
    const p = (t + n.phase * period) % period;
    n.joint.scale.set(1, p < (m.hold ?? 0.1) ? 0.12 : 1);
  },
  spin(n, m, t, ctx, g) {
    n.joint.rotation = n.rot0 + t * (m.freq ?? 0) * TAU * g;
  },
  // замах на атаці — додається до того, що вже накрутив sway
  swing(n, m, t, ctx) {
    n.joint.rotation += (m.amp ?? 0) * D2R * ctx.attack;
  },
  // віддача вздовж напрямку
  recoil(n, m, t, ctx) {
    const d = m.dir ?? [1, 0];
    n.joint.x += d[0] * (m.amp ?? 0) * ctx.attack;
    n.joint.y += d[1] * (m.amp ?? 0) * ctx.attack;
  },
  // приціл: кут задає гра
  aim(n, m, t, ctx) {
    if (ctx.aim != null) n.joint.rotation = n.rot0 + ctx.aim;
  },
};

function gateOf(m: Mod, ctx: Ctx): number {
  switch (m.on) {
    case 'walk': return ctx.moving ? 1 : 0;
    case 'attack': return ctx.attack;
    case 'hit': return ctx.hit;
    case 'death': return ctx.dead ? 1 : 0;
    default: return 1;
  }
}

/**
 * @param def      риг із rigs.json
 * @param textures маски частин
 * @param parts    звідки брати розміри в клітинках. Сюди приходить і parts.json
 *                 (вороги, база, декор), і каталог деталей башт — спільне в них
 *                 лише size, тому в сигнатурі саме воно, а не конкретний тип.
 * @param look     палітра
 */
export function buildRig(
  def: RigDef, textures: Map<string, Texture>,
  parts: Record<string, { size: Vec2 }>, look: Look,
): Rig {
  const view = new Container();
  const nodes: Node[] = [];

  for (const p of def.parts) {
    const tex = textures.get(p.part);
    const size = parts[p.part]?.size;
    if (!tex || !size) {
      console.warn(`[rig] немає частини ${p.part}`);
      continue;
    }
    const joint = new Container();
    joint.position.set(p.pos?.[0] ?? 0, p.pos?.[1] ?? 0);
    joint.rotation = (p.rot ?? 0) * D2R;

    const spr = new Sprite(tex);
    spr.anchor.set(p.pivot?.[0] ?? 0.5, p.pivot?.[1] ?? 0.5);
    spr.setSize(size[0], size[1]);
    // Дзеркалення живе на СПРАЙТІ, не на суглобі: update() щокадру скидає
    // суглобу масштаб у 1,1 (через squash), тому там воно б не втрималось.
    // Заразом діти чіпляються до суглоба й не перевертаються за батьком.
    // rigs.json flip не задає, тому вороги, база й декор незмінні.
    if (p.flip) spr.scale.x *= -1;
    spr.tint = (p.pen && look.pens[p.pen]) ?? look.pens.blue;
    joint.addChild(spr);

    const parent = p.parent != null ? nodes[p.parent]?.joint ?? view : view;
    parent.addChild(joint);

    nodes.push({
      joint,
      spr,
      mods: p.mods ?? [],
      x0: joint.x, y0: joint.y, rot0: joint.rotation,
      phase: Math.random(), // щоб натовп не дихав в унісон
    });
  }

  const ctx: Ctx = { moving: false, attack: 0, hit: 0, dead: false, aim: null };
  let t = Math.random() * 10;
  const attackDur = 0.28, hitDur = 0.22;

  return {
    view,
    hitbox: def.hitbox ?? [1, 1],

    /** Позиція якоря в одиницях світу відносно початку рига (з урахуванням масштабу). */
    anchor(name): Vec2 {
      const a = def.anchors?.[name] ?? [0, 0];
      return [a[0] * view.scale.x, a[1] * view.scale.y];
    },

    /** Масштаб малюнка: у тісних орієнтаціях спрайт більший за свій хітбокс. */
    setScale(s) { view.scale.set(s); },

    set moving(v: boolean) { ctx.moving = v; },
    set aim(v: number | null) { ctx.aim = v; },
    set dead(v: boolean) { ctx.dead = v; },

    fire(what) {
      if (what === 'attack') ctx.attack = 1;
      else if (what === 'hit') ctx.hit = 1;
    },

    update(dtMs) {
      const dt = dtMs / 1000;
      t += dt;
      if (ctx.attack > 0) ctx.attack = Math.max(0, ctx.attack - dt / attackDur);
      if (ctx.hit > 0) ctx.hit = Math.max(0, ctx.hit - dt / hitDur);

      for (const n of nodes) {
        n.joint.position.set(n.x0, n.y0);
        n.joint.rotation = n.rot0;
        n.joint.scale.set(1, 1);
        for (const m of n.mods) {
          const g = gateOf(m, ctx);
          if (g === 0) continue;
          MODS[m.type]?.(n, m, t, ctx, g);
        }
      }
    },
  };
}
