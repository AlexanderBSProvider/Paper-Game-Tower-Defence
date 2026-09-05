// Нотатки на полях режиму lane: ручка з чорнилом, життя, хвиля, і записка
// про нову зброю.
//
// Дублює (не імпортує) дрібні хелпери з hud.ts — `penIcon`, `tally`, `drawEnd`,
// дірті-чек у tick(). Це навмисно: 50 рядків копії дешевші за спільний модуль
// заради одного другого споживача, а головне — hud.ts лишається недоторканим,
// як обіцяно в плані.
//
// Іконок зброї на полях НЕМАЄ (рішення власника): зброю обирають у рамці
// обведення, після того як обрано ряд. У бою гравець дивиться на поле, а не
// на смугу карток.
//
// Смуга йде ЗВЕРХУ: у коридорі ядро ширше за високе, і вільне місце — над
// полем. У ландскейпі смуга лишається збоку, як у лабіринті.

import { Container, Graphics } from '../../lib/pixi.min.mjs';
import { penStroke, penPath, penRect, penText, textWidth, hatch, scribble } from '../view/ink.js';
import type { PenOpts } from '../view/ink.js';
import type { LaneGame, Phase } from '../laneGame.js';
import type { WeaponsData } from '../model/weapons.js';
import type { BuildingsData } from '../model/buildings.js';
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
  weapons: WeaponsData;
  buildings: BuildingsData;
  game: LaneGame;
  onRestart?: () => void;
}

export interface LaneHud {
  resize(L: Layout): void;
  tick(dt: number): void;
  /** Центр колби ручки в екранних px — сюди летять краплі чорнила. */
  gaugeAt(): Vec2;
  /** @returns 'restart', якщо тап забрала фінальна записка, інакше нічого */
  hit(px: number, py: number): string | null;
}

const SLOTS = ['ink', 'lives'];

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

export function createLaneHud({ hud, look, balance, weapons, buildings, game, onRestart }: LaneHudOpts): LaneHud {
  const still = new Graphics();
  const live = new Graphics();
  const toast = new Graphics(); // записка «нова зброя»
  const over = new Graphics();  // фінальна записка поверх усього
  hud.addChild(still, live, toast, over);

  const slots = new Map<string, Slot>();
  let u = 24;
  /** останнє намальоване — щоб не перемальовувати щокадру */
  let shown: { ink: number; lives: number; phase: Phase; wave: number; slots: boolean; plots: boolean } | null = null;
  let waveAt: { x: number; y: number } | null = null;
  // `!` — інваріант: place() ставить L0 і його кличе resize(), яку main кличе
  // на старті. Усе, що читає L0, працює лише після цього.
  let L0!: Layout;
  let box: { x: number; y: number; w: number; h: number } | null = null;

  /** Черга записок про нову зброю чи будівлю: показуємо по одній, 2.5 с кожну. */
  const queue: { id: string; kind: 'weapon' | 'building' }[] = [];
  let toastLeft = 0;

  const anyUsable = () => Object.entries(weapons.weapons)
    .some(([id, w]) => !id.startsWith('_') && game.isUnlocked(id) && game.wallet.ink >= w.cost);
  const anyBuildable = () => Object.entries(buildings.buildings)
    .some(([id, b]) => !id.startsWith('_') && game.isBuildingUnlocked(id) && game.wallet.ink >= b.cost);

  function place(L: Layout) {
    L0 = L;
    const n = SLOTS.length;
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
      u = Math.min(64, top / 1.62, L.w / (1.25 * 4));
      const bw = 1.2 * u, bh = 1.6 * u;
      // Ручка ліворуч, життя праворуч: між ними місце для записки про зброю.
      const y = (top - bh) / 2;
      slots.set('ink', { x: L.w * 0.08, y, w: bw, h: bh });
      slots.set('lives', { x: L.w * 0.92 - bw, y, w: bw, h: bh });
      waveAt = { x: L.w / 2, y: top - u * 0.4 };
    }
  }

  function drawStill() {
    still.clear();
    const pen: PenOpts = { color: look.pens.blue, width: u * 0.045, alpha: 0.85, jitter: u * 0.018, step: u * 0.22, overshoot: u * 0.05, halo: 0.12 };
    const s = slots.get('ink');
    if (s) s.gauge = penIcon(still, s.x + (s.w - u) / 2, s.y, u, pen);
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
    if (ls) tally(live, ls.x + ls.w * 0.14, ls.y, u, game.state.maxLives, game.state.lives, look);

    if (waveAt) {
      const size = u * 0.44;
      const txt = `${Math.min(game.state.wave + 1, game.state.waves)}/${game.state.waves}`;
      penText(live, txt, waveAt.x - textWidth(txt, size) / 2, waveAt.y - size / 2, size,
        { color: look.pens.pencil, alpha: 0.7 });
    }

    // Слоти й фундаменти світяться, коли є що намалювати: є куди тапати.
    const active = anyUsable(), plots = anyBuildable();
    game.setSlotsActive(active);
    game.setPlotsActive(plots);

    shown = { ink, lives: game.state.lives, phase: game.state.phase, wave: game.state.wave, slots: active, plots };
  }

  /**
   * Записка «відкрито нову зброю»: великий ескіз трафарету посеред поля з
   * маркерною плямою під ним і зірочкою-спалахом. Тримається 2.5 с і тане.
   */
  function drawToast(u: { id: string; kind: 'weapon' | 'building' }, p: number) {
    toast.clear();
    const w = u.kind === 'weapon' ? weapons.weapons[u.id] : buildings.buildings[u.id];
    if (!w) return;
    const s = Math.min(L0.w, L0.h) * 0.22;
    const cx = L0.w / 2, cy = L0.oy + L0.h * 0.02 + s * 0.6;
    const a = p < 0.15 ? p / 0.15 : p > 0.8 ? (1 - p) / 0.2 : 1;
    toast.alpha = a;
    toast.rect(cx - s * 0.62, cy - s * 0.58, s * 1.24, s * 1.2).fill({ color: look.pens.marker, alpha: 0.5 });
    penRect(toast, cx - s * 0.6, cy - s * 0.56, s * 1.2, s * 1.16, {
      color: look.pens.pencil, width: s * 0.02, alpha: 0.6, jitter: s * 0.008, step: s * 0.2, overshoot: s * 0.03, halo: 0,
    });
    for (const st of w.outline) {
      penStroke(toast, st.map(([x, y]): Vec2 => [cx - s * 0.5 + x * s, cy - s * 0.5 + y * s]), {
        color: look.pens.blue, width: s * 0.05, alpha: 0.9, jitter: s * 0.01, step: s * 0.15, overshoot: s * 0.02, halo: 0.14,
      });
    }
    // Промінці по кутах — «нове!».
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as Vec2[]) {
      const x0 = cx + dx * s * 0.66, y0 = cy + dy * s * 0.62;
      penStroke(toast, [[x0, y0], [x0 + dx * s * 0.12, y0 + dy * s * 0.12]], {
        color: look.pens.orange ?? look.pens.red, width: s * 0.035, alpha: 0.9, jitter: s * 0.006, step: s * 0.1, overshoot: 0, halo: 0.1,
      });
    }
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

  const TOAST = 2.5;

  return {
    resize(L) { place(L); drawStill(); drawLive(); drawEnd(); },

    /** Дешева перевірка щокадру: перемальовуємо лише коли число змінилось. */
    tick(dt) {
      queue.push(...game.takeUnlocks());
      if (toastLeft > 0 || queue.length) {
        if (toastLeft <= 0) toastLeft = TOAST;
        toastLeft -= dt;
        const id = queue[0];
        if (toastLeft <= 0) { queue.shift(); toast.clear(); }
        else if (id) drawToast(id, 1 - toastLeft / TOAST);
      }

      if (!shown) return;
      const st = game.state;
      if (shown.ink === game.wallet.ink && shown.lives === st.lives
        && shown.phase === st.phase && shown.wave === st.wave && shown.slots === anyUsable()
        && shown.plots === anyBuildable()) return;
      const phaseChanged = shown.phase !== st.phase;
      drawLive();
      if (phaseChanged) drawEnd();
    },

    gaugeAt() {
      const b = slots.get('ink')?.gauge;
      if (!b) return [u, u];
      return [b.x + b.w / 2, b.y + b.h / 2];
    },

    hit() {
      if (box) { onRestart?.(); return 'restart'; }
      return null;
    },
  };
}
