// Панель вежі: кімнати, захисники в них і числа рівнів.
//
// Петля — рівно та, що в референсі (Grow Castle), тільки замість вибору героя
// зі ростера рука проводить силует:
//
//   тап по вежі            → панель; порожні кімнати позначені
//   тап по порожній        → полиця трьох захисників → рамка → став і стріляє
//   тап по зайнятій        → картка «рів 4 → 5, шкода 22 → 27» і ціна
//   кнопка рівня вежі      → відкриває наступну кімнату
//   розвилка на рівні 3    → Форт або Арсенал, один раз
//
// Головне, чого тут не було раніше: **числа**. Кожен апгрейд показує, що саме
// зміниться, до того як гравець заплатив. Перо цифри вміє, а літер і стрілки
// немає (`GLYPHS` — це `0-9 + - % × / ! .`), тому стрілка малюється ломаною.
//
// Два простори координат, і плутати їх не можна: полиця живе в екранних
// пікселях (поля аркуша), кімнати — у клітинках світу.

import { Application, Container, Graphics } from '../../lib/pixi.min.mjs';
import { penStroke, penText, textWidth } from '../view/ink.js';
import type { PenOpts } from '../view/ink.js';
import type { LaneGame } from '../laneGame.js';
import type { KeepData } from '../model/keep.js';
import type { TracePad } from './tracepad.js';
import type { Fx, Layout, Look, Vec2 } from '../types.js';

/** Що зараз на полиці. */
type Mode = 'keep' | 'pick' | 'level';

/** Карточка на полиці, в екранних пікселях. */
interface Card {
  /** що зробить тап: id захисника, 'grow', ключ гілки або 'level' */
  id: string;
  cost: number;
  /** контур для ескізу; порожній — малюємо іншим способом */
  outline: Vec2[][];
  size: Vec2;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TowerPanelOpts {
  canvas: HTMLCanvasElement;
  app: Application;
  hudLayer: Container;
  worldLayer: Container;
  look: Look;
  layout: Layout;
  game: LaneGame;
  keepData: KeepData;
  tracePad: TracePad;
}

export interface TowerPanel {
  readonly open: boolean;
  /** Дотик, що почався тут, полю віддавати не можна навіть після закриття. */
  readonly busyPointer: boolean;
  readonly mode: Mode;
  readonly cards: Card[];
  /** Яка кімната під точкою екрана, або null. */
  floorAt(px: number, py: number): number | null;
  /** @returns чи взяли тап на себе */
  tapAt(px: number, py: number): boolean;
  close(): void;
  resize(): void;
  update(dt: number): void;
}

/** Розкладка полиці: клітинку беремо якомога більшу, карточок небагато. */
function shelfGrid(n: number, w: number, h: number) {
  let best = { cols: n, cell: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const cell = Math.min(w / cols, h / Math.ceil(n / cols));
    if (cell > best.cell) best = { cols, cell };
  }
  return best;
}

/** Смуга під полицю: у коридорі ядро ширше за високе, тому місце знизу. */
function shelfBand(L: Layout) {
  const bottom = Math.max(L.oy, L.h * 0.12);
  return { x: 0, y: L.h - bottom, w: L.w, h: bottom };
}

/** Стрілка «стане»: перо літер не вміє, тому це ломана, а не гліф. */
function arrow(g: Graphics, x: number, y: number, s: number, o: PenOpts) {
  penStroke(g, [[x, y], [x + s, y]], o);
  penStroke(g, [[x + s * 0.6, y - s * 0.28], [x + s, y], [x + s * 0.6, y + s * 0.28]], o);
}

/** Іконка рівня вежі: кімната й стрілка вгору — «відкрити наступну». */
const GROW_ICON: Vec2[][] = [
  [[0.16, 0.98], [0.16, 0.52], [0.84, 0.52], [0.84, 0.98]],
  [[0.5, 0.44], [0.5, 0.04]],
  [[0.28, 0.22], [0.5, 0.02], [0.72, 0.22]],
];

export function createTowerPanel({
  canvas, app, hudLayer, worldLayer, look, layout, game, keepData, tracePad,
}: TowerPanelOpts): TowerPanel {
  const panel = new Graphics();   // карточки на полях
  const info = new Graphics();    // числа картки рівня
  const fly = new Graphics();     // обведене, що стискається на місце
  const screen = new Container();
  screen.addChild(panel, info, fly);
  screen.visible = false;
  hudLayer.addChild(screen);

  const marks = new Graphics();   // кімнати, у клітинках
  marks.visible = false;
  worldLayer.addChild(marks);

  let cards: Card[] = [];
  let mode: Mode = 'keep';
  let picked: number | null = null;  // вибрана кімната
  let busy = false;
  let swallowing = false;
  const anims: Fx[] = [];

  const W = keepData.shell.roomW;
  const affordable = (n: number) => game.wallet.ink >= n;
  const toScreenX = (cx: number) => layout.ox + cx * layout.cell;
  const toScreenY = (cy: number) => layout.oy + cy * layout.cell;

  // --- що на полиці ----------------------------------------------------------

  function buildCards(): Omit<Card, 'x' | 'y' | 'w' | 'h'>[] {
    const keep = game.keep;

    if (mode === 'pick') {
      return Object.entries(keepData.defenders).map(([id, d]) => ({
        id, cost: keep.placeCost(id), outline: d.outline, size: d.size,
      }));
    }

    if (mode === 'level' && picked != null) {
      const p = keep.preview(picked);
      const d = keep.floors[picked];
      if (!p || !d) return [];
      const def = keepData.defenders[d.kind];
      return [{ id: 'level', cost: p.cost, outline: def.outline, size: def.size }];
    }

    // Режим вежі: рівень і, якщо час, розвилка.
    const out: Omit<Card, 'x' | 'y' | 'w' | 'h'>[] = [];
    if (keep.canGrow()) {
      out.push({ id: 'grow', cost: keep.growCost(), outline: GROW_ICON, size: [1, 1] });
    }
    if (keep.canBranch()) {
      for (const [id, b] of Object.entries(keepData.branches)) {
        const roof = id === 'fort' ? keepData.shell.roofFort : keepData.shell.roofArsenal;
        out.push({ id, cost: b.cost, outline: roof, size: [W, keepData.shell.roofH] });
      }
    }
    return out;
  }

  function layoutShelf() {
    const items = buildCards();
    const band = shelfBand(layout);
    const { cols, cell } = shelfGrid(Math.max(1, items.length), band.w * 0.96, band.h * 0.92);
    const rows = Math.ceil(items.length / cols);
    const x0 = band.x + (band.w - cols * cell) / 2;
    const y0 = band.y + (band.h - rows * cell) / 2;
    cards = items.map((it, i) => ({
      ...it,
      x: x0 + (i % cols) * cell,
      y: y0 + Math.floor(i / cols) * cell,
      w: cell, h: cell,
    }));
  }

  // --- малювання -------------------------------------------------------------

  /** Ескіз у коробку `box`, з пропорціями: розтягнутий у квадрат силует —
   *  половина того, чому полиця раніше виглядала погано. */
  function sketch(g: Graphics, outline: Vec2[][], size: Vec2, cx: number, cy: number, box: number, o: PenOpts = {}) {
    const k = box / Math.max(size[0], size[1]);
    for (const s of outline) {
      penStroke(g, s.map(([x, y]): Vec2 => [cx + (x - 0.5) * size[0] * k, cy + (y - 0.5) * size[1] * k]), {
        color: look.pens.blue, width: box * 0.05, alpha: 0.85,
        jitter: box * 0.006, step: box * 0.16, overshoot: box * 0.02, halo: 0.12, ...o,
      });
    }
  }

  function drawPanel() {
    panel.clear();
    for (const c of cards) {
      const ok = affordable(c.cost);
      sketch(panel, c.outline, c.size, c.x + c.w / 2, c.y + c.h * 0.42, c.w * 0.54, {
        color: ok ? look.pens.blue : look.pens.pencil,
        alpha: ok ? 0.85 : 0.35,
      });
      const size = c.h * 0.2;
      const txt = String(c.cost);
      penText(panel, txt, c.x + c.w / 2 - textWidth(txt, size) / 2, c.y + c.h - size * 1.15, size,
        { color: ok ? look.pens.green : look.pens.pencil, alpha: ok ? 0.9 : 0.4, width: size * 0.12 });
    }
  }

  /**
   * Кімнати на вежі.
   *
   * Порожня відкрита — маркерна рамка: сюди можна поставити. Забита не
   * позначається взагалі, бо на ній уже намальовані дошки. Зайнята показує
   * рівень цифрою збоку — це те, за що гравець платить, і воно мусить бути
   * видно без жодного тапу.
   */
  function drawMarks() {
    marks.clear();
    if (!screen.visible) return;
    const keep = game.keep;
    const h = game.floorH();
    const x0 = game.towerX - W / 2;

    for (let f = 0; f < keep.floorCount; f++) {
      if (!keep.isOpen(f)) continue;
      const y = game.floorY(f);
      const top = y - h / 2;
      const here = picked === f;
      const busyFloor = keep.floors[f];

      if (!busyFloor) {
        marks.rect(x0 + 0.08, top + 0.1, W - 0.16, h - 0.2)
          .fill({ color: look.pens.marker, alpha: here ? 0.42 : 0.16 });
      } else if (here) {
        marks.rect(x0 + 0.08, top + 0.1, W - 0.16, h - 0.2)
          .fill({ color: look.pens.marker, alpha: 0.22 });
      }

      if (busyFloor) {
        // Рівень цифрою праворуч від кімнати, дрібно й олівцем: це підпис, а не
        // елемент бою.
        const s = h * 0.34;
        penText(marks, String(busyFloor.level), x0 + W + 0.12, y - s / 2, s, {
          color: look.pens.pencil, width: s * 0.11, alpha: 0.75,
          jitter: s * 0.02, step: s * 0.3, overshoot: s * 0.05, halo: 0.1,
        });
      }
    }
  }

  /** Картка рівня: «рів 4 → 5, шкода 22 → 27». Те, чого не було зовсім. */
  function drawInfo() {
    info.clear();
    if (!screen.visible || mode !== 'level' || picked == null) return;
    const p = game.keep.preview(picked);
    if (!p) return;

    const u = Math.max(13, layout.cell * 0.46);
    const x = toScreenX(game.towerX) + layout.cell * (W / 2 + 0.5);
    let y = toScreenY(game.band.y0) + u * 0.3;

    const rows: [string, number, number, number][] = [
      ['lvl', p.level[0], p.level[1], 0],
      ['dmg', p.damage[0], p.damage[1], 0],
      ['rate', p.rate[0], p.rate[1], 1],
      ['range', p.range[0], p.range[1], 1],
    ];

    for (const [id, a, b, dp] of rows) {
      const pen: PenOpts = {
        color: look.pens.pencil, width: u * 0.07, alpha: 0.75,
        jitter: u * 0.02, step: u * 0.2, overshoot: u * 0.03, halo: 0.1,
      };
      for (const s of ROW_ICONS[id]) {
        penStroke(info, s.map(([sx, sy]): Vec2 => [x + sx * u * 0.7, y + sy * u]), pen);
      }

      const was = dp ? a.toFixed(dp) : String(Math.round(a));
      const now = dp ? b.toFixed(dp) : String(Math.round(b));
      const wx = x + u;
      penText(info, was, wx, y, u * 0.92, { color: look.pens.pencil, alpha: 0.7, width: u * 0.1 });
      const ax = wx + textWidth(was, u * 0.92) + u * 0.15;
      arrow(info, ax, y + u * 0.5, u * 0.5, { ...pen, alpha: 0.6 });
      penText(info, now, ax + u * 0.72, y, u * 0.92,
        { color: look.pens.green, alpha: 0.95, width: u * 0.11 });
      y += u * 1.22;
    }
  }

  const redraw = () => { layoutShelf(); drawPanel(); drawMarks(); drawInfo(); };

  // --- стиснення на місце ----------------------------------------------------

  /** Обведене летить із рамки в кімнату, зменшуючись. Це той самий малюнок,
   *  який щойно вела рука, а не підміна спрайтом. */
  function shrinkIn(strokes: Vec2[][], toX: number, toY: number, then: () => void) {
    const box = tracePad.box;
    const g = new Graphics();
    for (const s of strokes) {
      if (s.length < 2) continue;
      penStroke(g, s.map(([x, y]): Vec2 => [(x - 0.5) * box.side, (y - 0.5) * box.side]), {
        color: look.pens.blue, width: box.side * 0.026, alpha: 0.9,
        jitter: box.side * 0.003, step: box.side * 0.045, overshoot: box.side * 0.006, halo: 0.14,
      });
    }
    fly.removeChildren();
    fly.addChild(g);

    const fromX = box.x + box.side / 2, fromY = box.y + box.side / 2;
    const target = 0.14, dur = 0.42;

    anims.push({
      t: 0,
      step(dt) {
        this.t += dt;
        const p = Math.min(1, this.t / dur);
        const e = 1 - (1 - p) * (1 - p); // easeOut: летить швидко, сідає м'яко
        g.position.set(fromX + (toX - fromX) * e, fromY + (toY - fromY) * e);
        g.scale.set(1 + (target - 1) * e);
        g.alpha = p > 0.75 ? (1 - p) / 0.25 : 1;
        if (p < 1) return false;
        g.destroy();
        then();
        return true;
      },
    });
  }

  // --- взаємодія -------------------------------------------------------------

  const screenAt = (ev: PointerEvent): Vec2 => {
    const r = canvas.getBoundingClientRect();
    return [
      (ev.clientX - r.left) * (app.screen.width / r.width),
      (ev.clientY - r.top) * (app.screen.height / r.height),
    ];
  };

  const cardAt = (px: number, py: number) =>
    cards.find((c) => px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h);

  /** Чи тапнули по вежі, і в яку кімнату. Кімната = ряд, тому й математика та
   *  сама, що в загоні: `rowOf` по смузі. */
  function floorAt(px: number, py: number): number | null {
    const cx = (px - layout.ox) / layout.cell;
    const cy = (py - layout.oy) / layout.cell;
    if (Math.abs(cx - game.towerX) > game.towerReach) return null;
    if (cy < game.band.y0 || cy > game.band.y1) return null;
    const f = Math.floor((cy - game.band.y0) / game.floorH());
    return Math.min(Math.max(f, 0), game.keep.floorCount - 1);
  }

  /** Обвести захисника й поставити його в кімнату. */
  async function place(floor: number, kind: string) {
    const def = keepData.defenders[kind];
    if (!def || !affordable(game.keep.placeCost(kind))) return;
    busy = true;

    const traced = await tracePad.show(def.outline);
    if (!traced) { busy = false; return; } // передумав — чорнило ціле

    shrinkIn(traced.strokes, toScreenX(game.towerX), toScreenY(game.floorY(floor)), () => {
      game.placeDefender(floor, kind, traced.quality, traced.strokes);
      busy = false;
      // Кімната зайнята — далі має сенс показувати її рівень, а не полицю.
      mode = 'level';
      redraw();
    });
  }

  function open(): boolean {
    mode = 'keep';
    picked = null;
    screen.visible = true;
    marks.visible = true;
    redraw();
    return true;
  }

  function close() {
    mode = 'keep';
    picked = null;
    screen.visible = false;
    marks.visible = false;
    panel.clear();
    info.clear();
    marks.clear();
  }

  function onDown(ev: PointerEvent) {
    const [px, py] = screenAt(ev);

    if (!screen.visible) {
      if (floorAt(px, py) == null) return;
      swallowing = true;
      ev.preventDefault();
      open();
      return;
    }

    // Дотик належить панелі від початку й до кінця: інакше тап, яким панель
    // закрили, доїхав би до поля вже після закриття.
    swallowing = true;
    if (busy || tracePad.open) return;

    const c = cardAt(px, py);
    if (c) {
      ev.preventDefault();
      if (!affordable(c.cost)) return; // мовчазна відмова: ціна вже сіра
      if (c.id === 'grow') { game.growKeep(); redraw(); return; }
      if (c.id === 'level') {
        if (picked != null) game.levelDefender(picked);
        redraw();
        return;
      }
      if (keepData.branches[c.id]) { game.pickBranch(c.id); redraw(); return; }
      if (picked != null) place(picked, c.id);
      return;
    }

    const f = floorAt(px, py);
    if (f != null) {
      ev.preventDefault();
      if (!game.keep.isOpen(f)) {
        // Забита кімната — не слот, а нагадування: відкривають її рівнем вежі.
        mode = 'keep';
        picked = null;
      } else {
        picked = f;
        mode = game.keep.floors[f] ? 'level' : 'pick';
      }
      redraw();
      return;
    }

    close();
  }

  function onUp() { swallowing = false; }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });

  return {
    get open() { return screen.visible; },
    get busyPointer() { return swallowing; },
    get mode() { return mode; },
    // Прев'ю не дає надійного кадру, тому геймплей перевіряється числами:
    // звідси тест бере, куди тикати синтетичним пальцем.
    get cards() { return cards; },
    floorAt,

    tapAt(px, py) {
      if (screen.visible) return true;
      if (floorAt(px, py) == null) return false;
      return open();
    },

    close,
    resize() { if (screen.visible) redraw(); },

    update(dt) {
      for (let i = anims.length - 1; i >= 0; i--) if (anims[i].step(dt)) anims.splice(i, 1);
    },
  };
}

/** Підписи рядків картки. Літер перо не вміє, тому кожен — маленький малюнок. */
const ROW_ICONS: Record<string, Vec2[][]> = {
  // рівень — щаблі
  lvl: [[[0.1, 0.95], [0.1, 0.15]], [[0.1, 0.8], [0.6, 0.8]], [[0.1, 0.5], [0.6, 0.5]], [[0.1, 0.2], [0.6, 0.2]]],
  // шкода — вістря
  dmg: [[[0.05, 0.95], [0.4, 0.08], [0.75, 0.95]]],
  // темп — подвійна галка «швидше»
  rate: [[[0.08, 0.15], [0.42, 0.5], [0.08, 0.85]], [[0.42, 0.15], [0.76, 0.5], [0.42, 0.85]]],
  // далекість — стрілка вдалеч
  range: [[[0.02, 0.5], [0.78, 0.5]], [[0.5, 0.26], [0.78, 0.5], [0.5, 0.74]]],
};
