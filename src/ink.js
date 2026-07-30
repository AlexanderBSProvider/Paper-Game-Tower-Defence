// Перо. Усе чорнило в грі малюється цими примітивами.
//
// Що робить лінію схожою на шарикову ручку, а не на вектор:
//   1. плавний дрож — сума двох синусів, а не білий шум (інакше лінія «махрова»);
//   2. натиск — товщина повільно пливе вздовж штриха;
//   3. ореол — той самий шлях ширше і майже прозоро: паста розтікається волокнами;
//   4. перехльости — рука не спиняється точно в куті, лінія вибігає за нього;
//   5. multiply — чорнило затемнює папір, а не перекриває його (ставиться на контейнер).

import { Graphics, Sprite, Texture, DisplacementFilter } from '../lib/pixi.min.mjs';

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);

// Плавний «дрож руки»: дві хвилі різної частоти.
function wobbler(amp) {
  const p1 = rnd(0, TAU), p2 = rnd(0, TAU);
  const f1 = rnd(0.5, 1.3), f2 = rnd(2.0, 3.6);
  return (t) => (Math.sin(p1 + t * f1) * 0.68 + Math.sin(p2 + t * f2) * 0.32) * amp;
}

// Ресемплимо шлях рівномірно по довжині і зсуваємо кожну точку по нормалі.
function roughen(pts, amp, step) {
  if (pts.length < 2) return pts.slice();
  const wob = wobbler(amp);
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    segs.push({ a, b, len, start: total, nx: -(b[1] - a[1]) / len, ny: (b[0] - a[0]) / len });
    total += len;
  }
  if (!segs.length) return pts.slice();

  const out = [];
  const n = Math.max(1, Math.round(total / step));
  let si = 0;
  for (let k = 0; k <= n; k++) {
    const d = (total * k) / n;
    while (si < segs.length - 1 && d > segs[si].start + segs[si].len) si++;
    const s = segs[si];
    const t = Math.min(1, (d - s.start) / s.len);
    const o = wob(d / 18);
    out.push([
      s.a[0] + (s.b[0] - s.a[0]) * t + s.nx * o,
      s.a[1] + (s.b[1] - s.a[1]) * t + s.ny * o,
    ]);
  }
  return out;
}

// Вибіг за кінці: продовжуємо перший і останній сегмент.
function overshootEnds(pts, px) {
  if (px <= 0 || pts.length < 2) return pts;
  const ext = (a, b, d) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [b[0] + (b[0] - a[0]) / len * d, b[1] + (b[1] - a[1]) / len * d];
  };
  const out = pts.slice();
  out[0] = ext(pts[1], pts[0], rnd(px * 0.3, px));
  out[out.length - 1] = ext(pts[pts.length - 2], pts[pts.length - 1], rnd(px * 0.3, px));
  return out;
}

function ribbon(g, p, color, width, alpha, pressure) {
  const press = wobbler(1);
  for (let i = 1; i < p.length; i++) {
    const w = Math.max(0.35, width * (1 + press(i * 0.55) * pressure));
    g.moveTo(p[i - 1][0], p[i - 1][1]).lineTo(p[i][0], p[i][1]);
    g.stroke({ width: w, color, alpha, cap: 'round', join: 'round' });
  }
}

/**
 * Штрих пером по полілінії.
 * @param {Graphics} g
 * @param {number[][]} pts — [[x,y], ...] у координатах Graphics
 */
export function penStroke(g, pts, o = {}) {
  const {
    color = '#2b3a8f', width = 2, alpha = 0.9,
    jitter = 1.1, step = 5, overshoot = 3,
    pressure = 0.22, halo = 0.13,
  } = o;
  const p = roughen(overshootEnds(pts, overshoot), jitter, step);
  if (halo > 0) ribbon(g, p, color, width * 2.4, alpha * halo, 0);
  ribbon(g, p, color, width, alpha, pressure);
  return g;
}

/** Ломана/багатокутник: кожне ребро — окремий штрих, тому кути з перехльостом. */
export function penPath(g, pts, o = {}) {
  const closed = o.closed ?? false;
  const n = pts.length;
  const edges = closed ? n : n - 1;
  for (let i = 0; i < edges; i++) penStroke(g, [pts[i], pts[(i + 1) % n]], o);
  return g;
}

export function penCircle(g, cx, cy, r, o = {}) {
  const wob = wobbler(o.radiusJitter ?? r * 0.045);
  const steps = Math.max(14, Math.round(r * 1.1));
  const from = rnd(-0.25, 0.25);
  const to = TAU + rnd(0.12, 0.45); // рука замикає коло з нахлистом
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + (to - from) * (i / steps);
    const rr = r + wob(a * 2.2);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return penStroke(g, pts, { overshoot: 0, jitter: 0.5, ...o });
}

export function penRect(g, x, y, w, h, o = {}) {
  return penPath(g, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], { closed: true, overshoot: 4, ...o });
}

// Liang–Barsky: обрізаємо відрізок прямокутником.
function clipSeg(x0, y0, x1, y1, xmin, ymin, xmax, ymax) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const tests = [[-dx, x0 - xmin], [dx, xmax - x0], [-dy, y0 - ymin], [dy, ymax - y0]];
  for (const [p, q] of tests) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[x0 + t0 * dx, y0 + t0 * dy], [x0 + t1 * dx, y0 + t1 * dy]];
}

/** Штрихування — єдиний спосіб «залити» area в цьому стилі. Суцільних заливок немає. */
export function hatch(g, x, y, w, h, o = {}) {
  const { angle = Math.PI * 0.28, gap = 6, jitterGap = 0.35 } = o;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const nx = -dy, ny = dx;
  const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const proj = corners.map(([px, py]) => px * nx + py * ny);
  const diag = Math.hypot(w, h);

  for (let d = Math.min(...proj); d <= Math.max(...proj); d += gap * rnd(1 - jitterGap, 1 + jitterGap)) {
    const bx = nx * d, by = ny * d;
    const seg = clipSeg(bx - dx * diag, by - dy * diag, bx + dx * diag, by + dy * diag, x, y, x + w, y + h);
    if (seg) penStroke(g, seg, { width: 1.2, alpha: 0.62, overshoot: 1.5, halo: 0.08, ...o });
  }
  return g;
}

/** Закреслити — те, що робить рука, коли об'єкт більше не потрібен. Смерть ворога. */
export function scribble(g, x, y, w, h, o = {}) {
  const passes = o.passes ?? 2;
  for (let p = 0; p < passes; p++) {
    const rows = Math.max(3, Math.round(h / rnd(5, 9)));
    const pts = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      pts.push([x + (i % 2 ? w * rnd(0.9, 1.08) : w * rnd(-0.08, 0.1)), y + h * t + rnd(-2, 2)]);
    }
    penStroke(g, pts, { width: 2.2, alpha: 0.85, jitter: 1.6, overshoot: 5, ...o });
  }
  return g;
}

// --- boil: жива лінія ------------------------------------------------------
// Низькочастотний шум як карта зсуву. Кадр міняється дискретно (12 fps) — саме
// дискретність читається як мальована анімація, плавний зсув виглядає як «желе».
function noiseTexture(size) {
  const small = 24;
  const a = document.createElement('canvas');
  a.width = a.height = small;
  const ga = a.getContext('2d');
  const img = ga.createImageData(small, small);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 128 + (Math.random() - 0.5) * 150;     // x
    img.data[i + 1] = 128 + (Math.random() - 0.5) * 150; // y
    img.data[i + 2] = 128;
    img.data[i + 3] = 255;
  }
  ga.putImageData(img, 0, 0);

  const b = document.createElement('canvas');
  b.width = b.height = size;
  const gb = b.getContext('2d');
  gb.imageSmoothingEnabled = true;
  gb.drawImage(a, 0, 0, size, size);
  return Texture.from(b);
}

export function createBoil(look) {
  const frames = [noiseTexture(256), noiseTexture(256), noiseTexture(256)];
  const sprite = new Sprite(frames[0]);
  sprite.renderable = false; // трансформ потрібен фільтру, малювати не треба
  const filter = new DisplacementFilter({ sprite, scale: look.boil.amplitude });

  let acc = 0, i = 0;
  return {
    sprite,
    filter,
    resize(w, h) { sprite.setSize(w, h); },
    tick(dtMs) {
      acc += dtMs;
      const period = 1000 / look.boil.fps;
      if (acc < period) return;
      acc %= period;
      i = (i + 1) % frames.length;
      sprite.texture = frames[i];
    },
  };
}

/** Порожній Graphics із правильним блендом — усе чорнило створюється так. */
export function inkLayer() {
  const g = new Graphics();
  g.blendMode = 'multiply';
  return g;
}
