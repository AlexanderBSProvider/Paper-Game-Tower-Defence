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
import { createGame } from './game.js';
import { createTools } from './tools.js';

const [look, parts, rigDefs, level, balance] = await Promise.all([
  fetch('./data/look.json').then((r) => r.json()),
  fetch('./data/parts.json').then((r) => r.json()),
  fetch('./data/rigs.json').then((r) => r.json()),
  fetch('./data/level.json').then((r) => r.json()),
  fetch('./data/balance.json').then((r) => r.json()),
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
const game = createGame({ world, look, level, balance, rigDefs, parts, textures, layout });
const tools = createTools({ app, canvas: app.canvas, world, layout, game, look, balance });

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
  game.rescale(layout.spriteScale);

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

systems.push((dt) => game.update(dt));

relayout();
app.renderer.on('resize', relayout);

window.__td = { app, look, layout, world, hud, paper, state, systems, game, tools, textures };
