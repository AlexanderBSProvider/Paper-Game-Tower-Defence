// Хаб режиму lane: одна вежа зліва, вороги йдуть справа наліво по рядах.
//
// Ні сітки, ні BFS, ні лабіринту: маршрут — це пряма, тому рух ворога — один
// рядок `e.x -= step`. Усе, що складне в grid.ts/flow.ts, тут просто не існує.
//
// combat.ts береться БЕЗ ЄДИНОЇ ЗМІНИ. Він не знає про сітку — питає лише
// `distOf(e)`, наскільки ворог просунувся. У лабіринті це поле відстаней,
// а тут просто `e.x`: чим менший, тим ближче до вежі. Через це вежа сама
// собою бере найнебезпечнішу ціль, а комбо, рикошет і сплеш працюють задарма.
//
// Координати — клітинки світу, як усюди. Своє ядро (laneLevel.core), бо
// look.core 15x26 задане під портретний лабіринт, а тут світ лежить навпаки.

import { Container, Graphics, Texture } from '../lib/pixi.min.mjs';
import { penStroke } from './view/ink.js';
import { buildRig } from './view/rig.js';
import { createWallet } from './model/economy.js';
import { createCombat } from './combat.js';
import { createBuild, gunOf } from './model/build.js';
import { rowY, rowHeight } from './model/lane.js';
import type { Band, LaneLevel } from './model/lane.js';
import type { Build, Stats } from './model/build.js';
import type { Combat } from './combat.js';
import type { Wallet } from './model/economy.js';
import type {
  Balance, Enemy, Fx, Layout, Look, Parts, Rig, RigDefs, TowerParts,
} from './types.js';

/** Ворог у режимі: той самий Enemy, плюс ряд. combat.ts приймає Enemy[], і
 *  LaneEnemy[] під нього підходить — саме тому combat не довелося чіпати. */
export interface LaneEnemy extends Enemy {
  row: number;
}

export type Phase = 'break' | 'wave' | 'won' | 'lost';

/** Свій стан, а не GameState із game.ts: там є `sealed` — питання, чи
 *  замкнули лабіринт, якого тут не буває. */
export interface LaneState {
  lives: number;
  maxLives: number;
  wave: number;
  waves: number;
  phase: Phase;
  breakLeft: number;
  spawned: number;
  killed: number;
  leaked: number;
}

export interface LaneGameOpts {
  world: Container;
  look: Look;
  level: LaneLevel;
  balance: Balance;
  rigDefs: RigDefs;
  parts: Parts;
  textures: Map<string, Texture>;
  layout: Layout;
  towerParts: TowerParts;
  partTex: Map<string, Texture>;
}

export type AddPartResult =
  | { ok: true; id: number; spent: number; stats: Stats }
  | { ok: false; reason: string };

export type ReinkPartResult =
  | { ok: true; id: number; ink: number; spent: number; stats: Stats }
  | { ok: false; reason: string };

export interface LaneGame {
  state: LaneState;
  wallet: Wallet;
  enemies: LaneEnemy[];
  combat: Combat;
  band: Band;
  /** склад єдиної вежі — те, що доростає панеллю апгрейду */
  tower: Build;
  towerX: number;
  towerY: number;
  spawnEnemy(row?: number | null, typeId?: string, hpMul?: number): LaneEnemy;
  damage(e: Enemy, amount: number): boolean;
  /** Домалювати деталь у сокет вежі. Перша вісь росту: вширшки. */
  addPart(
    partId: string,
    at: { node: number; name: string } | null,
    quality?: number,
  ): AddPartResult;
  /** Обвести вже поставлену деталь ще раз. Друга вісь: вглибину. Працює й
   *  тоді, коли всі сокети зайняті, — саме цим вежа не впирається в стелю. */
  reinkPart(nodeId: number, quality?: number): ReinkPartResult;
  /** Скільки коштує наступне переобведення цієї деталі. */
  reinkCost(nodeId: number): number;
  update(dtMs: number): void;
  rescale(s: number): void;
  resize(): void;
}

/** Вежа в combat під фіксованим id: вона тут одна й назавжди. Союзники
 *  пізніше візьмуть id від 1, тому нуль лишається за нею. */
const TOWER_ID = 0;

/** Із чого починається вежа. Далі гравець дороблює її сам. */
const TEMPLATE = 'magic_tower';

export function createLaneGame({
  world, look, level, balance, rigDefs, parts, textures, layout, towerParts, partTex,
}: LaneGameOpts): LaneGame {
  const band: Band = { y0: level.band.y0, y1: level.band.y1, rows: level.rows };
  const towerX = level.towerX;
  // Вежа стоїть на всіх рядах одразу — вона висока, тому її місце по центру
  // смуги, і пропущений ворог у будь-якому ряду доходить саме до неї.
  const towerY = (band.y0 + band.y1) / 2;

  const wallet = createWallet({
    start: balance.economy.startInk,
    costs: balance.build,
    refund: balance.economy.refund,
  });

  const laneG = new Graphics();   // розмітка рядів
  const fxLayer = new Container();
  const units = new Container();  // усі, хто стоїть на землі: сортуються за y
  const shotLayer = new Container();
  world.addChild(laneG, fxLayer, units, shotLayer);

  const rigs: Rig[] = [];
  const fx: Fx[] = [];

  function mount(rig: Rig, x: number, y: number) {
    rig.view.position.set(x, y);
    rig.setScale(layout.spriteScale);
    units.addChild(rig.view);
    rigs.push(rig);
    return rig;
  }

  const place = (rigId: string, x: number, y: number) =>
    mount(buildRig(rigDefs[rigId], textures, parts, look), x, y);

  const placeBuild = (b: Build, x: number, y: number) =>
    mount(buildRig(b.rigDef(), partTex, towerParts.parts, look), x, y);

  function unplace(rig: Rig) {
    rig.view.destroy({ children: true });
    rigs.splice(rigs.indexOf(rig), 1);
  }

  // --- розмітка рядів --------------------------------------------------------
  /** Ряди накреслені олівцем: без них поле читається як одна каша, а гравцю
   *  треба бачити, у який саме ряд він ставитиме союзника. */
  function drawLanes() {
    laneG.clear();
    const x0 = 0, x1 = level.core.cols;
    const h = rowHeight(band);

    for (let r = 1; r < band.rows; r++) {
      penStroke(laneG, [[x0, band.y0 + h * r], [x1, band.y0 + h * r]], {
        color: look.pens.pencil, width: 0.03, alpha: 0.28, halo: 0,
        jitter: 0.05, step: 1.4, overshoot: 0,
      });
    }
    // Межі смуги трохи твердіші: видно, де закінчується поле бою.
    for (const y of [band.y0, band.y1]) {
      penStroke(laneG, [[x0, y], [x1, y]], {
        color: look.pens.pencil, width: 0.045, alpha: 0.5, halo: 0,
        jitter: 0.05, step: 1.4, overshoot: 0,
      });
    }
  }

  // --- стан ------------------------------------------------------------------
  const enemies: LaneEnemy[] = [];
  const state: LaneState = {
    lives: level.lives, maxLives: level.lives,
    wave: 0, waves: level.waves.length, phase: 'break',
    breakLeft: level.waveBreak ?? 5,
    spawned: 0, killed: 0, leaked: 0,
  };
  let spawnTimer = 0, waveLeft = 0;

  function despawn(e: LaneEnemy) {
    unplace(e.rig);
    enemies.splice(enemies.indexOf(e), 1);
  }

  function damage(e: Enemy, amount: number): boolean {
    e.hp -= amount;
    if (e.hp > 0) { e.rig.fire('hit'); return false; }
    wallet.earn(e.def.bounty);
    state.killed++;
    despawn(e as LaneEnemy);
    return true;
  }

  /** Наскільки ворог просунувся. Уся заміна BFS-поля на пряму — ось цей рядок. */
  const distOf = (e: Enemy) => e.x;

  const combat = createCombat({
    layer: shotLayer, look, enemies, damage, distOf,
  });

  // --- вежа ------------------------------------------------------------------
  // Каталог деталей і комбо ті самі, а база своя: у лабіринті башт багато й
  // вони стоять упритул до траси, тут вежа одна й мусить діставати через усю
  // смугу рядів. Правити towerparts.base не можна — це баланс лабіринту.
  const tower = createBuild(towerParts.parts, {
    ...towerParts,
    base: { ...towerParts.base, ...(level.towerBase ?? {}) },
  });
  for (const [partId, host, socket] of towerParts.templates?.[TEMPLATE] ?? []) {
    tower.add(partId, host == null ? null : { node: tower.nodes[host].id, name: socket! }, 1);
  }
  let towerRig = placeBuild(tower, towerX, towerY);
  combat.add(TOWER_ID, gunOf(tower.stats(), balance.projectiles), towerRig, towerX, towerY);

  /**
   * Домалювати деталь до вежі — це і є апгрейд.
   *
   * Риг перезбирається цілком: склад міняє не картинку, а дерево частин, тож
   * латати наявний вийшло б дорожче й крихкіше. Відкат стрільби при цьому не
   * скидається (див. combat.retune) — інакше апгрейд посеред хвилі дарував би
   * позачерговий постріл.
   */
  function addPart(
    partId: string,
    at: { node: number; name: string } | null,
    quality = 1,
  ): AddPartResult {
    const res = tower.add(partId, at, quality);
    if (!res.ok) return res;

    // Платимо після того, як склад прийняв деталь: інакше відмова «зайнято»
    // з'їдала б чорнило. Не вистачило — знімаємо назад, слідів не лишається.
    const price = towerParts.parts[partId]?.cost ?? 0;
    if (!wallet.pay(price)) {
      tower.remove(res.id);
      return { ok: false, reason: 'мало чорнила' };
    }

    unplace(towerRig);
    towerRig = placeBuild(tower, towerX, towerY);
    const stats = tower.stats();
    combat.retune(TOWER_ID, gunOf(stats, balance.projectiles), towerRig);
    return { ok: true, id: res.id, spent: price, stats };
  }

  /** Ціна наступного переобведення: що темніша деталь, то дорожче наступний
   *  прохід. Інакше вигідно було б качати одну й ту саму до стелі. */
  function reinkCost(nodeId: number): number {
    const n = tower.nodes.find((k) => k.id === nodeId);
    if (!n) return 0;
    return Math.round((n.part.cost ?? 10) * (0.6 + 0.4 * n.ink));
  }

  /** Обвести поставлену деталь ще раз. Друга вісь росту вежі. */
  function reinkPart(nodeId: number, quality = 1): ReinkPartResult {
    const price = reinkCost(nodeId);
    const res = tower.reink(nodeId, quality);
    if (!res.ok) return res;

    // Як і в addPart: платимо після того, як склад прийняв, інакше відмова
    // «темніше вже нікуди» з'їдала б чорнило.
    if (!wallet.pay(price)) {
      const n = tower.nodes.find((k) => k.id === nodeId);
      if (n) n.ink--; // відкат рівня; якість лишається змішаною, це не критично
      return { ok: false, reason: 'мало чорнила' };
    }

    unplace(towerRig);
    towerRig = placeBuild(tower, towerX, towerY);
    const stats = tower.stats();
    combat.retune(TOWER_ID, gunOf(stats, balance.projectiles), towerRig);
    return { ok: true, id: nodeId, ink: res.ink, spent: price, stats };
  }

  // --- вороги ----------------------------------------------------------------
  function spawnEnemy(row: number | null = null, typeId = 'earling', hpMul = 1): LaneEnemy {
    const r = row ?? Math.floor(Math.random() * band.rows);
    const def = balance.enemies[typeId];
    const y = rowY(band, r);
    const rig = place(def.rig, level.spawnX, y);
    const e: LaneEnemy = {
      rig, def, row: r,
      hp: Math.round(def.hp * hpMul),
      x: level.spawnX, y,
      // Крокової цілі немає: ворог іде прямо. Поля лишаються, бо combat.ts
      // приймає Enemy, а міняти його заради двох null — гірше, ніж їх лишити.
      tx: null, ty: null,
    };
    enemies.push(e);
    state.spawned++;
    return e;
  }

  function advance(e: LaneEnemy, step: number) {
    e.x -= step;
    if (e.x > towerX) return;
    // Дійшов до вежі: життя мінус, ворог зникає. Бази як окремого об'єкта
    // немає — вежа і є те, що захищають.
    state.lives = Math.max(0, state.lives - 1);
    state.leaked++;
    towerRig.fire('hit');
    despawn(e);
    if (state.lives === 0) state.phase = 'lost';
  }

  /** Хвилі: наступна починається, коли поле чисте, а не за таймером —
   *  перерва це час домалювати вежу, і вкорочувати її автоматично нечесно. */
  function updateWaves(dt: number) {
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
      spawnEnemy(w.row ?? null, w.enemy ?? 'earling', w.hp ?? 1);
      waveLeft--;
      spawnTimer = w.every;
      return;
    }

    if (enemies.length) return;
    if (state.wave + 1 >= level.waves.length) { state.phase = 'won'; return; }
    state.wave++;
    state.phase = 'break';
    state.breakLeft = level.waveBreak ?? 5;
  }

  function update(dtMs: number) {
    const dt = dtMs / 1000;
    const over = state.phase === 'won' || state.phase === 'lost';

    if (!over) {
      updateWaves(dt);
      for (const e of [...enemies]) {
        advance(e, e.def.speed * (1 - (e.slow ?? 0)) * dt);
        if (!enemies.includes(e)) continue;
        e.rig.view.position.set(e.x, e.y);
        e.rig.moving = true;
      }
    }
    combat.update(dt, !over);

    for (let i = fx.length - 1; i >= 0; i--) if (fx[i].step(dt)) fx.splice(i, 1);
    for (const r of rigs) r.update(dtMs);
    units.children.sort((a, b) => a.y - b.y);
  }

  function rescale(s: number) {
    for (const r of rigs) r.setScale(s);
  }

  drawLanes();

  return {
    state, wallet, enemies, combat, band, tower, towerX, towerY,
    spawnEnemy, damage, addPart, reinkPart, reinkCost, update, rescale,
    resize: drawLanes,
  };
}
