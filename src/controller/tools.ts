// Ручка й ластик. Тап ставить одну клітинку, протягування малює риску —
// рух руки збігається з тим, що з'являється на папері.
//
// Башти 2×2 ставляться лише тапом: тягнути ними означало б сипати їх пачкою.

import { Application, Container, Graphics } from '../../lib/pixi.min.mjs';
import { KINDS } from '../game.js';
import { lineCells } from '../model/grid.js';
import type { Game } from '../game.js';
import type { Hud } from './hud.js';
import type { Layout, Look, Vec2 } from '../types.js';

export interface ToolsOpts {
  app: Application;
  canvas: HTMLCanvasElement;
  world: Container;
  layout: Layout;
  game: Game;
  look: Look;
  hud?: Hud;
  /** поки відкрита рамка обведення або майстерня, поле не приймає ввід */
  blocked?: () => boolean;
  /** тап по вже поставленій башті: true — подію забрали */
  onTower?: (cx: number, cy: number) => boolean;
}

export interface Tools {
  readonly tool: string;
  setTool(t: string): void;
}

export function createTools({
  app, canvas, world, layout, game, look, hud, blocked, onTower,
}: ToolsOpts): Tools {
  const ghost = new Graphics();
  world.addChild(ghost);

  let tool = 'wall';
  let drawing = false;
  let hover: Vec2 | null = null;
  let last: Vec2 | null = null; // остання клітинка риски
  const strokeSeen = new Set<string>();

  /** Екранні пікселі рушія: канвас може бути розтягнутий CSS-ом. */
  function screenAt(ev: PointerEvent): Vec2 {
    const r = canvas.getBoundingClientRect();
    return [
      (ev.clientX - r.left) * (app.screen.width / r.width),
      (ev.clientY - r.top) * (app.screen.height / r.height),
    ];
  }

  /** Клітинка під вказівником. Для 2×2 центруємо фігуру на пальці. */
  function cellAt(ev: PointerEvent, w = 1, h = 1): Vec2 {
    const [px, py] = screenAt(ev);
    const x = (px - layout.ox) / layout.cell;
    const y = (py - layout.oy) / layout.cell;
    return [Math.floor(x - w / 2 + 0.5), Math.floor(y - h / 2 + 0.5)];
  }

  function setTool(t: string) {
    tool = t;
    hud?.setTool(t);
    redrawGhost();
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
    const range = game.rangeOf(tool);
    if (range) {
      ghost.circle(cx + k.w / 2, cy + k.h / 2, range)
        .stroke({ width: 0.05, color: look.pens.marker, alpha: 0.55 });
    }
  }

  function apply(cx: number, cy: number) {
    const key = `${cx},${cy}`;
    if (strokeSeen.has(key)) return;
    strokeSeen.add(key);
    if (tool === 'eraser') game.erase(cx, cy);
    else game.build(tool, cx, cy);
  }

  /** Розмір сліду інструмента. Невідомий інструмент дає 1×1, а не падіння:
   *  сюди приходить рядок, і єдина чесна відповідь на незнайомий — найменша. */
  const size = (): Vec2 => {
    const k = KINDS[tool];
    return tool === 'eraser' || !k ? [1, 1] : [k.w, k.h];
  };

  function onDown(ev: PointerEvent) {
    if (blocked?.()) return; // поки відкрита рамка обведення, поле не чіпаємо
    ev.preventDefault();
    // Поля — не поле: тап по нотатках перемикає інструмент, а після кінця
    // партії будь-який тап ловить фінальна записка.
    const picked = hud?.hit(...screenAt(ev));
    if (picked) { if (KINDS[picked] || picked === 'eraser') setTool(picked); return; }
    // Тап по вже поставленій башті — це не будівництво, а майстерня: туди
    // домальовують деталі. Ластик лишається ластиком і стирає башту цілком.
    if (tool !== 'eraser' && onTower?.(...cellAt(ev))) return;
    try { canvas.setPointerCapture?.(ev.pointerId); } catch { /* вказівник уже зник */ }
    drawing = true;
    strokeSeen.clear();
    hover = cellAt(ev, ...size());
    last = hover;
    apply(...hover);
    redrawGhost();
  }

  function onMove(ev: PointerEvent) {
    if (blocked?.()) return;
    hover = cellAt(ev, ...size());
    // Протягуванням малюємо лише те, що 1×1: стіни й стирання.
    if (drawing && last && (tool === 'eraser' || KINDS[tool]?.w === 1)) {
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

  // Клавіші-дублери для десктопа: 1 стіна, 2 магічна, 3 гармата, E ластик.
  const keys: Record<string, string> = { 1: 'wall', 2: 'magic_tower', 3: 'cannon', e: 'eraser', E: 'eraser' };
  window.addEventListener('keydown', (ev) => {
    const t = keys[ev.key];
    if (t) setTool(t);
  });

  hud?.setTool(tool);

  return {
    get tool() { return tool; },
    setTool,
  };
}
