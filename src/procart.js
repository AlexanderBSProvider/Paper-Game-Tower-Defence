// Дудл-плейсхолдери: те саме, що потім намалює рука, але поки малює код.
//
// Кожна частина — МАСКА: біле чорнило на прозорому. Колір дає перо в rigs.json
// через tint, тому один малюнок годиться будь-якій ручці, і твій майбутній арт
// стане на те саме місце без правок логіки.
//
// Малюємо в пікселях (refCell пікселів на клітинку × supersample), а спрайт
// потім живе в клітинках — тому лінія не роздувається разом зі світом.

import { Graphics, Rectangle } from '../lib/pixi.min.mjs';
import { penStroke, penPath, penCircle, penRect, hatch } from './ink.js';

const W = '#ffffff';
const ink = (o = {}) => ({ color: W, ...o });

/** Детермінований генератор — щоб декор не стрибав при кожному запуску. */
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- вухань --------------------------------------------------------------
function earlingBody(g, w, h, lw) {
  penCircle(g, w * 0.5, h * 0.52, Math.min(w, h) * 0.42, ink({ width: lw }));
  // лапки
  penStroke(g, [[w * 0.34, h * 0.86], [w * 0.29, h * 0.98]], ink({ width: lw }));
  penStroke(g, [[w * 0.66, h * 0.86], [w * 0.71, h * 0.98]], ink({ width: lw }));
  // тінь під животом
  hatch(g, w * 0.26, h * 0.62, w * 0.42, h * 0.24, ink({ gap: w * 0.1, width: lw * 0.55, alpha: 0.5 }));
}

function earlingHead(g, w, h, lw) {
  const cx = w * 0.5, cy = h * 0.62, r = Math.min(w, h) * 0.33;
  // вуха — те, за що його й звати
  penPath(g, [[cx - r * 0.85, cy - r * 0.55], [cx - r * 1.15, h * 0.06], [cx - r * 0.2, cy - r * 0.9]], ink({ width: lw }));
  penPath(g, [[cx + r * 0.85, cy - r * 0.55], [cx + r * 1.15, h * 0.06], [cx + r * 0.2, cy - r * 0.9]], ink({ width: lw }));
  penCircle(g, cx, cy, r, ink({ width: lw }));
  // зла паща
  penStroke(g, [[cx - r * 0.45, cy + r * 0.5], [cx - r * 0.15, cy + r * 0.3], [cx + r * 0.15, cy + r * 0.5], [cx + r * 0.45, cy + r * 0.3]], ink({ width: lw * 0.8, overshoot: 1 }));
}

function earlingEyes(g, w, h, lw) {
  for (const s of [-1, 1]) {
    const cx = w * 0.5 + s * w * 0.22;
    // брова під кутом — уся лють у ній
    penStroke(g, [[cx - w * 0.1, h * 0.18 + (s < 0 ? 0 : h * 0.22)], [cx + w * 0.1, h * 0.18 + (s < 0 ? h * 0.22 : 0)]], ink({ width: lw * 0.9 }));
    penCircle(g, cx, h * 0.66, h * 0.16, ink({ width: lw * 0.8 }));
  }
}

// --- магічна башта --------------------------------------------------------
function magicBase(g, w, h, lw) {
  const t = w * 0.16; // звуження догори
  penPath(g, [[w * 0.1 + t, h * 0.08], [w * 0.9 - t, h * 0.08], [w * 0.94, h * 0.95], [w * 0.06, h * 0.95]], ink({ width: lw, closed: true }));
  penCircle(g, w * 0.5, h * 0.36, w * 0.12, ink({ width: lw * 0.8 })); // вікно
  hatch(g, w * 0.62, h * 0.45, w * 0.28, h * 0.45, ink({ gap: w * 0.1, width: lw * 0.55, alpha: 0.55 }));
  penStroke(g, [[w * 0.06, h * 0.95], [w * 0.94, h * 0.95]], ink({ width: lw * 1.1 }));
}

function magicRoof(g, w, h, lw) {
  penPath(g, [[w * 0.08, h * 0.92], [w * 0.5, h * 0.07], [w * 0.92, h * 0.92]], ink({ width: lw }));
  // хвилястий низ — стріха, а не трикутник
  penStroke(g, [[w * 0.06, h * 0.9], [w * 0.28, h * 0.97], [w * 0.5, h * 0.89], [w * 0.72, h * 0.97], [w * 0.94, h * 0.9]], ink({ width: lw * 0.9 }));
  hatch(g, w * 0.5, h * 0.35, w * 0.36, h * 0.5, ink({ gap: w * 0.09, width: lw * 0.5, alpha: 0.5, angle: -0.6 }));
}

function magicStaff(g, w, h, lw) {
  penStroke(g, [[w * 0.5, h * 0.98], [w * 0.46, h * 0.3]], ink({ width: lw }));
  // зірка на вершині
  const cx = w * 0.46, cy = h * 0.2, r = Math.min(w, h) * 0.16;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    penStroke(g, [[cx - Math.cos(a) * r, cy - Math.sin(a) * r], [cx + Math.cos(a) * r, cy + Math.sin(a) * r]], ink({ width: lw * 0.75 }));
  }
  penCircle(g, cx, cy, r * 0.42, ink({ width: lw * 0.7 }));
}

// --- гармата --------------------------------------------------------------
function cannonBase(g, w, h, lw) {
  penRect(g, w * 0.12, h * 0.3, w * 0.76, h * 0.42, ink({ width: lw }));
  hatch(g, w * 0.14, h * 0.32, w * 0.72, h * 0.38, ink({ gap: w * 0.1, width: lw * 0.5, alpha: 0.45 }));
  penCircle(g, w * 0.3, h * 0.76, h * 0.2, ink({ width: lw }));
  penCircle(g, w * 0.7, h * 0.76, h * 0.2, ink({ width: lw }));
  penStroke(g, [[w * 0.3, h * 0.76], [w * 0.7, h * 0.76]], ink({ width: lw * 0.6, alpha: 0.7 }));
}

function cannonBarrel(g, w, h, lw) {
  penPath(g, [[w * 0.06, h * 0.28], [w * 0.86, h * 0.2], [w * 0.86, h * 0.8], [w * 0.06, h * 0.72]], ink({ width: lw, closed: true }));
  penCircle(g, w * 0.88, h * 0.5, h * 0.32, ink({ width: lw * 0.9 })); // дуло
  hatch(g, w * 0.1, h * 0.34, w * 0.7, h * 0.34, ink({ gap: w * 0.09, width: lw * 0.5, alpha: 0.45, angle: 0.12 }));
}

// --- база --------------------------------------------------------------
function keepWall(g, w, h, lw) {
  penRect(g, w * 0.06, h * 0.32, w * 0.88, h * 0.62, ink({ width: lw }));
  // зубці
  const n = 5, bw = (w * 0.88) / (n * 2 - 1);
  for (let i = 0; i < n; i++) {
    const x = w * 0.06 + i * bw * 2;
    penPath(g, [[x, h * 0.32], [x, h * 0.12], [x + bw, h * 0.12], [x + bw, h * 0.32]], ink({ width: lw * 0.9 }));
  }
  // ворота
  const gx = w * 0.5, gw = w * 0.15;
  penCircle(g, gx, h * 0.62, gw, ink({ width: lw * 0.9 }));
  penStroke(g, [[gx - gw, h * 0.62], [gx - gw, h * 0.94]], ink({ width: lw * 0.9 }));
  penStroke(g, [[gx + gw, h * 0.62], [gx + gw, h * 0.94]], ink({ width: lw * 0.9 }));
  hatch(g, w * 0.08, h * 0.36, w * 0.3, h * 0.55, ink({ gap: w * 0.06, width: lw * 0.45, alpha: 0.4 }));
}

function keepFlag(g, w, h, lw) {
  penStroke(g, [[w * 0.14, h * 0.98], [w * 0.14, h * 0.04]], ink({ width: lw }));
  penPath(g, [[w * 0.16, h * 0.08], [w * 0.92, h * 0.24], [w * 0.16, h * 0.44]], ink({ width: lw * 0.9 }));
  hatch(g, w * 0.2, h * 0.12, w * 0.5, h * 0.26, ink({ gap: w * 0.12, width: lw * 0.45, alpha: 0.5 }));
}

// --- декор --------------------------------------------------------------
function decorTree(g, w, h, lw) {
  penStroke(g, [[w * 0.44, h * 0.99], [w * 0.47, h * 0.62]], ink({ width: lw }));
  penStroke(g, [[w * 0.58, h * 0.99], [w * 0.55, h * 0.62]], ink({ width: lw }));
  // крона трьома клубками, як у скетчі
  penCircle(g, w * 0.5, h * 0.42, w * 0.3, ink({ width: lw * 0.95 }));
  penCircle(g, w * 0.3, h * 0.5, w * 0.2, ink({ width: lw * 0.9 }));
  penCircle(g, w * 0.72, h * 0.52, w * 0.19, ink({ width: lw * 0.9 }));
  hatch(g, w * 0.34, h * 0.3, w * 0.34, h * 0.28, ink({ gap: w * 0.11, width: lw * 0.45, alpha: 0.4 }));
}

function decorBush(g, w, h, lw) {
  penCircle(g, w * 0.34, h * 0.66, w * 0.22, ink({ width: lw * 0.9 }));
  penCircle(g, w * 0.64, h * 0.6, w * 0.26, ink({ width: lw * 0.9 }));
  penStroke(g, [[w * 0.08, h * 0.96], [w * 0.92, h * 0.94]], ink({ width: lw * 0.7, alpha: 0.6 }));
}

const DOODLES = {
  earling_body: earlingBody,
  earling_head: earlingHead,
  earling_eyes: earlingEyes,
  magic_base: magicBase,
  magic_roof: magicRoof,
  magic_staff: magicStaff,
  cannon_base: cannonBase,
  cannon_barrel: cannonBarrel,
  keep_wall: keepWall,
  keep_flag: keepFlag,
  decor_tree: decorTree,
  decor_bush: decorBush,
};

/**
 * Деталі башт печуться прямо з контурів: гравець обводить рівно те, що потім
 * стане на поле. Один набір ліній — одне джерело, тому малюнок і контур не
 * можуть розійтись.
 * @returns {Map<string, Texture>} id деталі → маска
 */
export function bakeCatalogue(renderer, catalogue, look) {
  const px = look.sprite.refCell * look.sprite.supersample;
  const out = new Map();

  for (const [id, def] of Object.entries(catalogue)) {
    if (id.startsWith('_') || !def.outline) continue;
    const w = def.size[0] * px, h = def.size[1] * px;
    const lw = Math.max(1.8, Math.min(w, h) * 0.075);
    const g = new Graphics();

    for (const s of def.outline) {
      penStroke(g, s.map(([x, y]) => [x * w, y * h]), ink({
        width: lw, jitter: lw * 0.45, step: Math.min(w, h) * 0.2,
        // Перехльости малі: усе, що вилізе за коробку, обріже кадр текстури.
        overshoot: lw * 0.7,
      }));
    }

    out.set(id, renderer.generateTexture({
      target: g, frame: new Rectangle(0, 0, w, h), antialias: true,
    }));
    g.destroy();
  }
  return out;
}

/**
 * Пече текстури всіх частин один раз на старті.
 * @returns {Map<string, Texture>} id частини → маска
 */
export function bakeParts(renderer, parts, look) {
  const px = look.sprite.refCell * look.sprite.supersample;
  const out = new Map();

  for (const [id, def] of Object.entries(parts)) {
    if (id.startsWith('_')) continue;
    const name = def.file.startsWith('proc:') ? def.file.slice(5) : null;
    const draw = name && DOODLES[name];
    if (!draw) {
      console.warn(`[procart] немає генератора для ${id} (${def.file})`);
      continue;
    }
    const w = def.size[0] * px, h = def.size[1] * px;
    const lw = Math.max(1.8, Math.min(w, h) * 0.055);

    const g = new Graphics();
    draw(g, w, h, lw);
    out.set(id, renderer.generateTexture({
      target: g,
      frame: new Rectangle(0, 0, w, h),
      antialias: true,
    }));
    g.destroy();
  }
  return out;
}
