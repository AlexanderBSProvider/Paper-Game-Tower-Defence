// Навчання малюнками: рука, що тапає й обводить, і піктограми без жодного слова.
//
// Власник попросив туторіал не текстом. Тому все тут — перо зошита:
//   - рука з вказівним пальцем (олівець + жовтий маркер), що натискає в точку,
//     і коло, що розходиться від пальця;
//   - та сама рука сама обводить трафарет у рамці й лишає слід чорнила —
//     показує, ЩО робити, а не розповідає;
//   - піктограми: «колодязь → крапля» і комікс «ворог → червона лінія →
//     блискавка ×1» (лазер спрацьовує лише раз).
// Заодно це знімає переклад: малюнок однаковий для всіх мов.
//
// Шар у екранних пікселях, над рамкою обведення. Руку малюємо раз (інакше
// дрож пера кипів би щокадру), далі лише рухаємо й крутимо.

import { Container, Graphics } from '../../lib/pixi.min.mjs';
import { penStroke, penPath, penText } from './ink.js';
import type { PenOpts } from './ink.js';
import type { Look, Vec2 } from '../types.js';

export type Picto = 'well' | 'laser';

export interface CoachArt {
  /** Рука тапає в точку екрана. Можна кликати щокадру — анімація не скидається. */
  tap(x: number, y: number): void;
  /** Рука обводить штрихи (px екрана) і лишає слід; показ повторюється. */
  trace(strokes: Vec2[][]): void;
  /** Піктограма біля точки екрана; null — сховати. */
  picto(kind: Picto | null, x?: number, y?: number): void;
  /** Сховати руку (піктограма лишається, якщо є). */
  hideHand(): void;
  hide(): void;
  /** Розмір руки в px: від клітинки поля. */
  resize(unit: number): void;
  tick(dt: number): void;
}

export function createCoachArt(layer: Container, look: Look, wellOutline: Vec2[][]): CoachArt {
  const hand = new Container();
  const handG = new Graphics();
  hand.addChild(handG);
  const ring = new Graphics();
  const trail = new Graphics();
  const pictoC = new Container();
  const pictoG = new Graphics();
  pictoC.addChild(pictoG);
  layer.addChild(trail, ring, pictoC, hand);

  let S = 60;                       // розмір руки, px
  let mode: 'none' | 'tap' | 'trace' = 'none';
  let t = 0;
  let target: Vec2 = [0, 0];
  let path: Vec2[][] = [], pathKey = '', total = 0;
  let pictoKind: Picto | null = null, pictoAt: Vec2 = [0, 0];

  const pencil = (w: number, o: PenOpts = {}): PenOpts => ({
    color: look.pens.pencil, width: w, alpha: 0.9, jitter: w * 0.25, step: w * 4, overshoot: w * 0.6, halo: 0.08, pressure: 0.2, ...o,
  });

  /**
   * Рука вказівним пальцем угору, кінчик пальця — у (0, 0). Далі її повертають
   * так, щоб палець дивився вгору-вліво, а зап'ястя йшло вниз-управо.
   */
  function drawHand() {
    const g = handG;
    g.clear();
    const u = S;
    const P = (x: number, y: number): Vec2 => [x * u, y * u];
    const tip: Vec2[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI + (Math.PI * i) / 8;
      tip.push(P(Math.cos(a) * 0.085, 0.085 + Math.sin(a) * 0.085));
    }
    const outline: Vec2[] = [
      ...tip,                                   // кінчик пальця зліва направо
      P(0.085, 0.46),                           // правий бік пальця вниз
      P(0.13, 0.43), P(0.18, 0.44), P(0.2, 0.47),   // зігнутий палець 1
      P(0.24, 0.44), P(0.29, 0.45), P(0.31, 0.49),  // зігнутий палець 2
      P(0.35, 0.47), P(0.4, 0.5), P(0.41, 0.56),    // зігнутий палець 3
      P(0.42, 0.7), P(0.38, 0.84),              // ребро долоні
      P(-0.08, 0.86),                           // низ долоні
      P(-0.12, 0.74), P(-0.21, 0.67), P(-0.27, 0.58), P(-0.22, 0.52), P(-0.14, 0.56), // великий палець
      P(-0.085, 0.5),                           // лівий бік пальця вгору
    ];
    g.poly(outline.flat()).fill({ color: look.pens.marker, alpha: 0.6 });
    penPath(g, outline, pencil(u * 0.032, { closed: true }));
    // складки між зігнутими пальцями
    for (const [x0, y0, y1] of [[0.2, 0.47, 0.56], [0.31, 0.49, 0.58]]) penStroke(g, [P(x0, y0), P(x0 - 0.01, y1)], pencil(u * 0.022));
    // рукав: синій, як усе своє в зошиті
    const sleeve: Vec2[] = [P(-0.12, 0.86), P(0.42, 0.84), P(0.45, 1.08), P(-0.11, 1.1)];
    g.poly(sleeve.flat()).fill({ color: look.pens.blue, alpha: 0.25 });
    penPath(g, sleeve, pencil(u * 0.03, { closed: true, color: look.pens.blue }));
    penStroke(g, [P(-0.1, 0.93), P(0.43, 0.91)], pencil(u * 0.02, { color: look.pens.blue }));
    hand.rotation = -0.5;
  }

  /** Крапля чорнила — та сама, що вилітає з колодязя. */
  function drop(g: Graphics, x: number, y: number, r: number) {
    const pen = { color: look.pens.green, width: r * 0.18, alpha: 0.95, jitter: r * 0.03, step: r * 0.4, overshoot: 0, halo: 0.15 };
    const pts: Vec2[] = [];
    for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI * 2; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
    g.circle(x, y, r).fill({ color: look.pens.green, alpha: 0.25 });
    penStroke(g, pts, pen);
    penStroke(g, [[x - r * 0.55, y - r * 0.8], [x, y - r * 1.7], [x + r * 0.55, y - r * 0.8]], pen);
  }

  /** Стрілка олівцем: «а потім». */
  function arrow(g: Graphics, x0: number, x1: number, y: number) {
    const w = S * 0.035;
    penStroke(g, [[x0, y], [x1, y]], pencil(w));
    penStroke(g, [[x1 - S * 0.14, y - S * 0.1], [x1, y], [x1 - S * 0.14, y + S * 0.1]], pencil(w));
  }

  function drawPicto() {
    const g = pictoG;
    g.clear();
    if (!pictoKind) return;
    const u = S;
    if (pictoKind === 'well') {
      // колодязь (той самий контур, що в трафареті) → крапля
      const box = u * 0.95;
      for (const st of wellOutline) {
        penStroke(g, st.map(([x, y]): Vec2 => [x * box - box / 2, y * box - box / 2]), {
          color: look.pens.blue, width: u * 0.04, alpha: 0.9, jitter: u * 0.01, step: u * 0.2, overshoot: u * 0.02, halo: 0.12,
        });
      }
      arrow(g, box * 0.6, box * 0.6 + u * 0.6, 0);
      drop(g, box * 0.6 + u * 0.95, u * 0.05, u * 0.2);
    } else {
      // ворог → червона лінія → блискавка ×1
      const r = u * 0.26;
      const eyes: Vec2[] = [[-r * 0.35, -r * 0.15], [r * 0.25, -r * 0.15]];
      g.circle(0, 0, r).fill({ color: look.pens.red, alpha: 0.22 });
      const ring: Vec2[] = [];
      for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI * 2; ring.push([Math.cos(a) * r, Math.sin(a) * r]); }
      penStroke(g, ring, { color: look.pens.red, width: u * 0.04, alpha: 0.9, jitter: u * 0.01, step: u * 0.15, overshoot: 0, halo: 0.1 });
      for (const [ex, ey] of eyes) g.circle(ex, ey, r * 0.13).fill({ color: look.pens.pencil, alpha: 0.95 });
      arrow(g, r * 1.4, r * 1.4 + u * 0.55, 0);
      const lx = r * 1.4 + u * 0.8;
      penStroke(g, [[lx, -u * 0.45], [lx, u * 0.45]], { color: look.margin.color, width: u * 0.07, alpha: 0.9, jitter: u * 0.01, step: u * 0.2, overshoot: 0, halo: 0.1 });
      const zx = lx + u * 0.18;
      const zig: Vec2[] = [[zx + u * 0.12, -u * 0.38], [zx - u * 0.02, -u * 0.02], [zx + u * 0.14, -u * 0.02], [zx, u * 0.38]];
      penStroke(g, zig, { color: look.pens.orange ?? look.pens.red, width: u * 0.06, alpha: 0.95, jitter: u * 0.01, step: u * 0.2, overshoot: 0, halo: 0.2 });
      const size = u * 0.36;
      penText(g, '×1', zx + u * 0.3, -size / 2, size, { color: look.pens.red, alpha: 0.95 });
    }
  }

  function placeHand(x: number, y: number, press = 0) {
    hand.visible = true;
    hand.position.set(x, y);
    hand.scale.set(1 - press * 0.08);
  }

  return {
    tap(x, y) {
      target = [x, y];
      if (mode !== 'tap') { mode = 'tap'; t = 0; trail.clear(); }
    },

    trace(strokes) {
      const key = strokes.map((s) => s.length + ':' + Math.round(s[0]?.[0] ?? 0) + ',' + Math.round(s[0]?.[1] ?? 0)).join('|');
      if (mode === 'trace' && key === pathKey) return;
      mode = 'trace'; t = 0; pathKey = key; path = strokes;
      total = 0;
      for (const s of path) for (let i = 1; i < s.length; i++) total += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      ring.clear();
    },

    picto(kind, x = 0, y = 0) {
      pictoAt = [x, y];
      if (kind === pictoKind) return;
      pictoKind = kind;
      drawPicto();
    },

    hideHand() {
      mode = 'none';
      hand.visible = false;
      ring.clear();
      trail.clear();
    },

    hide() {
      this.hideHand();
      this.picto(null);
    },

    resize(unit) {
      if (Math.abs(unit - S) < 0.5) return;
      S = unit;
      drawHand();
      drawPicto();
    },

    tick(dt) {
      t += dt;
      pictoC.visible = !!pictoKind;
      if (pictoKind) pictoC.position.set(pictoAt[0], pictoAt[1] + Math.sin(t * 2.4) * S * 0.04);

      if (mode === 'tap') {
        // Цикл 1.3 с: підлітає → натискає → коло розходиться.
        const T = 1.3, p = (t % T) / T;
        const approach = p < 0.3 ? 1 - p / 0.3 : 0;
        const press = p >= 0.3 && p < 0.45 ? Math.sin(((p - 0.3) / 0.15) * Math.PI) : 0;
        placeHand(target[0] + approach * S * 0.35, target[1] + approach * S * 0.35, press);
        ring.clear();
        if (p >= 0.32) {
          const q = (p - 0.32) / 0.68;
          ring.circle(target[0], target[1], S * (0.12 + q * 0.42))
            .stroke({ width: S * 0.05 * (1 - q) + 1, color: look.pens.orange ?? look.pens.red, alpha: 0.85 * (1 - q) });
        }
      } else if (mode === 'trace' && total > 0) {
        // Обводимо зі швидкістю ~2.4 с на трафарет, тримаємо, гасимо, знову.
        const dur = 2.4, hold = 0.7, fade = 0.4, T = dur + hold + fade;
        const lt = t % T;
        const done = Math.min(1, lt / dur) * total;
        trail.clear();
        trail.alpha = lt < dur + hold ? 1 : 1 - (lt - dur - hold) / fade;
        let acc = 0, head: Vec2 | null = null;
        for (const s of path) {
          for (let i = 1; i < s.length; i++) {
            const a = s[i - 1], b = s[i];
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (acc >= done) break;
            const k = Math.min(1, (done - acc) / len);
            const e: Vec2 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
            trail.moveTo(a[0], a[1]).lineTo(e[0], e[1]).stroke({ width: S * 0.05, color: look.pens.blue, alpha: 0.6, cap: 'round' });
            head = e;
            acc += len;
          }
        }
        if (head) placeHand(head[0], head[1]);
        else hand.visible = false;
      } else {
        hand.visible = false;
        ring.clear();
      }
    },
  };
}
