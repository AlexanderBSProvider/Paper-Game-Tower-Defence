// Виклик союзників і будівництво: тапаєш слот або фундамент — відкривається
// рамка з полицею трафаретів ліворуч, обираєш, обводиш.
//
// Вибір живе В РАМЦІ, а не на полях ігрової сцени (рішення власника): поки
// йде бій, гравець дивиться на поле; рішення «чим» приймається тоді, коли він
// уже вирішив «де». Полиця — DOM із назвами й підказками (shelfDom.ts), бо
// трафарет без підпису не читається. Рамка пам'ятає останній вибір.
//
// Порядок розбору тапу: фінальна записка → крапля над колодязем → слот
// юніта → фундамент. Крапля перша, бо вона висить над будівлею, і тап по ній
// не має відкривати полицю.
//
// Обведене летить із рамки на місце, стискаючись (`shrinkIn`), і вже звідти
// юніт іде в бій, а будівля стає.

import { Application, Container, Graphics } from '../../lib/pixi.min.mjs';
import { penStroke } from '../view/ink.js';
import { rowOf, rowY } from '../model/lane.js';
import { rarityOf, weaponIds } from '../model/weapons.js';
import { buildingIds } from '../model/buildings.js';
import type { LaneGame } from '../laneGame.js';
import type { LaneHud } from './laneHud.js';
import type { WeaponsData } from '../model/weapons.js';
import type { BuildingsData } from '../model/buildings.js';
import type { Shelf, ShelfCard } from './shelfDom.js';
import type { TracePad } from './tracepad.js';
import type { Fx, Layout, Look, Vec2 } from '../types.js';

export interface SquadPanelOpts {
  canvas: HTMLCanvasElement;
  app: Application;
  hudLayer: Container;
  look: Look;
  layout: Layout;
  game: LaneGame;
  weapons: WeaponsData;
  buildings: BuildingsData;
  tracePad: TracePad;
  shelf: Shelf;
  hud: LaneHud;
  /** поки відкрита рамка обведення, поле не приймає ввід */
  blocked?: () => boolean;
}

export interface SquadPanel {
  /** У який ряд викличе союзника тап у цій точці екрана, або null. */
  rowAt(px: number, py: number): number | null;
  /** @returns чи взяли тап на себе */
  tapAt(px: number, py: number): boolean;
  /** Остання обрана зброя — з неї починається наступна рамка. */
  readonly tool: string;
  readonly buildTool: string;
  update(dt: number): void;
}

/** Ширина полиці ліворуч від рамки, в px екрана. */
const shelfWidth = (L: Layout) => Math.min(170, Math.max(96, L.w * 0.3));

export function createSquadPanel({
  canvas, app, hudLayer, look, layout, game, weapons, buildings, tracePad, shelf, hud, blocked,
}: SquadPanelOpts): SquadPanel {
  const fly = new Graphics(); // обведене, що стискається на місце
  hudLayer.addChild(fly);
  const anims: Fx[] = [];
  let busy = false;
  const wIds = weaponIds(weapons);
  const bIds = buildingIds(buildings);
  let tool = wIds[0];
  let buildTool = bIds[0];

  const screenAt = (ev: PointerEvent): Vec2 => {
    const r = canvas.getBoundingClientRect();
    return [
      (ev.clientX - r.left) * (app.screen.width / r.width),
      (ev.clientY - r.top) * (app.screen.height / r.height),
    ];
  };
  const toWorld = (px: number, py: number): Vec2 => [(px - layout.ox) / layout.cell, (py - layout.oy) / layout.cell];
  const toScreenX = (cx: number) => layout.ox + cx * layout.cell;
  const toScreenY = (cy: number) => layout.oy + cy * layout.cell;

  const usableW = (id: string) => game.isUnlocked(id) && game.wallet.ink >= weapons.weapons[id].cost;

  /** На якій хвилі (з одиниці) відкривається id; стартове — 1. */
  const unlockWaveOf = (id: string, key: 'weapons' | 'buildings'): number => {
    const start = key === 'weapons' ? game.level.startWeapons : game.level.startBuildings;
    if (start.includes(id)) return 1;
    const list = key === 'weapons' ? game.level.unlocks : game.level.buildingUnlocks;
    for (const u of list) {
      const ids = key === 'weapons' ? (u as { weapons: string[] }).weapons : (u as { buildings: string[] }).buildings;
      if (ids.includes(id)) return u.wave + 1;
    }
    return game.level.waves.length + 1;
  };

  /** Заголовок полиці: яка хвиля зараз і що відкриється наступним у цій групі. */
  function shelfHeader(cards: ShelfCard[]): string {
    const wave = Math.min(game.state.wave + 1, game.state.waves);
    const locked = cards.filter((c) => c.locked && c.unlockWave).sort((a, b) => a.unlockWave! - b.unlockWave!);
    if (!locked.length) return `Хвиля ${wave} з ${game.state.waves} · усе відкрито`;
    const next = locked[0].unlockWave!;
    const names = locked.filter((c) => c.unlockWave === next).map((c) => c.title).join(', ');
    return `Хвиля ${wave} з ${game.state.waves} · на хвилі ${next}: ${names}`;
  }

  /** Відкриті першими, замкнені — за хвилею відкриття: полиця читається згори вниз як план. */
  const ordered = (cards: ShelfCard[]) => [...cards].sort((a, b) =>
    Number(!!a.locked) - Number(!!b.locked) || (a.unlockWave ?? 0) - (b.unlockWave ?? 0));
  const usableB = (id: string) => game.isBuildingUnlocked(id) && game.wallet.ink >= buildings.buildings[id].cost;

  /** Ряд під пальцем у зоні слотів: зліва від лінії дому. */
  function rowAt(px: number, py: number): number | null {
    const [cx, cy] = toWorld(px, py);
    const { band, level } = game;
    if (cy < band.y0 || cy > band.y1) return null;
    if (cx < 0 || cx > level.homeX) return null;
    return rowOf(band, cy);
  }

  /** Обведене летить із рамки на місце, зменшуючись. Це той самий малюнок,
   *  який щойно вела рука, а не підміна спрайтом. */
  function shrinkIn(strokes: Vec2[][], toX: number, toY: number, cells: number, then: () => void) {
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
    // Кінцевий масштаб — розмір у клітинках світу: box.side px → cells × cell px.
    const target = (layout.cell * cells) / box.side, dur = 0.42;

    anims.push({
      t: 0,
      step(dt) {
        this.t += dt;
        const p = Math.min(1, this.t / dur);
        const e = 1 - (1 - p) * (1 - p); // easeOut: летить швидко, сідає м'яко
        g.position.set(fromX + (toX - fromX) * e, fromY + (toY - fromY) * e);
        g.scale.set(1 + (target - 1) * e);
        g.alpha = p > 0.8 ? (1 - p) / 0.2 : 1;
        if (p < 1) return false;
        g.destroy();
        then();
        return true;
      },
    });
  }

  function weaponCards(): ShelfCard[] {
    return wIds.map((id) => {
      const w = weapons.weapons[id];
      return {
        id, title: w.title, hint: w.hint, outline: w.outline, cost: w.cost, group: w.kind,
        locked: !game.isUnlocked(id), affordable: game.wallet.ink >= w.cost,
        unlockWave: unlockWaveOf(id, 'weapons'),
      };
    });
  }

  function buildingCards(): ShelfCard[] {
    return bIds.map((id) => {
      const b = buildings.buildings[id];
      return {
        id, title: b.title, hint: b.hint, outline: b.outline, cost: b.cost, group: b.effect.type,
        locked: !game.isBuildingUnlocked(id), affordable: game.wallet.ink >= b.cost,
        unlockWave: unlockWaveOf(id, 'buildings'),
      };
    });
  }

  /** Рамка з полицею ліворуч: спільний шлях для зброї й будівель. */
  async function trace(row: number, cards: ShelfCard[], picked: string, onPick: (id: string) => boolean, outlineOf: (id: string) => Vec2[][]) {
    busy = true;
    game.setFocusRow(row);
    const reserve = shelfWidth(layout);
    const p = tracePad.show(outlineOf(picked), {
      stars: (s) => {
        const t = rarityOf(s.quality, weapons.rarity);
        return { n: t.stars, pen: t.pen };
      },
      leftReserve: reserve,
    });
    const box = tracePad.box;
    const gap = Math.max(6, Math.min(layout.w, layout.h) * 0.02);
    shelf.place(box.x - gap - reserve, gap, reserve, layout.h - gap * 2);
    shelf.show({
      cards: ordered(cards), picked, header: shelfHeader(cards),
      onPick: (id) => onPick(id) && (tracePad.setOutline(outlineOf(id)), true),
    });
    const traced = await p;
    shelf.hide();
    game.setFocusRow(null);
    if (!traced) busy = false;
    return traced;
  }

  /** Тап по слоту: юніт. */
  async function drawUnit(row: number) {
    if (!usableW(tool)) {
      const first = wIds.find(usableW);
      if (!first) return;
      tool = first;
    }
    const traced = await trace(row, weaponCards(), tool,
      (id) => { if (!usableW(id)) return false; tool = id; return true; },
      (id) => weapons.weapons[id].outline);
    if (!traced) return; // передумав — чорнило ціле

    const picked = tool;
    shrinkIn(traced.strokes, toScreenX(game.slotX), toScreenY(rowY(game.band, row)), 1, () => {
      game.summon(picked, row, traced.quality, traced.strokes);
      busy = false;
    });
  }

  /** Тап по фундаменту: будівля. */
  async function drawBuilding(row: number, col: number) {
    if (game.town.at(row, col)) return;
    if (!usableB(buildTool)) {
      const first = bIds.find(usableB);
      if (!first) return;
      buildTool = first;
    }
    const traced = await trace(row, buildingCards(), buildTool,
      (id) => { if (!usableB(id)) return false; buildTool = id; return true; },
      (id) => buildings.buildings[id].outline);
    if (!traced) return;

    const picked = buildTool;
    const [cx, cy] = game.plotCenter(row, col);
    shrinkIn(traced.strokes, toScreenX(cx), toScreenY(cy), buildings.buildings[picked].size[0], () => {
      game.build(picked, row, col, traced.quality, traced.strokes);
      busy = false;
    });
  }

  function tapAt(px: number, py: number): boolean {
    if (hud.hit(px, py)) return true;
    if (busy) return false;
    const [cx, cy] = toWorld(px, py);
    if (game.collectAt(cx, cy)) return true;
    const row = rowAt(px, py);
    if (row != null) { drawUnit(row); return true; }
    const plot = game.plotAt(cx, cy);
    if (plot) { drawBuilding(plot.row, plot.col); return true; }
    return false;
  }

  function onDown(ev: PointerEvent) {
    // Дотик, який щойно закрив рамку, полю не належить.
    if (ev.defaultPrevented || blocked?.()) return;
    if (tapAt(...screenAt(ev))) ev.preventDefault();
  }

  canvas.addEventListener('pointerdown', onDown);

  return {
    rowAt, tapAt,
    get tool() { return tool; },
    get buildTool() { return buildTool; },
    update(dt) {
      for (let i = anims.length - 1; i >= 0; i--) if (anims[i].step(dt)) anims.splice(i, 1);
    },
  };
}
