// Хаб режиму lane: чотири ряди, зліва слоти виклику, за лінією дому — село,
// справа спавн.
//
// Ні сітки, ні BFS, ні вежі. Гравець обводить ЗБРОЮ по трафарету — з неї
// збирається юніт (тіло малює код, зброю — рука), і він іде в бій сам: до лінії
// фронту, а далі — до найближчого ворога свого ряду. Ворог іде назустріч,
// спиняється перед першим, хто на дорозі — бійцем або будівлею, — і б'є.
// Дійшов до лінії дому — лазер ряду (раз), потім мінус життя.
//
// Село — три фундаменти в кожному ряду одразу за лінією дому, тобто НА ШЛЯХУ
// ворогів. Будівлі теж обводяться. Чорнило дає лише колодязь, і краплю треба
// тапнути — з ворогів нічого не падає.
//
// Хто куди йде і хто кого б'є — вирішують model/units.ts і model/buildings.ts
// і віддають події; тут лише малюнок: риги, снаряди, цифри, закреслення,
// краплі. Через це весь бій ганяється селфчеком без браузера, а цей файл —
// ні, і він про це знає.

import { Container, Graphics, Renderer, Texture } from '../lib/pixi.min.mjs';
import { penStroke, penStar, penCircle, hatch } from './view/ink.js';
import { buildRig } from './view/rig.js';
import { bakeTrace } from './view/procart.js';
import { createLaneFx } from './view/laneFx.js';
import { createWallet } from './model/economy.js';
import { rowY, rowHeight, rowOf, pickWeighted } from './model/lane.js';
import { createArmy } from './model/units.js';
import { createTown } from './model/buildings.js';
import { unlockedAt } from './model/weapons.js';
import { waveOf } from './model/campaign.js';
import type { Band, LaneEnemies, LaneEnemyDef, LaneLevel } from './model/lane.js';
import type { Ally, Army, Foe } from './model/units.js';
import type { Building, BuildingsData, Town } from './model/buildings.js';
import type { Rarity, WeaponKind, WeaponsData } from './model/weapons.js';
import type { Wallet } from './model/economy.js';
import type { Balance, Layout, Look, Mod, Parts, Rig, RigDef, RigDefs, Vec2 } from './types.js';

/** Ворог у режимі: те, що бачить модель (Foe), плюс риг і дані. */
export interface LaneEnemy extends Foe {
  id: number;
  def: LaneEnemyDef;
  rig: Rig;
  y: number;
  maxHp: number;
  /** смуга hp над босом; у звичайних ворогів немає */
  bar?: Graphics;
  barHp?: number;
}

/** Що сталося в рівні й варто показати поверх поля: банери, спалах життя. */
export type LaneEvent =
  | { type: 'wave'; n: number; last: boolean }
  | { type: 'boss' }
  | { type: 'life'; lives: number };

export type Phase = 'break' | 'wave' | 'won' | 'lost';

export interface LaneState {
  lives: number;
  maxLives: number;
  wave: number;
  /** скільки хвиль у рівні; 0 — нескінченний режим */
  waves: number;
  phase: Phase;
  breakLeft: number;
  spawned: number;
  killed: number;
  leaked: number;
}

export interface LaneGameOpts {
  world: Container;
  /** потрібен, щоб пекти обведене в текстуру на рантаймі */
  renderer: Renderer;
  look: Look;
  level: LaneLevel;
  weapons: WeaponsData;
  buildings: BuildingsData;
  enemyDefs: LaneEnemies;
  balance: Balance;
  rigDefs: RigDefs;
  parts: Parts;
  textures: Map<string, Texture>;
  layout: Layout;
}

export type SummonOutcome =
  | { ok: true; ally: Ally; rarity: Rarity; spent: number }
  | { ok: false; reason: string };

export type BuildOutcome =
  | { ok: true; building: Building; spent: number }
  | { ok: false; reason: string };

export interface Unlock {
  id: string;
  kind: 'weapon' | 'building';
}

export interface LaneGame {
  state: LaneState;
  wallet: Wallet;
  enemies: LaneEnemy[];
  army: Army;
  town: Town;
  band: Band;
  level: LaneLevel;
  /** де з'являється союзник у ряду */
  readonly slotX: number;
  spawnEnemy(row?: number | null, typeId?: string, hpMul?: number): LaneEnemy;
  /**
   * Намалювати союзника в ряд: зброя обведена, юніт зібраний, пішов.
   * @param strokes штрихи з рамки; без них береться контур із даних, тому
   *   виклик із консолі (`__td.laneGame.summon('sword', 1, 1)`) теж працює
   */
  summon(weaponId: string, row: number, quality?: number, strokes?: Vec2[][]): SummonOutcome;
  /** Поставити будівлю на фундамент (row, col). */
  build(kind: string, row: number, col: number, quality?: number, strokes?: Vec2[][]): BuildOutcome;
  /** Який фундамент під точкою світу, або null. */
  plotAt(cx: number, cy: number): { row: number; col: number } | null;
  plotCenter(row: number, col: number): Vec2;
  /** Тап по краплі над колодязем: забрати. @returns чи була крапля під пальцем */
  collectAt(cx: number, cy: number): boolean;
  /** Де висить перша крапля, що чекає тапу (клітинки світу), або null. */
  dropAt(): Vec2 | null;
  /** Підсвітити слоти маркером: є що намалювати, є куди тапати. */
  setSlotsActive(on: boolean): void;
  /** Те саме для фундаментів. */
  setPlotsActive(on: boolean): void;
  /** Підсвітити ряд, для якого зараз малюють (null — ніякий). */
  setFocusRow(row: number | null): void;
  isUnlocked(id: string): boolean;
  isBuildingUnlocked(id: string): boolean;
  /** Відкрите від останнього виклику: HUD показує винагороду й спорожняє чергу. */
  takeUnlocks(): Unlock[];
  /** Куди летять краплі чорнила — центр колби в ЕКРАННИХ px; ставить HUD. */
  setGauge(at: () => Vec2): void;
  readonly lasers: readonly number[];
  /** Події від останнього виклику: банери хвиль, бос, втрачене життя. */
  takeEvents(): LaneEvent[];
  update(dtMs: number): void;
  rescale(s: number): void;
  resize(): void;
  /** Прибрати все своє зі світу: рестарт рівня без перезавантаження сторінки. */
  destroy(): void;
}

/** Снаряд ренжового: летить по ряду вправо, поки не дожене ціль. */
interface Shot {
  g: Graphics;
  x: number;
  y: number;
  speed: number;
  ally: Ally;
  target: LaneEnemy;
}

/** Малюнок будівлі: риг, власна текстура, рисочки hp і крапля над колодязем. */
interface BuildingArt {
  rig: Rig;
  tex: Texture;
  hpG: Graphics;
  drop: Graphics | null;
  /** блимання «готово» в кузні */
  readyG: Graphics | null;
  t: number;
}

export function createLaneGame({
  world, renderer, look, level, weapons, buildings, enemyDefs, balance, rigDefs, parts, textures, layout,
}: LaneGameOpts): LaneGame {
  const band: Band = { y0: level.band.y0, y1: level.band.y1, rows: level.rows };
  const slotX = (level.slot.x0 + level.slot.x1) / 2;
  const plots = level.plots;
  const plotX = (col: number) => plots.x0 + plots.step * col;

  const wallet = createWallet({
    start: level.startInk ?? balance.economy.startInk,
    costs: balance.build,
    refund: balance.economy.refund,
  });

  /** Малюнок персонажів більший за хітбокс: бій той самий, видно краще.
   *  У тісних рядах (5 на сторінці) збільшення менше, інакше сусіди
   *  налазять один на одного. */
  const artK = (level.artScale ?? 1) * Math.min(1, rowHeight(band) / 2.2);

  const laneG = new Graphics();   // розмітка: ряди, дім, фронт, слоти, фундаменти
  const glowG = new Graphics();   // смуга ряду, для якого зараз малюють
  const pulseG = new Graphics();  // маркерні кола «тапни тут» — пульсують
  const decals = new Container(); // клякси на місці загиблих: поле пам'ятає бій
  const laserG = new Graphics();  // випромінювачі лазера на лінії дому
  const units = new Container();  // усі, хто стоїть на землі: сортуються за y
  const shotLayer = new Container();
  world.addChild(laneG, decals, glowG, pulseG, laserG, units, shotLayer);

  const fx = createLaneFx(shotLayer, look);
  const rigs: Rig[] = [];

  /**
   * Візуальний стан рига поверх моделі: відкидання від удару й «стусан»
   * масштабом. Модель про це не знає — позиція в бою та сама, просто малюнок
   * на мить зсувається й роздувається, і удар відчувається.
   */
  interface Vis { extra: number; kb: number; punch: number; }
  const vis = new Map<Rig, Vis>();

  function mount(rig: Rig, x: number, y: number, extra = 1) {
    rig.view.position.set(x, y);
    rig.setScale(layout.spriteScale * artK * extra);
    units.addChild(rig.view);
    rigs.push(rig);
    vis.set(rig, { extra, kb: 0, punch: 0 });
    return rig;
  }

  function unplace(rig: Rig) {
    rig.view.destroy({ children: true });
    rigs.splice(rigs.indexOf(rig), 1);
    vis.delete(rig);
  }

  /** Удар по ригу: dx — відкидання в клітинках (знак — куди), p — сила стусана. */
  function jolt(rig: Rig | undefined, dx: number, p = 1) {
    const v = rig && vis.get(rig);
    if (!v) return;
    v.kb = Math.max(-0.5, Math.min(0.5, v.kb + dx));
    v.punch = Math.min(1, v.punch + p);
  }

  // --- тряска й хітстоп ---------------------------------------------------------
  let shakeT = 0, shakeDur = 0, shakeAmp = 0, freeze = 0;
  /** Аркуш смикається: сила в клітинках, тривалість у секундах. */
  function shake(amp: number, dur = 0.25) {
    if (amp < shakeAmp * (shakeT / Math.max(shakeDur, 1e-6))) return; // слабша не перебиває сильнішу
    shakeAmp = amp; shakeDur = dur; shakeT = dur;
  }
  /** Мить, коли все завмирає: удар відчувається вагою. */
  const hitstop = (s: number) => { freeze = Math.max(freeze, s); };

  function stepShake(dt: number) {
    if (shakeT <= 0) return;
    shakeT = Math.max(0, shakeT - dt);
    const k = shakeT / shakeDur;
    const a = shakeAmp * k * layout.cell;
    world.position.set(layout.ox + (Math.random() - 0.5) * 2 * a, layout.oy + (Math.random() - 0.5) * 2 * a);
    if (shakeT === 0) world.position.set(layout.ox, layout.oy);
  }

  // --- клякси -------------------------------------------------------------------
  /** Клякса чорнила там, де хтось упав: лишається на аркуші й повільно тане. */
  function splat(x: number, y: number, r: number, color: string | number) {
    const g = new Graphics();
    const n = 9, pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, rr = r * (0.7 + Math.random() * 0.45);
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.55);
    }
    g.poly(pts).fill({ color, alpha: 0.16 });
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, d = r * (1.1 + Math.random() * 0.7);
      g.circle(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.55, r * (0.06 + Math.random() * 0.08))
        .fill({ color, alpha: 0.3 });
    }
    decals.addChild(g);
    while (decals.children.length > 40) decals.children[0].destroy();
    splats.push({ g, t: 0 });
  }
  const splats: { g: Graphics; t: number }[] = [];
  function stepSplats(dt: number) {
    for (let i = splats.length - 1; i >= 0; i--) {
      const s = splats[i];
      if (s.g.destroyed) { splats.splice(i, 1); continue; }
      s.t += dt;
      // Тримається 10 с, тане ще 6: поле довго пам'ятає, де був бій.
      s.g.alpha = s.t < 10 ? 1 : Math.max(0, 1 - (s.t - 10) / 6);
      if (s.t >= 16) { s.g.destroy(); splats.splice(i, 1); }
    }
  }

  // --- розмітка ---------------------------------------------------------------
  const pencil = {
    color: look.pens.pencil, width: 0.03, alpha: 0.28, halo: 0,
    jitter: 0.05, step: 1.4, overshoot: 0,
  };

  /** Пунктирний прямокутник: рамка слота й фундаменту. */
  function dashedRect(g: Graphics, x0: number, y0: number, x1: number, y1: number, color: string | number, alpha: number) {
    const side = (a: Vec2, b: Vec2) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(2, Math.round(len / 0.32));
      for (let i = 0; i < n; i += 2) {
        const t0 = i / n, t1 = Math.min(1, (i + 1) / n);
        penStroke(g, [
          [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0],
          [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1],
        ], { ...pencil, color, width: 0.04, alpha, step: 0.4 });
      }
    };
    side([x0, y0], [x1, y0]);
    side([x1, y0], [x1, y1]);
    side([x1, y1], [x0, y1]);
    side([x0, y1], [x0, y0]);
  }

  /** Чотири куточки олівцем замість суцільної рамки: «тут місце», а не коробка. */
  function corners(g: Graphics, x0: number, y0: number, x1: number, y1: number, color: string | number, alpha: number) {
    const k = Math.min(x1 - x0, y1 - y0) * 0.22;
    const o = { ...pencil, color, width: 0.04, alpha, step: 0.3 };
    penStroke(g, [[x0, y0 + k], [x0, y0], [x0 + k, y0]], o);
    penStroke(g, [[x1 - k, y0], [x1, y0], [x1, y0 + k]], o);
    penStroke(g, [[x1, y1 - k], [x1, y1], [x1 - k, y1]], o);
    penStroke(g, [[x0 + k, y1], [x0, y1], [x0, y1 - k]], o);
  }

  /**
   * Клякса-нора на правому краю ряду: звідси лізуть вороги. Без неї вони
   * з'являлися нізвідки, і поле не мало «звідки» й «куди».
   */
  function burrow(g: Graphics, x: number, cy: number, h: number) {
    const r = Math.min(0.9, h * 0.38);
    const pts: number[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const rr = r * (0.82 + 0.18 * Math.sin(i * 2.7 + cy));
      pts.push(x + Math.cos(a) * rr * 0.7, cy + 0.15 + Math.sin(a) * rr * 0.55);
    }
    g.poly(pts).fill({ color: look.pens.red, alpha: 0.2 });
    hatch(g, x - r * 0.6, cy - r * 0.35, r * 1.2, r * 0.95, {
      color: look.pens.red, gap: 0.12, jitterGap: 0.25, width: 0.03, alpha: 0.35, angle: -0.6,
    });
    penCircle(g, x, cy + 0.15, r * 0.62, { color: look.pens.red, width: 0.045, alpha: 0.55, jitter: 0.03, step: 0.25, halo: 0.1 });
    for (const [dx, dy, rr] of [[-0.9, -0.3, 0.07], [-0.75, 0.5, 0.05], [0.2, -0.65, 0.06]] as [number, number, number][]) {
      g.circle(x + dx * r, cy + dy * r, rr).fill({ color: look.pens.red, alpha: 0.35 });
    }
  }

  /**
   * Поле має читатись без слів: зліва слоти з плюсиком, лінія дому кольором
   * поля зошита, за нею фундаменти з молоточком, посередині бліді рисочки
   * фронту, праворуч нори, з яких лізуть вороги. Заготовки — ледь видно
   * олівцем: найпомітнішим на аркуші має бути бій, а не порожні місця.
   */
  function drawLanes() {
    laneG.clear();
    const x0 = 0, x1 = level.core.cols;
    const h = rowHeight(band);

    for (let r = 1; r < band.rows; r++) {
      penStroke(laneG, [[x0, band.y0 + h * r], [x1, band.y0 + h * r]], pencil);
    }
    for (const y of [band.y0, band.y1]) {
      penStroke(laneG, [[x0, y], [x1, y]], { ...pencil, width: 0.045, alpha: 0.5 });
    }

    // Лінія дому: вертикальна, кольором поля зошита.
    penStroke(laneG, [[level.homeX, band.y0 - 0.4], [level.homeX, band.y1 + 0.4]], {
      color: look.margin.color, width: 0.07, alpha: 0.75, halo: 0.1,
      jitter: 0.04, step: 0.8, overshoot: 0.1,
    });

    // Лінія фронту: рисочки, а не суцільна — це межа, а не стіна.
    for (let y = band.y0 + 0.2; y < band.y1; y += 0.6) {
      penStroke(laneG, [[level.holdX, y], [level.holdX, y + 0.28]], { ...pencil, width: 0.04, alpha: 0.32 });
    }

    for (let r = 0; r < band.rows; r++) {
      const cy = rowY(band, r);
      // Слот юніта: куточки й плюсик.
      const sh = Math.min(h * 0.42, 0.9);
      corners(laneG, level.slot.x0, cy - sh, level.slot.x1, cy + sh, look.pens.blue, 0.4);
      const sx = slotX;
      penStroke(laneG, [[sx - 0.22, cy], [sx + 0.22, cy]], { ...pencil, color: look.pens.blue, alpha: 0.55, width: 0.05 });
      penStroke(laneG, [[sx, cy - 0.22], [sx, cy + 0.22]], { ...pencil, color: look.pens.blue, alpha: 0.55, width: 0.05 });

      // Фундаменти: куточки й молоточок олівцем — ледь видно, поки порожньо.
      for (let c = 0; c < plots.cols; c++) {
        const px = plotX(c), half = plots.side / 2;
        corners(laneG, px - half, cy - half, px + half, cy + half, look.pens.pencil, 0.3);
        const hp = { ...pencil, width: 0.04, alpha: 0.25, step: 0.3 };
        penStroke(laneG, [[px - 0.22, cy + 0.22], [px + 0.12, cy - 0.12]], hp);
        penStroke(laneG, [[px + 0.02, cy - 0.3], [px + 0.3, cy - 0.02], [px + 0.2, cy + 0.08], [px - 0.08, cy - 0.2], [px + 0.02, cy - 0.3]], hp);
      }

      burrow(laneG, level.core.cols - 0.55, cy, h);
    }
  }

  let slotsActive = false, plotsActive = false, focusRow: number | null = null;
  function drawGlow() {
    glowG.clear();
    const h = rowHeight(band);
    if (focusRow != null) {
      // Ряд, для якого зараз малюють: маркерна смуга на весь ряд.
      glowG.rect(0, rowY(band, focusRow) - h / 2, level.core.cols, h)
        .fill({ color: look.pens.marker, alpha: 0.12 });
    }
    drawPulse();
  }

  /**
   * «Тапни тут» — маркерні кола, але лише там, де це справді порада: слот
   * ряду без жодного бійця (ряд голий) і перший вільний фундамент, поки в
   * селі немає колодязя (без нього чорнила не буде). Шістнадцять кіл, що
   * блимають усюди, знову робили найпомітнішим на аркуші порожнечу.
   */
  let pulseKey = '';
  function drawPulse() {
    const bare: number[] = [];
    if (slotsActive) {
      for (let r = 0; r < band.rows; r++) if (!army.allies.some((a) => a.row === r)) bare.push(r);
    }
    const needWell = plotsActive && !town.buildings.some((b) => b.def.effect.type === 'well');
    const key = bare.join(',') + '|' + needWell;
    if (key === pulseKey) return;
    pulseKey = key;
    pulseG.clear();
    for (const r of bare) pulseG.circle(slotX, rowY(band, r), 0.42).fill({ color: look.pens.marker, alpha: 0.7 });
    if (needWell) {
      for (let r = 0; r < band.rows; r++) {
        const c = [...Array(plots.cols).keys()].find((k) => !town.at(r, k));
        if (c == null) continue;
        pulseG.circle(plotX(c) + 0.04, rowY(band, r) - 0.04, 0.38).fill({ color: look.pens.marker, alpha: 0.5 });
      }
    }
  }

  /**
   * Випромінювачі лазера на лінії дому — по одному на ряд, сидять НА лінії,
   * дулом до ворогів. Прилад: коробка на ніжці, лінза праворуч, блискавка на
   * боці, маркерне світло за лінзою, поки є заряд. Витрачений — без світла й
   * блискавки, лінза закреслена, коробка олівцем: видно, що ряд без захисту.
   */
  function drawLasers() {
    laserG.clear();
    for (let r = 0; r < band.rows; r++) {
      const cy = rowY(band, r);
      const x = level.homeX;
      const on = lasers[r] > 0;
      const col = on ? look.pens.blue : look.pens.pencil;
      const pen = {
        color: col, width: 0.05, alpha: on ? 0.9 : 0.4,
        jitter: 0.01, step: 0.2, overshoot: 0.03, halo: on ? 0.15 : 0,
      };
      if (on) {
        // Світло за лінзою: маркерний конус у бік ворогів.
        laserG.poly([x + 0.32, cy - 0.1, x + 0.9, cy - 0.26, x + 0.9, cy + 0.26, x + 0.32, cy + 0.1])
          .fill({ color: look.pens.marker, alpha: 0.22 });
        laserG.circle(x + 0.32, cy, 0.2).fill({ color: look.pens.marker, alpha: 0.6 });
      }
      // Ніжка й основа.
      penStroke(laserG, [[x, cy + 0.32], [x, cy + 0.62]], pen);
      penStroke(laserG, [[x - 0.28, cy + 0.62], [x + 0.28, cy + 0.62]], pen);
      // Коробка приладу.
      penStroke(laserG, [[x - 0.42, cy - 0.3], [x + 0.28, cy - 0.3], [x + 0.28, cy + 0.3], [x - 0.42, cy + 0.3], [x - 0.42, cy - 0.3]], pen);
      // Лінза: кільце праворуч.
      penCircle(laserG, x + 0.32, cy, 0.16, { ...pen, width: 0.055 });
      if (on) {
        // Блискавка на боці: «заряджено».
        penStroke(laserG, [[x - 0.1, cy - 0.22], [x - 0.24, cy + 0.02], [x - 0.08, cy + 0.02], [x - 0.22, cy + 0.24]],
          { ...pen, color: look.pens.orange ?? look.pens.red, width: 0.05, alpha: 0.95 });
      } else {
        // Витрачено: лінза закреслена червоним.
        penStroke(laserG, [[x + 0.16, cy - 0.18], [x + 0.48, cy + 0.18]], { ...pen, color: look.pens.red, alpha: 0.7 });
        penStroke(laserG, [[x + 0.48, cy - 0.18], [x + 0.16, cy + 0.18]], { ...pen, color: look.pens.red, alpha: 0.7 });
      }
    }
  }

  // --- стан ------------------------------------------------------------------
  const enemies: LaneEnemy[] = [];
  const state: LaneState = {
    lives: level.lives, maxLives: level.lives,
    wave: 0, waves: level.endless ? 0 : level.waves.length, phase: 'break',
    breakLeft: level.waveBreak ?? 5,
    spawned: 0, killed: 0, leaked: 0,
  };
  let spawnTimer = 0, waveLeft = 0;
  let nextEnemyId = 1;
  const events: LaneEvent[] = [];

  /** Заряди лазера по рядах: як газонокосарки в PvZ, по одному на ряд. */
  const lasers: number[] = Array.from({ length: band.rows }, () => level.laser?.charges ?? 0);

  /** Відкрите: стартове плюс винагороди за пройдені хвилі. */
  let unlocked = unlockedAt(0, level.startWeapons, level.unlocks);
  let unlockedB = unlockedAt(0, level.startBuildings, level.buildingUnlocks, 'buildings');
  const newUnlocks: Unlock[] = [];
  function refreshUnlocks() {
    const w = unlockedAt(state.wave, level.startWeapons, level.unlocks);
    for (const id of w) if (!unlocked.has(id)) newUnlocks.push({ id, kind: 'weapon' });
    unlocked = w;
    const b = unlockedAt(state.wave, level.startBuildings, level.buildingUnlocks, 'buildings');
    for (const id of b) if (!unlockedB.has(id)) newUnlocks.push({ id, kind: 'building' });
    unlockedB = b;
  }

  /** Ціль крапель у клітинках світу. Поки HUD не сказав, де ручка — лівий верх смуги. */
  let gaugeAt: () => Vec2 = () => [layout.ox + layout.cell, layout.oy + layout.cell];
  const gaugeWorld = (): Vec2 => {
    const [px, py] = gaugeAt();
    return [(px - layout.ox) / layout.cell, (py - layout.oy) / layout.cell];
  };

  // --- село ------------------------------------------------------------------
  const town = createTown({
    data: buildings, rarity: weapons.rarity, rows: level.rows, cols: plots.cols,
    plotX, plotHalf: plots.side / 2,
  });

  // --- армія -----------------------------------------------------------------
  const army = createArmy({
    weapons, rows: level.rows, slotX, holdX: level.holdX, homeX: level.homeX,
    supportBack: level.supportBack,
    // Прапори ряду: множник доїжджає до кожного удару й пострілу тим самим hitOf.
    extraMul: (a, f) => town.dmgMul(a.row, f.cls),
  });

  /** Малюнок союзника за id: риг і його ВЛАСНА текстура зброї. */
  const allyArt = new Map<number, { rig: Rig; tex: Texture }>();
  const buildingArt = new Map<number, BuildingArt>();

  /** Зірки рідкості над головою — колір рівня. Перо літер не вміє, тому
   *  рідкість — це зірки й їхня ручка: олівець, синя, фіолетова, оранжева. */
  function drawStars(g: Graphics, tier: Rarity, top: number) {
    const n = tier.stars;
    const r = 0.11, gap = 0.28;
    const x0 = -((n - 1) * gap) / 2;
    const color = look.pens[tier.pen] ?? look.pens.blue;
    if (n >= 4) {
      // Легендарна — під зірками маркерна пляма, як підкреслення в зошиті.
      g.rect(x0 - r * 1.6, top - r * 0.9, (n - 1) * gap + r * 3.2, r * 2.1)
        .fill({ color: look.pens.marker, alpha: 0.55 });
    }
    for (let i = 0; i < n; i++) {
      penStar(g, x0 + i * gap, top, r, { color, width: 0.04, alpha: 0.9, halo: 0.12 });
    }
  }

  /**
   * Риг союзника: тіло з каталогу + зброя, яку щойно провела рука.
   *
   * Зброя — дитина тіла в точці руки, з піво́том у руків'ї: замах (swing) або
   * віддача (recoil) крутять саме її, тому анімація атаки дістається з тих
   * самих модифікаторів, що й у решти ригів. `bakeTrace` пече штрихи тим самим
   * кодом, що каталог, тому крива рука й каталог виходять одним пером.
   */
  function allyRig(kind: WeaponKind, weaponId: string, strokes: Vec2[][], tier: Rarity) {
    const body = weapons.bodies[kind];
    const w = weapons.weapons[weaponId];
    const tex = bakeTrace(renderer, strokes, w.size, look);

    const weaponMods: Mod[] = kind === 'melee'
      ? [{ type: 'sway', amp: 4, freq: 0.6 }, { type: 'swing', amp: 70 }]
      : kind === 'ranged'
        ? [{ type: 'sway', amp: 2, freq: 0.5 }, { type: 'recoil', amp: 0.2, dir: [-1, 0] }]
        // Священик підіймає посох на зціленні: невеликий замах угору.
        : [{ type: 'sway', amp: 3, freq: 0.4 }, { type: 'swing', amp: -25 }, { type: 'recoil', amp: 0.15, dir: [0, -1] }];

    const def: RigDef = {
      hitbox: body.size,
      anchors: { hit: [0, -body.size[1] * 0.5], ground: [0, body.size[1] / 2] },
      parts: [
        {
          part: body.part, pos: [0, body.size[1] / 2], pivot: [0.5, 1], pen: 'blue',
          mods: [
            { type: 'squash', amp: 0.04, freq: 1.1 },
            { type: 'bob', amp: 0.06, freq: 2.2, on: 'walk' },
          ],
        },
        {
          part: 'weapon', parent: 0, pos: body.hand, pivot: w.grip, rot: w.rot ?? 0, pen: 'blue',
          mods: weaponMods,
        },
      ],
    };
    const texMap = new Map(textures);
    texMap.set('weapon', tex);
    const rig = buildRig(def, texMap, { ...parts, weapon: { size: w.size } }, look);

    const stars = new Graphics();
    drawStars(stars, tier, -body.size[1] / 2 - 0.3);
    rig.view.addChild(stars);
    return { rig, tex };
  }

  function dropAlly(a: Ally) {
    const art = allyArt.get(a.id);
    if (!art) return;
    unplace(art.rig);
    // Текстура в кожного своя — вона і є те, що намалював гравець. Не зняти її
    // означає лишати рендер-таргет у пам'яті на кожного полеглого.
    art.tex.destroy(true);
    allyArt.delete(a.id);
  }

  function summon(
    weaponId: string, row: number, quality = 1,
    strokes?: Vec2[][],
  ): SummonOutcome {
    const w = weapons.weapons[weaponId];
    if (!w || weaponId.startsWith('_')) return { ok: false, reason: 'немає такої зброї' };
    if (!unlocked.has(weaponId)) return { ok: false, reason: 'ще не відкрито' };
    // Питаємо ДО того, як армія прийняла: інакше довелося б відкочувати.
    if (wallet.ink < w.cost) return { ok: false, reason: 'мало чорнила' };
    // Кузня ряду віддає заряд лише тому, хто справді став: ряд перевіряємо
    // до того, як брати заряд.
    if (!Number.isInteger(row) || row < 0 || row >= level.rows) return { ok: false, reason: 'немає такого ряду' };

    const boost = town.takeForge(row);
    const res = army.summon(weaponId, row, quality, boost);
    if (!res.ok) return res;
    wallet.pay(w.cost);

    const a = res.ally;
    const art = allyRig(a.kind, weaponId, strokes ?? w.outline, a.rarity);
    mount(art.rig, a.x, rowY(band, a.row));
    allyArt.set(a.id, art);
    if (boost > 0) fx.bless(a.x, rowY(band, a.row) - 0.9);
    redrawForge(row);
    return { ok: true, ally: a, rarity: a.rarity, spent: w.cost };
  }

  // --- будівлі ---------------------------------------------------------------
  /** Риг будівлі: одна частина з обведених штрихів, ледь дихає. */
  function buildingRig(b: Building, strokes: Vec2[][]): BuildingArt {
    const size = b.def.size;
    const tex = bakeTrace(renderer, strokes, size, look);
    const e = b.def.effect;
    const mods: Mod[] = e.type === 'banner'
      ? [{ type: 'sway', amp: 3.5, freq: 0.7 }]
      : e.type === 'trap'
        ? [{ type: 'squash', amp: 0.03, freq: 0.5 }]
        : [{ type: 'sway', amp: 0.6, freq: 0.25 }];
    const def: RigDef = {
      hitbox: size,
      anchors: { hit: [0, -size[1] * 0.5], ground: [0, size[1] / 2] },
      parts: [{ part: 'unit', pos: [0, size[1] / 2], pivot: [0.5, 1], pen: 'blue', mods }],
    };
    const rig = buildRig(def, new Map([['unit', tex]]), { unit: { size } }, look);
    const stars = new Graphics();
    drawStars(stars, b.rarity, -size[1] / 2 - 0.22);
    rig.view.addChild(stars);
    const hpG = new Graphics();
    rig.view.addChild(hpG);
    return { rig, tex, hpG, drop: null, readyG: null, t: 0 };
  }

  /** Рисочки hp під будівлею: з'являються лише коли її вже били. */
  function drawHp(b: Building, art: BuildingArt) {
    art.hpG.clear();
    if (b.hp >= b.maxHp) return;
    const n = 6, w = b.def.size[0] * 0.8, y = b.def.size[1] / 2 + 0.14;
    const alive = Math.ceil((b.hp / b.maxHp) * n);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * (w / n);
      penStroke(art.hpG, [[x - 0.05, y + 0.1], [x + 0.05, y - 0.1]], {
        color: i < alive ? look.pens.blue : look.pens.red, width: 0.045, alpha: 0.85,
        jitter: 0.01, step: 0.2, overshoot: 0.02, halo: 0.1,
      });
    }
  }

  /** Крапля над колодязем: висить і чекає тапу. */
  function showDrop(b: Building, art: BuildingArt) {
    if (art.drop) return;
    const g = new Graphics();
    const r = 0.26;
    const pen = { color: look.pens.green, width: 0.05, alpha: 0.95, jitter: 0.012, step: 0.12, overshoot: 0, halo: 0.2 };
    // Маркерне коло під краплею: «тапни мене».
    g.circle(0, 0, r * 1.7).fill({ color: look.pens.marker, alpha: 0.45 });
    penCircle(g, 0, 0, r, pen);
    penStroke(g, [[-r * 0.55, -r * 0.8], [0, -r * 1.7], [r * 0.55, -r * 0.8]], { ...pen, width: 0.045 });
    hatch(g, -r, -r, r * 2, r * 2, { ...pen, gap: r * 0.5, jitterGap: 0.2, width: 0.035, alpha: 0.6 });
    g.position.set(0, -b.def.size[1] / 2 - 0.75);
    art.rig.view.addChild(g);
    art.drop = g;
  }

  function hideDrop(art: BuildingArt) {
    art.drop?.destroy();
    art.drop = null;
  }

  /** Кузня з зарядом: маркерна іскра над нею. */
  function redrawForge(row: number) {
    for (const b of town.buildings) {
      if (b.row !== row || b.def.effect.type !== 'forge') continue;
      const art = buildingArt.get(b.id);
      if (!art) continue;
      art.readyG?.destroy();
      art.readyG = null;
      if (!b.ready) continue;
      const g = new Graphics();
      penStar(g, 0.55, -b.def.size[1] / 2 - 0.2, 0.16, { color: look.pens.orange ?? look.pens.red, width: 0.045, alpha: 0.95, halo: 0.2 });
      art.rig.view.addChild(g);
      art.readyG = g;
    }
  }

  function dropBuilding(b: Building) {
    const art = buildingArt.get(b.id);
    if (!art) return;
    unplace(art.rig);
    art.tex.destroy(true);
    buildingArt.delete(b.id);
    drawGlow();
  }

  function build(kind: string, row: number, col: number, quality = 1, strokes?: Vec2[][]): BuildOutcome {
    const d = buildings.buildings[kind];
    if (!d || kind.startsWith('_')) return { ok: false, reason: 'немає такої будівлі' };
    if (!unlockedB.has(kind)) return { ok: false, reason: 'ще не відкрито' };
    if (wallet.ink < d.cost) return { ok: false, reason: 'мало чорнила' };

    const res = town.build(kind, row, col, quality);
    if (!res.ok) return res;
    wallet.pay(d.cost);

    const b = res.building;
    const art = buildingRig(b, strokes ?? d.outline);
    mount(art.rig, b.x, rowY(band, b.row));
    buildingArt.set(b.id, art);
    redrawForge(row);
    drawGlow();
    return { ok: true, building: b, spent: d.cost };
  }

  function plotAt(cx: number, cy: number) {
    if (cy < band.y0 || cy > band.y1) return null;
    const row = rowOf(band, cy);
    const half = plots.side / 2 + 0.15;
    for (let c = 0; c < plots.cols; c++) {
      if (Math.abs(cx - plotX(c)) <= half && Math.abs(cy - rowY(band, row)) <= half) return { row, col: c };
    }
    return null;
  }

  const plotCenter = (row: number, col: number): Vec2 => [plotX(col), rowY(band, row)];

  function dropAt(): Vec2 | null {
    for (const b of town.buildings) {
      const art = buildingArt.get(b.id);
      if (art?.drop) return [b.x, rowY(band, b.row) + art.drop.y * layout.spriteScale * artK];
    }
    return null;
  }

  function collectAt(cx: number, cy: number): boolean {
    for (const b of town.buildings) {
      const art = buildingArt.get(b.id);
      if (!art?.drop) continue;
      // Крапля — дитина рига, а риг масштабований spriteScale × artScale: у світ її y іде через масштаб.
      const dropY = rowY(band, b.row) + art.drop.y * layout.spriteScale * artK;
      const dx = cx - b.x, dy = cy - dropY;
      if (Math.hypot(dx, dy) > 0.9) continue;
      const ink = town.collect(b);
      if (!ink) continue;
      // Крапля летить у ручку тим самим польотом, що й будь-яке чорнило, і
      // зараховується на прильоті.
      fx.inkDrop(b.x, dropY, ink, gaugeWorld, () => wallet.earn(ink));
      hideDrop(art);
      return true;
    }
    return false;
  }

  // --- вороги ----------------------------------------------------------------
  /** Зріст ворога на екрані: хітбокс з даних × масштаб малюнка. */
  const tall = (e: LaneEnemy) => e.def.size * artK * (e.def.scale ?? 1);



  /** Смуга hp над босом: штрихування, що коротшає. */
  function drawBar(e: LaneEnemy) {
    const g = e.bar;
    if (!g || e.barHp === e.hp) return;
    e.barHp = e.hp;
    g.clear();
    // Над рогами: верх коробки рига, а не якір удару — роги вищі за голову.
    const box = rigDefs[e.def.rig]?.hitbox ?? [1.9, e.def.size];
    const w = 1.1 * box[0] / 1.9, y = -box[1] * 0.86;
    const p = Math.max(0, e.hp / e.maxHp);
    penRectLite(g, -w / 2, y, w, 0.2, look.pens.pencil);
    if (p > 0) {
      g.rect(-w / 2 + 0.03, y + 0.03, (w - 0.06) * p, 0.14).fill({ color: look.pens.red, alpha: 0.75 });
    }
  }
  function penRectLite(g: Graphics, x: number, y: number, w: number, h: number, color: string | number) {
    penStroke(g, [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]],
      { color, width: 0.035, alpha: 0.7, jitter: 0.008, step: 0.2, overshoot: 0.02, halo: 0 });
  }

  function spawnEnemy(row: number | null = null, typeId = 'earling', hpMul = 1): LaneEnemy {
    const r = row ?? Math.floor(Math.random() * band.rows);
    const def = enemyDefs[typeId];
    const y = rowY(band, r);
    const rig = mount(buildRig(rigDefs[def.rig], textures, parts, look), level.spawnX, y, def.scale ?? 1);
    const hp = Math.round(def.hp * hpMul);
    const e: LaneEnemy = {
      id: nextEnemyId++, def, rig, row: r, y,
      x: level.spawnX, hp, maxHp: hp,
      cls: def.cls, damage: def.damage, rate: def.rate, reach: def.reach, speed: def.speed,
      cd: 0, moving: true, vs: def.vs,
    };
    if (def.boss) {
      // Корона намальована в самому ригу боса (bathking); тут лише смуга hp.
      e.bar = new Graphics();
      rig.view.addChild(e.bar);
      drawBar(e);
    }
    enemies.push(e);
    state.spawned++;
    return e;
  }

  function despawn(e: LaneEnemy) {
    unplace(e.rig);
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
  }

  /** Смерть ворога: закреслення, клякса й зняття. Чорнила з нього не падає — його дають будівлі. */
  function killEnemy(e: LaneEnemy) {
    if (!enemies.includes(e)) return;
    const s = tall(e);
    fx.strikeOut(e.x, e.y, s * 0.8, s);
    splat(e.x, e.y + 0.3, 0.35 + s * 0.2, look.pens.red);
    if (e.def.boss) { shake(0.35, 0.5); hitstop(0.12); }
    else if (e.def.cls === 'armored') shake(0.08, 0.15);
    state.killed++;
    despawn(e);
  }

  /**
   * Ворог на лінії дому. Поки в ряду є заряд лазера — промінь спалює всіх у
   * цьому ряду (як газонокосарка в PvZ), і життя ціле. Боса промінь не
   * спалює: відкидає назад і знімає половину hp — інакше бос-хвиля
   * вирішувалась би одним зарядом. Заряду немає — мінус життя (бос — три).
   */
  function leak(e: LaneEnemy) {
    if (!enemies.includes(e)) return;
    if (lasers[e.row] > 0) {
      lasers[e.row]--;
      fx.laser(level.homeX + 0.32, level.spawnX + 0.5, e.y);
      shake(0.3, 0.35);
      hitstop(0.08);
      for (const foe of [...enemies]) {
        if (foe.row !== e.row) continue;
        if (foe.def.boss) {
          foe.hp -= Math.ceil(foe.maxHp * 0.5);
          foe.x = Math.min(level.spawnX - 1, foe.x + 5);
          jolt(foe.rig, 0.5, 1);
          if (foe.hp <= 0) killEnemy(foe);
          else drawBar(foe);
        } else {
          killEnemy(foe);
        }
      }
      drawLasers();
      return;
    }
    const cost = e.def.boss ? 3 : 1;
    fx.strikeOut(level.homeX, e.y, 0.8, 1.2, look.pens.red);
    shake(0.25, 0.3);
    state.lives = Math.max(0, state.lives - cost);
    state.leaked++;
    events.push({ type: 'life', lives: state.lives });
    despawn(e);
    if (state.lives === 0) state.phase = 'lost';
  }

  // --- снаряди ---------------------------------------------------------------
  const shots: Shot[] = [];

  function shoot(a: Ally, target: LaneEnemy) {
    const y = rowY(band, a.row) - 0.55; // з висоти рук, не з-під ніг
    const g = fx.bolt(a.x + 0.4, y, 1);
    shots.push({ g, x: a.x + 0.4, y, speed: a.shot, ally: a, target });
    allyArt.get(a.id)?.rig.fire('attack');
  }

  function updateShots(dt: number) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.x += s.speed * dt;
      s.g.position.set(s.x, s.y);
      const alive = enemies.includes(s.target);
      if (alive && s.x >= s.target.x - 0.2) {
        const h = army.hitOf(s.ally, s.target);
        s.target.hp -= h.amount;
        fx.spark(s.x, s.y);
        jolt(s.target.rig, h.bonus ? 0.2 : 0.1, h.bonus ? 1 : 0.6);
        if (h.bonus) hitstop(0.035);
        fx.number(s.target.x, s.target.y - tall(s.target) - 0.2, h.amount, { bonus: h.bonus, penalty: h.penalty });
        if (s.target.hp <= 0) killEnemy(s.target);
        else drawBar(s.target);
      } else if (s.x < level.spawnX + 1.5) {
        // Ще летить. Ціль могла зникнути — риска однаково долітає до краю й
        // гасне там, а не блимає на місці.
        continue;
      }
      s.g.destroy();
      shots.splice(i, 1);
    }
  }

  // --- хвилі -----------------------------------------------------------------
  /** Наступна починається, коли поле чисте, а не за таймером: перерва — це час
   *  домалювати, і вкорочувати її автоматично нечесно. */
  function updateWaves(dt: number) {
    const w = waveOf(level, state.wave);

    if (state.phase === 'break') {
      state.breakLeft -= dt;
      if (state.breakLeft > 0) return;
      state.phase = 'wave';
      waveLeft = w.count;
      spawnTimer = 0;
      const last = !level.endless && state.wave === level.waves.length - 1;
      events.push({ type: 'wave', n: state.wave + 1, last });
      if (w.boss) {
        // Бос виходить першим і по центру, решта хвилі — за ним.
        spawnEnemy(Math.floor(band.rows / 2), w.boss, w.hp ?? 1);
        events.push({ type: 'boss' });
        spawnTimer = w.every * 1.5;
      }
      return;
    }

    if (waveLeft > 0) {
      spawnTimer -= dt;
      if (spawnTimer > 0) return;
      spawnEnemy(w.row ?? null, pickWeighted(w.mix, Math.random()), w.hp ?? 1);
      waveLeft--;
      spawnTimer = w.every;
      return;
    }

    if (enemies.length) return;
    if (!level.endless && state.wave + 1 >= level.waves.length) { state.phase = 'won'; return; }
    state.wave++;
    state.phase = 'break';
    state.breakLeft = level.waveBreak ?? 5;
    // Винагорода за пройдену хвилю — нова зброя чи будівля, і саме в перерві,
    // коли є час її роздивитись.
    refreshUnlocks();
  }

  // --- цикл ------------------------------------------------------------------
  let pulseT = 0;
  function update(dtMs: number) {
    const realDt = dtMs / 1000;
    // Хітстоп: бій і риги завмирають на мить, ефекти й тряска — ні.
    const frozen = freeze > 0;
    if (frozen) freeze = Math.max(0, freeze - realDt);
    const dt = frozen ? 0 : realDt;
    dtMs = dt * 1000;
    const over = state.phase === 'won' || state.phase === 'lost';

    if (!over) {
      updateWaves(dt);

      for (const ev of town.tick(dt, army.allies)) {
        const art = buildingArt.get(ev.building.id);
        if (!art) continue;
        if (ev.type === 'drop') {
          showDrop(ev.building, art);
        } else {
          art.rig.fire('attack');
          for (const t of ev.targets) {
            const y = rowY(band, t.row);
            fx.bless(t.x, y - 0.6);
            fx.number(t.x, y - 1.3, ev.amount, { color: look.pens.green, plus: true });
          }
        }
      }
      // Кузня перезарядилась — іскра має з'явитись сама, без чужого тапу.
      for (const b of town.buildings) {
        if (b.def.effect.type !== 'forge') continue;
        const art = buildingArt.get(b.id);
        if (art && b.ready !== !!art.readyG) redrawForge(b.row);
      }

      for (const ev of army.stepAllies(enemies, dt)) {
        if (ev.type === 'strike') {
          const foe = ev.foe as LaneEnemy;
          allyArt.get(ev.ally.id)?.rig.fire('attack');
          foe.rig.fire('hit');
          jolt(foe.rig, ev.bonus ? 0.28 : 0.15, ev.bonus ? 1 : 0.7);
          if (ev.bonus) { hitstop(0.05); shake(0.05, 0.12); }
          fx.number(foe.x, foe.y - tall(foe) - 0.2, ev.amount, { bonus: ev.bonus, penalty: ev.penalty });
          if (ev.killed) killEnemy(foe);
          else drawBar(foe);
        } else if (ev.type === 'shoot') {
          shoot(ev.ally, ev.foe as LaneEnemy);
        } else {
          allyArt.get(ev.ally.id)?.rig.fire('attack');
          for (const t of ev.targets) {
            const y = rowY(band, t.row);
            fx.bless(t.x, y - 0.6);
            fx.number(t.x, y - 1.3, ev.amount, { color: look.pens.green, plus: true });
          }
        }
      }

      for (const ev of army.stepFoes(enemies, dt, { obstacles: town.buildings, slowAt: town.slowAt })) {
        const foe = ev.foe as LaneEnemy;
        if (ev.type === 'hit') {
          foe.rig.fire('attack');
          const allyRigNow = allyArt.get(ev.ally.id)?.rig;
          allyRigNow?.fire('hit');
          jolt(allyRigNow, -0.14, 0.7);
          fx.number(ev.ally.x, rowY(band, ev.ally.row) - 1.5 * artK, ev.amount, { bonus: ev.amount > foe.def.damage });
          if (foe.def.boss || foe.def.cls === 'armored') shake(0.06, 0.12);
          if (ev.killed) {
            // Своїх закреслюємо синім: колір і тут каже, хто чий.
            fx.strikeOut(ev.ally.x, rowY(band, ev.ally.row) + 0.75, 1.0 * artK, 1.5 * artK, look.pens.blue);
            splat(ev.ally.x, rowY(band, ev.ally.row) + 0.4, 0.5, look.pens.blue);
            dropAlly(ev.ally);
          }
        } else if (ev.type === 'smash') {
          const b = ev.obstacle as Building;
          foe.rig.fire('attack');
          const art = buildingArt.get(b.id);
          art?.rig.fire('hit');
          jolt(art?.rig, 0, 0.5);
          fx.number(b.x, rowY(band, b.row) - b.def.size[1] / 2 - 0.4, ev.amount);
          if (town.damage(b, ev.amount)) {
            fx.strikeOut(b.x, rowY(band, b.row) + b.def.size[1] / 2, b.def.size[0], b.def.size[1], look.pens.blue);
            dropBuilding(b);
          } else if (art) {
            drawHp(b, art);
          }
        } else {
          leak(foe);
        }
      }

      updateShots(dt);

      for (const a of army.allies) {
        const art = allyArt.get(a.id);
        if (!art) continue;
        art.rig.moving = a.moving;
        art.rig.view.position.set(a.x, rowY(band, a.row));
      }
      for (const e of enemies) {
        e.rig.moving = e.moving;
        e.rig.view.position.set(e.x, e.y);
      }
      // Відкидання й стусан — лише малюнок: модель стоїть, де стояла.
      const base = layout.spriteScale * artK;
      for (const [rig, v] of vis) {
        if (v.kb === 0 && v.punch === 0) continue;
        rig.view.x += v.kb;
        rig.view.scale.set(base * v.extra * (1 + 0.16 * v.punch));
        v.kb *= Math.exp(-realDt * 14);
        v.punch *= Math.exp(-realDt * 12);
        if (Math.abs(v.kb) < 0.004) v.kb = 0;
        if (v.punch < 0.01) { v.punch = 0; rig.view.scale.set(base * v.extra); }
      }
      // Крапля над колодязем погойдується: живе, а не намальована.
      for (const art of buildingArt.values()) {
        art.t += dt;
        if (art.drop) art.drop.y += Math.sin(art.t * 3) * 0.004;
      }
    }

    fx.step(realDt);
    stepShake(realDt);
    stepSplats(realDt);
    pulseT += realDt;
    pulseG.alpha = 0.55 + 0.45 * Math.sin(pulseT * 5);
    drawPulse();
    for (const r of rigs) r.update(dtMs);
    units.children.sort((a, b) => a.y - b.y);
  }

  function rescale(s: number) {
    for (const r of rigs) r.setScale(s * artK * (vis.get(r)?.extra ?? 1));
  }

  function destroy() {
    for (const a of allyArt.values()) a.tex.destroy(true);
    for (const b of buildingArt.values()) b.tex.destroy(true);
    allyArt.clear();
    buildingArt.clear();
    shots.length = 0;
    rigs.length = 0;
    vis.clear();
    for (const c of [laneG, decals, glowG, pulseG, laserG, units, shotLayer]) {
      world.removeChild(c);
      c.destroy({ children: true });
    }
    world.position.set(layout.ox, layout.oy);
  }

  drawLanes();
  drawLasers();

  return {
    state, wallet, enemies, army, town, band, level, slotX, lasers,
    spawnEnemy, summon, build, plotAt, plotCenter, collectAt, dropAt, update, rescale,
    setSlotsActive(on) { if (on === slotsActive) return; slotsActive = on; drawGlow(); },
    setPlotsActive(on) { if (on === plotsActive) return; plotsActive = on; drawGlow(); },
    setFocusRow(row) { if (row === focusRow) return; focusRow = row; drawGlow(); },
    isUnlocked: (id) => unlocked.has(id),
    isBuildingUnlocked: (id) => unlockedB.has(id),
    takeUnlocks() { return newUnlocks.splice(0); },
    setGauge(at) { gaugeAt = at; },
    takeEvents() { return events.splice(0); },
    resize() { drawLanes(); drawGlow(); drawLasers(); },
    destroy,
  };
}
