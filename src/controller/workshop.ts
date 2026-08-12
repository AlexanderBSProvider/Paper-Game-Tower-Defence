// Майстерня: тап по башті → деталі на полях → перетягуєш на місце кріплення →
// обводиш у рамці → деталь стискається на башту.
//
// Це місце, де скіл зустрічається з білдом. Куди поставити — вирішує гравець
// (і від цього залежать стати, бо `build.ts` рахує їх із геометрії), а як воно
// ляже на папір — вирішує його рука в рамці обведення.
//
// Час не спиняється. Домальовувати посеред хвилі можна, і це справжній вибір:
// поки ведеш лінію, ніхто за тебе не стріляє краще.
//
// Два простори координат, і плутати їх не можна: панель деталей живе в
// екранних пікселях (це поля аркуша, не поле бою), а місця кріплення — у
// клітинках світу, бо вони прив'язані до башти.

import { Application, Container, Graphics } from '../../lib/pixi.min.mjs';
import { penStroke, penCircle, penRect, penText, textWidth } from '../view/ink.js';
import type { PenOpts } from '../view/ink.js';
import type { Game, TowerRef } from '../game.js';
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

/** Деталь під пальцем. */
interface Held {
  id: string;
  part: TowerPart;
  px: number;
  py: number;
}

export interface WorkshopOpts {
  canvas: HTMLCanvasElement;
  app: Application;
  hudLayer: Container;
  worldLayer: Container;
  look: Look;
  layout: Layout;
  game: Game;
  towerParts: TowerParts;
  tracePad: TracePad;
}

export interface Workshop {
  readonly open: boolean;
  /** Дотик, який почався в майстерні, полю віддавати не можна навіть після
   *  того, як майстерня закрилась. Про це питає `blocked` у tools. */
  readonly busyPointer: boolean;
  readonly tower: TowerRef | null;
  readonly slots: ShelfSlot[];
  readonly sockets: Socket[];
  openAt(cx: number, cy: number): boolean;
  close(): void;
  resize(): void;
  update(dt: number): void;
}

/** Скільки екранних пікселів «дотягується» палець до місця кріплення. */
const SNAP = 46;

/**
 * Розкладка панелі деталей у смузі полів.
 * Клітинку беремо якомога більшу — деталей небагато, а на телефоні смуга вузька.
 */
export function shelfGrid(n: number, w: number, h: number) {
  let best = { cols: n, rows: 1, cell: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cell = Math.min(w / cols, h / rows);
    if (cell > best.cell) best = { cols, rows, cell };
  }
  return best;
}

/**
 * Смуга під панель — протилежна до тієї, яку зайняв HUD.
 * HUD сідає в товщу вільну смугу, тому нам лишається тонша, і це правильно:
 * ескізи деталей на берегах і мають бути дрібними.
 *
 * З цієї ж смуги HUD пише номер хвилі, тому куток під нього лишаємо вільним:
 * два написи в одному місці на аркуші читаються як помарка.
 */
export function shelfBand(L: Layout) {
  const bottom = Math.max(L.oy, L.h * 0.1);
  const side = Math.max(L.ox, 0);
  return side > bottom
    ? { x: L.w - side, y: L.h * 0.2, w: side, h: L.h * 0.8, vertical: true }
    : { x: 0, y: 0, w: L.w - bottom * 1.1, h: bottom, vertical: false };
}

export function createWorkshop({
  canvas, app, hudLayer, worldLayer, look, layout, game, towerParts, tracePad,
}: WorkshopOpts): Workshop {
  // Деталі, які можна доставити. Заготовки сюди не потрапляють: вони не
  // чіпляються в сокет, з них башта починається.
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

  let tower: TowerRef | null = null;
  let slots: ShelfSlot[] = [];    // екранні пікселі
  let sockets: Socket[] = [];     // клітинки світу
  let held: Held | null = null;   // деталь під пальцем
  let snap: Socket | null = null; // місце кріплення, до якого дотягнулись
  let busy = false;               // відкрита рамка обведення або летить деталь
  let swallowing = false;         // цей дотик належить майстерні, поле його не бачить
  const anims: Fx[] = [];

  const affordable = (part: TowerPart) => game.wallet.ink >= (part.cost ?? 0);
  const toScreenX = (cx: number) => layout.ox + cx * layout.cell;
  const toScreenY = (cy: number) => layout.oy + cy * layout.cell;

  /** Місця кріплення в клітинках світу: склад рахує їх від підошви башти.
   *  Башту беремо параметром, а не із замикання: викликається лише тоді, коли
   *  вона точно є, і так це видно з сигнатури. */
  function readSockets(t: TowerRef): Socket[] {
    const [fx, fy] = game.footOf(t.cx, t.cy, game.KINDS[t.kind]!);
    const s = layout.spriteScale;
    return t.build!.freeSockets().map((k) => ({ ...k, x: fx + k.x * s, y: fy + k.y * s }));
  }

  // --- малювання -----------------------------------------------------------

  /** Ескіз деталі: той самий контур, що гравець потім обводитиме. */
  function sketch(
    g: Graphics, part: TowerPart,
    cx: number, cy: number, size: number, o: PenOpts = {},
  ) {
    const w = size, h = size;
    for (const s of part.outline) {
      penStroke(g, s.map(([x, y]): Vec2 => [cx + (x - 0.5) * w, cy + (y - 0.5) * h]), {
        color: look.pens.blue, width: size * 0.05, alpha: 0.85,
        jitter: size * 0.006, step: size * 0.16, overshoot: size * 0.02, halo: 0.12, ...o,
      });
    }
  }

  function layoutShelf() {
    const band = shelfBand(layout);
    // Трохи повітря по краях: ескізи на берегах не мають упиратись у поле.
    const { cols, rows, cell } = shelfGrid(shelf.length, band.w * 0.96, band.h * 0.92);
    const gw = cols * cell, gh = rows * cell;
    const x0 = band.x + (band.w - gw) / 2;
    const y0 = band.y + (band.h - gh) / 2;
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
      const pen = ok ? look.pens.blue : look.pens.pencil;
      sketch(panel, s.part, cx, cy, s.w * 0.56, { color: pen, alpha: ok ? 0.85 : 0.35 });

      const size = s.h * 0.2;
      const txt = String(s.part.cost ?? 0);
      penText(panel, txt, cx - textWidth(txt, size) / 2, s.y + s.h - size * 1.15, size,
        { color: ok ? look.pens.green : look.pens.pencil, alpha: ok ? 0.9 : 0.4, width: size * 0.12 });
    }
  }

  /** Місця кріплення — кружечки на башті; те, куди дотягнувся палець, жовтим. */
  function drawMarks() {
    marks.clear();
    if (!tower) return;
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
    const size = Math.min(layout.w, layout.h) * 0.13;
    sketch(drag, held.part, held.px, held.py, size, { alpha: 0.75 });
  }

  // --- стиснення на місце --------------------------------------------------

  /**
   * Обведене летить із рамки на башту, зменшуючись.
   *
   * Це той самий малюнок, який щойно вела рука: не підміна спрайтом, а він
   * сам, тому момент читається як «моє стало на місце».
   */
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
    const target = 0.12; // приблизний масштаб деталі на полі відносно рамки
    const dur = 0.42;

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

  // --- взаємодія -----------------------------------------------------------

  const screenAt = (ev: PointerEvent): Vec2 => {
    const r = canvas.getBoundingClientRect();
    return [
      (ev.clientX - r.left) * (app.screen.width / r.width),
      (ev.clientY - r.top) * (app.screen.height / r.height),
    ];
  };

  const slotAt = (px: number, py: number) =>
    slots.find((s) => px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h);

  /** Найближче вільне місце кріплення, якщо палець дотягнувся. */
  function nearestSocket(px: number, py: number): Socket | null {
    let best: Socket | null = null, bestD = SNAP;
    for (const k of sockets) {
      const d = Math.hypot(px - toScreenX(k.x), py - toScreenY(k.y));
      if (d < bestD) { best = k; bestD = d; }
    }
    return best;
  }

  async function commit(partId: string, part: TowerPart, socket: Socket) {
    const t = tower;
    if (!t) return;
    busy = true;
    held = null;
    snap = null;
    drawHeld();
    drawMarks();

    const traced = await tracePad.show(part.outline);
    if (!traced) { busy = false; return; } // передумав — чорнило ціле

    const x = toScreenX(socket.x), y = toScreenY(socket.y);
    shrinkIn(traced.strokes, x, y, () => {
      const res = game.addPart(t.id, partId, { node: socket.node, name: socket.name }, traced.quality);
      busy = false;
      if (!res.ok) return;
      // Риг перезібрано — беремо новий і перечитуємо, куди тепер можна ставити.
      tower = game.towerAt(t.cx, t.cy);
      sockets = tower ? readSockets(tower) : [];
      drawMarks();
      drawPanel();
    });
  }

  function onDown(ev: PointerEvent) {
    if (!screen.visible) return;
    // Дотик належить майстерні від початку й до кінця, навіть якщо ми ним нічого
    // не робимо. Інакше тап, яким майстерню закрили, доїжджає до поля вже після
    // закриття — обробник поля стоїть у черзі за нашим — і малює стіну під
    // панеллю. Те саме з тапом, яким скасували рамку обведення.
    swallowing = true;
    if (busy || tracePad.open) return;
    const [px, py] = screenAt(ev);

    const s = slotAt(px, py);
    if (s) {
      if (!affordable(s.part)) return; // мовчазна відмова: ціна вже сіра
      ev.preventDefault();
      try { canvas.setPointerCapture?.(ev.pointerId); } catch { /* вказівник уже зник */ }
      held = { id: s.id, part: s.part, px, py };
      drawHeld();
      return;
    }
    // Тап повз панель і повз саму башту — закрили майстерню.
    if (!tower) return;
    const cx = (px - layout.ox) / layout.cell, cy = (py - layout.oy) / layout.cell;
    const k = game.KINDS[tower.kind]!;
    if (cx < tower.cx || cx > tower.cx + k.w || cy < tower.cy || cy > tower.cy + k.h) close();
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
    const part = held.part, id = held.id, socket = snap;
    if (!socket) { held = null; snap = null; drawHeld(); drawMarks(); return; }
    commit(id, part, socket);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });

  function close() {
    tower = null;
    // swallowing навмисно не чіпаємо: дотик, що закриває, ще не завершився.

    held = null;
    snap = null;
    screen.visible = false;
    marks.visible = false;
    panel.clear();
    drag.clear();
    marks.clear();
  }

  return {
    get open() { return screen.visible; },
    get busyPointer() { return swallowing; },
    get tower() { return tower; },
    // Прев'ю не дає надійного кадру, тому геймплей перевіряється числами:
    // звідси тест бере, куди тикати синтетичним пальцем (див. Verification).
    get slots() { return slots; },
    get sockets() { return sockets; },

    /** @param cx @param cy клітинка, по якій тапнули */
    openAt(cx, cy) {
      const t = game.towerAt(cx, cy);
      if (!t) return false;
      tower = t;
      sockets = readSockets(t);
      if (!sockets.length) { tower = null; return false; } // ставити нема куди
      layoutShelf();
      drawPanel();
      drawMarks();
      screen.visible = true;
      marks.visible = true;
      return true;
    },

    close,

    resize() {
      if (!screen.visible || !tower) return;
      layoutShelf();
      sockets = readSockets(tower);
      drawPanel();
      drawMarks();
    },

    update(dt) {
      for (let i = anims.length - 1; i >= 0; i--) if (anims[i].step(dt)) anims.splice(i, 1);
    },
  };
}
