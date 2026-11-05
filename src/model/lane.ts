// Геометрія рядів: єдине, що про них треба знати і руху ворогів, і панелі слотів.
//
// Без Pixi й без Layout: сюди приходить смуга в клітинках, звідси виходять
// числа. Тому ганяється з node — і це саме та математика, яку легко зламати
// тихо: промахнувся рядом на пів клітинки, і союзник б'ється не в тому ряду,
// де стоїть.
//
// Координати — клітинки світу, вісь y вниз, як усюди в грі.

import type { Wave } from '../types.js';
import type { EnemyClass, WeaponKind } from './weapons.js';

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

/**
 * Зважений випадковий вибір із `mix` хвилі.
 * @param r число в [0, 1) — зовні, щоб тест був детермінованим
 */
export function pickWeighted(mix: Record<string, number>, r: number): string {
  const entries = Object.entries(mix).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let acc = 0;
  for (const [id, w] of entries) {
    acc += w / total;
    if (r < acc) return id;
  }
  return entries[entries.length - 1]?.[0] ?? '';
}

// --- data/laneLevel.json ----------------------------------------------------

/** Хвиля режиму: та сама форма, що в level.json, плюс ряд і суміш ворогів. */
export interface LaneWave extends Wave {
  /** номер ряду; null або відсутнє — випадковий */
  row?: number | null;
  /** ваги вибору ворога на кожен спавн; ключі з laneEnemies.json */
  mix: Record<string, number>;
  /** бос хвилі (ключ з laneEnemies.json): виходить першим, решта — за ним */
  boss?: string;
}

export interface LaneLevel {
  _?: string;
  /** своє ядро: у режимі коридору світ лежить навпаки до look.core */
  core: { cols: number; rows: number };
  lives: number;
  band: { y0: number; y1: number };
  rows: number;
  /** лінія дому: ворог дійшов — мінус життя */
  homeX: number;
  /** слот виклику в кожному ряду */
  slot: { x0: number; x1: number };
  /** лінія фронту: союзник без цілі тримає її */
  holdX: number;
  /** на скільки позаду фронту тримається священик без бійців */
  supportBack?: number;
  spawnX: number;
  /** одноразовий захист лінії дому, зарядів на ряд */
  laser?: { charges: number };
  /** фундаменти будівель: cols стовпчиків від x0 з кроком step, квадрат side */
  plots: { x0: number; cols: number; step: number; side: number };
  /** множник часу бою, поки відкрита рамка обведення */
  slowWhileDrawing?: number;
  /** зброя, відкрита від початку */
  startWeapons: string[];
  /** винагороди за хвилі: на початку хвилі wave відкриваються weapons */
  unlocks: { wave: number; weapons: string[] }[];
  startBuildings: string[];
  buildingUnlocks: { wave: number; buildings: string[] }[];
  waveBreak?: number;
  waves: LaneWave[];
  /** чорнило на старті; без нього — balance.economy.startInk */
  startInk?: number;
  /** хвилі без кінця: після списку laneGame бере endlessWave() */
  endless?: boolean;
  /** у скільки разів малюнок персонажів більший за хітбокс: геймплей у
   *  клітинках не змінюється, змінюється лише те, наскільки їх видно */
  artScale?: number;
}

// --- data/laneEnemies.json --------------------------------------------------

export interface LaneEnemyDef {
  _?: string;
  rig: string;
  cls: EnemyClass;
  /** зріст у клітинках — для закреслення й цифр */
  size: number;
  hp: number;
  speed: number;
  damage: number;
  rate: number;
  reach: number;
  /** власний бонус проти роду союзника */
  vs?: Partial<Record<WeaponKind, number>>;
  /** множник малюнка поверх artScale рівня: бос — той самий риг, але більший */
  scale?: number;
  /** бос: лазер його не спалює, а відкидає й ранить; над головою смуга hp */
  boss?: boolean;
}

/** Службові `_*` відсіює код, як і в parts.json — у типі їх немає. */
export type LaneEnemies = Record<string, LaneEnemyDef>;
