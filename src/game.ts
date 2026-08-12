// Ігровий шар: сітка, маршрут, вороги, будівництво.
//
// Усе живе в клітинках, тому товщини ліній тут дрібні числа (0.06 = 6% клітинки),
// а не пікселі: світ масштабується разом із екраном, лінія лишається лінією.

import { Container, Graphics, Texture } from '../lib/pixi.min.mjs';
import { penStroke, penRect, hatch, penText, textWidth } from './view/ink.js';
import { buildPath, posAt } from './model/pathmath.js';
import { createGrid, WALL, TOWER, DECOR, BASE } from './model/grid.js';
import { computeFlow, routeFrom, stepFrom, reaches, wouldSeal } from './model/flow.js';
import { buildRig } from './view/rig.js';
import { createWallet } from './model/economy.js';
import { createCombat } from './combat.js';
import { createBuild, gunOf } from './model/build.js';
import type { Grid } from './model/grid.js';
import type { Flow } from './model/flow.js';
import type { Wallet } from './model/economy.js';
import type { Combat } from './combat.js';
import type { Build, Stats } from './model/build.js';
import type {
  Balance, Enemy, Fx, Layout, Level, Look, Parts, Rig, RigDefs, TowerParts, Vec2,
} from './types.js';

/** Що саме ставить панель інструментів. */
export interface Kind {
  w: number;
  h: number;
  /** позначка в сітці */
  mark: number;
  tower: boolean;
  drawTime: number;
}

/** Поставлений об'єкт. У башти є склад і риг, у стіни — тільки Graphics. */
export interface Built {
  kind: string;
  cx: number;
  cy: number;
  rig: Rig | null;
  gfx: Graphics | null;
  build: Build | null;
}

/** Башта під клітинкою — те, що відкриває майстерня. */
export type TowerRef = Built & { id: number };

export type Phase = 'break' | 'wave' | 'won' | 'lost';

export interface GameState {
  lives: number;
  maxLives: number;
  wave: number;
  waves: number;
  /** 'break' — перерва перед хвилею, 'wave' — хвиля йде, далі 'won' | 'lost' */
  phase: Phase;
  breakLeft: number;
  spawned: number;
  killed: number;
  leaked: number;
  sealed: boolean;
}

export type BuildResult =
  | { ok: true; id: number }
  | { ok: false; reason: string };

export type EraseResult =
  | { ok: true; kind: string; refund: number }
  | { ok: false; reason: string };

export type AddPartResult =
  | { ok: true; id: number; spent: number; stats: Stats }
  | { ok: false; reason: string };

export interface GameOpts {
  world: Container;
  hud: Container;
  look: Look;
  level: Level;
  balance: Balance;
  rigDefs: RigDefs;
  parts: Parts;
  textures: Map<string, Texture>;
  layout: Layout;
  towerParts: TowerParts;
  partTex: Map<string, Texture>;
}

export interface Game {
  state: GameState;
  wallet: Wallet;
  grid: Grid;
  enemies: Enemy[];
  entry: Vec2;
  goals: Vec2[];
  update(dtMs: number): void;
  rescale(s: number): void;
  spawnEnemy(typeId?: string, hpMul?: number): Enemy;
  damage(e: Enemy, amount: number): boolean;
  combat: Combat;
  build(kind: string, cx: number, cy: number, instant?: boolean): BuildResult;
  erase(cx: number, cy: number): EraseResult;
  whyNot(kind: string, cx: number, cy: number): string | null;
  addPart(
    towerId: number, partId: string,
    at: { node: number; name: string } | null, quality?: number,
  ): AddPartResult;
  towerAt(cx: number, cy: number): TowerRef | null;
  footOf(cx: number, cy: number, k: Kind): Vec2;
  rangeOf(kind: string): number;
  built: Map<number, Built>;
  KINDS: Record<string, Kind | undefined>;
  readonly flow: Flow;
}

const PEN = { jitter: 0.035, step: 0.28, overshoot: 0.07 };

// tower — башта збирається зі складу (towerparts), а не з готового рига:
// те, що ставить панель інструментів, це лише заготовка, далі гравець дороблює.
export const KINDS: Record<string, Kind | undefined> = {
  wall: { w: 1, h: 1, mark: WALL, tower: false, drawTime: 0.2 },
  magic_tower: { w: 2, h: 2, mark: TOWER, tower: true, drawTime: 0.4 },
  cannon: { w: 2, h: 2, mark: TOWER, tower: true, drawTime: 0.4 },
};

/** Маршрут пунктиром зі стрілками — як план, накреслений у зошиті. */
function drawRoute(g: Graphics, pts: Vec2[], look: Look) {
  g.clear();
  if (pts.length < 2) return;
  const path = buildPath(pts);

  // Крок ресемплу дорівнює довжині риски: круглі торці сусідніх точок інакше
  // зливаються в намисто з клякс, а не в пунктир.
  const dash = 0.44, gap = 0.4;
  for (let d = 0; d < path.length - 0.1; d += dash + gap) {
    const a = posAt(path, d);
    const b = posAt(path, Math.min(d + dash, path.length));
    penStroke(g, [[a.x, a.y], [b.x, b.y]],
      { color: look.pens.pencil, width: 0.038, alpha: 0.42, halo: 0, jitter: 0.02, step: dash, overshoot: 0 });
  }

  for (let d = 2.5; d < path.length - 0.5; d += 6) {
    const p = posAt(path, d);
    for (const k of [2.6, -2.6]) {
      penStroke(g, [[p.x, p.y], [p.x + Math.cos(p.angle + k) * 0.3, p.y + Math.sin(p.angle + k) * 0.3]],
        { color: look.pens.pencil, width: 0.042, alpha: 0.5, halo: 0, jitter: 0.02, step: 0.3, overshoot: 0 });
    }
  }
}

/** Стіна — накреслений від руки квадрат із однією діагоналлю.
 *  Штрихування тут не працює: на 25 px клітинки сусідні стіни зливаються в
 *  суцільний брусок, і лабіринт перестає читатись по клітинках. */
function drawWall(g: Graphics, cx: number, cy: number, look: Look) {
  penRect(g, cx + 0.15, cy + 0.15, 0.7, 0.7,
    { ...PEN, color: look.pens.blue, width: 0.038, alpha: 0.72, overshoot: 0.06, halo: 0 });
  penStroke(g, [[cx + 0.26, cy + 0.74], [cx + 0.74, cy + 0.26]],
    { ...PEN, color: look.pens.blue, width: 0.03, alpha: 0.35, halo: 0 });
}

export function createGame({
  world, hud, look, level, balance, rigDefs, parts, textures, layout, towerParts, partTex,
}: GameOpts): Game {
  const grid = createGrid(look.core.cols, look.core.rows);
  const wallet = createWallet({
    start: balance.economy.startInk,
    costs: balance.build,
    refund: balance.economy.refund,
  });

  const routeG = new Graphics();
  const wallLayer = new Container();
  const fxLayer = new Container();
  // Один шар на всіх, хто стоїть на землі: сортуємо за y, тому ближнє
  // перекриває дальнє само собою.
  const units = new Container();
  // Постріли й бризки — поверх усіх, хто стоїть на землі.
  const shotLayer = new Container();
  world.addChild(routeG, wallLayer, fxLayer, units, shotLayer);

  const rigs: Rig[] = [];
  const fx: Fx[] = [];

  function mount(rig: Rig, x: number, y: number) {
    rig.view.position.set(x, y);
    rig.setScale(layout.spriteScale);
    units.addChild(rig.view);
    rigs.push(rig);
    return rig;
  }

  /** Готовий риг із rigs.json: вороги, база, декор. */
  const place = (rigId: string, x: number, y: number) =>
    mount(buildRig(rigDefs[rigId], textures, parts, look), x, y);

  /** Башта зі свого складу. Початок координат складу — підошва заготовки,
   *  тому риг стає на нижній край сліду, а не в його центр. */
  const placeBuild = (b: Build, x: number, y: number) =>
    mount(buildRig(b.rigDef(), partTex, towerParts.parts, look), x, y);

  function unplace(rig: Rig) {
    rig.view.destroy({ children: true });
    rigs.splice(rigs.indexOf(rig), 1);
  }

  /** Витирання маскою: об'єкт не з'являється, а домальовується зліва направо. */
  function wipeIn(
    target: Container, parent: Container,
    x: number, y: number, w: number, h: number, dur: number,
  ) {
    const mask = new Graphics();
    parent.addChild(mask);
    target.mask = mask;
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        const p = Math.min(1, this.t / dur);
        mask.clear().rect(x - 0.1, y - 0.1, (w + 0.2) * p, h + 0.2).fill(0xffffff);
        if (p < 1) return false;
        target.mask = null;
        mask.destroy();
        return true;
      },
    });
  }

  /** Слід від ластика: бліда пляма, яка тане. */
  function smudge(cx: number, cy: number, w: number, h: number) {
    const g = new Graphics();
    hatch(g, cx + 0.1, cy + 0.1, w - 0.2, h - 0.2,
      { color: look.pens.pencil, width: 0.07, alpha: 0.22, gap: 0.26, jitterGap: 0.4, halo: 0, jitter: 0.06, step: 0.3 });
    fxLayer.addChild(g);
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        const p = this.t / 1.3;
        g.alpha = Math.max(0, 1 - p);
        if (p < 1) return false;
        g.destroy();
        return true;
      },
    });
  }

  // --- нотатка про деталь на полях -------------------------------------------
  function showNote(stats: Stats, newCombos: string[]) {
    const g = new Graphics();
    hud.addChild(g);

    const size = 8;
    const x = layout.w - size * 3;
    const y = layout.h - size * 4;

    // Показуємо основні стати
    const rows = [];
    if (stats.range > 0) rows.push({ icon: '●', val: stats.range.toFixed(1) });
    if (stats.damage > 0) rows.push({ icon: '▼', val: stats.damage.toFixed(0) });
    if (stats.rate > 0 && stats.rate !== 1) rows.push({ icon: '◯', val: stats.rate.toFixed(1) });
    if (stats.splash > 0) rows.push({ icon: '◎', val: stats.splash.toFixed(1) });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      penText(g, row.icon, x, y + i * size * 0.6, size,
        { color: look.pens.blue, alpha: 0.8, width: size * 0.08 });
      penText(g, row.val, x + size * 0.6, y + i * size * 0.6, size,
        { color: look.pens.blue, alpha: 0.8, width: size * 0.08 });
    }

    // Нові комбо як вспишка
    if (newCombos.length) {
      const comboText = `+${newCombos.length}`;
      penText(g, comboText, x - size * 0.6, y - size, size * 1.2,
        { color: look.pens.green, alpha: 0.9, width: size * 0.12 });
    }

    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        if (this.t < 3) g.alpha = 1;
        else if (this.t < 4) g.alpha = Math.max(0, 1 - (this.t - 3));
        else {
          g.destroy();
          return true;
        }
        return false;
      },
    });
  }

  // --- рівень ---------------------------------------------------------------
  const [bx, by] = level.base;
  const [bw, bh] = level.baseSize;
  grid.fill(bx, by, bw, bh, BASE);
  const goals = grid.rect(bx, by, bw, bh);
  const keep = place('keep', bx + bw / 2, by + bh / 2);

  for (const [id, cx, cy] of level.decor) {
    grid.fill(cx, cy, 1, 1, DECOR);
    place(id, cx + 0.5, cy + 0.5);
  }

  const entry = level.entry;
  const built = new Map<number, Built>();
  let nextId = 1;

  let flow = computeFlow(grid, goals);

  const enemies: Enemy[] = [];
  // phase: 'break' — перерва перед хвилею, 'wave' — хвиля йде, далі 'won' | 'lost'.
  const state: GameState = {
    lives: level.lives, maxLives: level.lives,
    wave: 0, waves: level.waves.length, phase: 'break', breakLeft: level.waveBreak ?? 5,
    spawned: 0, killed: 0, leaked: 0, sealed: false,
  };
  let spawnTimer = 0, waveLeft = 0;

  const cellOf = (e: Enemy): Vec2 => [Math.floor(e.x), Math.floor(e.y)];
  const enemyCells = (): Vec2[] => enemies.filter((e) => e.y >= 0).map(cellOf);

  function refresh() {
    flow = computeFlow(grid, goals);
    state.sealed = !reaches(flow, entry[0], entry[1]);
    drawRoute(routeG, routeFrom(flow, entry[0], entry[1]), look);
    // Ціль, що стала стіною, більше не ціль — переобираємо наступного кадру.
    for (const e of enemies) {
      if (e.tx != null && grid.blocked(Math.floor(e.tx), Math.floor(e.ty!))) e.tx = null;
    }
  }

  // --- будівництво ----------------------------------------------------------
  /** @returns причина відмови або null, якщо можна */
  function whyNot(kind: string, cx: number, cy: number): string | null {
    const k = KINDS[kind];
    if (!k) return 'невідомий тип';
    if (!wallet.can(kind)) return 'мало чорнила';
    if (!grid.isFree(cx, cy, k.w, k.h)) return 'зайнято';
    const cells = grid.rect(cx, cy, k.w, k.h);
    const occupied = new Set(enemyCells().map(([x, y]) => `${x},${y}`));
    if (cells.some(([x, y]) => occupied.has(`${x},${y}`))) return 'там ворог';
    if (wouldSeal(grid, goals, cells, [entry, ...enemyCells()])) return 'замкне прохід';
    return null;
  }

  function build(kind: string, cx: number, cy: number, instant = false): BuildResult {
    const reason = whyNot(kind, cx, cy);
    if (reason) return { ok: false, reason };

    // whyNot уже відсіяв невідомий тип, тому тут kind точно є в таблиці.
    const k = KINDS[kind]!;
    wallet.spend(kind);
    const id = nextId++;
    grid.fill(cx, cy, k.w, k.h, k.mark, id);

    let rig: Rig | null = null, gfx: Graphics | null = null, comp: Build | null = null;
    if (k.tower) {
      comp = templateBuild(kind);
      rig = placeBuild(comp, ...footOf(cx, cy, k));
      combat.add(id, gunOf(comp.stats(), balance.projectiles), rig, cx + k.w / 2, cy + k.h / 2);
      if (!instant) wipeIn(rig.view, units, cx - k.w / 2, cy - k.h - 0.2, k.w * 2, k.h * 2, k.drawTime);
    } else {
      gfx = new Graphics();
      drawWall(gfx, cx, cy, look);
      wallLayer.addChild(gfx);
      if (!instant) wipeIn(gfx, wallLayer, cx, cy, k.w, k.h, k.drawTime);
    }

    built.set(id, { kind, cx, cy, rig, gfx, build: comp });
    refresh();
    return { ok: true, id };
  }

  /** Точка, у якій стоїть підошва башти: низ сліду по центру. */
  const footOf = (cx: number, cy: number, k: Kind): Vec2 => [cx + k.w / 2, cy + k.h];

  /** Заготовка з панелі інструментів — це рецепт із каталогу, зібраний начисто:
   *  шаблонні деталі гравець не обводив, тому якість у них ідеальна. */
  function templateBuild(kind: string): Build {
    const b = createBuild(towerParts.parts, towerParts);
    for (const [partId, host, socket] of towerParts.templates?.[kind] ?? []) {
      b.add(partId, host == null ? null : { node: b.nodes[host].id, name: socket! }, 1);
    }
    return b;
  }

  /**
   * Домалювати деталь до поставленої башти — це і є апгрейд.
   *
   * Риг перезбирається цілком: склад міняє не картинку, а дерево частин, тож
   * латати наявний риг вийшло б дорожче й крихкіше, ніж зібрати заново.
   * Відкат стрільби при цьому не скидається (див. combat.retune).
   */
  function addPart(
    towerId: number, partId: string,
    at: { node: number; name: string } | null, quality = 1,
  ): AddPartResult {
    const item = built.get(towerId);
    if (!item?.build) return { ok: false, reason: 'це не башта' };

    const oldCombos = item.build.stats().combos ?? [];
    const res = item.build.add(partId, at, quality);
    if (!res.ok) return res;

    // Платимо після того, як склад прийняв деталь: інакше відмова «зайнято»
    // з'їдала б чорнило. Не вистачило — знімаємо назад, слідів не лишається.
    const price = towerParts.parts[partId]?.cost ?? 0;
    if (!wallet.pay(price)) {
      item.build.remove(res.id);
      return { ok: false, reason: 'мало чорнила' };
    }

    const k = KINDS[item.kind]!;
    // item.build є (перевірено вище), отже це башта, отже риг у неї теж є.
    unplace(item.rig!);
    item.rig = placeBuild(item.build, ...footOf(item.cx, item.cy, k));
    const newStats = item.build.stats();
    const newCombos = newStats.combos ?? [];
    const freshCombos = newCombos.filter((c) => !oldCombos.includes(c));
    combat.retune(towerId, gunOf(newStats, balance.projectiles), item.rig);
    if (freshCombos.length || newStats.damage > 0) showNote(newStats, freshCombos);
    return { ok: true, id: res.id, spent: price, stats: newStats };
  }

  /** Радіус заготовки — те, що показує привид під пальцем ще до постановки.
   *  Рахуємо зі складу, а не з таблиці: інакше обіцяне коло розійдеться з тим,
   *  що справді стане на поле. Шаблон незмінний, тож рахуємо один раз. */
  const rangeCache = new Map<string, number>();
  function rangeOf(kind: string): number {
    if (!KINDS[kind]?.tower) return 0;
    if (!rangeCache.has(kind)) rangeCache.set(kind, templateBuild(kind).stats().range);
    return rangeCache.get(kind)!;
  }

  /** Башта під клітинкою — те, по чому тапає гравець, щоб відкрити майстерню. */
  function towerAt(cx: number, cy: number): TowerRef | null {
    const id = grid.ownerAt(cx, cy);
    const item = built.get(id);
    return item?.build ? { id, ...item } : null;
  }

  function erase(cx: number, cy: number): EraseResult {
    const id = grid.ownerAt(cx, cy);
    const item = built.get(id);
    if (!item) return { ok: false, reason: 'нічого стирати' };

    const k = KINDS[item.kind]!;
    grid.clearOwner(id);
    built.delete(id);
    combat.remove(id);
    if (item.rig) unplace(item.rig);
    if (item.gfx) item.gfx.destroy();
    smudge(item.cx, item.cy, k.w, k.h);
    const back = wallet.refund(item.kind);
    refresh();
    return { ok: true, kind: item.kind, refund: back };
  }

  // --- вороги ---------------------------------------------------------------
  /** @param hpMul живучість хвилі: типів ворога поки один, росте він. */
  function spawnEnemy(typeId = 'earling', hpMul = 1): Enemy {
    const def = balance.enemies[typeId];
    const rig = place(def.rig, entry[0] + 0.5, -1.6);
    const e: Enemy = { rig, def, hp: Math.round(def.hp * hpMul), x: entry[0] + 0.5, y: -1.6, tx: null, ty: null };
    enemies.push(e);
    state.spawned++;
    return e;
  }

  function despawn(e: Enemy) {
    unplace(e.rig);
    enemies.splice(enemies.indexOf(e), 1);
  }

  /** Шкода ворогу. Вбитий доливає чорнила в ручку — це єдиний дохід у грі.
   *  Візуал смерті (закреслення) — крок 7, поки просто зникає. */
  function damage(e: Enemy, amount: number): boolean {
    e.hp -= amount;
    if (e.hp > 0) { e.rig.fire('hit'); return false; }
    wallet.earn(e.def.bounty);
    state.killed++;
    despawn(e);
    return true;
  }

  /** Наскільки ворог просунувся: менше — ближче до бази. За полем, не за прямою. */
  function distOf(e: Enemy): number {
    const [cx, cy] = cellOf(e);
    if (!grid.inside(cx, cy)) return Infinity; // ще в коридорі над полем
    const d = flow.dist[cy * grid.cols + cx];
    return d < 0 ? Infinity : d;
  }

  const combat = createCombat({
    layer: shotLayer, look, enemies, damage, distOf,
  });

  function advance(e: Enemy, step: number) {
    // Коридор над полем: спершу просто спускаємось до першого ряду.
    if (e.y < 0.5) {
      e.y = Math.min(0.5, e.y + step);
      return;
    }
    const [cx, cy] = cellOf(e);
    if (grid.at(cx, cy) === BASE) {
      state.lives = Math.max(0, state.lives - 1);
      state.leaked++;
      keep.fire('hit');
      despawn(e);
      if (state.lives === 0) state.phase = 'lost';
      return;
    }
    if (e.tx == null) {
      const next = stepFrom(flow, cx, cy);
      if (!next) return; // шляху немає — стоїмо на місці
      e.tx = next[0] + 0.5;
      e.ty = next[1] + 0.5;
    }
    const dx = e.tx - e.x, dy = e.ty! - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= step) {
      e.x = e.tx; e.y = e.ty!;
      e.tx = null;
    } else {
      e.x += (dx / dist) * step;
      e.y += (dy / dist) * step;
    }
  }

  /** Хвилі. Наступна починається не за таймером, а коли поле чисте: перерва —
   *  це час домалювати лабіринт, і вкорочувати її автоматично нечесно. */
  function updateWaves(dt: number) {
    const w = level.waves[state.wave];

    if (state.phase === 'break') {
      state.breakLeft -= dt;
      if (state.breakLeft > 0) return;
      state.phase = 'wave';
      waveLeft = w.count;
      spawnTimer = 0;
      return;
    }

    if (waveLeft > 0) {
      spawnTimer -= dt;
      if (spawnTimer > 0) return;
      spawnEnemy(w.enemy ?? 'earling', w.hp ?? 1);
      waveLeft--;
      spawnTimer = w.every;
      return;
    }

    if (enemies.length) return; // хвиля виспавнилась, але ще не зачищена
    if (state.wave + 1 >= level.waves.length) { state.phase = 'won'; return; }
    state.wave++;
    state.phase = 'break';
    state.breakLeft = level.waveBreak ?? 5;
  }

  function update(dtMs: number) {
    const dt = dtMs / 1000;
    const over = state.phase === 'won' || state.phase === 'lost';

    if (!over) {
      updateWaves(dt);

      for (const e of [...enemies]) {
        advance(e, e.def.speed * (1 - (e.slow ?? 0)) * dt);
        if (!enemies.includes(e)) continue;
        e.rig.view.position.set(e.x, e.y);
        e.rig.moving = true;
      }

    }
    combat.update(dt, !over);

    // Ефекти й дихання рига йдуть навіть після кінця: аркуш не завмирає.
    for (let i = fx.length - 1; i >= 0; i--) if (fx[i].step(dt)) fx.splice(i, 1);
    for (const r of rigs) r.update(dtMs);
    units.children.sort((a, b) => a.y - b.y);
  }

  function rescale(s: number) {
    for (const r of rigs) r.setScale(s);
  }

  for (const [cx, cy] of level.startWalls ?? []) build('wall', cx, cy, true);
  refresh();

  return {
    state, wallet, grid, enemies, entry, goals, update, rescale, spawnEnemy, damage, combat,
    build, erase, whyNot, addPart, towerAt, footOf, rangeOf, built, KINDS,
    get flow() { return flow; },
  };
}
