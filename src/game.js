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

const PEN = { jitter: 0.035, step: 0.28, overshoot: 0.07 };

const KINDS = {
  wall: { w: 1, h: 1, mark: WALL, rig: null },
  magic_tower: { w: 2, h: 2, mark: TOWER, rig: 'magic_tower' },
  cannon: { w: 2, h: 2, mark: TOWER, rig: 'cannon' },
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

/** Стіни — накреслені від руки квадрати зі штрихуванням. */
function drawWalls(g, walls, look) {
  g.clear();
  // На 25 px клітинки все, що щільніше, зливається в суцільний брусок: обвід
  // тонкий, штрихування рідке, ореол вимкнено.
  for (const [cx, cy] of walls) {
    penRect(g, cx + 0.13, cy + 0.13, 0.74, 0.74,
      { ...PEN, color: look.pens.blue, width: 0.05, overshoot: 0.09, halo: 0.06 });
    hatch(g, cx + 0.2, cy + 0.2, 0.6, 0.6,
      { ...PEN, color: look.pens.blue, width: 0.035, alpha: 0.3, gap: 0.32, jitterGap: 0.2, halo: 0 });
  }
}

export function createGame({ world, look, level, balance, rigDefs, parts, textures, layout }) {
  const grid = createGrid(look.core.cols, look.core.rows);

  const routeG = new Graphics();
  const wallsG = new Graphics();
  // Один шар на всіх, хто стоїть на землі: сортуємо за y, тому ближнє
  // перекриває дальнє само собою.
  const units = new Container();
  world.addChild(routeG, wallsG, units);

  const rigs = [];
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
  const built = new Map(); // id → { kind, cx, cy, rig }
  let nextId = 1;

  let flow = computeFlow(grid, goals);

  const enemies = [];
  const state = { lives: level.lives, spawned: 0, leaked: 0, sealed: false };
  let spawnTimer = 0;

  const cellOf = (e) => [Math.floor(e.x), Math.floor(e.y)];
  const enemyCells = () => enemies.filter((e) => e.y >= 0).map(cellOf);

  function refresh() {
    flow = computeFlow(grid, goals);
    state.sealed = !reaches(flow, entry[0], entry[1]);
    drawRoute(routeG, routeFrom(flow, entry[0], entry[1]), look);
    drawWalls(wallsG, [...built.values()].filter((b) => b.kind === 'wall').map((b) => [b.cx, b.cy]), look);
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
    if (!grid.isFree(cx, cy, k.w, k.h)) return 'зайнято';
    const cells = grid.rect(cx, cy, k.w, k.h);
    const occupied = new Set(enemyCells().map(([x, y]) => `${x},${y}`));
    if (cells.some(([x, y]) => occupied.has(`${x},${y}`))) return 'там ворог';
    if (wouldSeal(grid, goals, cells, [entry, ...enemyCells()])) return 'замкне прохід';
    return null;
  }

  function build(kind, cx, cy, silent = false) {
    const reason = whyNot(kind, cx, cy);
    if (reason) return { ok: false, reason };

    const k = KINDS[kind];
    const id = nextId++;
    grid.fill(cx, cy, k.w, k.h, k.mark, id);
    const rig = k.rig ? place(k.rig, cx + k.w / 2, cy + k.h / 2) : null;
    built.set(id, { kind, cx, cy, rig });
    if (!silent) refresh();
    return { ok: true, id };
  }

  function erase(cx, cy) {
    const id = grid.ownerAt(cx, cy);
    const item = built.get(id);
    if (!item) return { ok: false, reason: 'нічого стирати' };
    grid.clearOwner(id);
    built.delete(id);
    if (item.rig) unplace(item.rig);
    refresh();
    return { ok: true, kind: item.kind };
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

    for (const r of rigs) r.update(dtMs);
    units.children.sort((a, b) => a.y - b.y);
  }

  function rescale(s) {
    for (const r of rigs) r.setScale(s);
  }

  for (const [cx, cy] of level.startWalls ?? []) build('wall', cx, cy, true);
  refresh();

  return { state, grid, enemies, entry, goals, update, rescale, spawnEnemy, build, erase, whyNot, get flow() { return flow; } };
}
