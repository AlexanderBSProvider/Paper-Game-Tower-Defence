// Нотатки на полях режиму lane: чорнило, два силуети союзників, життя, хвиля.
//
// Дублює (не імпортує) дрібні хелпери з hud.ts — `penIcon`, `tally`, `drawEnd`,
// дірті-чек у tick(). Це навмисно: 50 рядків копії дешевші за спільний модуль
// заради одного другого споживача, а головне — hud.ts лишається недоторканим,
// як обіцяно в плані.
//
// Різниць із hud.ts дві, і обидві від розкладки коридору:
//   1. Смуга йде ЗВЕРХУ, а не знизу: низ ядра віддано полиці деталей вежі
//      (towerPanel#shelfBand), і сидіти там удвох нема як.
//   2. Іконок інструментів не малюємо — беремо контури з allies.json. Той самий
//      outline, який гравець потім обводитиме в рамці, тож іконка не може
//      розійтися з тим, що вийде на полі.
//
// Каталогу турелей у смузі немає: вежа апгрейдиться тапом по самій вежі
// (towerPanel), і кнопка на полях була б другим входом у ті самі двері.

import { Container, Graphics } from '../../lib/pixi.min.mjs';
import { penStroke, penPath, penRect, penText, textWidth, hatch, scribble } from '../view/ink.js';
import type { PenOpts } from '../view/ink.js';
import type { LaneGame, Phase } from '../laneGame.js';
import type { Allies } from '../model/lane.js';
import type { AllyKind } from '../model/squad.js';
import type { Balance, Layout, Look, Vec2 } from '../types.js';

/** Місце під іконку в смузі полів. `gauge` є лише в ручки. */
interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
  gauge?: { x: number; y: number; w: number; h: number };
}

export interface LaneHudOpts {
  hud: Container;
  look: Look;
  balance: Balance;
  allies: Allies;
  game: LaneGame;
  onRestart?: () => void;
}

export interface LaneHud {
  resize(L: Layout): void;
  tick(): void;
  /** Кого малюватимемо наступним тапом по ряду. */
  readonly tool: AllyKind;
  setTool(t: AllyKind): void;
  /** @returns що під пальцем: тип союзника, 'restart' або нічого */
  hit(px: number, py: number): string | null;
}

const SLOTS = ['ink', 'melee', 'ranged', 'lives'];
const TOOLS = new Set<string>(['melee', 'ranged']);

/** Ручка збоку: корпус, конус і носик. Усередині корпусу видно чорнило. */
function penIcon(g: Graphics, x: number, y: number, u: number, pen: PenOpts) {
  const bx = x + 0.28 * u, bw = 0.44 * u;
  penPath(g, [
    [bx, y + 0.02 * u], [bx + bw, y + 0.02 * u], [bx + bw, y + 0.7 * u],
    [x + 0.5 * u, y + 0.98 * u], [bx, y + 0.7 * u],
  ], { ...pen, closed: true, overshoot: u * 0.04 });
  penStroke(g, [[bx, y + 0.14 * u], [bx + bw, y + 0.14 * u]], { ...pen, alpha: 0.5 });
  return { x: bx + u * 0.035, y: y + 0.17 * u, w: bw - u * 0.07, h: 0.5 * u };
}

/** Життя — рисочки, як рахунок на полях. Втрачені закреслені червоним. */
function tally(
  g: Graphics, x: number, y: number, u: number,
  total: number, alive: number, look: Look,
) {
  const per = 5;
  const gap = 0.11 * u, rowH = 0.46 * u;
  const rows = Math.ceil(total / per);
  const top = y + (u - rows * rowH) / 2;

  for (let i = 0; i < total; i++) {
    const r = (i / per) | 0, k = i % per;
    const gx = x + (k + 0.5) * gap;
    const gy = top + r * rowH;
    const dead = i >= alive;
    const col = dead ? look.pens.red : look.pens.blue;
    const o: PenOpts = { color: col, width: u * 0.045, alpha: dead ? 0.7 : 0.85, jitter: u * 0.02, step: u * 0.2, overshoot: u * 0.03, halo: 0.1 };
    if (k === per - 1) {
      penStroke(g, [[x + 0.1 * gap, gy + 0.34 * rowH], [gx + gap * 0.6, gy + 0.04 * rowH]], o);
    } else {
      penStroke(g, [[gx, gy + 0.04 * rowH], [gx + gap * 0.18, gy + 0.34 * rowH]], o);
    }
  }
}

export function createLaneHud({ hud, look, balance, allies, game, onRestart }: LaneHudOpts): LaneHud {
  const still = new Graphics();
  const live = new Graphics();
  const over = new Graphics(); // фінальна записка поверх усього
  hud.addChild(still, live, over);

  const slots = new Map<string, Slot>();
  let u = 24;
  let tool: AllyKind = 'melee';
  /** останнє намальоване — щоб не перемальовувати щокадру */
  let shown: {
    ink: number; lives: number; tool: string; phase: Phase; wave: number; shield: number;
  } | null = null;
  let waveAt: { x: number; y: number } | null = null;
  // `!` — інваріант: place() ставить L0 і його кличе resize(), яку main кличе
  // на старті. Усе, що читає L0, працює лише після цього.
  let L0!: Layout;
  let box: { x: number; y: number; w: number; h: number } | null = null;

  /** Іконка союзника — його ж контур із allies.json, вписаний у коробку u×u. */
  function allyIcon(g: Graphics, id: string, x: number, y: number, size: number, pen: PenOpts) {
    for (const s of allies[id as AllyKind].outline) {
      penStroke(g, s.map(([sx, sy]): Vec2 => [x + sx * size, y + sy * size]), {
        ...pen, jitter: size * 0.012, step: size * 0.16, overshoot: size * 0.02,
      });
    }
  }

  function place(L: Layout) {
    L0 = L;
    const n = SLOTS.length;
    // Смуга зверху: низ ядра належить полиці деталей вежі.
    const top = Math.max(L.oy, L.h * 0.1);
    const side = Math.max(L.ox, 0);
    const vertical = side > top;

    if (vertical) {
      u = Math.min(64, side / 1.25, L.h / (1.62 * n));
      const bw = 1.2 * u, bh = 1.6 * u;
      const x = (side - bw) / 2;
      const y0 = (L.h - n * bh) / 2;
      SLOTS.forEach((id, i) => slots.set(id, { x, y: y0 + i * bh, w: bw, h: bh }));
      waveAt = { x: L.w - side / 2, y: L.h * 0.12 };
    } else {
      u = Math.min(64, top / 1.62, L.w / (1.25 * n));
      const bw = 1.2 * u, bh = 1.6 * u;
      const x0 = (L.w - n * bw) / 2;
      const y = (top - bh) / 2;
      SLOTS.forEach((id, i) => slots.set(id, { x: x0 + i * bw, y, w: bw, h: bh }));
      // У кут смуги, а не по центру: центр зайнятий самим рядом іконок.
      waveAt = { x: L.w - u, y: top - u * 0.4 };
    }
  }

  function drawStill() {
    still.clear();
    const pen: PenOpts = { color: look.pens.blue, width: u * 0.045, alpha: 0.85, jitter: u * 0.018, step: u * 0.22, overshoot: u * 0.05, halo: 0.12 };

    for (const id of SLOTS) {
      const s = slots.get(id);
      if (!s) continue;
      const ix = s.x + (s.w - u) / 2;
      if (id === 'ink') s.gauge = penIcon(still, ix, s.y, u, pen);
      else if (TOOLS.has(id)) allyIcon(still, id, ix + u * 0.1, s.y, u * 0.8, pen);

      if (id === 'lives' || id === 'ink') continue;
      const size = u * 0.4;
      const txt = String(allies[id as AllyKind].cost);
      penText(still, txt, s.x + (s.w - textWidth(txt, size)) / 2, s.y + u, size,
        { color: look.pens.blue, alpha: 0.8 });
    }
  }

  function drawLive() {
    live.clear();
    const ink = game.wallet.ink;

    // Чорнило в корпусі ручки: штрихування росте знизу вгору.
    const s = slots.get('ink');
    const b = s?.gauge;
    if (s && b) {
      const p = Math.max(0, Math.min(1, ink / balance.economy.gauge));
      const top = b.y + b.h * (1 - p);
      if (p > 0.01) {
        hatch(live, b.x, top, b.w, b.h * p, {
          color: look.pens.green, angle: 0, gap: Math.max(1.4, u * 0.055),
          jitterGap: 0.2, width: u * 0.04, alpha: 0.7, halo: 0.1, jitter: u * 0.01, step: u * 0.14, overshoot: 0,
        });
        penStroke(live, [[b.x - u * 0.02, top], [b.x + b.w + u * 0.02, top]],
          { color: look.pens.green, width: u * 0.05, alpha: 0.95, jitter: u * 0.012, step: u * 0.12, overshoot: u * 0.02, halo: 0.15 });
      }
      const size = u * 0.4;
      penText(live, String(ink), s.x + (s.w - textWidth(String(ink), size)) / 2, s.y + u, size,
        { color: look.pens.green, alpha: 0.9 });
    }

    const ls = slots.get('lives');
    if (ls) {
      tally(live, ls.x + ls.w * 0.14, ls.y, u, game.state.maxLives, game.state.lives, look);
      // Щит гілки Форту — дужки перед рисочками життів. Без цього перк невидимий:
      // гравець платить за рівень і не бачить, за що саме.
      for (let i = 0; i < game.shield; i++) {
        const sx = ls.x + ls.w * 0.14 + u * (0.72 + i * 0.16);
        penStroke(live, [[sx, ls.y + u * 0.22], [sx + u * 0.1, ls.y + u * 0.5], [sx, ls.y + u * 0.78]], {
          color: look.pens.blue, width: u * 0.05, alpha: 0.8,
          jitter: u * 0.015, step: u * 0.14, overshoot: u * 0.02, halo: 0.1,
        });
      }
    }

    // Не по кишені — ціна закреслюється: тап по такому силуету нічого не дасть,
    // і краще це видно до тапу, ніж після мовчазної відмови.
    for (const id of TOOLS) {
      const t = slots.get(id);
      if (!t || ink >= allies[id as AllyKind].cost) continue;
      scribble(live, t.x + t.w * 0.1, t.y + u * 0.15, t.w * 0.8, u * 0.9,
        { color: look.pens.pencil, alpha: 0.45, passes: 1, halo: 0 });
    }

    // Обраний силует підкреслено маркером.
    const t = slots.get(tool);
    if (t) {
      live.rect(t.x + t.w * 0.08, t.y + u * 1.46, t.w * 0.84, u * 0.11)
        .fill({ color: look.pens.marker, alpha: 0.6 });
    }

    if (waveAt) {
      const size = u * 0.44;
      const txt = `${Math.min(game.state.wave + 1, game.state.waves)}/${game.state.waves}`;
      penText(live, txt, waveAt.x - textWidth(txt, size) / 2, waveAt.y - size / 2, size,
        { color: look.pens.pencil, alpha: 0.7 });
    }

    shown = {
      ink, lives: game.state.lives, tool,
      phase: game.state.phase, wave: game.state.wave, shield: game.shield,
    };
  }

  /** Кінець партії: записка поверх аркуша. Виграв — велика галочка, програв —
   *  усе закреслено. Знизу — стрілка «ще раз»; тап будь-де починає заново. */
  function drawEnd() {
    over.clear();
    box = null;
    const st = game.state;
    const win = st.phase === 'won';
    if (!win && st.phase !== 'lost') return;

    const W = L0.w, H = L0.h;
    const s = Math.min(W, H) * 0.34;
    const cx = W / 2, cy = H / 2 - s * 0.25;

    // Шар множиться на папір, тож затемнити можна, освітлити — ні.
    const bx = cx - s * 0.78, by = cy - s * 0.62, bw = s * 1.56, bh = s * 1.95;
    const dim = { color: 0x8f8875, alpha: 0.5 };
    over.rect(0, 0, W, by).fill(dim);
    over.rect(0, by + bh, W, H - by - bh).fill(dim);
    over.rect(0, by, bx, bh).fill(dim);
    over.rect(bx + bw, by, W - bx - bw, bh).fill(dim);
    const pen: PenOpts = { width: s * 0.045, alpha: 0.9, jitter: s * 0.012, step: s * 0.12, overshoot: s * 0.03, halo: 0.15 };

    penRect(over, bx, by, bw, bh, { ...pen, color: look.pens.pencil, alpha: 0.6, width: s * 0.022 });

    if (win) {
      penStroke(over, [[cx - s * 0.42, cy], [cx - s * 0.1, cy + s * 0.33], [cx + s * 0.46, cy - s * 0.4]],
        { ...pen, color: look.pens.green, width: s * 0.085 });
    } else {
      scribble(over, cx - s * 0.45, cy - s * 0.4, s * 0.9, s * 0.78,
        { color: look.pens.red, alpha: 0.85, passes: 3, halo: 0.12 });
    }

    const size = s * 0.3;
    const txt = `${win ? st.waves : st.wave}/${st.waves}`;
    penText(over, txt, cx - textWidth(txt, size) / 2, cy + s * 0.52, size,
      { color: win ? look.pens.green : look.pens.red, alpha: 0.95, width: size * 0.14 });

    // Кругова стрілка: розімкнене коло з двома рисочками на кінці.
    const r = s * 0.2, ay = cy + s * 1.2, from = -2.2;
    const pts: Vec2[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = from + (i / 24) * 5.1;
      pts.push([cx + Math.cos(a) * r, ay + Math.sin(a) * r]);
    }
    penStroke(over, pts, { ...pen, color: look.pens.blue, width: s * 0.05, overshoot: 0 });
    const hx = cx + Math.cos(from) * r, hy = ay + Math.sin(from) * r;
    for (const d of [0.7, 2.3]) {
      penStroke(over, [[hx, hy], [hx + Math.cos(from + d) * s * 0.13, hy + Math.sin(from + d) * s * 0.13]],
        { ...pen, color: look.pens.blue, width: s * 0.045 });
    }

    box = { x: 0, y: 0, w: W, h: H }; // після кінця тап будь-де = ще раз
  }

  return {
    resize(L) { place(L); drawStill(); drawLive(); drawEnd(); },

    /** Дешева перевірка щокадру: перемальовуємо лише коли число змінилось. */
    tick() {
      if (!shown) return;
      const st = game.state;
      if (shown.ink === game.wallet.ink && shown.lives === st.lives && shown.tool === tool
        && shown.phase === st.phase && shown.wave === st.wave
        && shown.shield === game.shield) return;
      const phaseChanged = shown.phase !== st.phase;
      drawLive();
      if (phaseChanged) drawEnd();
    },

    get tool() { return tool; },
    setTool(t) { tool = t; },

    hit(px, py) {
      if (box) { onRestart?.(); return 'restart'; }
      for (const id of TOOLS) {
        const s = slots.get(id);
        if (s && px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h) return id;
      }
      return null;
    },
  };
}
