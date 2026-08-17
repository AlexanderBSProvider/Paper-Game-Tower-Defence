// Апгрейд єдиної вежі: тап по ній → деталі на полях → тягнеш на місце
// кріплення → обводиш у рамці → обведене стискається на вежу.
//
// Це та сама петля, що в workshop.ts, і навмисно: гравець уже знає її з
// лабіринту. Різниця одна, але вона прибирає половину коду — вежа тут одна й
// стоїть на фіксованому місці, тому сокети рахуються від сталого якоря, а не
// через game.footOf(cx, cy, KINDS[kind]) по клітинці сітки.
//
// Два простори координат, і плутати їх не можна: панель деталей живе в
// екранних пікселях (поля аркуша), а сокети — у клітинках світу.

import { Application, Container, Graphics } from '../../lib/pixi.min.mjs';
import { penStroke, penCircle, penText, textWidth } from '../view/ink.js';
import type { PenOpts } from '../view/ink.js';
import type { LaneGame } from '../laneGame.js';
import { canReink } from '../model/build.js';
import type { Socket } from '../model/build.js';
import type { TracePad } from './tracepad.js';
import type { Fx, Layout, Look, TowerPart, TowerParts, Vec2 } from '../types.js';

/** Ескіз деталі на полях, в екранних пікселях. */
interface ShelfSlot {
  id: string;
  part: TowerPart;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Held {
  id: string;
  part: TowerPart;
  px: number;
  py: number;
}

export interface TowerPanelOpts {
  canvas: HTMLCanvasElement;
  app: Application;
  hudLayer: Container;
  worldLayer: Container;
  look: Look;
  layout: Layout;
  game: LaneGame;
  towerParts: TowerParts;
  tracePad: TracePad;
  /** скільки клітинок навколо вежі вважати тапом по ній */
  hitPad?: number;
}

export interface TowerPanel {
  readonly open: boolean;
  /** Дотик, що почався тут, полю віддавати не можна навіть після закриття. */
  readonly busyPointer: boolean;
  readonly slots: ShelfSlot[];
  readonly sockets: Socket[];
  /** Яка деталь вежі під точкою екрана, або null. */
  partAt(px: number, py: number): number | null;
  /** @returns чи взяли тап на себе */
  tapAt(px: number, py: number): boolean;
  close(): void;
  resize(): void;
  update(dt: number): void;
}

/** Скільки екранних пікселів «дотягується» палець до місця кріплення. */
const SNAP = 46;

/** Розкладка полиці: клітинку беремо якомога більшу, деталей небагато. */
function shelfGrid(n: number, w: number, h: number) {
  let best = { cols: n, rows: 1, cell: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cell = Math.min(w / cols, h / rows);
    if (cell > best.cell) best = { cols, rows, cell };
  }
  return best;
}

/**
 * Смуга під полицю. У коридорі ядро ширше за високе, тому вільне місце
 * лишається знизу — на відміну від лабіринту, де воно могло бути й збоку.
 */
function shelfBand(L: Layout) {
  const bottom = Math.max(L.oy, L.h * 0.12);
  return { x: 0, y: L.h - bottom, w: L.w, h: bottom };
}

export function createTowerPanel({
  canvas, app, hudLayer, worldLayer, look, layout, game, towerParts, tracePad,
  hitPad = 1.5,
}: TowerPanelOpts): TowerPanel {
  // Заготовки на полицю не потрапляють: вони не чіпляються в сокет, з них
  // вежа починається.
  const shelf = Object.entries(towerParts.parts)
    .filter(([id, p]) => !id.startsWith('_') && p.kind !== 'base')
    .map(([id, part]) => ({ id, part }));

  const panel = new Graphics();   // ескізи деталей на полях
  const drag = new Graphics();    // деталь під пальцем
  const fly = new Graphics();     // обведене, що стискається на місце
  const screen = new Container();
  screen.addChild(panel, drag, fly);
  screen.visible = false;
  hudLayer.addChild(screen);

  const marks = new Graphics();   // місця кріплення, у клітинках
  marks.visible = false;
  worldLayer.addChild(marks);

  let slots: ShelfSlot[] = [];
  let sockets: Socket[] = [];
  let held: Held | null = null;
  let snap: Socket | null = null;
  let busy = false;
  let swallowing = false;
  const anims: Fx[] = [];

  const affordable = (part: TowerPart) => game.wallet.ink >= (part.cost ?? 0);
  const toScreenX = (cx: number) => layout.ox + cx * layout.cell;
  const toScreenY = (cy: number) => layout.oy + cy * layout.cell;

  /**
   * Сокети в клітинках світу. Уся різниця з майстернею лабіринту — тут:
   * замість footOf по клітинці сітки беремо сталий якір вежі, бо вона одна
   * й нікуди не переїжджає.
   */
  function readSockets(): Socket[] {
    const s = layout.spriteScale;
    return game.tower.freeSockets().map((k) => ({
      ...k,
      x: game.towerX + k.x * s,
      y: game.towerY + k.y * s,
    }));
  }

  // --- малювання -------------------------------------------------------------

  /** Ескіз деталі: той самий контур, що гравець потім обводитиме. */
  function sketch(
    g: Graphics, part: TowerPart,
    cx: number, cy: number, size: number, o: PenOpts = {},
  ) {
    for (const s of part.outline) {
      penStroke(g, s.map(([x, y]): Vec2 => [cx + (x - 0.5) * size, cy + (y - 0.5) * size]), {
        color: look.pens.blue, width: size * 0.05, alpha: 0.85,
        jitter: size * 0.006, step: size * 0.16, overshoot: size * 0.02, halo: 0.12, ...o,
      });
    }
  }

  function layoutShelf() {
    const band = shelfBand(layout);
    const { cols, cell } = shelfGrid(shelf.length, band.w * 0.96, band.h * 0.92);
    const rows = Math.ceil(shelf.length / cols);
    const x0 = band.x + (band.w - cols * cell) / 2;
    const y0 = band.y + (band.h - rows * cell) / 2;
    slots = shelf.map((it, i) => ({
      ...it,
      x: x0 + (i % cols) * cell,
      y: y0 + Math.floor(i / cols) * cell,
      w: cell, h: cell,
    }));
  }

  function drawPanel() {
    panel.clear();
    for (const s of slots) {
      const cx = s.x + s.w / 2, cy = s.y + s.h * 0.44;
      const ok = affordable(s.part);
      // Не по кишені — той самий ескіз олівцем: видно, що є, і видно, що зарано.
      sketch(panel, s.part, cx, cy, s.w * 0.56, {
        color: ok ? look.pens.blue : look.pens.pencil,
        alpha: ok ? 0.85 : 0.35,
      });

      const size = s.h * 0.2;
      const txt = String(s.part.cost ?? 0);
      penText(panel, txt, cx - textWidth(txt, size) / 2, s.y + s.h - size * 1.15, size,
        { color: ok ? look.pens.green : look.pens.pencil, alpha: ok ? 0.9 : 0.4, width: size * 0.12 });
    }
  }

  /** Кружечки на вежі; те, куди дотягнувся палець, — жовтим. */
  function drawMarks() {
    marks.clear();
    if (!screen.visible) return;
    for (const k of sockets) {
      const hot = snap && snap.node === k.node && snap.name === k.name;
      penCircle(marks, k.x, k.y, hot ? 0.34 : 0.22, {
        color: hot ? look.pens.marker : look.pens.pencil,
        width: hot ? 0.075 : 0.045, alpha: hot ? 0.95 : 0.5,
        jitter: 0.02, step: 0.16, halo: hot ? 0.25 : 0,
      });
      if (hot) marks.circle(k.x, k.y, 0.3).fill({ color: look.pens.marker, alpha: 0.3 });
    }
  }

  function drawHeld() {
    drag.clear();
    if (!held) return;
    sketch(drag, held.part, held.px, held.py, Math.min(layout.w, layout.h) * 0.13, { alpha: 0.75 });
  }

  // --- стиснення на місце ----------------------------------------------------

  /** Обведене летить із рамки на вежу, зменшуючись. Це той самий малюнок,
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
    const target = 0.12, dur = 0.42;

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

  const slotAt = (px: number, py: number) =>
    slots.find((s) => px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h);

  function nearestSocket(px: number, py: number): Socket | null {
    let best: Socket | null = null, bestD = SNAP;
    for (const k of sockets) {
      const d = Math.hypot(px - toScreenX(k.x), py - toScreenY(k.y));
      if (d < bestD) { best = k; bestD = d; }
    }
    return best;
  }

  /** Чи тапнули по самій вежі. Замість грід-математики — коробка навколо
   *  якоря: вежа одна й на місці, тому цього досить. */
  function onTower(px: number, py: number) {
    const cx = (px - layout.ox) / layout.cell;
    const cy = (py - layout.oy) / layout.cell;
    const h = game.band.y1 - game.band.y0;
    return Math.abs(cx - game.towerX) <= hitPad && Math.abs(cy - game.towerY) <= h / 2;
  }

  /**
   * Яка деталь вежі під пальцем. Коробка рахується від піво́та, як у
   * build.metrics(): у ствола він біля кріплення, а не внизу по центру, тож
   * інакше палець промахувався б повз горизонтальні деталі.
   */
  function partAt(px: number, py: number) {
    const cx = (px - layout.ox) / layout.cell;
    const cy = (py - layout.oy) / layout.cell;
    const s = layout.spriteScale;

    let best: { id: number; d: number } | null = null;
    for (const n of game.tower.nodes) {
      const [w, h] = n.part.size;
      const [pvx, pvy] = n.part.pivot ?? [0.5, 1];
      const nx = game.towerX + n.x * s, ny = game.towerY + n.y * s;
      const x0 = nx - w * pvx * s, y0 = ny - h * pvy * s;
      if (!canReink(n)) continue; // тумбу підсилити нема чим — хай тап іде далі
      if (cx < x0 || cx > x0 + w * s || cy < y0 || cy > y0 + h * s) continue;
      // Деталі перекриваються, тому беремо ту, чий центр ближчий до пальця.
      const d = Math.hypot(cx - (x0 + w * s / 2), cy - (y0 + h * s / 2));
      if (!best || d < best.d) best = { id: n.id, d };
    }
    return best?.id ?? null;
  }

  /** Обвести поставлену деталь ще раз. Друга вісь росту: коли сокети скінчились,
   *  сильнішати можна лише вглиб. */
  async function reink(nodeId: number) {
    const n = game.tower.nodes.find((k) => k.id === nodeId);
    if (!n) return;
    // Питаємо ДО рамки: інакше гравець обвів би контур і аж потім дізнався,
    // що цю деталь підсилити не можна або що бракує чорнила.
    if (!canReink(n)) return;
    if (game.wallet.ink < game.reinkCost(nodeId)) return;
    busy = true;

    const traced = await tracePad.show(n.part.outline);
    if (!traced) { busy = false; return; }

    const s = layout.spriteScale;
    shrinkIn(traced.strokes,
      toScreenX(game.towerX + n.x * s), toScreenY(game.towerY + n.y * s), () => {
        game.reinkPart(nodeId, traced.quality);
        busy = false;
        sockets = readSockets();
        drawMarks();
        drawPanel();
      });
  }

  function open(): boolean {
    sockets = readSockets();
    if (!sockets.length) return false; // ставити нема куди
    layoutShelf();
    screen.visible = true;
    marks.visible = true;
    drawPanel();
    drawMarks();
    return true;
  }

  function close() {
    held = null;
    snap = null;
    screen.visible = false;
    marks.visible = false;
    panel.clear();
    drag.clear();
    marks.clear();
  }

  async function commit(partId: string, part: TowerPart, socket: Socket) {
    busy = true;
    held = null;
    snap = null;
    drawHeld();
    drawMarks();

    const traced = await tracePad.show(part.outline);
    if (!traced) { busy = false; return; } // передумав — чорнило ціле

    shrinkIn(traced.strokes, toScreenX(socket.x), toScreenY(socket.y), () => {
      const res = game.addPart(partId, { node: socket.node, name: socket.name }, traced.quality);
      busy = false;
      if (!res.ok) return;
      // Вежу перезібрано — перечитуємо, куди тепер можна ставити.
      sockets = readSockets();
      drawMarks();
      drawPanel();
    });
  }

  function onDown(ev: PointerEvent) {
    const [px, py] = screenAt(ev);

    if (!screen.visible) {
      // Панель закрита: тап по вежі її відкриває, решту не чіпаємо.
      if (!onTower(px, py)) return;
      swallowing = true;
      ev.preventDefault();
      open();
      return;
    }

    // Дотик належить панелі від початку й до кінця, навіть якщо ним нічого не
    // роблять: інакше тап, яким панель закрили, доїхав би до поля вже після
    // закриття — обробник поля стоїть у черзі за нашим.
    swallowing = true;
    if (busy || tracePad.open) return;

    const s = slotAt(px, py);
    if (s) {
      if (!affordable(s.part)) return; // мовчазна відмова: ціна вже сіра
      ev.preventDefault();
      try { canvas.setPointerCapture?.(ev.pointerId); } catch { /* вказівник уже зник */ }
      held = { id: s.id, part: s.part, px, py };
      drawHeld();
      return;
    }

    // Тап по вже поставленій деталі — переобведення. Це друга вісь росту, і
    // саме вона працює тоді, коли ставити нове вже нікуди.
    const node = partAt(px, py);
    if (node != null) {
      ev.preventDefault();
      reink(node);
      return;
    }

    // Тап повз полицю, повз деталі й повз саму вежу — закрили панель.
    if (!onTower(px, py)) close();
  }

  function onMove(ev: PointerEvent) {
    if (!held || busy) return;
    const [px, py] = screenAt(ev);
    held.px = px; held.py = py;
    const found = nearestSocket(px, py);
    if (found !== snap) { snap = found; drawMarks(); }
    drawHeld();
  }

  function onUp() {
    swallowing = false;
    if (!held || busy) return;
    const { part, id } = held;
    const socket = snap;
    if (!socket) { held = null; snap = null; drawHeld(); drawMarks(); return; }
    commit(id, part, socket);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });

  return {
    get open() { return screen.visible; },
    get busyPointer() { return swallowing; },
    // Прев'ю не дає надійного кадру, тому геймплей перевіряється числами:
    // звідси тест бере, куди тикати синтетичним пальцем.
    get slots() { return slots; },
    get sockets() { return sockets; },
    partAt,

    tapAt(px, py) {
      if (screen.visible) return true;
      if (!onTower(px, py)) return false;
      return open();
    },

    close,

    resize() {
      if (!screen.visible) return;
      layoutShelf();
      sockets = readSockets();
      drawPanel();
      drawMarks();
    },

    update(dt) {
      for (let i = anims.length - 1; i >= 0; i--) if (anims[i].step(dt)) anims.splice(i, 1);
    },
  };
}
