// Зайнятість клітинок. Сітка = рівно ядро (look.core), тому лабіринт однаковий
// на будь-якому екрані; газони за ядром — декор і в сітку не входять.
//
// Координати клітинок цілі, центр клітинки (cx+0.5, cy+0.5) у світових одиницях.

export const FREE = 0;
export const WALL = 1;
export const TOWER = 2;
export const DECOR = 3;
export const BASE = 4;

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
