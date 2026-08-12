// Нотатки на полях: ручка з чорнилом, інструменти з цінами, життя рисочками.
//
// HUD живе в екранних пікселях (не в клітинках), бо він не частина поля — це
// те, що дописано збоку від малюнка. Місце для нього дає розкладка: аркуш
// центрує ядро, тож у портреті вільна смуга лишається знизу, а в ландскейпі —
// зліва. Обираємо ту, що товща, і кладемо все в один ряд уздовж неї.
//
// Малюємо у два Graphics: статика (іконки, ціни) перемальовується лише на
// ресайзі, динаміка (рівень чорнила, число, життя, підкреслення) — коли
// значення змінилось. Перо щоразу дрижить інакше, тому перемальовувати HUD
// щокадру не можна: напис почне кипіти.

import { Graphics } from '../lib/pixi.min.mjs';
import { penStroke, penPath, penRect, penCircle, penText, textWidth, hatch, scribble } from './ink.js';

const SLOTS = ['ink', 'wall', 'magic_tower', 'cannon', 'eraser', 'lives'];
const TOOLS = new Set(['wall', 'magic_tower', 'cannon', 'eraser']);

/** Іконки інструментів. Коробка — квадрат u×u з початком у (x, y). */
const ICONS = {
  wall(g, x, y, u, pen) {
    penRect(g, x + 0.18 * u, y + 0.22 * u, 0.64 * u, 0.6 * u, { ...pen, overshoot: u * 0.06 });
    penStroke(g, [[x + 0.26 * u, y + 0.76 * u], [x + 0.74 * u, y + 0.28 * u]], { ...pen, alpha: 0.45 });
  },
  magic_tower(g, x, y, u, pen) {
    penRect(g, x + 0.24 * u, y + 0.42 * u, 0.52 * u, 0.46 * u, { ...pen, overshoot: u * 0.05 });
    penStroke(g, [[x + 0.12 * u, y + 0.44 * u], [x + 0.5 * u, y + 0.08 * u], [x + 0.88 * u, y + 0.44 * u]], pen);
    penStroke(g, [[x + 0.5 * u, y + 0.08 * u], [x + 0.5 * u, y - 0.02 * u]], { ...pen, alpha: 0.5 });
  },
  cannon(g, x, y, u, pen) {
    penRect(g, x + 0.14 * u, y + 0.52 * u, 0.6 * u, 0.34 * u, { ...pen, overshoot: u * 0.05 });
    penStroke(g, [[x + 0.34 * u, y + 0.54 * u], [x + 0.9 * u, y + 0.16 * u]], { ...pen, width: pen.width * 1.8 });
    penCircle(g, x + 0.3 * u, y + 0.84 * u, 0.14 * u, pen);
  },
  eraser(g, x, y, u, pen) {
    penPath(g, [
      [x + 0.12 * u, y + 0.74 * u], [x + 0.36 * u, y + 0.24 * u],
      [x + 0.88 * u, y + 0.24 * u], [x + 0.64 * u, y + 0.74 * u],
    ], { ...pen, closed: true, overshoot: u * 0.06 });
    penStroke(g, [[x + 0.24 * u, y + 0.5 * u], [x + 0.76 * u, y + 0.5 * u]], { ...pen, alpha: 0.45 });
  },
};

/** Ручка збоку: корпус, конус і носик. Усередині корпусу видно чорнило. */
function penIcon(g, x, y, u, pen) {
  const bx = x + 0.28 * u, bw = 0.44 * u;
  penPath(g, [
    [bx, y + 0.02 * u], [bx + bw, y + 0.02 * u], [bx + bw, y + 0.7 * u],
    [x + 0.5 * u, y + 0.98 * u], [bx, y + 0.7 * u],
  ], { ...pen, closed: true, overshoot: u * 0.04 });
  penStroke(g, [[bx, y + 0.14 * u], [bx + bw, y + 0.14 * u]], { ...pen, alpha: 0.5 });
  return { x: bx + u * 0.035, y: y + 0.17 * u, w: bw - u * 0.07, h: 0.5 * u };
}

/** Життя — рисочки, як рахунок на полях. Втрачені закреслені червоним. */
function tally(g, x, y, u, total, alive, look) {
  const per = 5;
  const gap = 0.11 * u, rowH = 0.46 * u;
  const rows = Math.ceil(total / per);
  const top = y + (u - rows * rowH) / 2;

  for (let i = 0; i < total; i++) {
    const r = (i / per) | 0, k = i % per;
    const gx = x + (k + 0.5) * gap;
    const gy = top + r * rowH;
    const dead = i >= alive;
    const col = dead ? look.pens.red : look.pens.blue;
    const o = { color: col, width: u * 0.045, alpha: dead ? 0.7 : 0.85, jitter: u * 0.02, step: u * 0.2, overshoot: u * 0.03, halo: 0.1 };
    if (k === per - 1) {
      // п'ята рисочка лягає навскіс через попередні чотири
      penStroke(g, [[x + 0.1 * gap, gy + 0.34 * rowH], [gx + gap * 0.6, gy + 0.04 * rowH]], o);
    } else {
      penStroke(g, [[gx, gy + 0.04 * rowH], [gx + gap * 0.18, gy + 0.34 * rowH]], o);
    }
  }
}

export function createHud({ hud, look, balance, game, onRestart }) {
  const still = new Graphics();
  const live = new Graphics();
  const over = new Graphics(); // фінальна записка поверх усього
  hud.addChild(still, live, over);

  const slots = new Map(); // id → { x, y, w, h, u, gauge? }
  let u = 24;
  let tool = 'wall';
  let shown = null;   // останнє намальоване {ink, lives, tool, phase, wave}
  let waveAt = null;  // де підписано номер хвилі
  let L0 = null;      // остання розкладка — потрібна фінальній записці
  let box = null;     // рамка фінальної записки, вона ж зона тапу

  const price = (id) => (id === 'eraser' ? '50%' : String(balance.build[id] ?? ''));

  function place(L) {
    L0 = L;
    const n = SLOTS.length;
    const bottom = Math.max(L.oy, L.h * 0.1);
    const side = Math.max(L.ox, 0);
    const vertical = side > bottom;

    if (vertical) {
      u = Math.min(64, side / 1.25, L.h / (1.62 * n));
      const bw = 1.2 * u, bh = 1.6 * u;
      const x = (side - bw) / 2;
      const y0 = (L.h - n * bh) / 2;
      SLOTS.forEach((id, i) => slots.set(id, { x, y: y0 + i * bh, w: bw, h: bh }));
      // Лічильник хвиль — на протилежному полі, щоб не тіснити інструменти.
      waveAt = { x: L.w - side / 2, y: L.h * 0.12 };
    } else {
      u = Math.min(64, bottom / 1.62, L.w / (1.25 * n));
      const bw = 1.2 * u, bh = 1.6 * u;
      const x0 = (L.w - n * bw) / 2;
      const y = L.h - bottom + (bottom - bh) / 2;
      SLOTS.forEach((id, i) => slots.set(id, { x: x0 + i * bw, y, w: bw, h: bh }));
      // У куток, а не по центру смуги: центр вільного поля потрібен панелі
      // деталей, а номер хвилі — довідка, яка не мусить сидіти на видноті.
      waveAt = { x: L.w - bottom * 0.5, y: Math.max(bottom, L.oy) / 2 };
    }
  }

  function drawStill() {
    still.clear();
    const pen = { color: look.pens.blue, width: u * 0.045, alpha: 0.85, jitter: u * 0.018, step: u * 0.22, overshoot: u * 0.05, halo: 0.12 };

    for (const id of SLOTS) {
      const s = slots.get(id);
      const ix = s.x + (s.w - u) / 2;
      if (id === 'ink') s.gauge = penIcon(still, ix, s.y, u, pen);
      else if (ICONS[id]) ICONS[id](still, ix, s.y, u, pen);

      if (id === 'lives' || id === 'ink') continue;
      const size = u * 0.4;
      penText(still, price(id), s.x + (s.w - textWidth(price(id), size)) / 2, s.y + u, size,
        { color: id === 'eraser' ? look.pens.green : look.pens.blue, alpha: 0.8 });
    }
  }

  function drawLive() {
    live.clear();
    const ink = game.wallet.ink;

    // Чорнило в корпусі ручки: штрихування росте знизу вгору.
    const s = slots.get('ink');
    const b = s?.gauge;
    if (b) {
      const p = Math.max(0, Math.min(1, ink / balance.economy.gauge));
      const top = b.y + b.h * (1 - p);
      if (p > 0.01) {
        // штрихи впоперек корпусу: рівень читається як рідина, а не як смуга
        hatch(live, b.x, top, b.w, b.h * p, {
          color: look.pens.green, angle: 0, gap: Math.max(1.4, u * 0.055),
          jitterGap: 0.2, width: u * 0.04, alpha: 0.7, halo: 0.1, jitter: u * 0.01, step: u * 0.14, overshoot: 0,
        });
        // межа чорнила — те, за чим стежить око
        penStroke(live, [[b.x - u * 0.02, top], [b.x + b.w + u * 0.02, top]],
          { color: look.pens.green, width: u * 0.05, alpha: 0.95, jitter: u * 0.012, step: u * 0.12, overshoot: u * 0.02, halo: 0.15 });
      }
      const size = u * 0.4;
      penText(live, String(ink), s.x + (s.w - textWidth(String(ink), size)) / 2, s.y + u, size,
        { color: look.pens.green, alpha: 0.9 });
    }

    const ls = slots.get('lives');
    if (ls) tally(live, ls.x + ls.w * 0.14, ls.y, u, game.state.maxLives, game.state.lives, look);

    // Обраний інструмент підкреслено маркером.
    const t = slots.get(tool);
    if (t) {
      live.rect(t.x + t.w * 0.08, t.y + u * 1.46, t.w * 0.84, u * 0.11)
        .fill({ color: look.pens.marker, alpha: 0.6 });
    }

    // Номер хвилі — олівцем на протилежному полі.
    if (waveAt) {
      const size = u * 0.44;
      const txt = `${Math.min(game.state.wave + 1, game.state.waves)}/${game.state.waves}`;
      penText(live, txt, waveAt.x - textWidth(txt, size) / 2, waveAt.y - size / 2, size,
        { color: look.pens.pencil, alpha: 0.7 });
    }

    shown = { ink, lives: game.state.lives, tool, phase: game.state.phase, wave: game.state.wave };
  }

  /** Кінець партії: записка поверх аркуша. Виграв — велика галочка, програв —
   *  усе закреслено. Знизу — стрілка «ще раз»; тап будь-де починає заново. */
  function drawEnd() {
    over.clear();
    box = null;
    const st = game.state;
    const win = st.phase === 'won';
    if (!win && st.phase !== 'lost') return;

    const W = L0.w, H = L0.h;
    const s = Math.min(W, H) * 0.34;
    const cx = W / 2, cy = H / 2 - s * 0.25;

    // Шар множиться на папір, тож затемнити можна, освітлити — ні. Гасимо все
    // навколо записки: суцільна заливка на весь екран не дала б контрасту.
    const bx = cx - s * 0.78, by = cy - s * 0.62, bw = s * 1.56, bh = s * 1.95;
    const dim = { color: 0x8f8875, alpha: 0.5 };
    over.rect(0, 0, W, by).fill(dim);
    over.rect(0, by + bh, W, H - by - bh).fill(dim);
    over.rect(0, by, bx, bh).fill(dim);
    over.rect(bx + bw, by, W - bx - bw, bh).fill(dim);
    const pen = { width: s * 0.045, alpha: 0.9, jitter: s * 0.012, step: s * 0.12, overshoot: s * 0.03, halo: 0.15 };

    penRect(over, bx, by, bw, bh, { ...pen, color: look.pens.pencil, alpha: 0.6, width: s * 0.022 });

    if (win) {
      penStroke(over, [[cx - s * 0.42, cy], [cx - s * 0.1, cy + s * 0.33], [cx + s * 0.46, cy - s * 0.4]],
        { ...pen, color: look.pens.green, width: s * 0.085 });
    } else {
      scribble(over, cx - s * 0.45, cy - s * 0.4, s * 0.9, s * 0.78,
        { color: look.pens.red, alpha: 0.85, passes: 3, halo: 0.12 });
    }

    const size = s * 0.3;
    const txt = `${win ? st.waves : st.wave}/${st.waves}`;
    penText(over, txt, cx - textWidth(txt, size) / 2, cy + s * 0.52, size,
      { color: win ? look.pens.green : look.pens.red, alpha: 0.95, width: size * 0.14 });

    // Кругова стрілка: розімкнене коло з двома рисочками на кінці.
    const r = s * 0.2, ay = cy + s * 1.2, from = -2.2;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const a = from + (i / 24) * 5.1;
      pts.push([cx + Math.cos(a) * r, ay + Math.sin(a) * r]);
    }
    penStroke(over, pts, { ...pen, color: look.pens.blue, width: s * 0.05, overshoot: 0 });
    const hx = cx + Math.cos(from) * r, hy = ay + Math.sin(from) * r;
    for (const d of [0.7, 2.3]) {
      penStroke(over, [[hx, hy], [hx + Math.cos(from + d) * s * 0.13, hy + Math.sin(from + d) * s * 0.13]],
        { ...pen, color: look.pens.blue, width: s * 0.045 });
    }

    box = { x: 0, y: 0, w: W, h: H }; // після кінця тап будь-де = ще раз
  }

  return {
    resize(L) { place(L); drawStill(); drawLive(); drawEnd(); },

    /** Дешева перевірка щокадру: перемальовуємо лише коли число змінилось. */
    tick() {
      if (!shown) return;
      const st = game.state;
      if (shown.ink === game.wallet.ink && shown.lives === st.lives && shown.tool === tool
        && shown.phase === st.phase && shown.wave === st.wave) return;
      const phaseChanged = shown.phase !== st.phase;
      drawLive();
      if (phaseChanged) drawEnd();
    },

    setTool(t) { tool = t; },
    get tool() { return tool; },

    /** @returns {string|null} що під пальцем: інструмент, 'restart' або нічого */
    hit(px, py) {
      if (box) { onRestart?.(); return 'restart'; }
      for (const id of TOOLS) {
        const s = slots.get(id);
        if (s && px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h) return id;
      }
      return null;
    },
  };
}
