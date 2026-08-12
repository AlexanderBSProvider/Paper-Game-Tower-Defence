// Бій: башти цілять, стріляють, влучають.
//
// Ціль обирається не «найближча до башти», а найближча до бази — по тому ж
// полю відстаней, яким ходять вороги. У лабіринті це єдиний осмислений вибір:
// коридор часто проходить повз башту двічі, і бити треба того, хто вже майже
// прорвався, а не того, хто щойно зайшов у радіус.
//
// Снаряд малюється один раз у свій Graphics і далі лише рухається: перо з
// дрожем щокадру — це нова геометрія на кожен кадр, чого рушій не подарує.

import { Container, Graphics } from '../lib/pixi.min.mjs';
import { penStroke, penCircle, penText, textWidth, hatch, scribble } from './view/ink.js';
import { chainTargets, oppositeTarget } from './model/aim.js';
import type { Gun } from './model/build.js';
import type { Enemy, Fx, Look, Rig } from './types.js';

/** Башта на полі. def приходить уже порахованим зі складу. */
export interface Tower {
  def: Gun;
  rig: Rig;
  x: number;
  y: number;
  /** відкат до наступного пострілу */
  cd: number;
}

interface ShotBase {
  g: Graphics;
  dmg: number;
  splash: number;
  speed: number;
  ric: number;
  x: number;
  y: number;
  target: Enemy;
  tower: Tower;
}

/** Навісний: летить по хорді плюс синусоїдна гірка, тому веде власну параметризацію. */
interface ArcShot extends ShotBase {
  arc: true;
  x0: number; y0: number;
  tx: number; ty: number;
  len: number;
  /** 0..1 вздовж хорди */
  p: number;
}

interface BoltShot extends ShotBase {
  arc: false;
}

export type Shot = ArcShot | BoltShot;

export interface CombatOpts {
  layer: Container;
  look: Look;
  enemies: Enemy[];
  /** @returns true, якщо ворог помер */
  damage(e: Enemy, amount: number): boolean;
  /** наскільки ворог просунувся до бази */
  distOf(e: Enemy): number;
}

export interface Combat {
  add(id: number, def: Gun | null, rig: Rig, x: number, y: number): void;
  retune(id: number, def: Gun | null, rig?: Rig | null): void;
  remove(id: number): boolean;
  update(dt: number, active?: boolean): void;
  strikeOut(x: number, y: number, w: number, h: number): void;
  towers: Map<number, Tower>;
  shots: Shot[];
}

/** Снаряд магії — коротка риска з іскрою на вістрі. */
function drawBolt(g: Graphics, look: Look) {
  penStroke(g, [[-0.34, 0], [0.12, 0]],
    { color: look.pens.blue, width: 0.08, alpha: 0.9, jitter: 0.015, step: 0.2, overshoot: 0.04, halo: 0.2 });
  for (const a of [-0.8, 0.8]) {
    penStroke(g, [[0.12, 0], [0.12 + Math.cos(a) * 0.12, Math.sin(a) * 0.12]],
      { color: look.pens.blue, width: 0.05, alpha: 0.7, jitter: 0.01, step: 0.12, overshoot: 0, halo: 0 });
  }
}

/** Ядро — кулька, заштрихована навхрест. */
function drawBall(g: Graphics, look: Look) {
  const pen = { color: look.pens.blue, width: 0.055, alpha: 0.85, jitter: 0.012, step: 0.12, overshoot: 0, halo: 0.15 };
  penCircle(g, 0, 0, 0.17, pen);
  hatch(g, -0.13, -0.13, 0.26, 0.26, { ...pen, gap: 0.075, jitterGap: 0.2, width: 0.04, alpha: 0.6 });
}

export function createCombat({ layer, look, enemies, damage, distOf }: CombatOpts): Combat {
  const towers = new Map<number, Tower>();
  const shots: Shot[] = [];
  const fx: Fx[] = [];

  /** def — стати гармати: damage, rate, range, splash, projectile, speed.
   *  Приходять уже порахованими: у зібраної башти вони залежать від складу, а не
   *  від типу, тому тут ми більше нічого не шукаємо в таблицях. */
  const add = (id: number, def: Gun | null, rig: Rig, x: number, y: number) => {
    if (def) towers.set(id, { def, rig, x, y, cd: 0 });
  };

  /** Гравець домалював деталь: стати інші, риг новий, а відкат лишається —
   *  інакше апгрейд посеред хвилі дарував би позачерговий постріл. */
  const retune = (id: number, def: Gun | null, rig?: Rig | null) => {
    const t = towers.get(id);
    if (!t || !def) return;
    t.def = def;
    if (rig) t.rig = rig;
  };

  const remove = (id: number) => towers.delete(id);

  /** Найближчий до бази ворог у радіусі. */
  function pick(t: Tower): Enemy | null {
    let best: Enemy | null = null, bestD = Infinity;
    for (const e of enemies) {
      const d = distOf(e);
      if (d >= bestD) continue;
      if (Math.hypot(e.x - t.x, e.y - t.y) > t.def.range) continue;
      best = e; bestD = d;
    }
    return best;
  }

  // --- сліди влучання ------------------------------------------------------
  function fade(g: Graphics, dur: number) {
    layer.addChild(g);
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        g.alpha = Math.max(0, 1 - this.t / dur);
        if (this.t < dur) return false;
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

  /** Бризки чорнила: промені й кілька крапель по колу. */
  function splash(x: number, y: number, r: number) {
    const g = new Graphics();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
      const len = r * (0.5 + Math.random() * 0.5);
      penStroke(g, [[x + Math.cos(a) * r * 0.15, y + Math.sin(a) * r * 0.15],
        [x + Math.cos(a) * len, y + Math.sin(a) * len]],
        { color: look.pens.blue, width: 0.055, alpha: 0.75, jitter: 0.03, step: 0.22, overshoot: 0.03, halo: 0.12 });
      if (i % 3 === 0) penCircle(g, x + Math.cos(a) * len * 1.15, y + Math.sin(a) * len * 1.15, 0.05,
        { color: look.pens.blue, width: 0.04, alpha: 0.6, halo: 0 });
    }
    fade(g, 0.42);
  }

  /** Цифра шкоди спливає вгору й тане — так само, як її дописували б збоку. */
  function number(x: number, y: number, amount: number) {
    const g = new Graphics();
    const size = 0.58;
    penText(g, String(Math.round(amount)), x - textWidth(amount, size) / 2, y, size,
      { color: look.pens.red, alpha: 0.9, width: size * 0.11 });
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

  /** Смерть: ворога закреслюють кількома зигзагами, і закреслення тане. */
  function strikeOut(x: number, y: number, w: number, h: number) {
    const g = new Graphics();
    scribble(g, x - w / 2, y - h, w, h, { color: look.pens.red, alpha: 0.85, halo: 0.12, passes: 2 });
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

  /** Молнія рикошету: затухаюча лінія від одної цілі до наступної. */
  function zap(x1: number, y1: number, x2: number, y2: number) {
    const g = new Graphics();
    penStroke(g, [[x1, y1], [x2, y2]],
      { color: look.pens.blue, width: 0.12, alpha: 0.8, jitter: 0.05, step: 0.25, overshoot: 0.05, halo: 0.25 });
    layer.addChild(g);
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        g.alpha = Math.max(0, 0.8 - this.t / 0.3);
        if (this.t < 0.3) return false;
        g.destroy();
        return true;
      },
    });
  }

  // --- постріл -------------------------------------------------------------
  function hit(s: Shot) {
    const [x, y] = [s.x, s.y];
    if (s.splash) {
      splash(x, y, s.splash);
      // Ядро б'є по площі, тож ціль могла й зрушити — це і є плата за навісний постріл.
      for (const e of [...enemies]) {
        if (Math.hypot(e.x - x, e.y - y + 0.5) > s.splash) continue;
        number(e.x, e.y - 2, s.dmg);
        if (damage(e, s.dmg)) strikeOut(e.x, e.y, 1.2, 1.5);
      }
    } else {
      spark(x, y);
      if (enemies.includes(s.target)) {
        number(s.target.x, s.target.y - 2, s.dmg);
        if (damage(s.target, s.dmg)) strikeOut(s.target.x, s.target.y, 1.2, 1.5);
        // Рикошет: ланцюг прострілу крізь натовп
        if (s.ric > 0) {
          const chain = chainTargets(s.target.x, s.target.y, enemies, 2.5, s.ric, [s.target]);
          let prev: Enemy = s.target, dmg = s.dmg * 0.6;
          for (const e of chain) {
            zap(prev.x, prev.y, e.x, e.y);
            number(e.x, e.y - 2, dmg);
            if (damage(e, dmg)) strikeOut(e.x, e.y, 1.2, 1.5);
            prev = e; dmg *= 0.6;
          }
        }
      }
    }
    s.g.destroy();
  }

  function shoot(t: Tower, target: Enemy) {
    const d = t.def;
    const ang = Math.atan2(target.y - 0.5 - (t.y - 0.5), target.x - t.x);
    const g = new Graphics();
    const base: ShotBase = {
      g, dmg: d.damage, splash: d.splash ?? 0, speed: d.speed, ric: d.ricochet ?? 0,
      x: t.x + Math.cos(ang) * 0.8, y: t.y - 0.5 + Math.sin(ang) * 0.8,
      target, tower: t,
    };

    // Дві форми снаряда — два різні набори полів. Об'єднання замість «усе
    // опційне» дає advance() гарантію, що в навісного x0/tx/len справді є.
    let s: Shot;
    if (d.projectile === 'ball') {
      drawBall(g, look);
      const x0 = base.x, y0 = base.y;
      const tx = target.x, ty = target.y - 0.4;
      s = { ...base, arc: true, x0, y0, tx, ty, len: Math.hypot(tx - x0, ty - y0), p: 0 };
    } else {
      drawBolt(g, look);
      g.rotation = ang;
      s = { ...base, arc: false };
    }
    g.position.set(s.x, s.y);
    layer.addChild(g);
    shots.push(s);

    t.rig.fire('attack');
    t.rig.aim = ang;
  }

  function advance(s: Shot, dt: number): boolean {
    if (s.arc) {
      // Навісна траєкторія: рівномірно по хорді плюс синусоїдна гірка.
      s.p += (s.speed * dt) / Math.max(0.001, s.len);
      if (s.p >= 1) { s.x = s.tx; s.y = s.ty; return true; }
      s.x = s.x0 + (s.tx - s.x0) * s.p;
      s.y = s.y0 + (s.ty - s.y0) * s.p;
      s.g.position.set(s.x, s.y - Math.sin(Math.PI * s.p) * Math.min(1.6, s.len * 0.28));
      s.g.rotation += dt * 6;
      return false;
    }
    // Магія веде ціль до останнього: у лабіринті ворог часто зникає за рогом.
    const tgt = enemies.includes(s.target) ? [s.target.x, s.target.y - 0.5] : [s.x + 0.001, s.y];
    const dx = tgt[0] - s.x, dy = tgt[1] - s.y;
    const dist = Math.hypot(dx, dy);
    const step = s.speed * dt;
    if (dist <= step || !enemies.includes(s.target)) { s.x = tgt[0]; s.y = tgt[1]; return true; }
    s.x += (dx / dist) * step;
    s.y += (dy / dist) * step;
    s.g.position.set(s.x, s.y);
    s.g.rotation = Math.atan2(dy, dx);
    return false;
  }

  /** @param active після кінця партії стрільба спиняється, а сліди
   *  дотанцьовують: інакше останнє закреслення так і застигне на аркуші. */
  function update(dt: number, active = true) {
    if (!active) {
      for (let i = fx.length - 1; i >= 0; i--) if (fx[i].step(dt)) fx.splice(i, 1);
      return;
    }
    // Сповільнення від страху: кожен кадр скидається, потім застосовуються активні ефекти
    for (const e of enemies) e.slow = 0;
    for (const t of towers.values()) {
      // Страх: усім ворогам у радіусі зменшити швидкість
      if (t.def.fear) {
        for (const e of enemies) {
          const d = Math.hypot(e.x - t.x, e.y - t.y);
          if (d <= t.def.range) e.slow = Math.max(e.slow ?? 0, t.def.fear);
        }
      }
      t.cd -= dt;
      const target = pick(t);
      if (!target) { t.rig.aim = null; continue; }
      if (t.cd > 0) continue;
      t.cd = 1 / t.def.rate;
      shoot(t, target);
      // Другий ствол: стріляє в іншу ціль
      if (t.def.twoWay) {
        const other = oppositeTarget(t.x, t.y, target, enemies, t.def.range, (e) => distOf(e));
        if (other) shoot(t, other);
      }
    }

    for (let i = shots.length - 1; i >= 0; i--) {
      if (advance(shots[i], dt)) { hit(shots[i]); shots.splice(i, 1); }
    }
    for (let i = fx.length - 1; i >= 0; i--) if (fx[i].step(dt)) fx.splice(i, 1);
  }

  return { add, retune, remove, update, strikeOut, towers, shots };
}
