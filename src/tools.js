// Ручка й ластик. Тап ставить одну клітинку, протягування малює риску —
// рух руки збігається з тим, що з'являється на папері.
//
// Башти 2×2 ставляться лише тапом: тягнути ними означало б сипати їх пачкою.

import { Graphics } from '../lib/pixi.min.mjs';
import { KINDS } from './game.js';
import { lineCells } from './grid.js';

export function createTools({ app, canvas, world, layout, game, look, balance }) {
  const ghost = new Graphics();
  world.addChild(ghost);

  let tool = 'wall';
  let drawing = false;
  let hover = null;
  let last = null; // остання клітинка риски
  const strokeSeen = new Set();

  /** Клітинка під вказівником. Для 2×2 центруємо фігуру на пальці. */
  function cellAt(ev, w = 1, h = 1) {
    const r = canvas.getBoundingClientRect();
    const sx = app.screen.width / r.width;
    const sy = app.screen.height / r.height;
    const x = ((ev.clientX - r.left) * sx - layout.ox) / layout.cell;
    const y = ((ev.clientY - r.top) * sy - layout.oy) / layout.cell;
    return [Math.floor(x - w / 2 + 0.5), Math.floor(y - h / 2 + 0.5)];
  }

  function redrawGhost() {
    ghost.clear();
    if (!hover) return;
    const [cx, cy] = hover;

    if (tool === 'eraser') {
      const something = game.grid.ownerAt(cx, cy) >= 0;
      ghost.rect(cx, cy, 1, 1)
        .fill({ color: something ? look.pens.marker : look.pens.pencil, alpha: something ? 0.45 : 0.12 });
      return;
    }

    const k = KINDS[tool];
    if (!k) return;
    const reason = game.whyNot(tool, cx, cy);
    ghost.rect(cx, cy, k.w, k.h)
      .fill({ color: reason ? look.pens.red : look.pens.marker, alpha: reason ? 0.22 : 0.4 });

    // Радіус башти видно ще до постановки — інакше лабіринт будується наосліп.
    const range = balance.towers[tool]?.range;
    if (range) {
      ghost.circle(cx + k.w / 2, cy + k.h / 2, range)
        .stroke({ width: 0.05, color: look.pens.marker, alpha: 0.55 });
    }
  }

  function apply(cx, cy) {
    const key = `${cx},${cy}`;
    if (strokeSeen.has(key)) return;
    strokeSeen.add(key);
    if (tool === 'eraser') game.erase(cx, cy);
    else game.build(tool, cx, cy);
  }

  const size = () => (tool === 'eraser' ? [1, 1] : [KINDS[tool].w, KINDS[tool].h]);

  function onDown(ev) {
    ev.preventDefault();
    canvas.setPointerCapture?.(ev.pointerId);
    drawing = true;
    strokeSeen.clear();
    hover = cellAt(ev, ...size());
    last = hover;
    apply(...hover);
    redrawGhost();
  }

  function onMove(ev) {
    hover = cellAt(ev, ...size());
    // Протягуванням малюємо лише те, що 1×1: стіни й стирання.
    if (drawing && (tool === 'eraser' || KINDS[tool].w === 1)) {
      for (const c of lineCells(last[0], last[1], hover[0], hover[1])) apply(...c);
      last = hover;
    }
    redrawGhost();
  }

  function onUp() {
    drawing = false;
    last = null;
    strokeSeen.clear();
  }

  function onLeave() {
    drawing = false;
    hover = null;
    redrawGhost();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);

  // Тимчасово, поки немає HUD: 1 стіна, 2 магічна, 3 гармата, E ластик.
  const keys = { 1: 'wall', 2: 'magic_tower', 3: 'cannon', e: 'eraser', E: 'eraser' };
  window.addEventListener('keydown', (ev) => {
    const t = keys[ev.key];
    if (t) { tool = t; redrawGhost(); }
  });

  return {
    get tool() { return tool; },
    setTool(t) { tool = t; redrawGhost(); },
  };
}
