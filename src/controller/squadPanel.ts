// Малювання союзників: обираєш силует на полях, тапаєш ряд — і обводиш його.
//
// Панелі вибору тут навмисно немає. Малювати доводиться під час хвилі, і зайвий
// крок «тап по ряду → меню → тип» коштував би гравцеві життів. Тип уже обраний
// на полях (laneHud), тому тап по ряду одразу відкриває рамку — рівно один
// дотик між рішенням і олівцем.
//
// Заразом це єдиний диспетчер вводу режиму: тап по нотатках перемикає силует,
// а після кінця партії його ловить фінальна записка. Так само влаштований
// лабіринт, тільки там цим займається tools.ts.

import { Application } from '../../lib/pixi.min.mjs';
import { rowOf } from '../model/lane.js';
import type { LaneGame } from '../laneGame.js';
import type { LaneHud } from './laneHud.js';
import type { Allies } from '../model/lane.js';
import type { TracePad } from './tracepad.js';
import type { Layout, Vec2 } from '../types.js';

export interface SquadPanelOpts {
  canvas: HTMLCanvasElement;
  app: Application;
  layout: Layout;
  game: LaneGame;
  allies: Allies;
  tracePad: TracePad;
  hud: LaneHud;
  /** поки відкрита рамка обведення або панель вежі, поле не приймає ввід */
  blocked?: () => boolean;
}

export interface SquadPanel {
  /** Куди поставить союзника тап у цій точці екрана, або null. */
  rowAt(px: number, py: number): number | null;
  /** @returns чи взяли тап на себе */
  tapAt(px: number, py: number): boolean;
}

export function createSquadPanel({
  canvas, app, layout, game, allies, tracePad, hud, blocked,
}: SquadPanelOpts): SquadPanel {
  const screenAt = (ev: PointerEvent): Vec2 => {
    const r = canvas.getBoundingClientRect();
    return [
      (ev.clientX - r.left) * (app.screen.width / r.width),
      (ev.clientY - r.top) * (app.screen.height / r.height),
    ];
  };

  /**
   * Ряд під пальцем.
   *
   * Приймаємо тап по всій смузі, а не лише по коробці загону: сам союзник усе
   * одно стає у свою колонку, тому широка зона нічого не ламає, зате в ряд
   * заввишки з палець на 375px влучити можна.
   *
   * Зона вежі не наша — там працює towerPanel. Він же й свій тап уже забрав
   * би через busyPointer, але покладатися на порядок обробників тут не варто.
   */
  function rowAt(px: number, py: number): number | null {
    const cx = (px - layout.ox) / layout.cell;
    const cy = (py - layout.oy) / layout.cell;
    const { band } = game;
    if (cy < band.y0 || cy > band.y1) return null;
    if (cx < game.towerX + 1.5) return null;
    return rowOf(band, cy);
  }

  /** Тап по ряду: обводимо силует і ставимо, що вийшло. */
  async function draw(row: number) {
    const kind = hud.tool;
    // Питаємо ДО рамки: інакше гравець обвів би контур і аж потім дізнався,
    // що чорнила бракує. Ціна на полях уже закреслена, тому це не сюрприз.
    if (game.wallet.ink < allies[kind].cost) return;

    const traced = await tracePad.show(allies[kind].outline);
    if (!traced) return; // передумав — чорнило ціле
    // Штрихи йдуть у бій як є: з них печеться текстура союзника, тому на полі
    // стоїть саме те, що провела рука, а не її ідеальний прообраз.
    game.addAlly(kind, row, traced.quality, traced.strokes);
  }

  function tapAt(px: number, py: number): boolean {
    const picked = hud.hit(px, py);
    if (picked) {
      if (picked === 'melee' || picked === 'ranged') hud.setTool(picked);
      return true;
    }
    const row = rowAt(px, py);
    if (row == null) return false;
    draw(row);
    return true;
  }

  function onDown(ev: PointerEvent) {
    if (blocked?.()) return;
    if (tapAt(...screenAt(ev))) ev.preventDefault();
  }

  canvas.addEventListener('pointerdown', onDown);

  // Клавіші-дублери для десктопа, як у лабіринті: 1 щитоносець, 2 лучник.
  window.addEventListener('keydown', (ev) => {
    if (ev.key === '1') hud.setTool('melee');
    if (ev.key === '2') hud.setTool('ranged');
  });

  return { rowAt, tapAt };
}
