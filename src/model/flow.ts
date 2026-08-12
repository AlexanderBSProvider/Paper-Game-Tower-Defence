// Маршрут як наслідок намальованого.
//
// Один BFS від бази по вільних клітинках дає поле відстаней і напрямків. Далі
// все безкоштовно: ворог просто йде вниз по градієнту, посеред хвилі сам
// розвертається, а питання «чи можна тут будувати» — це те саме питання
// досяжності в тому самому полі.

import { FREE } from './grid.js';
import type { Grid } from './grid.js';
import type { Vec2 } from '../types.js';

export interface Flow {
  /** кроків до бази; -1 — недосяжно */
  dist: Int32Array;
  /** індекс напрямку до бази; -1 — глухий кут */
  dir: Int8Array;
  cols: number;
  rows: number;
}

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/**
 * @param goals клітинки-цілі (база). Самі цілі можуть бути зайняті —
 *              розходимось лише по вільних сусідах.
 */
export function computeFlow(grid: Grid, goals: Vec2[]): Flow {
  const n = grid.cols * grid.rows;
  const dist = new Int32Array(n).fill(-1);
  const dir = new Int8Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;

  for (const [gx, gy] of goals) {
    if (!grid.inside(gx, gy)) continue;
    const i = grid.idx(gx, gy);
    if (dist[i] !== -1) continue;
    dist[i] = 0;
    queue[tail++] = i;
  }

  while (head < tail) {
    const i = queue[head++];
    const x = i % grid.cols;
    const y = (i / grid.cols) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (!grid.inside(nx, ny)) continue;
      const j = grid.idx(nx, ny);
      if (dist[j] !== -1 || grid.cells[j] !== FREE) continue;
      dist[j] = dist[i] + 1;
      dir[j] = (d + 2) % 4; // напрямок назад, від сусіда до нас
      queue[tail++] = j;
    }
  }

  return { dist, dir, cols: grid.cols, rows: grid.rows };
}

export function reaches(flow: Flow, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= flow.cols || y >= flow.rows) return false;
  return flow.dist[y * flow.cols + x] >= 0;
}

/** Скільки кроків звідси до бази. Поза полем і в глухому куті — Infinity,
 *  щоб число можна було просто порівнювати, не переплітаючи з -1. */
export function distAt(flow: Flow, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= flow.cols || y >= flow.rows) return Infinity;
  const d = flow.dist[y * flow.cols + x];
  return d < 0 ? Infinity : d;
}

/** Наступна клітинка на шляху до бази, або null. */
export function stepFrom(flow: Flow, x: number, y: number): Vec2 | null {
  if (x < 0 || y < 0 || x >= flow.cols || y >= flow.rows) return null;
  const d = flow.dir[y * flow.cols + x];
  if (d < 0) return null;
  return [x + DX[d], y + DY[d]];
}

/** Полілінія центрів клітинок від точки до бази — те, що малюємо пунктиром. */
export function routeFrom(flow: Flow, x: number, y: number): Vec2[] {
  const pts: Vec2[] = [[x + 0.5, y + 0.5]];
  let cx = x, cy = y;
  for (let n = 0; n < flow.cols * flow.rows; n++) {
    const s = stepFrom(flow, cx, cy);
    if (!s) break;
    [cx, cy] = s;
    pts.push([cx + 0.5, cy + 0.5]);
  }
  return simplify(pts);
}

/** Прямі ділянки склеюємо в один сегмент — менше роботи перу. */
export function simplify(pts: Vec2[]): Vec2[] {
  if (pts.length < 3) return pts;
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = out[out.length - 1];
    const [bx, by] = pts[i];
    const [cx, cy] = pts[i + 1];
    if ((bx - ax) * (cy - by) !== (by - ay) * (cx - bx)) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Чи відріже прохід, якщо зайняти ці клітинки.
 * mustReach — точки, з яких досяжність обов'язкова: вхід і кожен живий ворог,
 * бо замурувати ворога так само погано, як замурувати вхід.
 */
export function wouldSeal(grid: Grid, goals: Vec2[], cells: Vec2[], mustReach: Vec2[]): boolean {
  const saved = cells.map(([x, y]) => grid.cells[grid.idx(x, y)]);
  for (const [x, y] of cells) grid.cells[grid.idx(x, y)] = 1;

  const probe = computeFlow(grid, goals);
  const sealed = mustReach.some(([x, y]) => !reaches(probe, x, y));

  cells.forEach(([x, y], k) => { grid.cells[grid.idx(x, y)] = saved[k]; });
  return sealed;
}
