// Обведення: наскільки точно гравець провів по контуру.
//
// Уся геометрія — в координатах рамки 0..1, тому оцінка не залежить ні від
// розміру екрана, ні від того, як часто пристрій шле події вказівника: вхідні
// точки перед оцінкою ресемпляться рівномірно.
//
// Свідомо тупо: найближчий сегмент шукається перебором. Контур — сотня
// сегментів, лінія гравця — дві сотні точок, тобто 20 тисяч операцій на одне
// обведення. Поле відстаней тут було б передчасною оптимізацією.
//
// Оцінка не залежить від напрямку й порядку штрихів: обводити можна хоч
// знизу вгору, хоч у зворотному порядку — рука сама вирішує.

import type { Vec2 } from '../types.js';

/** Штрихи в координатах рамки 0..1: [[[x,y], ...], ...] */
export type Strokes = Vec2[][];

export interface TraceSeg {
  ax: number; ay: number; bx: number; by: number;
  len: number;
}

export interface Template {
  strokes: Strokes;
  segs: TraceSeg[];
  /** рівномірні вузли контуру — по них рахується покриття */
  nodes: Vec2[];
  length: number;
  step: number;
}

export interface Score {
  accuracy: number;
  coverage: number;
  speedBonus: number;
  extraLifts: number;
  quality: number;
  ok: boolean;
}

export interface ScoreOpts {
  /** скільки часу зайняло обведення */
  seconds?: number;
  tol?: number;
  refSpeed?: number;
  minCoverage?: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Рівномірні точки вздовж полілінії. Останню точку завжди лишаємо. */
export function resample(pts: Vec2[], step: number): Vec2[] {
  if (pts.length < 2) return pts.slice();
  const out: Vec2[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    let d = step - carry;
    while (d <= len) {
      out.push([ax + (dx / len) * d, ay + (dy / len) * d]);
      d += step;
    }
    carry = (len - (d - step)) % step;
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > 1e-9) out.push(last);
  return out;
}

function toSegments(strokes: Strokes): TraceSeg[] {
  const segs: TraceSeg[] = [];
  for (const s of strokes) {
    for (let i = 1; i < s.length; i++) {
      const [ax, ay] = s[i - 1], [bx, by] = s[i];
      const len = Math.hypot(bx - ax, by - ay);
      if (len > 1e-9) segs.push({ ax, ay, bx, by, len });
    }
  }
  return segs;
}

/** Найближча точка контуру до (x, y): проєкція на найкращий сегмент. */
export function nearestOn(segs: TraceSeg[], x: number, y: number) {
  let best = { d: Infinity, px: x, py: y };
  for (const s of segs) {
    const dx = s.bx - s.ax, dy = s.by - s.ay;
    const t = clamp01(((x - s.ax) * dx + (y - s.ay) * dy) / (s.len * s.len));
    const px = s.ax + dx * t, py = s.ay + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { d, px, py };
  }
  return best;
}

/**
 * Контур деталі, підготовлений до оцінки.
 * @param strokes штрихи: [[[x,y], ...], ...] у 0..1
 */
export function makeTemplate(strokes: Strokes, { step = 0.02 } = {}): Template {
  const segs = toSegments(strokes);
  const nodes = strokes.flatMap((s) => resample(s, step));
  const length = segs.reduce((a, s) => a + s.len, 0);
  return { strokes, segs, nodes, length, step };
}

/**
 * Притягнути лінію гравця до контуру. Не приймаємо руку як є і не підміняємо
 * її шаблоном — саме частка magnet вирішує, наскільки лінія лишається своєю.
 * @param magnet 0 — чиста рука, 1 — чистий шаблон
 */
export function magnetize(tpl: Template, pts: Vec2[], magnet = 0.7): Vec2[] {
  const k = clamp01(magnet);
  return pts.map(([x, y]): Vec2 => {
    const n = nearestOn(tpl.segs, x, y);
    return [x + (n.px - x) * k, y + (n.py - y) * k];
  });
}

/**
 * Оцінка обведення.
 * @param strokes штрихи гравця в тих самих 0..1
 */
export function scoreTrace(tpl: Template, strokes: Strokes, o: ScoreOpts = {}): Score {
  const { seconds = 0, tol = 0.08, refSpeed = 0.6, minCoverage = 0.6 } = o;
  const zero: Score = { accuracy: 0, coverage: 0, speedBonus: 0, extraLifts: 0, quality: 0, ok: false };
  if (!tpl.segs.length || !tpl.nodes.length) return zero;

  const pts = strokes.flatMap((s) => (s.length > 1 ? resample(s, 0.01) : s));
  if (!pts.length) return zero;

  // Наскільки тримався лінії: середнє відхилення в частках допуску.
  let off = 0;
  for (const [x, y] of pts) off += Math.min(1, nearestOn(tpl.segs, x, y).d / tol);
  const accuracy = clamp01(1 - off / pts.length);

  // Чи обвів усе: скільки вузлів контуру пройдено близько.
  const tol2 = tol * tol;
  let hit = 0;
  for (const [nx, ny] of tpl.nodes) {
    for (const [x, y] of pts) {
      const dx = x - nx, dy = y - ny;
      if (dx * dx + dy * dy <= tol2) { hit++; break; }
    }
  }
  const coverage = hit / tpl.nodes.length;

  // Впевнений темп — це частина вміння, але важить найменше.
  const speedBonus = seconds > 0 ? clamp01(tpl.length / seconds / refSpeed) : 0;

  // Зайві відриви пальця понад ті, що є в самому контурі.
  const extraLifts = Math.max(0, strokes.length - tpl.strokes.length);

  // Покриття рахуємо від порога зарахування, а не від нуля: усе нижче порога
  // однаково не приймається, тож інакше 0.35 бала роздавались би задарма
  // кожному, хто просто довів лінію до кінця.
  const cov = clamp01((coverage - minCoverage) / (1 - minCoverage));

  const quality = clamp01(
    0.55 * accuracy + 0.35 * cov + 0.10 * speedBonus - 0.05 * extraLifts,
  );

  // Єдина відмова, і вона чесна: обвів менше, ніж треба — переобведи.
  return { accuracy, coverage, speedBonus, extraLifts, quality, ok: coverage >= minCoverage };
}
