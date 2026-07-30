// Зайнятість клітинок. Сітка = рівно ядро (look.core), тому лабіринт однаковий
// на будь-якому екрані; газони за ядром — декор і в сітку не входять.
//
// Координати клітинок цілі, центр клітинки (cx+0.5, cy+0.5) у світових одиницях.

export const FREE = 0;
export const WALL = 1;
export const TOWER = 2;
export const DECOR = 3;
export const BASE = 4;

/**
 * Клітинки на відрізку між двома (Брезенхем). Швидкий свайп дає рідкі події
 * вказівника, тож без цього в риску з'являються дірки.
 */
export function lineCells(x0, y0, x1, y1) {
  const out = [];
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
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

export function createGrid(cols, rows) {
  const cells = new Uint8Array(cols * rows);
  const owner = new Int32Array(cols * rows).fill(-1);

  const idx = (x, y) => y * cols + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;

  return {
    cols, rows, cells, owner, idx, inside,

    /** За межами поля — стіна: вороги не мають куди звідти дітись. */
    at(x, y) { return inside(x, y) ? cells[idx(x, y)] : WALL; },
    blocked(x, y) { return this.at(x, y) !== FREE; },
    ownerAt(x, y) { return inside(x, y) ? owner[idx(x, y)] : -1; },

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
      const out = [];
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
      const out = [];
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push([x + i, y + j]);
      return out;
    },
  };
}
