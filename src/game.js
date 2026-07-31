// Ігровий шар: сітка, маршрут, вороги, будівництво.
//
// Усе живе в клітинках, тому товщини ліній тут дрібні числа (0.06 = 6% клітинки),
// а не пікселі: світ масштабується разом із екраном, лінія лишається лінією.

import { Container, Graphics } from '../lib/pixi.min.mjs';
import { penStroke, penCircle, penRect, penText, textWidth, hatch, scribble } from './ink.js';
import { buildPath, posAt } from './pathmath.js';
import { createGrid, WALL, TOWER, DECOR, BASE } from './grid.js';
import { computeFlow, routeFrom, stepFrom, reaches, wouldSeal, distAt } from './flow.js';
import { buildRig } from './rig.js';
import { createWallet } from './economy.js';
import { pickTarget, leadPoint, splashHits } from './combat.js';

const PEN = { jitter: 0.035, step: 0.28, overshoot: 0.07 };

export const KINDS = {
  wall: { w: 1, h: 1, mark: WALL, rig: null, drawTime: 0.2 },
  magic_tower: { w: 2, h: 2, mark: TOWER, rig: 'magic_tower', drawTime: 0.4 },
  cannon: { w: 2, h: 2, mark: TOWER, rig: 'cannon', drawTime: 0.4 },
};

/** Маршрут пунктиром зі стрілками — як план, накреслений у зошиті. */
function drawRoute(g, pts, look) {
  g.clear();
  if (pts.length < 2) return;
  const path = buildPath(pts);

  // Крок ресемплу дорівнює довжині риски: круглі торці сусідніх точок інакше
  // зливаються в намисто з клякс, а не в пунктир.
  const dash = 0.44, gap = 0.4;
  for (let d = 0; d < path.length - 0.1; d += dash + gap) {
    const a = posAt(path, d);
    const b = posAt(path, Math.min(d + dash, path.length));
    penStroke(g, [[a.x, a.y], [b.x, b.y]],
      { color: look.pens.pencil, width: 0.038, alpha: 0.42, halo: 0, jitter: 0.02, step: dash, overshoot: 0 });
  }

  for (let d = 2.5; d < path.length - 0.5; d += 6) {
    const p = posAt(path, d);
    for (const k of [2.6, -2.6]) {
      penStroke(g, [[p.x, p.y], [p.x + Math.cos(p.angle + k) * 0.3, p.y + Math.sin(p.angle + k) * 0.3]],
        { color: look.pens.pencil, width: 0.042, alpha: 0.5, halo: 0, jitter: 0.02, step: 0.3, overshoot: 0 });
    }
  }
}

/** Стіна — накреслений від руки квадрат із однією діагоналлю.
 *  Штрихування тут не працює: на 25 px клітинки сусідні стіни зливаються в
 *  суцільний брусок, і лабіринт перестає читатись по клітинках. */
function drawWall(g, cx, cy, look) {
  penRect(g, cx + 0.15, cy + 0.15, 0.7, 0.7,
    { ...PEN, color: look.pens.blue, width: 0.038, alpha: 0.72, overshoot: 0.06, halo: 0 });
  penStroke(g, [[cx + 0.26, cy + 0.74], [cx + 0.74, cy + 0.26]],
    { ...PEN, color: look.pens.blue, width: 0.03, alpha: 0.35, halo: 0 });
}

/** Згусток магічної башти: голова і хвилястий слід, що коливається до хвоста.
 *  Малюється щокадру наново — інакше слід не «живий», а просто повернутий. */
function drawBolt(g, x, y, angle, t, look) {
  g.clear();
  const n = 7, len = 0.8;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const back = -u * len;
    const wave = Math.sin(t * 19 + u * 7.5) * 0.1 * u; // біля голови слід рівний
    pts.push([
      x + Math.cos(angle) * back - Math.sin(angle) * wave,
      y + Math.sin(angle) * back + Math.cos(angle) * wave,
    ]);
  }
  penStroke(g, pts, { color: look.pens.blue, width: 0.07, alpha: 0.72, halo: 0.2, jitter: 0.015, step: 0.13, overshoot: 0 });
  penCircle(g, x, y, 0.13, { color: look.pens.blue, width: 0.075, alpha: 0.92, jitter: 0.025, step: 0.11 });
}

/** Ядро гармати: летить по дузі, тому висота — це зсув угору, а не рух угору.
 *  Риска на землі лишає тінь, інакше дуга читається як «ядро полетіло вбік». */
function drawBall(g, x, y, hop, look) {
  g.clear();
  penStroke(g, [[x - 0.13, y], [x + 0.13, y]],
    { color: look.pens.pencil, width: 0.05, alpha: 0.3, halo: 0, jitter: 0.01, step: 0.26, overshoot: 0 });
  penCircle(g, x, y - hop, 0.155, { color: look.pens.blue, width: 0.085, alpha: 0.92, jitter: 0.025, step: 0.12 });
}

export function createGame({ world, look, level, balance, rigDefs, parts, textures, layout }) {
  const grid = createGrid(look.core.cols, look.core.rows);
  const wallet = createWallet({
    start: balance.economy.startInk,
    costs: balance.build,
    refund: balance.economy.refund,
  });

  const routeG = new Graphics();
  const wallLayer = new Container();
  const fxLayer = new Container();   // сліди на землі — під персонажами
  // Один шар на всіх, хто стоїть на землі: сортуємо за y, тому ближнє
  // перекриває дальнє само собою.
  const units = new Container();
  // Чорнило поверх усього: снаряди, бризки, цифри шкоди й закреслення. Саме
  // «поверх» тут суттєве — закреслити ворога можна лише зверху, не з-під нього.
  const overLayer = new Container();
  world.addChild(routeG, wallLayer, fxLayer, units, overLayer);

  const rigs = [];
  const fx = [];

  function place(rigId, x, y) {
    const rig = buildRig(rigDefs[rigId], textures, parts, look);
    rig.view.position.set(x, y);
    rig.setScale(layout.spriteScale);
    units.addChild(rig.view);
    rigs.push(rig);
    return rig;
  }
  function unplace(rig) {
    rig.view.destroy({ children: true });
    rigs.splice(rigs.indexOf(rig), 1);
  }

  /** Витирання маскою: об'єкт не з'являється, а домальовується зліва направо. */
  function wipeIn(target, parent, x, y, w, h, dur) {
    const mask = new Graphics();
    parent.addChild(mask);
    target.mask = mask;
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        const p = Math.min(1, this.t / dur);
        mask.clear().rect(x - 0.1, y - 0.1, (w + 0.2) * p, h + 0.2).fill(0xffffff);
        if (p < 1) return false;
        target.mask = null;
        mask.destroy();
        return true;
      },
    });
  }

  /** Слід від ластика: бліда пляма, яка тане. */
  function smudge(cx, cy, w, h) {
    const g = new Graphics();
    hatch(g, cx + 0.1, cy + 0.1, w - 0.2, h - 0.2,
      { color: look.pens.pencil, width: 0.07, alpha: 0.22, gap: 0.26, jitterGap: 0.4, halo: 0, jitter: 0.06, step: 0.3 });
    fxLayer.addChild(g);
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        const p = this.t / 1.3;
        g.alpha = Math.max(0, 1 - p);
        if (p < 1) return false;
        g.destroy();
        return true;
      },
    });
  }

  /** Загальний шматок для ефектів, що просто тануть: тримає dur, потім гасне. */
  function fade(g, hold, dur) {
    overLayer.addChild(g);
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        if (this.t < hold) return false;
        const p = (this.t - hold) / dur;
        g.alpha = Math.max(0, 1 - p);
        if (p < 1) return false;
        g.destroy();
        return true;
      },
    });
  }

  /** Бризки чорнила від влучання: короткі штрихи врозтіч. */
  function splat(x, y, r, color) {
    const g = new Graphics();
    const n = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const len = r * (0.35 + Math.random() * 0.65);
      penStroke(g, [[x, y], [x + Math.cos(a) * len, y + Math.sin(a) * len]],
        { color, width: 0.055, alpha: 0.7, halo: 0.15, jitter: 0.03, step: 0.22, overshoot: 0.04 });
    }
    fade(g, 0.05, 0.4);
  }

  /** Цифра шкоди — писана поспіхом, тому з нахилом; спливає вгору й тане. */
  function damageNumber(x, y, amount) {
    const str = String(Math.round(amount));
    const size = 0.5;
    const g = new Graphics();
    penText(g, str, -textWidth(str, size) / 2, -size, size,
      { color: look.pens.red, width: 0.05, alpha: 0.95, halo: 0.12 });
    g.position.set(x, y);
    g.rotation = (Math.random() - 0.5) * 0.3;
    overLayer.addChild(g);

    const y0 = y;
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        const p = this.t / 0.75;
        g.y = y0 - p * 0.85;
        g.alpha = Math.max(0, 1 - p * p); // тримається, поки читається, і швидко гасне
        if (p < 1) return false;
        g.destroy();
        return true;
      },
    });
  }

  /**
   * Смерть ворога: його не прибирають, а закреслюють.
   *
   * Риг лишається під зигзагами весь час, поки їх видно, — інакше виходить, що
   * закреслили порожнє місце. Коли закреслення стерлось, під ним ще кілька
   * секунд тримається бліда пляма-«стерка».
   */
  function strikeOut(e) {
    const [hw, hh] = e.rig.hitbox;
    // Риг стоїть ногами в (e.x, e.y), тому коробка йде вгору від землі, а не
    // симетрично навколо точки — інакше зигзаги з'їжджають ворогові під ноги.
    const x0 = e.x - hw / 2, y0 = e.y - hh;
    const g = new Graphics();
    scribble(g, x0, y0, hw, hh,
      { color: look.pens.red, width: 0.085, alpha: 0.8, jitter: 0.05, step: 0.2, overshoot: 0.1, halo: 0.1, passes: 2 });
    overLayer.addChild(g);

    const hold = 0.22, dur = 0.45;
    fx.push({
      t: 0,
      rig: e.rig,
      step(dt) {
        this.t += dt;
        if (this.t < hold) return false;
        const p = (this.t - hold) / dur;
        g.alpha = Math.max(0, 1 - p);
        if (this.rig) { unplace(this.rig); this.rig = null; } // риг зникає під чорнилом
        if (p < 1) return false;
        g.destroy();
        smudge(x0, y0, hw, hh);
        return true;
      },
    });
  }

  // --- рівень ---------------------------------------------------------------
  const [bx, by] = level.base;
  const [bw, bh] = level.baseSize;
  grid.fill(bx, by, bw, bh, BASE);
  const goals = grid.rect(bx, by, bw, bh);
  const keep = place('keep', bx + bw / 2, by + bh / 2);

  for (const [id, cx, cy] of level.decor) {
    grid.fill(cx, cy, 1, 1, DECOR);
    place(id, cx + 0.5, cy + 0.5);
  }

  const entry = level.entry;
  const built = new Map(); // id → { kind, cx, cy, rig, gfx }
  let nextId = 1;

  let flow = computeFlow(grid, goals);

  const enemies = [];
  const state = { lives: level.lives, maxLives: level.lives, spawned: 0, killed: 0, leaked: 0, sealed: false };
  let spawnTimer = 0;

  const cellOf = (e) => [Math.floor(e.x), Math.floor(e.y)];
  const enemyCells = () => enemies.filter((e) => e.y >= 0).map(cellOf);

  function refresh() {
    flow = computeFlow(grid, goals);
    state.sealed = !reaches(flow, entry[0], entry[1]);
    drawRoute(routeG, routeFrom(flow, entry[0], entry[1]), look);
    // Ціль, що стала стіною, більше не ціль — переобираємо наступного кадру.
    for (const e of enemies) {
      if (e.tx != null && grid.blocked(Math.floor(e.tx), Math.floor(e.ty))) e.tx = null;
    }
  }

  // --- будівництво ----------------------------------------------------------
  /** @returns {string|null} причина відмови або null, якщо можна */
  function whyNot(kind, cx, cy) {
    const k = KINDS[kind];
    if (!k) return 'невідомий тип';
    if (!wallet.can(kind)) return 'мало чорнила';
    if (!grid.isFree(cx, cy, k.w, k.h)) return 'зайнято';
    const cells = grid.rect(cx, cy, k.w, k.h);
    const occupied = new Set(enemyCells().map(([x, y]) => `${x},${y}`));
    if (cells.some(([x, y]) => occupied.has(`${x},${y}`))) return 'там ворог';
    if (wouldSeal(grid, goals, cells, [entry, ...enemyCells()])) return 'замкне прохід';
    return null;
  }

  function build(kind, cx, cy, instant = false) {
    const reason = whyNot(kind, cx, cy);
    if (reason) return { ok: false, reason };

    const k = KINDS[kind];
    wallet.spend(kind);
    const id = nextId++;
    grid.fill(cx, cy, k.w, k.h, k.mark, id);

    let rig = null, gfx = null;
    if (k.rig) {
      rig = place(k.rig, cx + k.w / 2, cy + k.h / 2);
      if (!instant) wipeIn(rig.view, units, cx - k.w / 2, cy - k.h - 0.2, k.w * 2, k.h * 2, k.drawTime);
    } else {
      gfx = new Graphics();
      drawWall(gfx, cx, cy, look);
      wallLayer.addChild(gfx);
      if (!instant) wipeIn(gfx, wallLayer, cx, cy, k.w, k.h, k.drawTime);
    }

    const gun = balance.towers[kind] ?? null;
    // Стартовий відкат врозкид: інакше сусідні однакові башти б'ють залпом
    // в один такт, і потік гине ривками замість рівного вигризання.
    built.set(id, { kind, cx, cy, rig, gfx, gun, cool: gun ? Math.random() / gun.rate : 0 });
    refresh();
    return { ok: true, id };
  }

  function erase(cx, cy) {
    const id = grid.ownerAt(cx, cy);
    const item = built.get(id);
    if (!item) return { ok: false, reason: 'нічого стирати' };

    const k = KINDS[item.kind];
    grid.clearOwner(id);
    built.delete(id);
    if (item.rig) unplace(item.rig);
    if (item.gfx) item.gfx.destroy();
    smudge(item.cx, item.cy, k.w, k.h);
    const back = wallet.refund(item.kind);
    refresh();
    return { ok: true, kind: item.kind, refund: back };
  }

  // --- вороги ---------------------------------------------------------------
  function spawnEnemy(typeId = 'earling') {
    const def = balance.enemies[typeId];
    const rig = place(def.rig, entry[0] + 0.5, -1.6);
    const e = { rig, def, hp: def.hp, x: entry[0] + 0.5, y: -1.6, tx: null, ty: null };
    enemies.push(e);
    state.spawned++;
    return e;
  }

  function despawn(e) {
    unplace(e.rig);
    enemies.splice(enemies.indexOf(e), 1);
  }

  /** Шкода ворогу. Вбитий доливає чорнила в ручку — це єдиний дохід у грі. */
  function damage(e, amount) {
    if (e.hp <= 0) return false; // вже закреслений: сплеш не має добивати двічі

    e.hp -= amount;
    const [ax, ay] = e.rig.anchor('hit');
    damageNumber(e.x + ax, e.y + ay, amount);

    if (e.hp > 0) { e.rig.fire('hit'); return false; }

    wallet.earn(e.def.bounty);
    state.killed++;
    enemies.splice(enemies.indexOf(e), 1); // більше не ціль і більше не рухається
    e.rig.dead = true;
    strikeOut(e); // риг прибере саме закреслення, коли доб'є свій хід
    return true;
  }

  // --- бій ------------------------------------------------------------------
  const shots = [];

  /** Наскільки ворог близький до бази — та сама BFS-відстань, якою він і йде. */
  function progressOf(e) {
    return distAt(flow, ...cellOf(e));
  }

  /** Куди він рухається зараз: потрібне гарматі для упередження. */
  function velocityOf(e) {
    if (e.y < 0.5) return [0, e.def.speed]; // ще спускається коридором до поля
    if (e.tx == null) return [0, 0];
    const dx = e.tx - e.x, dy = e.ty - e.y;
    const d = Math.hypot(dx, dy);
    return d < 1e-6 ? [0, 0] : [(dx / d) * e.def.speed, (dy / d) * e.def.speed];
  }

  /** Точка, у яку цілиться згусток і з якої вискакує цифра шкоди. */
  function aimPoint(e) {
    const [ax, ay] = e.rig.anchor('hit');
    return [e.x + ax, e.y + ay];
  }

  function fireAt(item, gun, target) {
    item.rig.fire('attack');
    const [mx, my] = item.rig.anchor('muzzle');
    const sx = item.rig.view.x + mx, sy = item.rig.view.y + my;

    const g = new Graphics();
    overLayer.addChild(g);

    if (gun.projectile === 'ball') {
      // Ядро летить по дузі й нікуди не звертає, тому цілимось на випередження:
      // без цього сплеш лягає ворогові за спину.
      const [vx, vy] = velocityOf(target);
      const lead = leadPoint(sx, sy, target.x, target.y, vx, vy, gun.speed);
      shots.push({ kind: 'ball', g, gun, sx, sy, ex: lead.x, ey: lead.y, t: 0, dur: Math.max(0.12, lead.t) });
    } else {
      const [tx, ty] = aimPoint(target);
      shots.push({ kind: 'bolt', g, gun, x: sx, y: sy, aimX: tx, aimY: ty, target, t: 0 });
    }
  }

  function updateTowers(dt) {
    for (const item of built.values()) {
      if (!item.gun) continue;
      item.cool = Math.max(0, item.cool - dt);
      if (item.cool > 0) continue;

      const k = KINDS[item.kind];
      const target = pickTarget(item.cx + k.w / 2, item.cy + k.h / 2, item.gun.range, enemies, progressOf);
      if (!target) continue; // відкат не витрачаємо: башта вистрелить, щойно хтось зайде

      item.cool = 1 / item.gun.rate;
      fireAt(item, item.gun, target);
    }
  }

  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.t += dt;

      if (s.kind === 'bolt') {
        // Самонавідний, але ціль могли добити раніше — тоді згусток дотягує до
        // останньої відомої точки й гасне, а не перекидається на іншого.
        const alive = s.target.hp > 0;
        if (alive) [s.aimX, s.aimY] = aimPoint(s.target);

        const dx = s.aimX - s.x, dy = s.aimY - s.y;
        const dist = Math.hypot(dx, dy);
        const step = s.gun.speed * dt;

        if (dist <= step) {
          if (alive) {
            splat(s.aimX, s.aimY, 0.32, look.pens.blue);
            damage(s.target, s.gun.damage);
          }
          s.g.destroy();
          shots.splice(i, 1);
          continue;
        }
        s.x += (dx / dist) * step;
        s.y += (dy / dist) * step;
        drawBolt(s.g, s.x, s.y, Math.atan2(dy, dx), s.t, look);
        continue;
      }

      const p = Math.min(1, s.t / s.dur);
      const x = s.sx + (s.ex - s.sx) * p;
      const y = s.sy + (s.ey - s.sy) * p;
      drawBall(s.g, x, y, Math.sin(p * Math.PI) * (s.gun.arc ?? 1), look);
      if (p < 1) continue;

      const r = s.gun.splash ?? 0;
      splat(s.ex, s.ey, Math.max(r, 0.4), look.pens.blue);
      for (const e of splashHits(s.ex, s.ey, r, enemies)) damage(e, s.gun.damage);
      s.g.destroy();
      shots.splice(i, 1);
    }
  }

  function advance(e, step) {
    // Коридор над полем: спершу просто спускаємось до першого ряду.
    if (e.y < 0.5) {
      e.y = Math.min(0.5, e.y + step);
      return;
    }
    const [cx, cy] = cellOf(e);
    if (grid.at(cx, cy) === BASE) {
      state.lives = Math.max(0, state.lives - 1);
      state.leaked++;
      keep.fire('hit');
      despawn(e);
      return;
    }
    if (e.tx == null) {
      const next = stepFrom(flow, cx, cy);
      if (!next) return; // шляху немає — стоїмо на місці
      e.tx = next[0] + 0.5;
      e.ty = next[1] + 0.5;
    }
    const dx = e.tx - e.x, dy = e.ty - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= step) {
      e.x = e.tx; e.y = e.ty;
      e.tx = null;
    } else {
      e.x += (dx / dist) * step;
      e.y += (dy / dist) * step;
    }
  }

  function update(dtMs) {
    const dt = dtMs / 1000;

    if (state.spawned < level.spawn.count) {
      spawnTimer += dt;
      if (spawnTimer >= level.spawn.every) {
        spawnTimer -= level.spawn.every;
        spawnEnemy();
      }
    }

    for (const e of [...enemies]) {
      advance(e, e.def.speed * dt);
      if (!enemies.includes(e)) continue;
      e.rig.view.position.set(e.x, e.y);
      e.rig.moving = true;
    }

    // Спершу вороги йдуть, потім башти обирають ціль: постріл завжди по тому,
    // де ворог уже стоїть у цьому кадрі, а не де стояв у попередньому.
    updateTowers(dt);
    updateShots(dt);

    for (let i = fx.length - 1; i >= 0; i--) if (fx[i].step(dt)) fx.splice(i, 1);
    for (const r of rigs) r.update(dtMs);
    units.children.sort((a, b) => a.y - b.y);
  }

  function rescale(s) {
    for (const r of rigs) r.setScale(s);
  }

  for (const [cx, cy] of level.startWalls ?? []) build('wall', cx, cy, true);
  refresh();

  return {
    state, wallet, grid, enemies, entry, goals, update, rescale, spawnEnemy, damage,
    build, erase, whyNot, shots, get flow() { return flow; },
  };
}
