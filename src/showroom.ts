// Шоурум ворогів: усі варіанти кожної ролі на одному аркуші, живі.
//
// Власник обирає форму для кожної ролі (звичайний, швидкий, броньований, бос).
// Вибір зберігається в localStorage (picks.ts), і гра одразу бере обране —
// без правки файлів. Остаточний вибір потім переноситься в laneEnemies.json.
//
// Аркуш і перо ті самі, що в грі (paper, boil, bakeParts, buildRig): що бачиш
// тут, те й побачиш у бою. Картки — DOM (назви, кнопки), істоти — Pixi, які
// стають у прямокутники карток.

import { Application, Container } from '../lib/pixi.min.mjs';
import { createPaper } from './view/paper.js';
import { createBoil, inkContainer } from './view/ink.js';
import { bakeParts } from './view/procart.js';
import { buildRig } from './view/rig.js';
import { loadPicks, savePicks } from './picks.js';
import type { Picks } from './picks.js';
import type { Layout, Look, Parts, Rig, RigDefs } from './types.js';

interface Option { rig: string; name: string }
interface Role { role: string; title: string; hint: string; options: Option[] }
interface Roster { roles: Role[] }

const [look, parts, rigDefs, roster, enemies] = await Promise.all([
  fetch('./data/look.json').then((r) => r.json()),
  fetch('./data/parts.json').then((r) => r.json()),
  fetch('./data/rigs.json').then((r) => r.json()),
  fetch('./data/bestiary.json').then((r) => r.json()),
  fetch('./data/laneEnemies.json').then((r) => r.json()),
]) as [Look, Parts, RigDefs, Roster, Record<string, { rig: string }>];

const app = new Application();
await app.init({
  resizeTo: window, antialias: true, background: '#1b1917',
  resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
});
document.getElementById('app')!.appendChild(app.canvas);

const paper = createPaper(app, look);
const boil = createBoil(look);
const world = inkContainer([boil.filter]);
app.stage.addChild(paper.base, world, paper.overlay, boil.sprite);
const textures = bakeParts(app.renderer, parts, look);

const picks: Picks = loadPicks();
const chosen = (role: string) => picks[role] ?? enemies[role]?.rig;

// --- DOM ------------------------------------------------------------------------
const tabs = document.getElementById('tabs')!;
const grid = document.getElementById('grid')!;
const hint = document.getElementById('hint')!;
const walkBtn = document.getElementById('walk') as HTMLButtonElement;
const summary = document.getElementById('summary')!;

let roleIdx = 0;
let walking = true;

interface Shown { rig: Rig; stage: HTMLElement; opt: Option }
let shown: Shown[] = [];

function renderSummary() {
  summary.textContent = roster.roles
    .map((r) => `${r.title}: ${r.options.find((o) => o.rig === chosen(r.role))?.name ?? '—'}`)
    .join(' · ');
}

function renderTabs() {
  tabs.replaceChildren(...roster.roles.map((r, i) => {
    const b = document.createElement('button');
    b.className = i === roleIdx ? 'tab on' : 'tab';
    b.textContent = r.title;
    b.addEventListener('click', () => { roleIdx = i; show(); });
    return b;
  }));
}

/** Розставити Pixi-істот у прямокутники карток: масштаб — щоб уся істота влізла. */
function place() {
  for (const s of shown) {
    const r = s.stage.getBoundingClientRect();
    s.rig.setScale(1);
    s.rig.update(0);
    const b = s.rig.view.getLocalBounds();
    // Вписати з запасом на замах і погойдування; низ істоти — трохи вище підвалу картки.
    const k = Math.min((r.width * 0.72) / b.width, (r.height * 0.62) / b.height, 260);
    s.rig.setScale(k);
    s.rig.view.position.set(
      r.left + r.width / 2 - (b.x + b.width / 2) * k,
      r.top + r.height * 0.86 - (b.y + b.height) * k,
    );
  }
}

function show() {
  for (const s of shown) s.rig.view.destroy({ children: true });
  shown = [];
  renderTabs();
  const role = roster.roles[roleIdx];
  hint.textContent = role.hint;
  grid.replaceChildren();
  for (const opt of role.options) {
    const def = rigDefs[opt.rig];
    if (!def) continue;
    const card = document.createElement('div');
    card.className = chosen(role.role) === opt.rig ? 'card picked' : 'card';
    const stage = document.createElement('div');
    stage.className = 'stage';
    const foot = document.createElement('div');
    foot.className = 'foot';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = opt.name;
    const hit = document.createElement('button');
    hit.className = 'btn';
    hit.textContent = 'Удар';
    const pick = document.createElement('button');
    pick.className = 'btn pick';
    pick.textContent = chosen(role.role) === opt.rig ? 'Обрано ✓' : 'Обрати';
    foot.append(name, hit, pick);
    card.append(stage, foot);
    grid.append(card);

    const rig = buildRig(def, textures, parts, look);
    world.addChild(rig.view);
    const s: Shown = { rig, stage, opt };
    shown.push(s);
    const strike = () => rig.fire('attack');
    stage.addEventListener('pointerdown', strike);
    hit.addEventListener('click', strike);
    pick.addEventListener('click', () => {
      picks[role.role] = opt.rig;
      savePicks(picks);
      show();
    });
  }
  renderSummary();
  // DOM уже розкладено — ставимо істот у картки.
  requestAnimationFrame(place);
}

walkBtn.addEventListener('click', () => {
  walking = !walking;
  walkBtn.textContent = walking ? 'Крокують' : 'Стоять';
});
document.getElementById('reset')!.addEventListener('click', () => {
  for (const k of Object.keys(picks)) delete picks[k];
  savePicks(picks);
  show();
});

function layoutNow() {
  const w = app.screen.width, h = app.screen.height;
  const L: Layout = {
    w, h, cell: look.grid.cell, ox: 0, oy: 0, spriteScale: 1,
    land: { x0: 0, y0: 0, x1: w / look.grid.cell, y1: h / look.grid.cell },
  };
  paper.resize(L);
  boil.resize(w, h);
  place();
}
app.renderer.on('resize', layoutNow);

app.ticker.add(({ deltaMS }) => {
  paper.tick(deltaMS);
  boil.tick(deltaMS);
  for (const s of shown) {
    s.rig.moving = walking;
    s.rig.update(deltaMS);
  }
});

layoutNow();
show();

declare global { interface Window { __showroom?: unknown } }
window.__showroom = { app, shown: () => shown, picks, show, place };
