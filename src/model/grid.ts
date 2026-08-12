// Зайнятість клітинок. Сітка = рівно ядро (look.core), тому лабіринт однаковий
// на будь-якому екрані; газони за ядром — декор і в сітку не входять.
//
// Координати клітинок цілі, центр клітинки (cx+0.5, cy+0.5) у світових одиницях.

import type { Vec2 } from '../types.js';

export const FREE = 0;
export const WALL = 1;
export const TOWER = 2;
export const DECOR = 3;
export const BASE = 4;

export interface Grid {
  readonly cols: number;
  readonly rows: number;
  readonly cells: Uint8Array;
  readonly owner: Int32Array;
  idx(x: number, y: number): number;
  inside(x: number, y: number): boolean;
  at(x: number, y: number): number;
  blocked(x: number, y: number): boolean;
  ownerAt(x: number, y: number): number;
  isFree(x: number, y: number, w?: number, h?: number): boolean;
  fill(x: number, y: number, w: number, h: number, kind: number, id?: number): void;
  clearOwner(id: number): Vec2[];
  rect(x: number, y: number, w: number, h: number): Vec2[];
}

/**
 * Клітинки на відрізку між двома (Брезенхем). Швидкий свайп дає рідкі події
 * вказівника, тож без цього в риску з'являються дірки.
 */
export function lineCells(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  const out: Vec2[] = [];
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (let guard = 0; guard < 4096; guard++) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return out;
}

export function createGrid(cols: number, rows: number): Grid {
  const cells = new Uint8Array(cols * rows);
  const owner = new Int32Array(cols * rows).fill(-1);

  const idx = (x: number, y: number) => y * cols + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows;
  // Винесено з літерала: `blocked` викликало `this.at`, а вивести тип об'єкта
  // через власний this TS не може — виходить циклічність.
  const at = (x: number, y: number) => (inside(x, y) ? cells[idx(x, y)] : WALL);

  return {
    cols, rows, cells, owner, idx, inside,

    /** За межами поля — стіна: вороги не мають куди звідти дітись. */
    at,
    blocked: (x, y) => at(x, y) !== FREE,
    ownerAt: (x, y) => (inside(x, y) ? owner[idx(x, y)] : -1),

    /** Чи всі клітинки прямокутника вільні й у межах поля. */
    isFree(x, y, w = 1, h = 1) {
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          if (!inside(x + i, y + j) || cells[idx(x + i, y + j)] !== FREE) return false;
        }
      }
      return true;
    },

    fill(x, y, w, h, kind, id = -1) {
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          if (!inside(x + i, y + j)) continue;
          cells[idx(x + i, y + j)] = kind;
          owner[idx(x + i, y + j)] = id;
        }
      }
    },

    clearOwner(id) {
      const out: Vec2[] = [];
      for (let i = 0; i < cells.length; i++) {
        if (owner[i] === id) {
          cells[i] = FREE;
          owner[i] = -1;
          out.push([i % cols, (i / cols) | 0]);
        }
      }
      return out;
    },

    rect(x, y, w, h) {
      const out: Vec2[] = [];
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push([x + i, y + j]);
      return out;
    },
  };
}
