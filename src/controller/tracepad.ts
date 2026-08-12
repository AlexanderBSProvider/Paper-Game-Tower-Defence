// Рамка обведення: великий квадрат на аркуші, у ньому блідий контур деталі,
// по якому гравець веде пальцем.
//
// Живе прев'ю домальовується посегментно, а не перемальовується щокадру:
// `penStroke` щоразу кидає новий дрож, тож перемальована лінія кипіла б.
//
// Після зарахування лінію притягуємо до контуру (`magnetize`) і переобводимо
// начисто повним пером. Саме цей крок вирішує, чи виглядатиме крива пальцем
// лінія так, ніби її впевнено провели ручкою.

import { Container, Graphics } from '../../lib/pixi.min.mjs';
import { penStroke, penRect, penText, textWidth } from '../view/ink.js';
import { makeTemplate, scoreTrace, magnetize } from '../model/trace.js';
import type { Score, Strokes, Template } from '../model/trace.js';
import type { Layout, Look, Vec2 } from '../types.js';

/** Рамка в екранних пікселях. */
export interface Box {
  x: number;
  y: number;
  side: number;
}

/** Результат показу: оцінка плюс притягнуті до контуру штрихи. */
export type Traced = Score & { strokes: Strokes };

export interface TracePadCfg {
  /** 0 — чиста рука, 1 — чистий шаблон */
  magnet?: number;
  tol?: number;
  /** скільки тримати результат перед закриттям */
  holdMs?: number;
  /** пауза, після якої рука вважається спиненою */
  idleMs?: number;
}

export interface TracePadOpts {
  canvas: HTMLCanvasElement;
  layer: Container;
  sheetLayer: Container;
  look: Look;
  cfg?: TracePadCfg;
}

export interface TracePad {
  readonly open: boolean;
  readonly box: Box;
  resize(layout: Layout): void;
  /** @param outline штрихи деталі в 0..1. null у відповіді — передумав. */
  show(outline: Strokes): Promise<Traced | null>;
}

const LIVE = { width: 2.2, alpha: 0.85, jitter: 0.5, step: 6, overshoot: 0, halo: 0.1, pressure: 0.15 };

export function createTracePad({ canvas, layer, sheetLayer, look, cfg = {} }: TracePadOpts): TracePad {
  const { magnet = 0.7, tol = 0.08, holdMs = 800, idleMs = 700 } = cfg;

  // Підкладка малюється звичайним блендом: на шарі чорнила (multiply) світлого
  // аркуша не буває — множення вміє тільки темнити.
  const sheet = new Graphics();
  sheetLayer.addChild(sheet);

  const frame = new Graphics();
  const ghost = new Graphics();   // контур деталі
  const live = new Graphics();    // те, що веде палець
  const clean = new Graphics();   // переобведене начисто
  const note = new Graphics();    // оцінка
  const view = new Container();
  view.addChild(frame, ghost, live, clean, note);
  view.visible = false;
  sheet.visible = false;
  layer.addChild(view);

  // `!` — не «мені байдуже», а зафіксований інваріант: L ставить resize(), яку
  // main кличе на старті; box ставить place() всередині show()/resize(); tpl
  // ставить show(). Усе, що їх читає, працює лише при видимій рамці.
  let L!: Layout;
  let box!: Box;
  let tpl!: Template;
  let strokes: Strokes = [];      // штрихи гравця в 0..1
  let cur: Vec2[] | null = null;
  let started = 0;
  let done: ((v: Traced | null) => void) | null = null; // resolve поточного показу
  let frozen = false;
  let idle: ReturnType<typeof setTimeout> | undefined; // таймер «рука спинилась»

  const toLocal = (px: number, py: number): Vec2 => [(px - box.x) / box.side, (py - box.y) / box.side];
  const toScreen = ([x, y]: Vec2): Vec2 => [box.x + x * box.side, box.y + y * box.side];

  function place() {
    const side = Math.min(L.w, L.h) * 0.72;
    box = { x: (L.w - side) / 2, y: (L.h - side) / 2, side };
  }

  function drawChrome() {
    const { x, y, side } = box;
    // Гасимо все навколо і кладемо в рамку чистий аркуш: крізь нього ледь
    // проступає клітинка сторінки, але дерева й маршрут уже не заважають.
    sheet.clear();
    const d = { color: 0x2a2418, alpha: 0.3 };
    sheet.rect(0, 0, L.w, y).fill(d);
    sheet.rect(0, y + side, L.w, L.h - y - side).fill(d);
    sheet.rect(0, y, x, side).fill(d);
    sheet.rect(x + side, y, L.w - x - side, side).fill(d);
    sheet.rect(x + side * 0.012, y + side * 0.016, side, side).fill({ color: 0x2a2418, alpha: 0.22 });
    sheet.rect(x, y, side, side).fill({ color: look.paper.base, alpha: 0.96 });

    // Своя клітинка на підкладці: аркуш має лишитись зошитом, а не білим полем.
    // Крок беремо як у сторінки, щоб рамка не виглядала чужою.
    const step = side / 9;
    for (let i = 1; i < 9; i++) {
      sheet.rect(x + i * step, y, 1, side).fill({ color: look.grid.color, alpha: 0.5 });
      sheet.rect(x, y + i * step, side, 1).fill({ color: look.grid.color, alpha: 0.5 });
    }

    frame.clear();
    penRect(frame, x, y, side, side, {
      color: look.pens.pencil, width: side * 0.005, alpha: 0.55,
      jitter: side * 0.004, step: side * 0.08, overshoot: side * 0.02, halo: 0,
    });

    ghost.clear();
    for (const s of tpl.strokes) {
      penStroke(ghost, s.map(toScreen), {
        color: look.pens.pencil, width: side * 0.022, alpha: 0.42,
        jitter: side * 0.002, step: side * 0.05, overshoot: 0, halo: 0,
      });
    }
  }

  /** Оцінка рукою на полі рамки: скільки відсотків вийшло. */
  function drawNote(score: Score) {
    note.clear();
    const size = box.side * 0.11;
    const txt = `${Math.round(score.quality * 100)}%`;
    penText(note, txt, box.x + box.side - textWidth(txt, size) - size * 0.4,
      box.y + box.side + size * 0.35, size,
      { color: score.quality > 0.75 ? look.pens.green : look.pens.blue, alpha: 0.95, width: size * 0.11 });
  }

  function finish(score: Score) {
    frozen = true;
    // Переобведення: рука лишається своєю, але вже не може бути кривою.
    live.clear();
    clean.clear();
    for (const s of strokes) {
      if (s.length < 2) continue;
      penStroke(clean, magnetize(tpl, s, magnet).map(toScreen), {
        color: look.pens.blue, width: box.side * 0.026, alpha: 0.9,
        jitter: box.side * 0.003, step: box.side * 0.045, overshoot: box.side * 0.006, halo: 0.14,
      });
    }
    drawNote(score);
    // Знімаємо результат ДО close(): він чистить strokes.
    const out: Traced = { ...score, strokes: strokes.map((s) => magnetize(tpl, s, magnet)) };
    setTimeout(() => {
      const r = done;
      close();
      r?.(out);
    }, holdMs);
  }

  function onDown(ev: PointerEvent) {
    if (!view.visible || frozen) return;
    const [x, y] = local(ev);
    // Тап повз рамку — передумав.
    if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) {
      const r = done;
      close();
      r?.(null);
      return;
    }
    // Захоплення не критичне: вказівник міг уже зникнути, а кидок звідси обірвав
    // би обробник і з'їв початок штриха.
    try { canvas.setPointerCapture?.(ev.pointerId); } catch { /* байдуже */ }
    clearTimeout(idle); // ще малює — зарахування чекає
    if (!strokes.length) started = performance.now();
    cur = [[x, y]];
    strokes.push(cur);
  }

  function onMove(ev: PointerEvent) {
    if (!cur || frozen) return;
    const p = local(ev);
    const last = cur[cur.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.008) return;
    cur.push(p);
    // Домальовуємо лише новий відрізок — накопичуємо лінію, а не перемальовуємо.
    penStroke(live, [toScreen(last), toScreen(p)], { ...LIVE, color: look.pens.blue, width: box.side * 0.022 });
  }

  /** Кнопки «готово» немає: зараховуємо, коли рука спинилась.
   *  Обвів усе — зараховуємо одразу, обвів достатньо — чекаємо паузу, бо
   *  контур може мати кілька штрихів і гравець просто переставляє палець. */
  function onUp() {
    if (!cur || frozen) return;
    cur = null;
    const score = scoreTrace(tpl, strokes, { seconds: (performance.now() - started) / 1000, tol });
    if (!score.ok) return;
    if (score.coverage >= 0.97) { finish(score); return; }
    clearTimeout(idle);
    idle = setTimeout(() => finish(scoreTrace(tpl, strokes, { seconds: (performance.now() - started) / 1000, tol })), idleMs);
  }

  const local = (ev: PointerEvent): Vec2 => {
    const r = canvas.getBoundingClientRect();
    return toLocal((ev.clientX - r.left) * (L.w / r.width), (ev.clientY - r.top) * (L.h / r.height));
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  function close() {
    clearTimeout(idle);
    view.visible = false;
    sheet.visible = false;
    frozen = false;
    strokes = [];
    cur = null;
    done = null;
    live.clear();
    clean.clear();
    note.clear();
  }

  return {
    get open() { return view.visible; },

    /** Де стояла рамка. Потрібно майстерні: обведене летить звідси на башту,
     *  тому після закриття координати мають лишитись. */
    get box() { return box; },

    resize(layout) {
      L = layout;
      if (!view.visible) return;
      place();
      drawChrome();
    },

    show(outline) {
      tpl = makeTemplate(outline);
      strokes = [];
      cur = null;
      frozen = false;
      place();
      drawChrome();
      live.clear();
      clean.clear();
      note.clear();
      view.visible = true;
      sheet.visible = true;
      return new Promise((resolve) => { done = resolve; });
    },
  };
}
