// Геометрія рядів: єдине, що про них треба знати і руху ворогів, і панелі загону.
//
// Без Pixi й без Layout: сюди приходить смуга в клітинках, звідси виходять
// числа. Тому ганяється з node — і це саме та математика, яку легко зламати
// тихо: промахнувся рядом на пів клітинки, і союзник б'ється не в тому ряду,
// де стоїть.
//
// Координати — клітинки світу, вісь y вниз, як усюди в грі.

import type { AllyKind, AllyStats } from './squad.js';
import type { Vec2, Wave } from '../types.js';

/** Смуга, поділена на рівні ряди. */
export interface Band {
  /** верхня межа смуги */
  y0: number;
  /** нижня межа смуги */
  y1: number;
  rows: number;
}

/** Висота одного ряду в клітинках. */
export const rowHeight = (b: Band) => (b.y1 - b.y0) / b.rows;

/** Центр ряду: ворог іде саме по цій лінії, союзник на ній стоїть. */
export function rowY(b: Band, row: number): number {
  const r = Math.min(Math.max(row, 0), b.rows - 1);
  return b.y0 + rowHeight(b) * (r + 0.5);
}

/**
 * У якому ряду лежить точка.
 *
 * За межами смуги повертає крайній ряд, а не -1: тап трохи вище першого ряду
 * гравець має на увазі як перший ряд, а не як «нікуди». Промах пальцем не
 * повинен з'їдати дію.
 */
export function rowOf(b: Band, y: number): number {
  const r = Math.floor((y - b.y0) / rowHeight(b));
  return Math.min(Math.max(r, 0), b.rows - 1);
}

// --- data/laneLevel.json ----------------------------------------------------

/** Хвиля режиму: та сама форма, що в level.json, плюс ряд. */
export interface LaneWave extends Wave {
  /** номер ряду; null або відсутнє — випадковий */
  row?: number | null;
}

export interface LaneLevel {
  _?: string;
  /** своє ядро: у режимі коридору світ лежить навпаки до look.core */
  core: { cols: number; rows: number };
  lives: number;
  band: { y0: number; y1: number };
  rows: number;
  /** вежа стоїть на всіх рядах одразу, тому в неї лише x */
  towerX: number;
  /** своя база вежі: towerparts.base задана під лабіринт і тут не діставала */
  towerBase?: { rate?: number; range?: number };
  spawnX: number;
  squad: { cols: number; xLeft: number; xRight: number };
  waveBreak?: number;
  waves: LaneWave[];
}

// --- data/allies.json -------------------------------------------------------

/** Силует союзника: те саме, що TowerPart, тільки без сокетів і тегів. */
export interface AllyDef {
  _?: string;
  /** у клітинках */
  size: Vec2;
  cost: number;
  stats: AllyStats;
  /** штрихи в 0..1 коробки: одне джерело і для обведення, і для випікання */
  outline: Vec2[][];
  /** Чим малювати союзника на полі, поки немає випікання обведеного гравцем.
   *  Тимчасовий місток: справжній силует має братися з outline через bakeTrace. */
  rig?: string;
}

/** Ключі збігаються з AllyKind, тому пошук прямий. Службові `_*` відсіює код,
 *  як і в parts.json — у типі їх немає. */
export type Allies = Record<AllyKind, AllyDef>;
