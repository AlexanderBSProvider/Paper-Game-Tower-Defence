// Дрібні ефекти режиму lane: снаряд, цифра, закреслення, іскра, крапля, лазер.
//
// Копії з combat.ts, а не імпорт — той самий прецедент, що laneHud.ts ↔ hud.ts:
// combat.ts обслуговує лабіринт і лишається недоторканим, а режиму від нього
// треба чотири малюнки на сорок рядків. Спільний модуль заради двох споживачів
// коштував би дорожче за копію.
//
// Усе в клітинках світу: шар лежить у world, і перо саме масштабується.

import { Container, Graphics } from '../../lib/pixi.min.mjs';
import { penStroke, penCircle, penText, textWidth, hatch, scribble } from './ink.js';
import type { Fx, Look, Vec2 } from '../types.js';

export interface NumberOpts {
  /** бонусний удар: більша й зі знаком оклику — єдиний спосіб показати контри без літер */
  bonus?: boolean;
  /** штрафний удар: дрібна й олівцем — «не та зброя» */
  penalty?: boolean;
  color?: string | number;
  /** зі знаком плюс: зцілення */
  plus?: boolean;
}

export interface LaneFx {
  /** Риска снаряда. Малюється раз, далі лише рухається — перо з дрожем щокадру
   *  це нова геометрія на кожен кадр. */
  bolt(x: number, y: number, dir: 1 | -1): Graphics;
  /** Цифра спливає й тане. */
  number(x: number, y: number, amount: number, o?: NumberOpts): void;
  spark(x: number, y: number): void;
  /** Зцілення: зелені промінці навколо точки. */
  bless(x: number, y: number): void;
  /** Смерть: закреслюють кількома зигзагами, і закреслення тане. */
  strikeOut(x: number, y: number, w: number, h: number, color?: string | number): void;
  /** Лазер лінії дому: товстий промінь через увесь ряд, спалахує й гасне. */
  laser(x0: number, x1: number, y: number): void;
  /**
   * Крапля чорнила: вискакує з точки, робить коротку дугу й летить туди, куди
   * каже `to` (перепитується щокадру — ручка на полях може переїхати при
   * ресайзі). На прильоті — `then`: чорнило зараховується саме тоді, коли крапля
   * долетіла, щоб число в ручці росло на очах, а не наперед.
   */
  inkDrop(x: number, y: number, amount: number, to: () => Vec2, then: () => void): void;
  step(dt: number): void;
}

export function createLaneFx(layer: Container, look: Look): LaneFx {
  const fx: Fx[] = [];

  function fade(g: Graphics, dur: number, hold = 0) {
    layer.addChild(g);
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        g.alpha = this.t < hold ? 1 : Math.max(0, 1 - (this.t - hold) / dur);
        if (this.t < hold + dur) return false;
        g.destroy();
        return true;
      },
    });
  }

  function bolt(x: number, y: number, dir: 1 | -1) {
    const g = new Graphics();
    penStroke(g, [[-0.34, 0], [0.12, 0]],
      { color: look.pens.blue, width: 0.08, alpha: 0.9, jitter: 0.015, step: 0.2, overshoot: 0.04, halo: 0.2 });
    for (const a of [-0.8, 0.8]) {
      penStroke(g, [[0.12, 0], [0.12 + Math.cos(a) * 0.12, Math.sin(a) * 0.12]],
        { color: look.pens.blue, width: 0.05, alpha: 0.7, jitter: 0.01, step: 0.12, overshoot: 0, halo: 0 });
    }
    g.position.set(x, y);
    g.scale.x = dir;
    layer.addChild(g);
    return g;
  }

  function number(x: number, y: number, amount: number, o: NumberOpts = {}) {
    const g = new Graphics();
    const size = o.bonus ? 0.8 : o.penalty ? 0.42 : 0.58;
    const txt = (o.plus ? '+' : '') + String(Math.round(amount)) + (o.bonus ? '!' : '');
    const color = o.color ?? (o.penalty ? look.pens.pencil : look.pens.red);
    penText(g, txt, x - textWidth(txt, size) / 2, y, size,
      { color, alpha: o.penalty ? 0.7 : 0.9, width: size * (o.bonus ? 0.13 : 0.11) });
    layer.addChild(g);
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        const p = this.t / 0.75;
        g.y = -p * 0.7;
        g.alpha = Math.max(0, 1 - p * p);
        if (p < 1) return false;
        g.destroy();
        return true;
      },
    });
  }

  function spark(x: number, y: number) {
    const g = new Graphics();
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.18 + Math.random() * 0.16;
      penStroke(g, [[x, y], [x + Math.cos(a) * r, y + Math.sin(a) * r]],
        { color: look.pens.blue, width: 0.05, alpha: 0.8, jitter: 0.02, step: 0.2, overshoot: 0, halo: 0.1 });
    }
    fade(g, 0.22);
  }

  function bless(x: number, y: number) {
    const g = new Graphics();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.3, r0 = 0.25, r1 = 0.5 + Math.random() * 0.2;
      penStroke(g, [[x + Math.cos(a) * r0, y + Math.sin(a) * r0], [x + Math.cos(a) * r1, y + Math.sin(a) * r1]],
        { color: look.pens.green, width: 0.045, alpha: 0.8, jitter: 0.015, step: 0.2, overshoot: 0, halo: 0.12 });
    }
    fade(g, 0.4);
  }

  function strikeOut(x: number, y: number, w: number, h: number, color: string | number = look.pens.red) {
    const g = new Graphics();
    scribble(g, x - w / 2, y - h, w, h, { color, alpha: 0.85, halo: 0.12, passes: 2 });
    layer.addChild(g);
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        g.alpha = this.t < 0.35 ? 0.9 : Math.max(0, 0.9 - (this.t - 0.35) / 0.45);
        if (this.t < 0.8) return false;
        g.destroy();
        return true;
      },
    });
  }

  /**
   * Лазер лінії дому. Три шари, щоб читалось як спалах, а не як риска:
   * широка маркерна смуга на весь ряд, ламана-блискавка червоним поверх неї,
   * тонке оранжеве ядро, і зигзаги-іскри, що розлітаються від променя. Промінь
   * росте з лівого краю за 0.12 с (видно, ЗВІДКИ він б'є), тримається й тане.
   */
  function laser(x0: number, x1: number, y: number) {
    const band = new Graphics();
    band.rect(x0, y - 0.45, x1 - x0, 0.9).fill({ color: look.pens.marker, alpha: 0.7 });
    layer.addChild(band);

    const beam = new Graphics();
    const red = look.pens.red, orange = look.pens.orange ?? look.pens.red;
    // Блискавка: ламана з дрібними зламами, а не пряма — так око читає «розряд».
    const bolt: Vec2[] = [[x0, y]];
    for (let x = x0 + 0.5; x < x1; x += 0.5 + Math.random() * 0.4) {
      bolt.push([x, y + (Math.random() - 0.5) * 0.28]);
    }
    bolt.push([x1, y]);
    penStroke(beam, bolt, { color: red, width: 0.2, alpha: 0.95, jitter: 0.02, step: 0.4, overshoot: 0.2, halo: 0.4 });
    penStroke(beam, [[x0, y], [x1, y]], { color: orange, width: 0.07, alpha: 0.95, jitter: 0.015, step: 0.5, overshoot: 0.2, halo: 0 });
    // Іскри від променя: короткі зигзаги вгору й униз уздовж ряду.
    for (let x = x0 + 1; x < x1; x += 1.2 + Math.random()) {
      const s = Math.random() < 0.5 ? -1 : 1;
      penStroke(beam, [[x, y + s * 0.2], [x + 0.15, y + s * 0.45], [x - 0.05, y + s * 0.55], [x + 0.1, y + s * 0.8]],
        { color: orange, width: 0.05, alpha: 0.9, jitter: 0.01, step: 0.2, overshoot: 0, halo: 0.15 });
    }
    // Спалах біля випромінювача.
    penCircle(beam, x0, y, 0.45, { color: red, width: 0.06, alpha: 0.9, halo: 0.3 });
    layer.addChild(beam);

    // Ріст ліворуч → праворуч через маску масштабом по x навколо x0.
    beam.pivot.set(x0, 0);
    beam.position.set(x0, 0);
    band.pivot.set(x0, 0);
    band.position.set(x0, 0);
    const grow = 0.12, hold = 0.25, fadeT = 0.55;
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        const p = Math.min(1, this.t / grow);
        beam.scale.x = p;
        band.scale.x = p;
        const a = this.t < grow + hold ? 1 : Math.max(0, 1 - (this.t - grow - hold) / fadeT);
        beam.alpha = a;
        band.alpha = a * 0.7;
        if (this.t < grow + hold + fadeT) return false;
        beam.destroy();
        band.destroy();
        return true;
      },
    });
  }

  function inkDrop(x: number, y: number, amount: number, to: () => Vec2, then: () => void) {
    const g = new Graphics();
    // Крапля: кулька з носиком угорі, заштрихована — зелена, як усе чорнило.
    const r = 0.16 + Math.min(0.14, amount * 0.008);
    const pen = { color: look.pens.green, width: 0.05, alpha: 0.9, jitter: 0.012, step: 0.12, overshoot: 0, halo: 0.15 };
    penCircle(g, 0, 0, r, pen);
    penStroke(g, [[-r * 0.55, -r * 0.8], [0, -r * 1.7], [r * 0.55, -r * 0.8]], { ...pen, width: 0.045 });
    hatch(g, -r, -r, r * 2, r * 2, { ...pen, gap: r * 0.5, jitterGap: 0.2, width: 0.035, alpha: 0.6 });
    g.position.set(x, y);
    layer.addChild(g);

    // Дві фази: підскок (крапля вискочила з ворога) і політ у ручку.
    const pop = 0.55, flight = 0.6;
    const vx = (Math.random() - 0.5) * 0.8;
    let from: Vec2 | null = null;
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        if (this.t < pop) {
          const p = this.t / pop;
          g.position.set(x + vx * p, y - Math.sin(p * Math.PI) * 0.9);
          return false;
        }
        if (!from) from = [g.x, g.y];
        const p = Math.min(1, (this.t - pop) / flight);
        const e = p * p; // easeIn: зривається повільно, влітає швидко
        const [tx, ty] = to();
        g.position.set(from[0] + (tx - from[0]) * e, from[1] + (ty - from[1]) * e);
        g.scale.set(1 - 0.5 * e);
        if (p < 1) return false;
        g.destroy();
        then();
        return true;
      },
    });
  }

  function step(dt: number) {
    for (let i = fx.length - 1; i >= 0; i--) if (fx[i].step(dt)) fx.splice(i, 1);
  }

  return { bolt, number, spark, bless, strikeOut, laser, inkDrop, step };
}
