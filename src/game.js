// Ігровий шар: траса, декор, база, вороги.
//
// Усе живе в клітинках, тому товщини ліній тут дрібні числа (0.06 = 6% клітинки),
// а не пікселі: світ масштабується разом із екраном, і лінія лишається лінією.

import { Container, Graphics } from '../lib/pixi.min.mjs';
import { penStroke } from './ink.js';
import { buildPath, posAt } from './pathmath.js';
import { buildRig } from './rig.js';

const PEN = { jitter: 0.035, step: 0.28, overshoot: 0.07 };

/** Дорога: два краї, пунктир по центру і стрілки — як план, накреслений у зошиті. */
function drawRoad(g, path, half, look) {
  const edge = { ...PEN, color: look.pens.pencil, width: 0.055, alpha: 0.75, halo: 0.1 };

  for (const s of path.segs) {
    const nx = -s.uy * half, ny = s.ux * half;
    for (const k of [1, -1]) {
      penStroke(g, [[s.x0 + nx * k, s.y0 + ny * k], [s.x1 + nx * k, s.y1 + ny * k]], edge);
    }
  }

  const dash = 0.5, gap = 0.42;
  for (let d = 0.3; d < path.length - 0.3; d += dash + gap) {
    const a = posAt(path, d);
    const b = posAt(path, Math.min(d + dash, path.length));
    penStroke(g, [[a.x, a.y], [b.x, b.y]], { ...PEN, color: look.pens.pencil, width: 0.05, alpha: 0.5, halo: 0 });
  }

  for (let d = 4; d < path.length - 1; d += 7) {
    const p = posAt(path, d);
    const arrow = { ...PEN, color: look.pens.pencil, width: 0.06, alpha: 0.65, halo: 0 };
    for (const k of [2.5, -2.5]) {
      penStroke(g, [[p.x, p.y], [p.x + Math.cos(p.angle + k) * 0.34, p.y + Math.sin(p.angle + k) * 0.34]], arrow);
    }
  }
}

export function createGame({ world, look, level, balance, rigDefs, parts, textures, layout }) {
  const path = buildPath(level.path);

  const road = new Graphics();
  drawRoad(road, path, level.roadHalf, look);

  // Один шар на всіх, хто стоїть на землі: сортуємо за y, тому ближнє
  // перекриває дальнє само собою.
  const units = new Container();
  world.addChild(road, units);

  const rigs = [];
  function place(rigId, x, y) {
    const rig = buildRig(rigDefs[rigId], textures, parts, look);
    rig.view.position.set(x, y);
    rig.setScale(layout.spriteScale);
    units.addChild(rig.view);
    rigs.push(rig);
    return rig;
  }

  for (const [id, x, y] of level.decor) place(id, x, y);
  for (const [id, x, y] of level.towers) place(id, x, y);
  const keep = place('keep', level.keep[0], level.keep[1]);

  const enemies = [];
  const state = { lives: level.lives, spawned: 0, leaked: 0 };
  let spawnTimer = 0;

  function spawnEnemy(typeId = 'earling') {
    const def = balance.enemies[typeId];
    const rig = place(def.rig, 0, 0);
    const e = { rig, def, hp: def.hp, d: 0, seg: 0 };
    enemies.push(e);
    state.spawned++;
    return e;
  }

  function despawn(e) {
    e.rig.view.destroy({ children: true });
    rigs.splice(rigs.indexOf(e.rig), 1);
    enemies.splice(enemies.indexOf(e), 1);
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
      e.d += e.def.speed * dt;
      const p = posAt(path, e.d, e.seg);
      e.seg = p.seg;
      e.rig.view.position.set(p.x, p.y);
      e.rig.moving = true;

      if (e.d >= path.length) {
        state.lives = Math.max(0, state.lives - 1);
        state.leaked++;
        keep.fire('hit');
        despawn(e);
      }
    }

    for (const r of rigs) r.update(dtMs);
    units.children.sort((a, b) => a.y - b.y);
  }

  function rescale(s) {
    for (const r of rigs) r.setScale(s);
  }

  return { state, path, enemies, update, rescale, spawnEnemy };
}
