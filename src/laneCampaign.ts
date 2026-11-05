// Кампанія режиму lane: сторінка за сторінкою, зірки, нескінченний режим.
//
// Сесія рівня — це гра, HUD і панель виклику. Між рівнями сесію прибирають і
// збирають нову на місці, без перезавантаження сторінки: SDK платформи живе
// далі, а між рівнями є природне місце для реклами (commercialBreak).
//
// Сюди ж — банери хвиль і боса, записка кінця сторінки, зошит зі сторінками
// й пауза через меню. Тексти — у strings.ts.

import type { Application, Container, Texture } from '../lib/pixi.min.mjs';
import { createLaneGame } from './laneGame.js';
import type { LaneGame } from './laneGame.js';
import { createLaneHud } from './controller/laneHud.js';
import type { LaneHud } from './controller/laneHud.js';
import { createSquadPanel } from './controller/squadPanel.js';
import type { SquadPanel } from './controller/squadPanel.js';
import { createLaneUi } from './controller/laneUi.js';
import { createCoachArt } from './view/coachArt.js';
import type { Btn } from './controller/laneUi.js';
import type { Shelf } from './controller/shelfDom.js';
import type { TracePad } from './controller/tracepad.js';
import {
  endlessLevel, endlessOpen, pageLevel, pageOpen, parseProgress, recordEndless, recordPage,
  resumePage, starsFor,
} from './model/campaign.js';
import type { CampaignData, Progress } from './model/campaign.js';
import { rowY } from './model/lane.js';
import type { LaneEnemies, LaneLevel } from './model/lane.js';
import type { WeaponsData } from './model/weapons.js';
import type { BuildingsData } from './model/buildings.js';
import { loadRaw, saveRaw } from './storage.js';
import { devMode } from './dev.js';
import { uk } from './strings.js';
import type { Balance, Layout, Look, Parts, RigDefs } from './types.js';

export interface CampaignDeps {
  app: Application;
  world: Container;
  hud: Container;
  look: Look;
  balance: Balance;
  rigDefs: RigDefs;
  parts: Parts;
  textures: Map<string, Texture>;
  layout: Layout;
  base: LaneLevel;
  weapons: WeaponsData;
  buildings: BuildingsData;
  enemyDefs: LaneEnemies;
  campaign: CampaignData;
  tracePad: TracePad;
  shelf: Shelf;
  sdk: { commercialBreak(): Promise<unknown> | void };
  /** шар навчання над рамкою обведення (екранні px) */
  coachLayer: Container;
  /** поставити або зняти паузу меню (вкладку стереже main) */
  pause(on: boolean): void;
}

export type Selection = { kind: 'page'; i: number } | { kind: 'endless' };

interface Session {
  game: LaneGame;
  hud: LaneHud;
  panel: SquadPanel;
}

export interface Campaign {
  update(dtMs: number): void;
  resize(L: Layout): void;
  /** Фаза для SDK: 'wave' — гравець у бою; 'menu' — на паузі в меню. */
  phase(): string;
  start(sel: Selection): void;
  readonly session: Session | null;
  readonly progress: Progress;
}

export function createCampaign(d: CampaignDeps): Campaign {
  const { campaign: C, weapons: W, buildings: B } = d;
  const progress = parseProgress(loadRaw());
  const save = () => saveRaw(JSON.stringify(progress));

  let s: Session | null = null;
  let sel: Selection = { kind: 'page', i: 0 };
  let ended = false, endTimer = 0, menuOpen = false;
  let announceAt = 0;
  /** Навчання на першій сторінці: де зараз стрілка. */
  type Coach = 'slot' | 'trace' | 'well' | 'drop' | 'laser' | 'done';
  let coach: Coach = 'done', coachT = 0, sawDrop = false;
  let pending: { id: string; kind: 'weapon' | 'building' }[] = [];
  const slow = d.base.slowWhileDrawing ?? 0.1;

  const ui = createLaneUi(() => openMenu());
  /** Навчання малюнками: рука й піктограми замість тексту. */
  const art = createCoachArt(d.coachLayer, d.look, B.buildings.well?.outline ?? []);
  const artUnit = () => Math.max(40, Math.min(110, d.layout.cell * 1.25));
  /** Дев-режим: усе відкрите (dev.ts). Прогрес однаково записується. */
  const dev = devMode();
  if (dev) ui.setBadge('DEV · усе відкрито · ?dev=0 — вимкнути');
  const isOpen = (i: number) => dev || pageOpen(C, progress, i);
  const endlessIsOpen = () => dev || endlessOpen(C, progress);

  function makeSession(level: LaneLevel, title: string): Session {
    const game = createLaneGame({
      world: d.world, renderer: d.app.renderer, look: d.look, level, weapons: W, buildings: B,
      enemyDefs: d.enemyDefs, balance: d.balance, rigDefs: d.rigDefs, parts: d.parts,
      textures: d.textures, layout: d.layout,
    });
    const hud = createLaneHud({ hud: d.hud, look: d.look, balance: d.balance, weapons: W, buildings: B, game });
    // Краплі чорнила летять у колбу ручки на полях: HUD знає, де вона.
    game.setGauge(() => hud.gaugeAt());
    const panel = createSquadPanel({
      canvas: d.app.canvas, app: d.app, hudLayer: d.hud, look: d.look, layout: d.layout, game,
      weapons: W, buildings: B, tracePad: d.tracePad, shelf: d.shelf, hud,
      blocked: () => d.tracePad.open || ui.open || menuOpen,
      title,
    });
    if (d.layout.w > 0) {
      hud.resize(d.layout);
      game.rescale(d.layout.spriteScale);
    }
    return { game, hud, panel };
  }

  function dispose() {
    d.tracePad.cancel();
    d.shelf.hide();
    if (!s) return;
    s.panel.destroy();
    s.hud.destroy();
    s.game.destroy();
    s = null;
  }

  function start(next: Selection) {
    ui.hide();
    dispose();
    sel = next;
    // Стрілки навчання — лише на першій сторінці й лише доки її не пройдено.
    coach = next.kind === 'page' && next.i === 0 && !(progress.stars[C.pages[0].id] > 0) ? 'slot' : 'done';
    coachT = 0;
    sawDrop = false;
    art.hide();
    pending = [];
    announceAt = 0;
    ended = false;
    endTimer = 0;
    menuOpen = false;
    d.pause(false);

    if (next.kind === 'page') {
      const p = C.pages[next.i];
      s = makeSession(pageLevel(d.base, C, next.i), `${uk.page(next.i + 1)} · ${p.title}`);
      ui.banner(uk.page(next.i + 1), p.title, 2200);
      // «Нове!» — записка на старті сторінки, що щось приносить. На першій
      // сторінці нового нічого немає: усе нове, і записки лише заважали б.
      if (next.i > 0) {
        announceAt = 2.3; // після банера сторінки, а не поверх нього
        pending = [
          ...(p.unlock?.weapons ?? []).map((id) => ({ id, kind: 'weapon' as const })),
          ...(p.unlock?.buildings ?? []).map((id) => ({ id, kind: 'building' as const })),
        ];
      }
    } else {
      s = makeSession(endlessLevel(d.base, C), `∞ ${uk.endless}`);
      ui.banner(`∞ ${uk.endless}`, progress.endlessBest ? uk.record(progress.endlessBest) : undefined, 2200);
    }
    ui.setMenu(true);
  }

  /** Між рівнями: реклама платформи (якщо вона вирішить її показати), потім старт. */
  async function go(next: Selection) {
    ui.hide();
    try { await d.sdk.commercialBreak(); } catch { /* реклама не має ламати гру */ }
    start(next);
  }

  const titleOf = (id: string) => W.weapons[id]?.title ?? B.buildings[id]?.title ?? id;

  function showPages(resume?: () => void) {
    ui.showPages({
      title: dev ? 'Зошит · DEV' : undefined,
      pages: C.pages.map((p, i) => ({ n: i + 1, title: p.title, stars: progress.stars[p.id] ?? 0, open: isOpen(i) })),
      endless: {
        open: endlessIsOpen(),
        label: endlessIsOpen()
          ? (progress.endlessBest ? uk.record(progress.endlessBest) : uk.endless)
          : uk.endlessLocked(C.pages.findIndex((p) => p.id === C.endless.after) + 1),
      },
      onPick: (i) => go({ kind: 'page', i }),
      onEndless: () => go({ kind: 'endless' }),
      onResume: resume,
    });
  }

  function openMenu() {
    if (!s || ended || menuOpen) return;
    d.tracePad.cancel();
    d.shelf.hide();
    menuOpen = true;
    d.pause(true);
    ui.setMenu(false);
    showPages(() => {
      ui.hide();
      menuOpen = false;
      d.pause(false);
      ui.setMenu(true);
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menuOpen) { ui.hide(); menuOpen = false; d.pause(false); ui.setMenu(true); }
    else openMenu();
  });

  /**
   * Навчання показом: рука тапає туди, куди треба, обводить трафарет сама,
   * піктограми пояснюють колодязь і лазер. Жодного слова — малюнок однаковий
   * для всіх мов. Кроки йдуть за тим, що гравець справді зробив: намалював
   * бійця → колодязь → забрав краплю → комікс про лазер.
   */
  function stepCoach(dt: number) {
    art.resize(artUnit());
    art.tick(dt);
    if (!s || coach === 'done' || ended || menuOpen) { art.hide(); return; }
    const g = s.game, L = d.layout, pad = d.tracePad;
    const sx = (cx: number) => L.ox + cx * L.cell, sy = (cy: number) => L.oy + cy * L.cell;
    const mid = Math.floor(g.band.rows / 2);
    const hasWell = g.town.buildings.some((b) => b.def.effect.type === 'well');

    if (coach === 'slot' || coach === 'trace') {
      if (g.army.allies.length) { coach = 'well'; coachT = 0; }
      else if (pad.open) coach = 'trace';
      else if (coach === 'trace') {
        // Рамка закрилась: або обведене летить на місце (юніт за мить), або передумав.
        coachT += dt;
        if (coachT > 0.8) { coach = 'slot'; coachT = 0; }
        art.hide();
        return;
      }
    }
    if (coach === 'well' && hasWell) coach = 'drop';

    switch (coach) {
      case 'slot':
        art.picto(null);
        art.tap(sx(g.slotX), sy(rowY(g.band, mid)));
        return;
      case 'trace': {
        coachT = 0;
        art.picto(null);
        // Почав вести сам — показ більше не заважає.
        if (pad.drawn) { art.hideHand(); return; }
        const b = pad.box;
        const outline = W.weapons[s.panel.tool]?.outline ?? [];
        art.trace(outline.map((st) => st.map(([x, y]): [number, number] => [b.x + x * b.side, b.y + y * b.side])));
        return;
      }
      case 'well': {
        if (pad.open) {
          // Обводить колодязь — показуємо, як, поки не почав сам.
          art.picto(null);
          if (pad.drawn) { art.hideHand(); return; }
          const b = pad.box;
          art.trace((B.buildings.well?.outline ?? []).map((st) => st.map(([x, y]): [number, number] => [b.x + x * b.side, b.y + y * b.side])));
          return;
        }
        const col = [0, 1, 2].find((c) => !g.town.at(mid, c)) ?? 0;
        const [cx, cy] = g.plotCenter(mid, col);
        art.tap(sx(cx), sy(cy));
        // Праворуч на межі рядів: там, де щойно намальований боєць уже пройшов.
        art.picto('well', sx(cx + 2.6), sy(cy - (g.band.y1 - g.band.y0) / g.band.rows * 0.5));
        return;
      }
      case 'drop': {
        art.picto(null);
        const p = g.dropAt();
        if (!p) {
          art.hideHand();
          if (sawDrop) { coach = 'laser'; coachT = 6; }
          return;
        }
        sawDrop = true;
        art.tap(sx(p[0]), sy(p[1]));
        return;
      }
      case 'laser':
        coachT -= dt;
        art.hideHand();
        if (coachT <= 0) { coach = 'done'; art.hide(); return; }
        art.picto('laser', sx(g.level.homeX + 1.1), sy(g.band.y0 + 0.75));
        return;
    }
  }

  function finish() {
    if (!s) return;
    const st = s.game.state;
    d.tracePad.cancel();
    d.shelf.hide();
    ui.setMenu(false);
    const pagesBtn: Btn = { label: uk.pages, onClick: () => showPages() };

    if (sel.kind === 'endless') {
      const reached = st.wave + 1;
      const rec = recordEndless(progress, reached);
      save();
      ui.showEnd({
        win: false, title: uk.endlessTitle,
        lines: [uk.endlessReached(reached), rec ? uk.newRecord : uk.record(progress.endlessBest)],
        buttons: [{ label: uk.retry, primary: true, onClick: () => go({ kind: 'endless' }) }, pagesBtn],
      });
      return;
    }

    const i = sel.i;
    const page = C.pages[i];
    if (st.phase === 'won') {
      const stars = starsFor(st.lives, st.maxLives);
      const hadEndless = endlessOpen(C, progress);
      recordPage(progress, page.id, stars);
      save();
      const lines = [st.lives >= st.maxLives ? uk.noLoss : uk.lost(st.maxLives - st.lives)];
      const nextI = i + 1;
      const last = nextI >= C.pages.length;
      if (!last) {
        const np = C.pages[nextI];
        const items = [...(np.unlock?.weapons ?? []), ...(np.unlock?.buildings ?? [])].map(titleOf);
        lines.push(uk.nextTeaser(np.title, items));
      }
      if (!hadEndless && endlessOpen(C, progress)) lines.push(uk.endlessUnlocked);
      const buttons: Btn[] = last
        ? [{ label: `∞ ${uk.endless}`, primary: true, onClick: () => go({ kind: 'endless' }) }, pagesBtn]
        : [
          { label: uk.next, primary: true, onClick: () => go({ kind: 'page', i: nextI }) },
          { label: uk.retry, onClick: () => go({ kind: 'page', i }) },
          pagesBtn,
        ];
      ui.showEnd({ win: true, title: last ? uk.bookDone : uk.winTitle, stars, lines, buttons });
    } else {
      const tip = uk.tips[Math.floor(Math.random() * uk.tips.length)];
      ui.showEnd({
        win: false, title: uk.loseTitle,
        lines: [uk.reached(Math.min(st.wave + 1, st.waves), st.waves), tip],
        buttons: [{ label: uk.retry, primary: true, onClick: () => go({ kind: 'page', i }) }, pagesBtn],
      });
    }
  }

  return {
    update(dtMs) {
      if (!s) return;
      const g = s.game;
      g.update(d.tracePad.open ? dtMs * slow : dtMs);
      s.panel.update(dtMs / 1000);
      if (d.tracePad.open) ui.clearBanner();
      s.hud.tick(dtMs / 1000);
      stepCoach(dtMs / 1000);

      if (pending.length && announceAt > 0) {
        announceAt -= dtMs / 1000;
        if (announceAt <= 0) { s.hud.announce(pending); pending = []; }
      }

      const evs = g.takeEvents();
      const boss = evs.some((e) => e.type === 'boss');
      for (const ev of evs) {
        if (ev.type === 'wave' && !boss) ui.banner(ev.last ? uk.lastWave : uk.wave(ev.n), undefined, 1500);
        else if (ev.type === 'boss') ui.banner(uk.boss, uk.bossSub, 2400);
        else if (ev.type === 'life') s.hud.flashLives();
      }

      const over = g.state.phase === 'won' || g.state.phase === 'lost';
      if (over && !ended) {
        ended = true;
        endTimer = 1.1; // дати кадру з останнім закресленням дограти
        d.tracePad.cancel();
      }
      if (ended && endTimer > 0) {
        endTimer -= dtMs / 1000;
        if (endTimer <= 0) finish();
      }
    },

    resize(L) {
      if (!s) return;
      s.game.rescale(L.spriteScale);
      s.game.resize();
      s.hud.resize(L);
    },

    phase() {
      if (menuOpen || !s) return 'menu';
      return s.game.state.phase;
    },

    start,
    get session() { return s; },
    progress,
  };
}

/** З чого почати: ?page=N чи ?endless у адресі (розробка), інакше перша непройдена. */
export function initialSelection(C: CampaignData, p: Progress): Selection {
  const q = new URLSearchParams(location.search);
  if (q.has('endless')) return { kind: 'endless' };
  const n = Number(q.get('page'));
  if (Number.isInteger(n) && n >= 1 && n <= C.pages.length) return { kind: 'page', i: n - 1 };
  return { kind: 'page', i: resumePage(C, p) };
}
