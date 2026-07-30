// Boot і розкладка.
//
// Одиниця світу = одна клітинка зошита. Уся механіка (траса, радіуси, швидкості)
// живе в клітинках, тому геймплей однаковий на будь-якому екрані.
//
// Ядро core.cols × core.rows видно завжди: клітинка = min(W/cols, H/rows).
// Земля просто продовжується за ядро й заповнює екран — летербоксу немає, у
// ландскейпі по боках виходять широкі газони, на яких теж можна будувати.
// Малюнок персонажа при дрібній клітинці масштабується окремо від хітбокса,
// щоб морди читалися й на вузькому екрані.

import { Application, Graphics } from '../lib/pixi.min.mjs';
import { createPaper } from './paper.js';
import { createBoil, inkContainer } from './ink.js';
import { bakeParts } from './procart.js';
import { buildRig } from './rig.js';

const [look, parts, rigDefs] = await Promise.all([
  fetch('./data/look.json').then((r) => r.json()),
  fetch('./data/parts.json').then((r) => r.json()),
  fetch('./data/rigs.json').then((r) => r.json()),
]);

const app = new Application();
await app.init({
  resizeTo: window,
  antialias: true,
  background: '#1b1917',
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
});
document.getElementById('app').appendChild(app.canvas);

const layout = {
  w: 0, h: 0,
  cell: look.sprite.refCell, // px на клітинку
  ox: 0, oy: 0,              // екранні координати клітинки (0,0) ядра
  spriteScale: 1,
  land: { x0: 0, y0: 0, x1: 0, y1: 0 }, // межі землі в клітинках
};

const paper = createPaper(app, look);

// Boil тремтить лише чорнилом: якщо накрити ним папір — попливе клітинка.
const boil = createBoil(look);

const world = inkContainer([boil.filter]); // чорнило, одиниця = клітинка
const hud = inkContainer();                // нотатки на полях, екранні пікселі

app.stage.addChild(paper.base, world, paper.overlay, hud, boil.sprite);

const textures = bakeParts(app.renderer, parts, look);
const actors = [];

function spawn(rigId, x, y) {
  const rig = buildRig(rigDefs[rigId], textures, parts, look);
  rig.view.position.set(x, y);
  rig.setScale(layout.spriteScale);
  world.addChild(rig.view);
  actors.push(rig);
  return rig;
}

const debug = new URLSearchParams(location.search).has('debug');
const debugRect = new Graphics();
if (debug) world.addChild(debugRect);

function relayout() {
  const w = app.screen.width, h = app.screen.height;
  const { cols, rows } = look.core;

  const cell = Math.min(w / cols, h / rows);
  const ox = Math.round((w - cols * cell) / 2);
  const oy = Math.round((h - rows * cell) / 2);

  layout.w = w;
  layout.h = h;
  layout.cell = cell;
  layout.ox = ox;
  layout.oy = oy;
  // Дрібна клітинка — малюнок більший за хітбокс, інакше морди зникають.
  layout.spriteScale = Math.min(look.sprite.maxScale, Math.max(1, look.sprite.refCell / cell));
  layout.land = { x0: -ox / cell, y0: -oy / cell, x1: cols + ox / cell, y1: rows + oy / cell };

  world.scale.set(cell);
  world.position.set(ox, oy);
  paper.resize(layout);
  boil.resize(w, h);
  for (const a of actors) a.setScale(layout.spriteScale);

  if (debug) {
    debugRect.clear()
      .rect(0, 0, cols, rows)
      .stroke({ width: 2 / cell, color: 0xff00ff, alpha: 0.45 });
  }
}

// Пауза, коли вкладку сховали (вимога Poki та CrazyGames), зупиняє ЛОГІКУ, а не
// рендер: якщо гасити тікер, у канвасі лишається мертвий кадр.
const state = { paused: false };
document.addEventListener('visibilitychange', () => { state.paused = document.hidden; });

const systems = []; // (dtMs) => void, отримують 0 на паузі

app.ticker.add(({ deltaMS }) => {
  const dt = state.paused ? 0 : deltaMS;
  paper.tick(deltaMS);
  boil.tick(dt);
  for (const s of systems) s(dt);
});

systems.push((dt) => { for (const a of actors) a.update(dt); });

// --- сцена кроку 3: персонажі просто стоять і дихають ----------------------
// Порядок спавну = порядок відмальовки, тому спершу далеке, потім близьке.
for (const [x, y] of [[1.2, 3.4], [13.6, 5.1], [0.9, 12.8], [14.1, 15.6], [2.1, 21.4], [12.9, 22.8]]) {
  spawn('tree', x, y);
}
for (const [x, y] of [[3.6, 2.2], [11.4, 9.4], [1.6, 17.2], [13.2, 19.1]]) {
  spawn('bush', x, y);
}

spawn('earling', 5.0, 5.0);
spawn('earling', 9.4, 7.6);
spawn('earling', 7.2, 11.2);

spawn('magic_tower', 4.4, 17.4);
spawn('cannon', 10.6, 17.4);
spawn('keep', 7.5, 23.4);

relayout();
app.renderer.on('resize', relayout);

window.__td = { app, look, layout, world, hud, paper, state, systems, actors, textures, spawn };
