// Ігровий шар: сітка, маршрут, вороги, будівництво.
//
// Усе живе в клітинках, тому товщини ліній тут дрібні числа (0.06 = 6% клітинки),
// а не пікселі: світ масштабується разом із екраном, лінія лишається лінією.

import { Container, Graphics } from '../lib/pixi.min.mjs';
import { penStroke, penRect, hatch } from './ink.js';
import { buildPath, posAt } from './pathmath.js';
import { createGrid, WALL, TOWER, DECOR, BASE } from './grid.js';
import { computeFlow, routeFrom, stepFrom, reaches, wouldSeal } from './flow.js';
import { buildRig } from './rig.js';
import { createWallet } from './economy.js';
import { createCombat } from './combat.js';

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

export function createGame({ world, look, level, balance, rigDefs, parts, textures, layout }) {
  const grid = createGrid(look.core.cols, look.core.rows);
  const wallet = createWallet({
    start: balance.economy.startInk,
    costs: balance.build,
    refund: balance.economy.refund,
  });

  const routeG = new Graphics();
  const wallLayer = new Container();
  const fxLayer = new Container();
  // Один шар на всіх, хто стоїть на землі: сортуємо за y, тому ближнє
  // перекриває дальнє само собою.
  const units = new Container();
  // Постріли й бризки — поверх усіх, хто стоїть на землі.
  const shotLayer = new Container();
  world.addChild(routeG, wallLayer, fxLayer, units, shotLayer);

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
  // phase: 'break' — перерва перед хвилею, 'wave' — хвиля йде, далі 'won' | 'lost'.
  const state = {
    lives: level.lives, maxLives: level.lives,
    wave: 0, waves: level.waves.length, phase: 'break', breakLeft: level.waveBreak ?? 5,
    spawned: 0, killed: 0, leaked: 0, sealed: false,
  };
  let spawnTimer = 0, waveLeft = 0;

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
      combat.add(id, kind, rig, cx + k.w / 2, cy + k.h / 2);
      if (!instant) wipeIn(rig.view, units, cx - k.w / 2, cy - k.h - 0.2, k.w * 2, k.h * 2, k.drawTime);
    } else {
      gfx = new Graphics();
      drawWall(gfx, cx, cy, look);
      wallLayer.addChild(gfx);
      if (!instant) wipeIn(gfx, wallLayer, cx, cy, k.w, k.h, k.drawTime);
    }

    built.set(id, { kind, cx, cy, rig, gfx });
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
    combat.remove(id);
    if (item.rig) unplace(item.rig);
    if (item.gfx) item.gfx.destroy();
    smudge(item.cx, item.cy, k.w, k.h);
    const back = wallet.refund(item.kind);
    refresh();
    return { ok: true, kind: item.kind, refund: back };
  }

  // --- вороги ---------------------------------------------------------------
  /** @param {number} hpMul живучість хвилі: типів ворога поки один, росте він. */
  function spawnEnemy(typeId = 'earling', hpMul = 1) {
    const def = balance.enemies[typeId];
    const rig = place(def.rig, entry[0] + 0.5, -1.6);
    const e = { rig, def, hp: Math.round(def.hp * hpMul), x: entry[0] + 0.5, y: -1.6, tx: null, ty: null };
    enemies.push(e);
    state.spawned++;
    return e;
  }

  function despawn(e) {
    unplace(e.rig);
    enemies.splice(enemies.indexOf(e), 1);
  }

  /** Шкода ворогу. Вбитий доливає чорнила в ручку — це єдиний дохід у грі.
   *  Візуал смерті (закреслення) — крок 7, поки просто зникає. */
  function damage(e, amount) {
    e.hp -= amount;
    if (e.hp > 0) { e.rig.fire('hit'); return false; }
    wallet.earn(e.def.bounty);
    state.killed++;
    despawn(e);
    return true;
  }

  /** Наскільки ворог просунувся: менше — ближче до бази. За полем, не за прямою. */
  function distOf(e) {
    const [cx, cy] = cellOf(e);
    if (!grid.inside(cx, cy)) return Infinity; // ще в коридорі над полем
    const d = flow.dist[cy * grid.cols + cx];
    return d < 0 ? Infinity : d;
  }

  const combat = createCombat({
    layer: shotLayer, look, balance, enemies, damage, distOf,
  });

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
      if (state.lives === 0) state.phase = 'lost';
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

  /** Хвилі. Наступна починається не за таймером, а коли поле чисте: перерва —
   *  це час домалювати лабіринт, і вкорочувати її автоматично нечесно. */
  function updateWaves(dt) {
    const w = level.waves[state.wave];

    if (state.phase === 'break') {
      state.breakLeft -= dt;
      if (state.breakLeft > 0) return;
      state.phase = 'wave';
      waveLeft = w.count;
      spawnTimer = 0;
      return;
    }

    if (waveLeft > 0) {
      spawnTimer -= dt;
      if (spawnTimer > 0) return;
      spawnEnemy(w.enemy ?? 'earling', w.hp ?? 1);
      waveLeft--;
      spawnTimer = w.every;
      return;
    }

    if (enemies.length) return; // хвиля виспавнилась, але ще не зачищена
    if (state.wave + 1 >= level.waves.length) { state.phase = 'won'; return; }
    state.wave++;
    state.phase = 'break';
    state.breakLeft = level.waveBreak ?? 5;
  }

  function update(dtMs) {
    const dt = dtMs / 1000;
    const over = state.phase === 'won' || state.phase === 'lost';

    if (!over) {
      updateWaves(dt);

      for (const e of [...enemies]) {
        advance(e, e.def.speed * dt);
        if (!enemies.includes(e)) continue;
        e.rig.view.position.set(e.x, e.y);
        e.rig.moving = true;
      }

    }
    combat.update(dt, !over);

    // Ефекти й дихання рига йдуть навіть після кінця: аркуш не завмирає.
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
    state, wallet, grid, enemies, entry, goals, update, rescale, spawnEnemy, damage, combat,
    build, erase, whyNot, get flow() { return flow; },
  };
}
