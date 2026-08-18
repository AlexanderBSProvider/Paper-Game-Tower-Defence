// Апгрейд єдиної вежі: дві осі росту, одна візуальна мова.
//
//   вширшки — тап по вежі → деталі на полях → тягнеш на кріплення → обводиш
//             у рамці → обведене стискається на вежу;
//   вглибину — тап по корпусу вежі → полиця показує силуети наступного рівня
//             → обводиш вибраний → вежа стає ним цілком.
//
// Мова одна: **пунктирний привид олівцем = те, що буде, якщо заплатиш і
// обведеш**. Він же під пальцем на кріпленні, він же на карточці рівня. Раніше
// прев'ю не було взагалі — полиця крихітних ескізів, абстрактна точка-сокет,
// модальна рамка, і лише потім видно результат: три перемикання контексту до
// першого фідбеку.
//
// Химеру збирати нема як: кріплення типізовані (`socketKinds`), тому морда
// фізично не встає на дах, а несумісне кріплення під час перетягування навіть
// не світиться.
//
// Два простори координат, і плутати їх не можна: полиця й блок статів живуть в
// екранних пікселях (поля аркуша), а кріплення й привиди — у клітинках світу.

import { Application, Container, Graphics } from '../../lib/pixi.min.mjs';
import { penStroke, penCircle, penText, textWidth } from '../view/ink.js';
import type { PenOpts } from '../view/ink.js';
import type { LaneGame } from '../laneGame.js';
import type { Socket } from '../model/build.js';
import type { Stats } from '../model/build.js';
import type { TracePad } from './tracepad.js';
import type { Fx, Layout, Look, TowerPart, TowerParts, Vec2 } from '../types.js';

/** Карточка на полиці, в екранних пікселях. Або деталь, або рівень вежі. */
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
  /** Що зараз на полиці: деталі чи силуети наступного рівня. */
  readonly mode: 'parts' | 'fork';
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

/** Розкладка полиці: клітинку беремо якомога більшу, карточок небагато. */
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

/** Іконки блоку статів. Літер перо не вміє (GLYPHS — цифри й кілька знаків),
 *  тому підпис — маленький малюнок, як усе інше на полях. */
const STAT_ICONS: Record<string, Vec2[][]> = {
  // шкода — вістря
  damage: [[[0.05, 0.95], [0.5, 0.05], [0.95, 0.95]]],
  // темп — подвійна галка «швидше»
  rate: [[[0.1, 0.12], [0.5, 0.5], [0.1, 0.88]], [[0.5, 0.12], [0.9, 0.5], [0.5, 0.88]]],
  // далекість — стрілка вдалеч
  range: [[[0.02, 0.5], [0.95, 0.5]], [[0.65, 0.24], [0.95, 0.5], [0.65, 0.76]]],
};

export function createTowerPanel({
  canvas, app, hudLayer, worldLayer, look, layout, game, towerParts, tracePad,
  hitPad = 1.5,
}: TowerPanelOpts): TowerPanel {
  // На полицю не потрапляють ні заготовки лабіринту, ні рівні вежі: перші не
  // чіпляються в кріплення, другі мають свою полицю (режим 'fork').
  const shelf = Object.entries(towerParts.parts)
    .filter(([id, p]) => !id.startsWith('_') && p.kind !== 'base' && p.kind !== 'tier')
    .map(([id, part]) => ({ id, part }));

  const panel = new Graphics();   // карточки на полях
  const drag = new Graphics();    // деталь під пальцем
  const info = new Graphics();    // блок статів
  const fly = new Graphics();     // обведене, що стискається на місце
  const screen = new Container();
  screen.addChild(panel, drag, info, fly);
  screen.visible = false;
  hudLayer.addChild(screen);

  const marks = new Graphics();   // кріплення й привиди, у клітинках
  marks.visible = false;
  worldLayer.addChild(marks);

  let slots: ShelfSlot[] = [];
  let sockets: Socket[] = [];
  let held: Held | null = null;
  let snap: Socket | null = null;
  let mode: 'parts' | 'fork' = 'parts';
  let busy = false;
  let swallowing = false;
  const anims: Fx[] = [];

  const affordable = (part: TowerPart) => game.wallet.ink >= (part.cost ?? 0);
  const toScreenX = (cx: number) => layout.ox + cx * layout.cell;
  const toScreenY = (cy: number) => layout.oy + cy * layout.cell;

  /**
   * Кріплення в клітинках світу. Уся різниця з майстернею лабіринту — тут:
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

  /** Куди вежа може дорости з поточного рівня. Рівень — це деталь-основа. */
  function nextTiers(): { id: string; part: TowerPart }[] {
    const root = game.tower.nodes[0];
    return (root?.part.next ?? [])
      .map((id) => ({ id, part: towerParts.parts[id] }))
      .filter((t): t is { id: string; part: TowerPart } => !!t.part);
  }

  /** Чи приймає це кріплення таку деталь. Кріплення без `accepts` (усі деталі
   *  лабіринту) приймає будь-що — тому там нічого не змінилось. */
  const fits = (k: Socket, part: TowerPart) => !k.accepts || k.accepts.includes(part.kind);

  // --- малювання -------------------------------------------------------------

  /**
   * Ескіз деталі: той самий контур, що гравець потім обводитиме.
   *
   * `box` — сторона коробки, у яку вписуємось; пропорції деталі зберігаються.
   * Раніше обидві осі множились на одне число, і кожна карточка виходила
   * розтягнутою в квадрат — зокрема через це полиця й виглядала погано.
   */
  function sketch(
    g: Graphics, part: TowerPart,
    cx: number, cy: number, box: number, o: PenOpts = {},
  ) {
    const [w, h] = part.size;
    const k = box / Math.max(w, h);
    for (const s of part.outline) {
      penStroke(g, s.map(([x, y]): Vec2 => [cx + (x - 0.5) * w * k, cy + (y - 0.5) * h * k]), {
        color: look.pens.blue, width: box * 0.05, alpha: 0.85,
        jitter: box * 0.006, step: box * 0.16, overshoot: box * 0.02, halo: 0.12, ...o,
      });
    }
  }

  /**
   * Привид деталі на вежі, у клітинках світу.
   *
   * Це і є прев'ю: деталь стоїть саме там, саме такого розміру й саме тим
   * боком, як стане після обведення. Дзеркалення рахується від піво́та — рівно
   * так, як його робить rig.ts на спрайті, інакше привид і результат
   * розійшлися б.
   */
  function ghost(g: Graphics, part: TowerPart, x: number, y: number, flip = false, o: PenOpts = {}) {
    const s = layout.spriteScale;
    const [w, h] = part.size;
    const [pvx, pvy] = part.pivot ?? [0.5, 1];
    for (const st of part.outline) {
      penStroke(g, st.map(([px, py]): Vec2 => [
        x + (flip ? -(px - pvx) : px - pvx) * w * s,
        y + (py - pvy) * h * s,
      ]), {
        color: look.pens.pencil, width: 0.05, alpha: 0.5,
        jitter: 0.03, step: 0.22, overshoot: 0.02, halo: 0, ...o,
      });
    }
  }

  function layoutShelf() {
    const items = mode === 'fork' ? nextTiers() : shelf;
    const band = shelfBand(layout);
    const { cols, cell } = shelfGrid(Math.max(1, items.length), band.w * 0.96, band.h * 0.92);
    const rows = Math.ceil(items.length / cols);
    const x0 = band.x + (band.w - cols * cell) / 2;
    const y0 = band.y + (band.h - rows * cell) / 2;
    slots = items.map((it, i) => ({
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

  /**
   * Кріплення на вежі й привид того, що в них стане.
   *
   * Точок олівцем більше немає: кронштейни намальовані в самому силуеті рівня,
   * а маркером позначене лише те, куди дотягнувся палець. Єдиний дозволений у
   * стилі залив — маркерний, і тепер він несе рівно один сенс: «сюди влучиш».
   */
  function drawMarks() {
    marks.clear();
    if (!screen.visible) return;

    if (mode === 'fork') {
      // Привида на вежі тут НЕ малюємо: варіантів два, і накладені один на
      // одного вони дають кашу. Прев'ю — самі карточки на полиці, вони й є
      // силуети майбутньої вежі на всю клітинку. Тут лише маркер: замінюють
      // саме це.
      const w = 1.6, h = (game.band.y1 - game.band.y0) / 2;
      marks.rect(game.towerX - w / 2, game.towerY + 0.1, w, 0.14)
        .fill({ color: look.pens.marker, alpha: 0.6 });
      for (const dx of [-1, 1]) {
        penStroke(marks, [
          [game.towerX + dx * w * 0.55, game.towerY - h * 0.9],
          [game.towerX + dx * w * 0.55, game.towerY],
        ], {
          color: look.pens.marker, width: 0.06, alpha: 0.5,
          jitter: 0.04, step: 0.4, overshoot: 0.06, halo: 0.2,
        });
      }
      return;
    }

    for (const k of sockets) {
      // Несумісне кріплення під час перетягування не існує: не світиться й не
      // притягує. Так химеру не «не модно» збирати, а нема як.
      if (held && !fits(k, held.part)) continue;
      const hot = snap && snap.node === k.node && snap.name === k.name;
      penCircle(marks, k.x, k.y, hot ? 0.3 : 0.16, {
        color: look.pens.marker, width: hot ? 0.07 : 0.04,
        alpha: hot ? 0.95 : 0.4, jitter: 0.02, step: 0.16, halo: hot ? 0.25 : 0,
      });
      if (hot) marks.circle(k.x, k.y, 0.26).fill({ color: look.pens.marker, alpha: 0.3 });
    }

    // Головне прев'ю: те, що стане, якщо відпустити палець тут.
    if (held && snap) ghost(marks, held.part, snap.x, snap.y, snap.flip);
  }

  function drawHeld() {
    drag.clear();
    if (!held) return;
    sketch(drag, held.part, held.px, held.py, Math.min(layout.w, layout.h) * 0.13, { alpha: 0.75 });
  }

  /**
   * Стати вежі рукою, поруч із нею.
   *
   * Без цього блоку половина апгрейду невидима: далекобійність рахується з
   * геометрії складу (висота, висота маси, симетрія), і гравець ніяк не міг
   * побачити, що дало підняття ствола вище. Дельта міряється сухим прогоном —
   * деталь ставиться, стати читаються, деталь знімається; ні оплати, ні
   * перезбору рига.
   */
  function drawInfo() {
    info.clear();
    if (!screen.visible) return;

    const now = game.tower.stats();
    let soon: Stats | null = null;
    if (held && snap) {
      const res = game.tower.add(held.id, { node: snap.node, name: snap.name }, 1);
      if (res.ok) {
        soon = game.tower.stats();
        game.tower.remove(res.id);
      }
    }

    const u = Math.max(14, layout.cell * 0.5);
    const x = toScreenX(game.towerX) + layout.cell * 1.2;
    let y = toScreenY(game.band.y0) + u * 0.3;

    const rows: [string, number, number][] = [
      ['damage', now.damage, soon?.damage ?? now.damage],
      ['rate', now.rate, soon?.rate ?? now.rate],
      ['range', now.range, soon?.range ?? now.range],
    ];

    for (const [icon, a, b] of rows) {
      const pen: PenOpts = {
        color: look.pens.pencil, width: u * 0.07, alpha: 0.8,
        jitter: u * 0.02, step: u * 0.2, overshoot: u * 0.03, halo: 0.1,
      };
      for (const s of STAT_ICONS[icon]) {
        penStroke(info, s.map(([sx, sy]): Vec2 => [x + sx * u * 0.7, y + sy * u]), pen);
      }

      const txt = icon === 'damage' ? String(Math.round(a)) : a.toFixed(1);
      penText(info, txt, x + u, y + u * 0.05, u * 0.9,
        { color: look.pens.blue, alpha: 0.9, width: u * 0.1 });

      // Дельта тільки коли вона є: нуль зеленим читався б як «нічого не дасть»,
      // а насправді це «ще не вибрано».
      const d = b - a;
      if (Math.abs(d) >= 0.05) {
        const dt = (d > 0 ? '+' : '-') + (icon === 'damage'
          ? String(Math.round(Math.abs(d))) : Math.abs(d).toFixed(1));
        penText(info, dt, x + u * 1.1 + textWidth(txt, u * 0.9), y + u * 0.05, u * 0.9,
          { color: d > 0 ? look.pens.green : look.pens.red, alpha: 0.9, width: u * 0.1 });
      }
      y += u * 1.25;
    }
  }

  const redraw = () => { drawMarks(); drawPanel(); drawInfo(); };

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
      if (held && !fits(k, held.part)) continue;
      const d = Math.hypot(px - toScreenX(k.x), py - toScreenY(k.y));
      if (d < bestD) { best = k; bestD = d; }
    }
    return best;
  }

  /** Чи тапнули по самій вежі. Замість грід-математики — коробка навколо
   *  якоря: вежа одна й на місці, тому цього досить. Ширину дає сама вежа
   *  (`towerReach`), інакше після рівня її край опинявся б поза зоною тапу. */
  function onTower(px: number, py: number) {
    const cx = (px - layout.ox) / layout.cell;
    const cy = (py - layout.oy) / layout.cell;
    const h = game.band.y1 - game.band.y0;
    return Math.abs(cx - game.towerX) <= Math.max(hitPad, game.towerReach)
      && Math.abs(cy - game.towerY) <= h / 2;
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
      if (cx < x0 || cx > x0 + w * s || cy < y0 || cy > y0 + h * s) continue;
      // Деталі перекриваються, тому беремо ту, чий центр ближчий до пальця.
      const d = Math.hypot(cx - (x0 + w * s / 2), cy - (y0 + h * s / 2));
      if (!best || d < best.d) best = { id: n.id, d };
    }
    return best?.id ?? null;
  }

  /**
   * Дорости рівень: обводимо силует нової вежі цілком.
   *
   * Ціну питаємо ДО рамки — інакше гравець провів би рукою весь контур і аж
   * потім дізнався, що чорнила не вистачає.
   */
  async function levelUp(partId: string, part: TowerPart) {
    if (!affordable(part)) return;
    busy = true;

    const traced = await tracePad.show(part.outline);
    if (!traced) { busy = false; return; } // передумав — чорнило ціле

    shrinkIn(traced.strokes,
      toScreenX(game.towerX), toScreenY(game.towerY), () => {
        game.levelUp(partId, traced.quality);
        busy = false;
        // Новий силует — нові кріплення, і полиця вертається до деталей: щойно
        // вибраний рівень уже не пропозиція.
        mode = 'parts';
        sockets = readSockets();
        layoutShelf();
        redraw();
      });
  }

  function open(): boolean {
    sockets = readSockets();
    // Порожня вежа без кріплень і без куди рости — панель відкривати нема сенсу.
    if (!sockets.length && !nextTiers().length) return false;
    // Кріплення скінчились — одразу показуємо рівні: полиця деталей, з якої
    // нікуди не поставити, виглядала б як зламана панель.
    mode = sockets.length ? 'parts' : 'fork';
    layoutShelf();
    screen.visible = true;
    marks.visible = true;
    redraw();
    return true;
  }

  function close() {
    held = null;
    snap = null;
    mode = 'parts';
    screen.visible = false;
    marks.visible = false;
    panel.clear();
    drag.clear();
    info.clear();
    marks.clear();
  }

  async function commit(partId: string, part: TowerPart, socket: Socket) {
    busy = true;
    held = null;
    snap = null;
    drawHeld();
    redraw();

    const traced = await tracePad.show(part.outline);
    if (!traced) { busy = false; return; } // передумав — чорнило ціле

    shrinkIn(traced.strokes, toScreenX(socket.x), toScreenY(socket.y), () => {
      const res = game.addPart(partId, { node: socket.node, name: socket.name }, traced.quality);
      busy = false;
      if (!res.ok) return;
      // Вежу перезібрано — перечитуємо, куди тепер можна ставити.
      sockets = readSockets();
      redraw();
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
      // Рівень не тягнеться на кріплення — він і є вежа, тому тап одразу в рамку.
      if (mode === 'fork') { levelUp(s.id, s.part); return; }
      try { canvas.setPointerCapture?.(ev.pointerId); } catch { /* вказівник уже зник */ }
      held = { id: s.id, part: s.part, px, py };
      drawHeld();
      return;
    }

    // Тап по самій вежі — друга вісь росту: полиця показує, у що вона доросте.
    if (onTower(px, py)) {
      ev.preventDefault();
      if (mode === 'parts' && nextTiers().length) {
        mode = 'fork';
        layoutShelf();
        redraw();
      } else if (mode === 'fork') {
        mode = 'parts';
        layoutShelf();
        redraw();
      }
      return;
    }

    // Тап повз полицю й повз вежу — закрили панель.
    close();
  }

  function onMove(ev: PointerEvent) {
    if (!held || busy) return;
    const [px, py] = screenAt(ev);
    held.px = px; held.py = py;
    const found = nearestSocket(px, py);
    if (found !== snap) { snap = found; drawMarks(); drawInfo(); }
    drawHeld();
  }

  function onUp() {
    swallowing = false;
    if (!held || busy) return;
    const { part, id } = held;
    const socket = snap;
    if (!socket) { held = null; snap = null; drawHeld(); redraw(); return; }
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
    get mode() { return mode; },
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
      redraw();
    },

    update(dt) {
      for (let i = anims.length - 1; i >= 0; i--) if (anims[i].step(dt)) anims.splice(i, 1);
    },
  };
}
