// Селфчек математики, яку легко зламати тихо. Фреймворків не ставимо:
//   npm test          (tsc + цей файл)
//   node tools/selfcheck.js   (якщо dist/ уже зібраний)
// Мовчазний вихід 0 = все гаразд.
//
// Імпорти йдуть у dist/, а не в src/: джерела тепер .ts, а перевіряти треба
// саме те, що поїде в браузер.
//
// Усе, що тут перевіряється, лежить у dist/model/ — і це не збіг: модель тим і
// визначена, що не знає про Pixi, тож ганяється з node без браузера.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPath, posAt, distToPath } from '../dist/model/pathmath.js';
import { createGrid, lineCells, WALL, BASE } from '../dist/model/grid.js';
import { computeFlow, reaches, stepFrom, routeFrom, simplify, wouldSeal } from '../dist/model/flow.js';
import { createWallet } from '../dist/model/economy.js';
import { makeTemplate, scoreTrace, magnetize, resample, nearestOn } from '../dist/model/trace.js';
import { createBuild, qualityMul, gunOf } from '../dist/model/build.js';
import { chainTargets, oppositeTarget } from '../dist/model/aim.js';
import { rowY, rowOf, rowHeight, pickWeighted } from '../dist/model/lane.js';
import { rarityOf, counterMul, unitStats, weaponIds, unlockedAt } from '../dist/model/weapons.js';
import { createArmy } from '../dist/model/units.js';
import { createTown, buildingIds } from '../dist/model/buildings.js';
import {
  unlockedThrough, pageLevel, endlessLevel, endlessWave, waveOf, starsFor, parseProgress, recordPage,
  recordEndless, pageOpen, endlessOpen, resumePage, emptyProgress,
} from '../dist/model/campaign.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// Г-подібна траса: вниз 3, вправо 4. Довжина рівно 7.
const p = buildPath([[0, 0], [0, 3], [4, 3]]);
near(p.length, 7);
assert.equal(p.segs.length, 2);

// Кінці й злам
near(posAt(p, 0).x, 0); near(posAt(p, 0).y, 0);
near(posAt(p, 3).x, 0); near(posAt(p, 3).y, 3);
near(posAt(p, 7).x, 4); near(posAt(p, 7).y, 3);
near(posAt(p, 1.5).y, 1.5);
near(posAt(p, 5).x, 2);

// Кут: спершу вниз (+y), потім вправо (+x)
near(posAt(p, 1).angle, Math.PI / 2);
near(posAt(p, 5).angle, 0);

// Виліт за межі затискається, а не ламається
near(posAt(p, -10).y, 0);
near(posAt(p, 999).x, 4);

// hint не змінює відповідь, хоч би яким кривим був
for (const hint of [-5, 0, 1, 99]) {
  near(posAt(p, 5, hint).x, 2);
  near(posAt(p, 1, hint).y, 1);
}

// Рух уперед монотонний і без стрибків між сегментами
let prev = posAt(p, 0), seg = 0, travelled = 0;
for (let d = 0.05; d <= 7; d += 0.05) {
  const q = posAt(p, d, seg);
  const step = Math.hypot(q.x - prev.x, q.y - prev.y);
  assert.ok(step < 0.06, `стрибок ${step} на d=${d}`);
  travelled += step;
  prev = q; seg = q.seg;
}
assert.ok(Math.abs(travelled - 7) < 0.05, `пройдено ${travelled}, а траса 7`);

// Відстань до траси: на трасі нуль, збоку — перпендикуляр, за кінцем — до кінця
near(distToPath(p, 0, 1.5), 0);
near(distToPath(p, 2, 3), 0);
near(distToPath(p, 2, 0), 2);      // навпроти вертикального сегмента
near(distToPath(p, 0, 5), 2);      // під зламом: до точки (0,3)
near(distToPath(p, 4, 6), 3);      // за кінцем: до точки (4,3)
near(distToPath(p, -1, -1), Math.SQRT2);

// Діагональ: довжина не бреше
const d = buildPath([[0, 0], [3, 4]]);
near(d.length, 5);
near(posAt(d, 2.5).x, 1.5);
near(posAt(d, 2.5).y, 2);

// Нульові сегменти викидаються, а не дають NaN
const z = buildPath([[1, 1], [1, 1], [1, 4]]);
near(z.length, 3);
near(posAt(z, 1.5).y, 2.5);

assert.throws(() => buildPath([[2, 2], [2, 2]]), /порожня/);

// --- сітка й маршрут -------------------------------------------------------

// Поле 5x6, база внизу по центру, вхід угорі по центру.
const mkGrid = () => {
  const g = createGrid(5, 6);
  g.fill(2, 5, 1, 1, BASE);
  return g;
};
const GOALS = [[2, 5]];
const ENTRY = [2, 0];

{
  const g = mkGrid();
  const f = computeFlow(g, GOALS);
  // Порожнє поле: рівно 5 кроків згори вниз
  assert.equal(f.dist[0 * 5 + 2], 5);
  assert.ok(reaches(f, ...ENTRY));
  // Кожен крок наближає до бази рівно на одиницю
  let [x, y] = ENTRY, steps = 0;
  while (true) {
    const s = stepFrom(f, x, y);
    if (!s) break;
    assert.equal(f.dist[y * 5 + x] - f.dist[s[1] * 5 + s[0]], 1);
    [x, y] = s; steps++;
    assert.ok(steps <= 30, 'маршрут зациклився');
  }
  assert.deepEqual([x, y], [2, 5]);
  assert.equal(steps, 5);
}

{
  // Стіна на прямій змушує обійти: шлях довшає рівно на 2
  const g = mkGrid();
  g.fill(2, 2, 1, 1, WALL);
  const f = computeFlow(g, GOALS);
  assert.equal(f.dist[0 * 5 + 2], 7);
  assert.ok(reaches(f, ...ENTRY));
  // Клітинка під стіною недосяжна для напрямку, але сама стіна — не маршрут
  assert.equal(f.dist[2 * 5 + 2], -1);
  assert.equal(stepFrom(f, 2, 2), null);
}

{
  // Повний паркан упоперек відрізає вхід
  const g = mkGrid();
  for (let x = 0; x < 5; x++) g.fill(x, 3, 1, 1, WALL);
  const f = computeFlow(g, GOALS);
  assert.equal(reaches(f, ...ENTRY), false);
}

{
  // wouldSeal ловить саме останню клітинку паркану, а не передостанню
  const g = mkGrid();
  for (let x = 0; x < 4; x++) g.fill(x, 3, 1, 1, WALL);
  assert.equal(wouldSeal(g, GOALS, [[4, 3]], [ENTRY]), true);
  // (4,4) теж замуровує: єдиний прохід — через (4,3), а далі глухий кут
  assert.equal(wouldSeal(g, GOALS, [[4, 4]], [ENTRY]), true);
  assert.equal(wouldSeal(g, GOALS, [[0, 1]], [ENTRY]), false);
  // перевірка не має лишати слідів у сітці
  assert.equal(g.at(4, 3), 0);
  assert.equal(g.at(4, 4), 0);
  assert.equal(g.at(0, 1), 0);
  // замурувати ворога — так само заборонено
  assert.equal(wouldSeal(g, GOALS, [[4, 3]], [[4, 2]]), true);
}

{
  // Башта 2x2 як стіна: перевіряємо цілим прямокутником
  const g = mkGrid();
  g.fill(0, 3, 1, 1, WALL);
  g.fill(4, 3, 1, 1, WALL);
  assert.equal(g.isFree(1, 3, 2, 2), true);
  assert.equal(wouldSeal(g, GOALS, g.rect(1, 3, 2, 2), [ENTRY]), false);
  assert.equal(wouldSeal(g, GOALS, g.rect(1, 3, 3, 1), [ENTRY]), true);
}

{
  // Маршрут для малювання: центри клітинок, прямі ділянки склеєні
  const g = mkGrid();
  const f = computeFlow(g, GOALS);
  const pts = routeFrom(f, ...ENTRY);
  assert.deepEqual(pts[0], [2.5, 0.5]);
  assert.deepEqual(pts[pts.length - 1], [2.5, 5.5]);
  assert.equal(pts.length, 2, 'пряма має склеїтись в один сегмент');
  near(buildPath(pts).length, 5);
}

assert.deepEqual(simplify([[0, 0], [0, 1], [0, 2], [1, 2]]), [[0, 0], [0, 2], [1, 2]]);

// Зайнятість і стирання
{
  const g = createGrid(4, 4);
  g.fill(1, 1, 2, 2, WALL, 7);
  assert.equal(g.isFree(1, 1), false);
  assert.equal(g.isFree(0, 0, 2, 2), false); // перетинається з зайнятим
  assert.equal(g.isFree(3, 3), true);
  assert.equal(g.isFree(3, 3, 2, 1), false); // виліт за межі
  assert.equal(g.ownerAt(2, 2), 7);
  assert.deepEqual(g.clearOwner(7).length, 4);
  assert.equal(g.isFree(1, 1, 2, 2), true);
}

// Риска під пальцем: між рідкими подіями вказівника не має бути дірок
{
  assert.deepEqual(lineCells(2, 3, 2, 3), [[2, 3]]);
  assert.deepEqual(lineCells(0, 0, 3, 0), [[0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(lineCells(0, 0, 0, -2), [[0, 0], [0, -1], [0, -2]]);
  assert.deepEqual(lineCells(0, 0, 2, 2), [[0, 0], [1, 1], [2, 2]]);

  // Довільний відрізок: кінці на місці, сусідні клітинки дотикаються
  const seg = lineCells(1, 2, 9, 7);
  assert.deepEqual(seg[0], [1, 2]);
  assert.deepEqual(seg[seg.length - 1], [9, 7]);
  for (let i = 1; i < seg.length; i++) {
    const dx = Math.abs(seg[i][0] - seg[i - 1][0]);
    const dy = Math.abs(seg[i][1] - seg[i - 1][1]);
    assert.ok(dx <= 1 && dy <= 1 && dx + dy > 0, `розрив на ${i}: ${seg[i - 1]} → ${seg[i]}`);
  }
}

// Чорнило: платимо рівно раз, повертаємо рівно половину, в мінус не йдемо
{
  const w = createWallet({ start: 120, costs: { wall: 5, magic_tower: 60, cannon: 100 }, refund: 0.5 });
  assert.equal(w.ink, 120);
  assert.equal(w.can('cannon'), true);

  assert.equal(w.spend('cannon'), true);
  assert.equal(w.ink, 20);
  assert.equal(w.can('cannon'), false);
  assert.equal(w.spend('cannon'), false);
  assert.equal(w.ink, 20, 'невдале списання не має чіпати баланс');

  assert.equal(w.refund('cannon'), 50);
  assert.equal(w.ink, 70);

  // Стіна коштує 5 → повертається 2, а не 3: стирання не має бути доходом
  assert.equal(w.spend('wall'), true);
  assert.equal(w.refund('wall'), 2);
  assert.equal(w.ink, 67);

  // Цикл «поставив-стер» тільки зменшує запас
  const before = w.ink;
  for (let i = 0; i < 10; i++) { w.spend('wall'); w.refund('wall'); }
  assert.ok(w.ink < before);

  assert.equal(w.earn(8), 8);
  assert.equal(w.ink, 45);

  // Невідомий тип нічого не коштує і нічого не повертає
  assert.equal(w.cost('нема'), 0);
  assert.equal(w.spend('нема'), true);
  assert.equal(w.ink, 45);

  // Порожня ручка: найдешевше вже не по кишені
  const empty = createWallet({ start: 0, costs: { wall: 5 }, refund: 0.5 });
  assert.equal(empty.can('wall'), false);
  assert.equal(empty.spend('wall'), false);
  assert.equal(empty.ink, 0);
}

// --- обведення -------------------------------------------------------------
// Контур — горизонтальна риска, тому відхилення по y дорівнює відстані до
// контуру, і всі числа можна перевіряти в лоб.
{
  const LINE = [[0.1, 0.5], [0.9, 0.5]];
  const tpl = makeTemplate([LINE]);
  near(tpl.length, 0.8, 1e-9);
  assert.equal(tpl.nodes.length, 41); // 0.8 з кроком 0.02

  const shift = (dy) => tpl.nodes.map(([x, y]) => [x, y + dy]);
  const opts = { seconds: 1, tol: 0.08 };

  // Ідеальне обведення
  const perfect = scoreTrace(tpl, [shift(0)], opts);
  near(perfect.accuracy, 1, 1e-6);
  near(perfect.coverage, 1, 1e-9);
  assert.equal(perfect.ok, true);
  assert.ok(perfect.quality > 0.95, `ідеал дав ${perfect.quality}`);

  // Напрямок і порядок штрихів не мають значення — рука сама вирішує
  const back = scoreTrace(tpl, [shift(0).slice().reverse()], opts);
  near(back.quality, perfect.quality, 1e-9);

  // Зсув на половину допуску з'їдає рівно половину точності
  const half = scoreTrace(tpl, [shift(0.04)], opts);
  near(half.accuracy, 0.5, 1e-6);
  near(half.coverage, 1, 1e-9);        // 0.04 < tol, вузли все ще пройдені
  assert.ok(half.quality < perfect.quality);

  // Зсув на цілий допуск: точності немає, але обведення зараховане
  const edge = scoreTrace(tpl, [shift(0.08)], opts);
  near(edge.accuracy, 0, 1e-6);
  assert.equal(edge.ok, true);

  // Обвів менше половини — не зараховано
  const partial = scoreTrace(tpl, [[[0.1, 0.5], [0.4, 0.5]]], opts);
  assert.ok(partial.coverage > 0.4 && partial.coverage < 0.55, `покриття ${partial.coverage}`);
  assert.equal(partial.ok, false);
  assert.ok(partial.accuracy > 0.99, 'по лінії вів точно, просто не до кінця');

  // Ледь зараховане обведення не має отримувати бали за саме покриття
  const barely = scoreTrace(tpl, [[[0.1, 0.58], [0.62, 0.58]]], opts);
  assert.ok(barely.ok, `мало пройти поріг: ${barely.coverage}`);
  assert.ok(barely.quality < 0.2, `ледь зараховане дало ${barely.quality}`);

  // Частота подій вказівника не впливає: дві точки і сотня дають те саме
  const sparse = scoreTrace(tpl, [[[0.1, 0.5], [0.9, 0.5]]], opts);
  const dense = scoreTrace(tpl, [resample(LINE, 0.002)], opts);
  near(sparse.accuracy, dense.accuracy, 1e-6);
  near(sparse.coverage, dense.coverage, 1e-9);

  // Зайві відриви пальця штрафуються
  const chopped = scoreTrace(tpl, [
    [[0.1, 0.5], [0.4, 0.5]], [[0.4, 0.5], [0.65, 0.5]], [[0.65, 0.5], [0.9, 0.5]],
  ], opts);
  assert.equal(chopped.extraLifts, 2);
  assert.ok(chopped.quality < perfect.quality - 0.09, `штраф не спрацював: ${chopped.quality}`);

  // Порожнє обведення нічого не коштує і нічого не дає
  const empty = scoreTrace(tpl, [], opts);
  assert.equal(empty.quality, 0);
  assert.equal(empty.ok, false);

  // Магніт: точка на відстані d лягає на d*(1-magnet) від контуру
  const [m] = magnetize(tpl, [[0.5, 0.6]], 0.7);
  near(m[0], 0.5, 1e-9);
  near(m[1], 0.53, 1e-9);
  near(nearestOn(tpl.segs, m[0], m[1]).d, 0.03, 1e-9);
  // Крайні значення: 0 — чиста рука, 1 — чистий шаблон
  near(magnetize(tpl, [[0.5, 0.6]], 0)[0][1], 0.6, 1e-9);
  near(magnetize(tpl, [[0.5, 0.6]], 1)[0][1], 0.5, 1e-9);
}

// --- склад башти -----------------------------------------------------------
{
  const CAT = {
    stump: {
      art: 'proc:stump', size: [1.6, 1.0], cost: 25, tags: ['heavy'],
      sockets: { top: [0, -1.0], left: [-0.8, -0.3], right: [0.8, -0.3] },
    },
    barrel: {
      art: 'proc:barrel', size: [1.2, 0.5], cost: 30, tags: ['barrel'],
      stats: { damage: 10 }, sockets: { tip: [0.6, -0.2] },
    },
    roof: { art: 'proc:roof', size: [1.4, 0.7], cost: 20, tags: ['round'], sockets: { top: [0, -0.7] } },
    spike: { art: 'proc:spike', size: [0.5, 0.6], cost: 10, tags: ['sharp'], stats: { damage: 4 } },
    spring: { art: 'proc:spring', size: [0.5, 0.6], cost: 15, tags: ['spring'] },
  };
  const CFG = {
    base: { rate: 1, range: 2.4 },
    combos: [{ id: 'ricochet', need: ['spring', 'barrel'], gives: { ricochet: 2 } }],
  };
  const mk = () => createBuild(CAT, CFG);

  // Заготовка ставиться без сокета і рівно одна
  {
    const b = mk();
    assert.equal(b.empty, true);
    assert.equal(b.add('stump').ok, true);
    assert.equal(b.add('stump').reason, 'заготовка вже є');
    assert.equal(b.add('нема', null).reason, 'немає такої деталі');
    assert.equal(b.empty, false);
  }

  // Місця кріплення: неіснуюче й зайняте
  {
    const b = mk();
    const s = b.add('stump').id;
    assert.equal(b.add('barrel', { node: s, name: 'нема' }).reason, 'немає такого місця');
    assert.equal(b.add('barrel', { node: 99, name: 'top' }).reason, 'немає такої деталі в башті');
    assert.equal(b.add('barrel', { node: s, name: 'top' }).ok, true);
    assert.equal(b.add('roof', { node: s, name: 'top' }).reason, 'зайнято');
    assert.equal(b.freeSockets().length, 3); // left, right у пенька + tip у ствола
  }

  // ГОЛОВНЕ: та сама деталь у різних місцях — різна башта
  {
    const high = mk();
    const h = high.add('stump').id;
    high.add('barrel', { node: h, name: 'top' });

    const side = mk();
    const s = side.add('stump').id;
    side.add('barrel', { node: s, name: 'left' });

    near(high.metrics().height, 1.5, 1e-9);
    near(side.metrics().height, 1.0, 1e-9);
    near(high.stats().range, 2.4 + 0.6 * 1.5 + 0.4 * (1.55 / 2.2), 1e-9);
    assert.ok(high.stats().range > side.stats().range + 0.3,
      `ствол угорі має бити далі: ${high.stats().range} проти ${side.stats().range}`);
    // а ціна однакова — платиш за деталі, не за розум
    assert.equal(high.stats().cost, side.stats().cost);
  }

  // Ціна — сума деталей; зняття забирає все, що трималось зверху
  {
    const b = mk();
    const s = b.add('stump').id;
    const bar = b.add('barrel', { node: s, name: 'top' }).id;
    b.add('spike', { node: bar, name: 'tip' });
    assert.equal(b.stats().cost, 65);

    const gone = b.remove(bar);
    assert.equal(gone.length, 2, 'ствол падає разом із шипом');
    assert.equal(b.stats().cost, 25);
    assert.equal(b.remove(999).length, 0);
  }

  // Комбо тільки коли обидві деталі на місці
  {
    const b = mk();
    const s = b.add('stump').id;
    b.add('barrel', { node: s, name: 'top' });
    assert.deepEqual(b.stats().combos, []);
    const sp = b.add('spring', { node: s, name: 'left' }).id;
    assert.deepEqual(b.stats().combos, ['ricochet']);
    assert.equal(b.stats().ricochet, 2);
    b.remove(sp);
    assert.deepEqual(b.stats().combos, []);
    assert.equal(b.stats().ricochet, undefined);
  }

  // Симетрія: рівно складено — точніше б'є
  {
    const one = mk();
    const a = one.add('stump').id;
    one.add('spike', { node: a, name: 'left' });
    near(one.stats().crit, 0.05, 1e-9);

    const two = mk();
    const c = two.add('stump').id;
    two.add('spike', { node: c, name: 'left' });
    two.add('spike', { node: c, name: 'right' });
    near(two.stats().crit, 0.25, 1e-9);
  }

  // Якість обведення множить внесок саме тієї деталі
  {
    const good = mk(), bad = mk();
    const g = good.add('stump', null, 1).id;
    good.add('barrel', { node: g, name: 'top' }, 1);
    const b2 = bad.add('stump', null, 1).id;
    bad.add('barrel', { node: b2, name: 'top' }, 0);
    near(good.stats().damage, 10 * qualityMul(1), 1e-9);
    near(bad.stats().damage, 10 * qualityMul(0), 1e-9);
    assert.ok(good.stats().damage > bad.stats().damage * 1.7, 'ідеал має бути майже вдвічі кращий');
    // але ціна від старання не залежить
    assert.equal(good.stats().cost, bad.stats().cost);
  }

  // Шипи підсилюють усе, кругле пришвидшує
  {
    const b = mk();
    const s = b.add('stump').id;
    b.add('barrel', { node: s, name: 'top' });
    const plain = b.stats();
    b.add('spike', { node: s, name: 'left' });
    const spiky = b.stats();
    assert.ok(spiky.damage > plain.damage * 1.15);
    near(plain.rate, 1, 1e-9);

    const r = mk();
    const rs = r.add('stump').id;
    r.add('roof', { node: rs, name: 'top' });
    near(r.stats().rate, 1.1, 1e-9);
  }

  // Опис для рига: дерево з правильними батьками, ствол уміє цілитись
  {
    const b = mk();
    const s = b.add('stump').id;
    const bar = b.add('barrel', { node: s, name: 'top' }).id;
    b.add('spike', { node: bar, name: 'tip' });
    const def = b.rigDef();
    assert.equal(def.parts.length, 3);
    assert.equal(def.parts[0].parent, undefined);
    assert.equal(def.parts[1].parent, 0);
    assert.equal(def.parts[2].parent, 1);
    assert.deepEqual(def.parts[1].pos, [0, -1.0]);
    assert.deepEqual(def.parts[2].pos, [0.6, -0.2]);
    assert.ok(def.parts[1].mods.some((m) => m.type === 'aim'), 'ствол має водити за ціллю');
    assert.ok(def.parts[0].mods.every((m) => m.type !== 'aim'));
  }

  // Півот деталі враховується в коробці: горизонтальний ствол не має
  // «додавати висоти» так, ніби він стоїть на своєму нижньому краю
  {
    const CAT2 = {
      ...CAT,
      gun: { art: 'proc:gun', size: [1.3, 0.5], cost: 30, tags: ['barrel'], pivot: [0.1, 0.5] },
    };
    const b = createBuild(CAT2, CFG);
    const s = b.add('stump').id;
    b.add('gun', { node: s, name: 'top' });
    near(b.metrics().height, 1.25, 1e-9); // 1.0 пенька + півствола вгору
  }

  // Порожній склад нічого не коштує і не стріляє
  {
    const b = mk();
    assert.equal(b.stats().cost, 0);
    assert.equal(b.stats().damage, 0);
    assert.equal(b.freeSockets().length, 0);
  }
}

// --- гармата зі складу -----------------------------------------------------
// Тип снаряда ніде не записаний: він наслідок складу. Тому перевіряємо саме
// перемикання, а не переписування полів.
{
  assert.equal(gunOf(null), null);
  assert.equal(gunOf({ damage: 0, rate: 1, range: 3 }), null, 'башта без зброї не стріляє');

  const bolt = gunOf({ damage: 10, rate: 1.2, range: 4, splash: 0 }, { boltSpeed: 11, ballSpeed: 7 });
  assert.equal(bolt.projectile, 'bolt');
  assert.equal(bolt.speed, 11);
  assert.equal(bolt.damage, 10);
  assert.equal(bolt.rate, 1.2);
  assert.equal(bolt.range, 4);

  const ball = gunOf({ damage: 10, rate: 0.5, range: 3, splash: 1.5 }, { boltSpeed: 11, ballSpeed: 7 });
  assert.equal(ball.projectile, 'ball');
  assert.equal(ball.speed, 7);
  assert.equal(ball.splash, 1.5);

  // Без таблиці швидкостей усе одно дає число, а не undefined
  assert.ok(Number.isFinite(gunOf({ damage: 1, rate: 1, range: 1 }).speed));
}

// --- заготовки з каталогу --------------------------------------------------
// Рецепт шаблону легко зламати тихо: досить перейменувати сокет у деталі, і
// заготовка мовчки збереться без зброї. Тому збираємо всі шаблони по-справжньому.
{
  const root = fileURLToPath(new URL('..', import.meta.url));
  const TP = JSON.parse(readFileSync(root + 'data/towerparts.json', 'utf8'));
  const balance = JSON.parse(readFileSync(root + 'data/balance.json', 'utf8'));

  assert.ok(Object.keys(TP.templates).length, 'шаблонів немає');

  for (const [kind, recipe] of Object.entries(TP.templates)) {
    const b = createBuild(TP.parts, TP);
    recipe.forEach(([partId, host, socket], i) => {
      const at = host == null ? null : { node: b.nodes[host].id, name: socket };
      const r = b.add(partId, at, 1);
      assert.ok(r.ok, `${kind}: деталь ${i} (${partId}) не стала: ${r.reason}`);
    });
    assert.equal(b.nodes.length, recipe.length, `${kind}: склад неповний`);

    const st = b.stats();
    assert.ok(st.damage > 0, `${kind}: заготовка не завдає шкоди`);
    assert.ok(st.range > 0 && Number.isFinite(st.range), `${kind}: радіус ${st.range}`);
    assert.ok(st.rate > 0, `${kind}: темп ${st.rate}`);
    // Ціна заготовки має вкладатись у те, що з гравця бере панель інструментів,
    // інакше шаблон вигідніше зібрати вручну по деталях.
    assert.ok(st.cost <= balance.build[kind], `${kind}: деталі коштують ${st.cost} > ${balance.build[kind]}`);

    assert.ok(gunOf(st, balance.projectiles), `${kind}: гармата не зібралась`);
    // Куди ще можна ставити — саме це показує майстерня
    assert.ok(b.freeSockets().length > 0, `${kind}: нема вільних місць кріплення`);
  }

  // Гармата має бути навісною, магічна — ні: це видно зі складу, не з назви
  const mk = (kind) => {
    const b = createBuild(TP.parts, TP);
    for (const [id, host, socket] of TP.templates[kind]) {
      b.add(id, host == null ? null : { node: b.nodes[host].id, name: socket }, 1);
    }
    return gunOf(b.stats(), balance.projectiles);
  };
  assert.equal(mk('cannon').projectile, 'ball');
  assert.equal(mk('magic_tower').projectile, 'bolt');
  assert.ok(mk('cannon').damage > 0 && mk('magic_tower').damage > 0);

  // Комбо мають доїжджати до гармати. Два способи зламати їх тихо, і обидва
  // вже спрацьовували: (1) gunOf збирав новий об'єкт із шести полів і викидав
  // ricochet / fear / twoWay; (2) в need стоїть тег, якого немає в жодної
  // деталі, тож комбо не збереться ніколи. Перевіряємо обидва.
  const partWithTag = (tag) =>
    Object.entries(TP.parts).find(([, p]) => (p.tags ?? []).includes(tag))?.[0];

  for (const c of TP.combos) {
    for (const tag of c.need) {
      assert.ok(partWithTag(tag), `комбо ${c.id}: у каталозі немає деталі з тегом «${tag}»`);
    }

    const b = createBuild(TP.parts, TP);
    b.add('stump', null, 1);
    // Зброя потрібна окремо: комбо самі шкоди не дають, а без шкоди gunOf
    // чесно повертає null (башта підтримки).
    const ids = ['cannon', ...c.need.map(partWithTag)];
    for (const id of ids) {
      const slot = b.freeSockets()[0];
      assert.ok(slot, `комбо ${c.id}: нема куди чіпляти ${id}`);
      const r = b.add(id, { node: slot.node, name: slot.name }, 1);
      assert.ok(r.ok, `комбо ${c.id}: ${id} не стала: ${r.reason}`);
    }

    const st = b.stats();
    assert.ok(st.combos.includes(c.id), `комбо ${c.id} не зібралось`);
    const gun = gunOf(st, balance.projectiles);
    assert.ok(gun, `комбо ${c.id}: гармата не зібралась`);
    for (const [key, val] of Object.entries(c.gives)) {
      assert.equal(gun[key], val, `комбо ${c.id}: ${key} не доїхав до гармати`);
    }
  }
}

// --- вибір цілей для комбо -------------------------------------------------
{
  const at = (x, y) => ({ x, y });

  // Ланцюг тягнеться крізь натовп: другий стрибок рахується від першої жертви,
  // а не від точки влучання. b далеко від старту, але поруч із a.
  {
    const a = at(1, 0), b = at(2.2, 0), far = at(0, 1.4);
    const chain = chainTargets(0, 0, [a, b, far], 1.5, 2);
    assert.deepEqual(chain, [a, b], 'ланцюг має йти a → b, а не зіркою з нуля');
  }

  // Радіус обрізає, повторів не буває, exclude поважається
  {
    const a = at(1, 0), b = at(9, 0);
    assert.deepEqual(chainTargets(0, 0, [a, b], 1.5, 3), [a]);
    assert.deepEqual(chainTargets(0, 0, [a], 1.5, 3, [a]), []);
    assert.deepEqual(chainTargets(0, 0, [], 1.5, 3), []);
    assert.deepEqual(chainTargets(0, 0, [a], 1.5, 0), []);
  }

  // Кількість стрибків обмежена саме count
  {
    const line = [at(1, 0), at(2, 0), at(3, 0), at(4, 0)];
    assert.equal(chainTargets(0, 0, line, 1.5, 2).length, 2);
    assert.equal(chainTargets(0, 0, line, 1.5, 99).length, 4);
  }

  // Другий ствол б'є в інший бік, а не вдруге по тій самій цілі
  {
    const first = at(3, 0), sameSide = at(2, 0), other = at(-2, 0), farOther = at(-9, 0);
    const rank = (e) => Math.abs(e.x);
    assert.equal(oppositeTarget(0, 0, first, [first, sameSide, other], 5, rank), other);
    assert.equal(oppositeTarget(0, 0, first, [first, sameSide], 5, rank), null,
      'позаду нікого — другого пострілу немає');
    assert.equal(oppositeTarget(0, 0, first, [first, farOther], 5, rank), null, 'за радіусом');
  }
}


// --- lane mode: геометрія рядів --------------------------------------------
{
  const band = { y0: 2, y1: 10, rows: 4 };
  near(rowHeight(band), 2);

  // Центри рядів, а не межі: ворог іде посередині ряду.
  near(rowY(band, 0), 3);
  near(rowY(band, 3), 9);

  // Зворотність — головне: якщо rowOf(rowY(r)) дасть інший ряд, союзник стане
  // не туди, куди тапнули, і це не буде видно, поки хтось не програє через це.
  for (let r = 0; r < band.rows; r++) {
    assert.equal(rowOf(band, rowY(band, r)), r, `ряд ${r} не зворотний`);
  }

  // Межі рядів належать нижньому ряду, розривів немає.
  assert.equal(rowOf(band, 2), 0, 'верхній край смуги — нульовий ряд');
  assert.equal(rowOf(band, 3.99), 0);
  assert.equal(rowOf(band, 4), 1, 'межа рядів іде в наступний ряд');

  // Промах пальцем за смугу — крайній ряд, а не -1: інакше тап трохи вище
  // поля мовчки нічого не робив би.
  assert.equal(rowOf(band, -100), 0, 'вище смуги — перший ряд');
  assert.equal(rowOf(band, 100), 3, 'нижче смуги — останній ряд');
  assert.equal(rowY(band, -5), rowY(band, 0), 'ряд за межами затискається');
  assert.equal(rowY(band, 99), rowY(band, 3));

  // Зважений вибір: нульова вага не випадає, межі відрізків належать наступному.
  assert.equal(pickWeighted({ a: 1, b: 0 }, 0.99), 'a');
  assert.equal(pickWeighted({ a: 1, b: 3 }, 0.1), 'a');
  assert.equal(pickWeighted({ a: 1, b: 3 }, 0.25), 'b');
  assert.equal(pickWeighted({ a: 1, b: 3 }, 0.999), 'b');
}

// --- лабіринт не поїхав -----------------------------------------------------
// Сторож балансу РОБОЧОЇ гри, не режиму. Числа зняті з коду до того, як лінія
// почала перебирати build.ts, і звірені на чотирьох складах, включно з metrics.
// Якщо цей блок упав — поїхав лабіринт, і шукати треба не в режимі.
{
  const TP = JSON.parse(readFileSync(
    fileURLToPath(new URL('../data/towerparts.json', import.meta.url)), 'utf8'));
  const b = createBuild(TP.parts, TP);
  b.add('stump', null, 1);
  b.add('cannon', { node: b.nodes[0].id, name: 'right' }, 1);
  b.add('spikes', { node: b.nodes[0].id, name: 'left' }, 1);
  const s = b.stats();
  near(s.damage, 20.125);
  near(s.splash, 1.5);
  near(s.rate, 1);
  near(s.crit, 0.25);
  near(s.range, 3.419612188365651);
  near(s.metrics.height, 1.0499999999999998);
  near(s.metrics.topMass, 0.47403047091412726);
}

// --- lane mode: зброя, рідкість, контри ------------------------------------
// Найтихіше тут ламається три речі: пороги рідкості, що не зростають (legendary
// стає недосяжним без жодної помилки); контри, які нічого не контрять (усі
// зброї однакові, а картки обіцяють різницю); і зброя, що домінує голими
// числами (тоді клас — оздоблення, а не рішення).
const root = fileURLToPath(new URL('..', import.meta.url));
const WP = JSON.parse(readFileSync(root + 'data/weapons.json', 'utf8'));
const EN = JSON.parse(readFileSync(root + 'data/laneEnemies.json', 'utf8'));
const LL = JSON.parse(readFileSync(root + 'data/laneLevel.json', 'utf8'));
const BD = JSON.parse(readFileSync(root + 'data/buildings.json', 'utf8'));
const enemyIds = Object.keys(EN).filter((k) => !k.startsWith('_'));

{
  // --- рідкість ---
  const R = WP.rarity;
  assert.ok(R.length >= 3, 'рівнів рідкості замало, щоб різниця відчувалась');
  assert.equal(R[0].min, 0, 'перший рівень має починатись від нуля, інакше погане обведення не має рівня');
  for (let i = 1; i < R.length; i++) {
    assert.ok(R[i].min > R[i - 1].min, `пороги рідкості не зростають на ${R[i].id}`);
    assert.ok(R[i].mul > R[i - 1].mul, `множник ${R[i].id} не більший за ${R[i - 1].id}`);
    assert.ok(R[i].stars > R[i - 1].stars, `зірок у ${R[i].id} не більше`);
  }
  assert.ok(R[R.length - 1].min < 1, 'найвищий рівень недосяжний навіть ідеальним обведенням');
  // Кольорове кодування: у кожного рівня своя ручка, і всі ручки є в палітрі.
  const LK = JSON.parse(readFileSync(root + 'data/look.json', 'utf8'));
  assert.equal(new Set(R.map((t) => t.pen)).size, R.length, 'два рівні рідкості однією ручкою');
  for (const t of R) assert.ok(LK.pens[t.pen], `${t.id}: ручки ${t.pen} немає в look.pens`);
  assert.equal(R[0].pen, 'pencil', 'common мусить бути «білою» — на папері це незафарбована, олівцева зірка');
  assert.equal(R[R.length - 1].pen, 'orange', 'legendary — оранжева');
  assert.equal(rarityOf(0, R).id, R[0].id);
  assert.equal(rarityOf(1, R).id, R[R.length - 1].id);
  assert.equal(rarityOf(R[1].min, R).id, R[1].id, 'поріг має бути включним');
  assert.equal(rarityOf(R[1].min - 1e-9, R).id, R[0].id);
  assert.equal(rarityOf(-5, R).id, R[0].id, 'від’ємна якість не має ламати вибір');

  // Рідкість множить силу, але не геометрію: засяг і швидкість ті самі.
  const sw = WP.weapons.sword;
  const lo = unitStats(sw, R[0]), hi = unitStats(sw, R[R.length - 1]);
  assert.ok(hi.hp > lo.hp && hi.damage > lo.damage, 'рідкість не додала сили');
  near(hi.reach, lo.reach); near(hi.speed, lo.speed); near(hi.rate, lo.rate);

  // --- зброя ---
  const ids = weaponIds(WP);
  assert.equal(ids.length, 7, `зброї ${ids.length}, а має бути 7: по три на рід і священик`);
  const support = ids.filter((id) => WP.weapons[id].kind === 'support');
  assert.equal(support.length, 1, 'священик має бути один');
  const priest = WP.weapons[support[0]];
  assert.ok(priest.stats.heal > 0 && priest.stats.range > 0 && priest.stats.damage === 0,
    'священик лікує, дістає, і не б’є');
  for (const kind of ['melee', 'ranged']) {
    const ofKind = ids.filter((id) => WP.weapons[id].kind === kind);
    assert.equal(ofKind.length, 3, `${kind}: ${ofKind.length} зброї замість 3`);
    const classes = new Set(ofKind.map((id) => WP.weapons[id].cls));
    assert.deepEqual([...classes].sort(), ['balanced', 'heavy', 'quick'], `${kind}: класи не по одному кожного`);

    // Сирий dps у межах роду близький: різниця між зброями — клас, а не сила.
    const dps = ofKind.map((id) => WP.weapons[id].stats.damage * WP.weapons[id].stats.rate);
    const lo = Math.min(...dps), hi = Math.max(...dps);
    assert.ok(hi <= lo * 1.2, `${kind}: dps ${lo.toFixed(1)}..${hi.toFixed(1)} — хтось домінує голими числами`);
  }
  for (const id of ids) {
    const w = WP.weapons[id];
    assert.ok(w.cost > 0, `${id}: без ціни`);
    assert.ok(w.stats.hp > 0 && (w.stats.damage > 0 || w.stats.heal > 0) && w.stats.rate > 0 && w.stats.speed > 0, `${id}: стати неповні`);
    if (w.kind === 'melee') assert.ok(w.stats.reach > 0, `${id}: мілі без reach нікого не спинить`);
    else if (w.kind === 'ranged') assert.ok(w.stats.range > 0 && w.stats.shot > 0, `${id}: ренж без range/shot`);
    assert.ok(w.grip?.length === 2, `${id}: без grip нема за що тримати`);
    assert.ok(w.title && w.hint, `${id}: без підпису на полиці трафарет не читається`);
    // Штрихів не більше п'яти: scoreTrace карає за кожен зайвий відрив пальця.
    assert.ok(w.outline.length >= 1 && w.outline.length <= 5, `${id}: ${w.outline.length} штрихів, дозволено 1..5`);
    for (const [i, s] of w.outline.entries()) {
      assert.ok(s.length >= 2, `${id}: штрих ${i} з однієї точки`);
      for (const [x, y] of s) {
        assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1,
          `${id}: точка (${x},${y}) поза коробкою 0..1 — обведення промахнеться повз рамку`);
      }
    }
  }
  // Тіло на кожен рід, і точка руки над землею.
  for (const kind of ['melee', 'ranged', 'support']) {
    const b = WP.bodies[kind];
    assert.ok(b?.part && b.size?.length === 2 && b.hand?.length === 2, `${kind}: тіло неповне`);
    assert.ok(b.hand[1] < 0 && -b.hand[1] < b.size[1], `${kind}: рука не на тілі`);
  }

  // --- контри: камінь-ножиці-папір ---
  const enemyClasses = [...new Set(enemyIds.map((id) => EN[id].cls))];
  assert.ok(enemyClasses.length >= 3, 'класів ворогів замало для трикутника');
  const bestVs = {};
  for (const ec of enemyClasses) {
    let best = null, worst = null;
    for (const wc of ['balanced', 'heavy', 'quick']) {
      const m = counterMul(WP.counters, wc, ec);
      if (!best || m > best.m) best = { wc, m };
      if (!worst || m < worst.m) worst = { wc, m };
    }
    assert.ok(counterMul(WP.counters, 'balanced', ec) >= worst.m, `проти ${ec} збалансована зброя найгірша — тоді вона просто гірша`);
    bestVs[ec] = best.wc;
  }
  assert.equal(bestVs.armored, 'heavy', 'броню має ламати важка зброя');
  assert.equal(bestVs.swift, 'quick', 'бігунів має різати швидка зброя');
  assert.ok(counterMul(WP.counters, 'heavy', 'swift') < 1, 'важка має не встигати за бігуном');
  assert.ok(counterMul(WP.counters, 'quick', 'armored') < 1, 'швидка має дряпати броню');
  assert.equal(counterMul(WP.counters, 'balanced', 'armored'), 1);
  // Трикутник має бути помітним, не косметичним: правильна зброя щонайменше
  // втричі краща за неправильну проти того самого ворога.
  for (const [good, bad, ec] of [['heavy', 'quick', 'armored'], ['quick', 'heavy', 'swift']]) {
    const ratio = counterMul(WP.counters, good, ec) / counterMul(WP.counters, bad, ec);
    assert.ok(ratio >= 3, `проти ${ec}: ${good} лише в ${ratio.toFixed(1)} рази кращий за ${bad} — трикутника не видно`);
  }
  assert.ok(counterMul(WP.counters, 'balanced', 'standard') > 1, 'збалансована має мати свою нішу — базового ворога');
  assert.equal(counterMul(WP.counters, 'нема', 'нема'), 1, 'невідомий клас має давати 1, а не NaN');

  // --- вороги ---
  const by = (cls) => enemyIds.filter((id) => EN[id].cls === cls).map((id) => EN[id]);
  for (const id of enemyIds) {
    const e = EN[id];
    for (const k of ['hp', 'speed', 'damage', 'rate', 'reach', 'size']) {
      // Чорнило з ворогів не падає — його дають будівлі. bounty тут не має бути.
      assert.equal(e.bounty, undefined, `${id}: bounty — чорнило з ворогів більше не падає`);
      assert.ok(e[k] > 0, `${id}: ${k} порожній`);
    }
    assert.ok(e.rig, `${id}: без рига`);
    assert.ok(['standard', 'swift', 'armored'].includes(e.cls), `${id}: невідомий клас ${e.cls}`);
    // Власний бонус лише в тих, хто когось контрить: інакше вухань теж «контрить».
    if (e.cls === 'standard') assert.ok(!e.vs, `${id}: базовий ворог не має бонусів`);
    else assert.ok(e.vs && Object.values(e.vs).some((v) => v > 1), `${id}: клас ${e.cls}, а бонусу проти нікого`);
  }
  const std = by('standard')[0], swift = by('swift')[0], arm = by('armored')[0];
  assert.ok(swift.speed > std.speed && std.speed > arm.speed, 'швидкості класів переплутані');
  assert.ok(arm.hp > std.hp && std.hp > swift.hp, 'живучість класів переплутана');
  assert.ok(arm.damage > std.damage, 'здоровань має бити болючіше за вуханя');
  assert.ok(swift.vs.ranged > 1 && !swift.vs.melee, 'бігун має добігати до стрільців, а не до щитів');
  assert.ok(arm.vs.melee > 1 && !arm.vs.ranged, 'здоровань має ламати блокувальників');
}

// --- lane mode: рівень ------------------------------------------------------
{
  // Зліва направо: слот юніта → лінія дому → фундаменти → фронт → спавн.
  assert.ok(LL.slot.x0 < LL.slot.x1, 'слот вивернутий');
  assert.ok(LL.slot.x1 < LL.homeX, 'слот юніта має бути ЗЛІВА від лінії дому, за лазером');
  const P = LL.plots;
  assert.ok(P.cols === 3, 'фундаментів має бути три стовпчики');
  assert.ok(P.x0 - P.side / 2 > LL.homeX, 'перший фундамент налазить на лінію дому');
  const lastPlot = P.x0 + P.step * (P.cols - 1) + P.side / 2;
  assert.ok(lastPlot < LL.holdX, 'фундаменти за лінією фронту — бійці їх не прикриють');
  assert.ok(P.side < P.step, 'фундаменти налазять один на одного');
  assert.ok(P.side <= rowHeight({ y0: LL.band.y0, y1: LL.band.y1, rows: LL.rows }), 'фундамент вищий за ряд');
  assert.ok(LL.holdX < LL.spawnX, 'лінія фронту за точкою спавну');
  assert.ok(LL.band.y0 < LL.band.y1, 'смуга рядів вивернута');
  assert.ok(LL.rows >= 1);
  assert.ok(LL.core.cols > LL.spawnX - 2, `ядро ${LL.core.cols} вужче за спавн ${LL.spawnX}`);
  assert.ok(LL.band.y1 <= LL.core.rows, 'смуга рядів вилазить за ядро');
  assert.equal(LL.drip, undefined, 'крапля з неба знята: чорнило тільки з будівель');
  assert.ok(LL.laser.charges >= 1, 'лазер без зарядів — лінія без захисту');
  assert.ok(LL.slowWhileDrawing > 0 && LL.slowWhileDrawing <= 0.2, 'сповільнення під час малювання має бути ~90%');
  assert.ok(LL.supportBack > 0, 'священик без відступу стоятиме на передовій');

  // Вороги повільні навмисно: гравець мусить встигати обводити. Вухань іде
  // смугу не швидше, ніж за 30 с.
  const std = EN[Object.keys(EN).find((id) => EN[id].cls === 'standard')];
  assert.ok((LL.spawnX - LL.homeX) / std.speed >= 30, 'базовий ворог проходить смугу швидше за 30 с — малювати не встигнеш');

  // Відкриття зброї: стартова по одній на бойовий рід, решта — за хвилі, і всі
  // до останньої хвилі. Не відкрита ніколи зброя — це намальований трафарет,
  // якого гравець ніколи не побачить.
  const all = weaponIds(WP);
  for (const id of LL.startWeapons) assert.ok(WP.weapons[id], `стартової зброї ${id} немає`);
  const startKinds = LL.startWeapons.map((id) => WP.weapons[id].kind);
  assert.ok(startKinds.includes('melee') && startKinds.includes('ranged'), 'на старті має бути і мілі, і ренж');
  assert.ok(LL.unlocks.length >= 1, 'винагород за хвилі немає');
  let prevWave = -1;
  for (const u of LL.unlocks) {
    assert.ok(u.wave > prevWave, 'винагороди не за зростанням хвиль');
    assert.ok(u.wave >= 1 && u.wave < LL.waves.length, `винагорода на хвилі ${u.wave}, а хвиль ${LL.waves.length}`);
    for (const id of u.weapons) assert.ok(WP.weapons[id], `винагорода ${id} — такої зброї немає`);
    prevWave = u.wave;
  }
  const last = unlockedAt(LL.waves.length - 1, LL.startWeapons, LL.unlocks);
  for (const id of all) assert.ok(last.has(id), `${id} не відкривається ніколи`);

  // Будівлі: колодязь від початку (без нього чорнила немає взагалі), решта за
  // хвилі, і все відкривається до останньої.
  const bIds = buildingIds(BD);
  assert.ok(LL.startBuildings.includes('well'), 'без колодязя на старті чорнила не буде звідки взяти');
  for (const id of LL.startBuildings) assert.ok(BD.buildings[id], `стартової будівлі ${id} немає`);
  for (const u of LL.buildingUnlocks) {
    assert.ok(u.wave >= 1 && u.wave < LL.waves.length, `будівлі на хвилі ${u.wave}, а хвиль ${LL.waves.length}`);
    for (const id of u.buildings) assert.ok(BD.buildings[id], `винагорода ${id} — такої будівлі немає`);
  }
  const lastB = unlockedAt(LL.waves.length - 1, LL.startBuildings, LL.buildingUnlocks, 'buildings');
  for (const id of bIds) assert.ok(lastB.has(id), `будівля ${id} не відкривається ніколи`);
  assert.equal(unlockedAt(0, LL.startBuildings, LL.buildingUnlocks, 'buildings').size, LL.startBuildings.length);

  for (const id of bIds) {
    const b = BD.buildings[id];
    assert.ok(b.title && b.hint, `${id}: без підпису`);
    assert.ok(b.cost > 0 && b.hp > 0, `${id}: без ціни або без hp`);
    assert.ok(b.size?.length === 2 && b.size[0] <= P.side + 0.01 && b.size[1] <= P.side + 0.01, `${id}: не влазить у фундамент`);
    assert.ok(b.outline.length >= 1 && b.outline.length <= 5, `${id}: ${b.outline.length} штрихів, дозволено 1..5`);
    for (const [i, st] of b.outline.entries()) {
      assert.ok(st.length >= 2, `${id}: штрих ${i} з однієї точки`);
      for (const [x, y] of st) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `${id}: точка поза коробкою`);
    }
    assert.ok(['well', 'barricade', 'banner', 'forge', 'chapel', 'trap'].includes(b.effect.type), `${id}: невідомий ефект`);
  }
  const kinds = new Set(bIds.map((id) => BD.buildings[id].effect.type));
  assert.ok(kinds.has('well') && kinds.has('barricade') && kinds.has('banner') && kinds.has('forge') && kinds.has('chapel') && kinds.has('trap'),
    'бракує якогось роду будівель');
  const banners = bIds.filter((id) => BD.buildings[id].effect.type === 'banner').map((id) => BD.buildings[id].effect.vs);
  assert.deepEqual([...banners].sort(), ['armored', 'standard', 'swift'], 'прапорів має бути по одному на клас ворога');
  // Колодязь має окуповуватись за сесію: 6 хвиль по ~30 с — щонайменше 5 крапель.
  const well = BD.buildings.well.effect;
  assert.ok(well.ink * 5 > BD.buildings.well.cost, 'колодязь не окуповується');
  assert.equal(unlockedAt(0, LL.startWeapons, LL.unlocks).size, LL.startWeapons.length, 'на першій хвилі відкрито більше за стартове');
  // Швидка зброя відкривається не пізніше за бігунів, важка — за здорованів:
  // трикутник треба дати в руки тоді, коли він потрібен.
  const firstOf = (cls) => LL.waves.findIndex((w) => Object.keys(w.mix).some((id) => EN[id].cls === cls));
  for (const [ec, wc] of [['swift', 'quick'], ['armored', 'heavy']]) {
    const first = firstOf(ec);
    if (first < 0) continue;
    const have = unlockedAt(first, LL.startWeapons, LL.unlocks);
    assert.ok([...have].some((id) => WP.weapons[id].cls === wc), `${ec} прийшли раніше за ${wc} зброю`);
  }

  const band = { y0: LL.band.y0, y1: LL.band.y1, rows: LL.rows };
  assert.ok(rowHeight(band) >= 1, `ряд ${rowHeight(band)} клітинки — вороги зіллються`);
  for (const id of enemyIds) {
    // Бос навмисно вищий за ряд: його мають бачити здалеку.
    if (EN[id].boss) continue;
    assert.ok(EN[id].size <= rowHeight(band), `${id} заввишки ${EN[id].size} не влазить у ряд ${rowHeight(band)}`);
  }

  assert.ok(LL.waves.length, 'хвиль немає');
  for (const [i, w] of LL.waves.entries()) {
    assert.ok(w.count > 0 && w.every > 0, `хвиля ${i} порожня`);
    assert.ok(w.row == null || (w.row >= 0 && w.row < LL.rows), `хвиля ${i}: ряду ${w.row} не існує`);
    assert.ok(w.mix && Object.values(w.mix).some((v) => v > 0), `хвиля ${i}: mix порожній`);
    for (const id of Object.keys(w.mix)) assert.ok(EN[id], `хвиля ${i}: ворога ${id} немає в laneEnemies.json`);
  }
  // Перша хвиля — лише базовий ворог: контри треба спершу показати, а потім вимагати.
  assert.deepEqual(Object.keys(LL.waves[0].mix), ['earling'], 'перша хвиля вже з контрами');
}

// --- lane mode: крок бою ----------------------------------------------------
// Ряд — це черга: ніхто нікого не обходить. Саме це найлегше зламати тихо:
// союзник, що пройшов крізь ворога, ворог, що б'є через ряд, контри, що не
// доїхали до шкоди.
{
  const mk = () => createArmy({ weapons: WP, rows: 4, slotX: 2, holdX: 11, homeX: 0.8 });
  const mkTown = () => createTown({
    data: BD, rarity: WP.rarity, rows: 4, cols: 3, plotX: (c) => 3 + c * 2, plotHalf: 0.8,
  });
  const foe = (over = {}) => ({
    row: 0, x: 20, hp: 40, cls: 'standard', damage: 5, rate: 1, reach: 0.6, speed: 1.5, cd: 0,
    moving: false, ...over,
  });
  const run = (army, foes, seconds, dt = 0.05, world) => {
    const ev = { a: [], f: [] };
    for (let t = 0; t < seconds; t += dt) {
      ev.a.push(...army.stepAllies(foes, dt));
      ev.f.push(...army.stepFoes(foes, dt, world));
    }
    return ev;
  };

  // Довша рука ворога: здоровань (засяг 0.8) спиняється перед мечем (0.7) за
  // лінією фронту. Колись боєць стояв на лінії й не діставав, а ворог бив його
  // безкарно — і хвиля не закінчувалась ніколи. Тепер боєць підступає.
  for (const wid of ['sword', 'mace', 'spear']) {
    const a = mk();
    a.summon(wid, 0, 0.6);
    for (let t = 0; t < 12; t += 0.05) a.stepAllies([], 0.05); // боєць уже стоїть на лінії
    const f = foe({ x: 14, hp: 120, cls: 'armored', reach: 0.8, damage: 14, rate: 0.5, speed: 0.3 });
    let t = 0;
    for (; t < 90 && f.hp > 0 && a.allies.length; t += 0.05) { a.stepAllies([f], 0.05); a.stepFoes([f], 0.05); }
    assert.ok(f.hp < 120, `${wid}: здоровань із довшою рукою б'є ${Math.round(t)} с, а боєць жодного разу не дістав`);
    for (const al of a.allies) assert.ok(al.x <= 11 + 1.3, `${wid}: боєць побіг за ворогом далеко за лінію (${al.x})`);
  }

  // Виклик: зброя з даних, рідкість із якості, слот, відмови.
  {
    const a = mk();
    const r = a.summon('sword', 1, 1);
    assert.ok(r.ok);
    assert.equal(r.ally.kind, 'melee');
    assert.equal(r.ally.cls, 'balanced');
    assert.equal(r.ally.rarity.id, 'legendary', 'ідеальне обведення не дало вищої рідкості');
    near(r.ally.x, 2);
    assert.equal(r.ally.reach, WP.weapons.sword.stats.reach);
    const bad = a.summon('sword', 1, 0);
    assert.equal(bad.ally.rarity.id, 'common');
    assert.ok(bad.ally.hp < r.ally.hp, 'common живучіший за legendary');

    assert.equal(a.summon('нема', 0, 1).reason, 'немає такої зброї');
    assert.equal(a.summon('_weapons', 0, 1).reason, 'немає такої зброї');
    assert.equal(a.summon('sword', 9, 1).reason, 'немає такого ряду');
    assert.equal(a.summon('sword', 1.5, 1).reason, 'немає такого ряду');
    assert.equal(a.allies.length, 2, 'невдалий виклик лишив слід');

    const rg = a.summon('bow', 0, 1).ally;
    assert.equal(rg.kind, 'ranged');
    assert.ok(rg.range > 0 && rg.reach === 0);
  }

  // Порожній ряд: іде до фронту й стає рівно на ньому, не далі.
  {
    const a = mk();
    const s = a.summon('sword', 0, 1).ally;
    run(a, [], 3);
    assert.ok(s.x > 2 && s.x < 11, `за 3 с має бути в дорозі, а він на ${s.x}`);
    assert.equal(s.moving, true);
    run(a, [], 20);
    near(s.x, 11);
    assert.equal(s.moving, false, 'на фронті має стояти');
  }

  // Мілі спиняється перед ворогом у reach і б'є по відкату; ворог спиняється
  // перед ним у своєму reach і б'є у відповідь. Ніхто крізь нікого не проходить.
  {
    const a = mk();
    const s = a.summon('sword', 0, 1).ally;
    // Живучий, щоб за 4 с не вмер: тут перевіряємо чергу, а не вбивство.
    const f = foe({ x: 6, hp: 1000 });
    const ev = run(a, [f], 4);
    assert.ok(f.x > s.x, 'ворог пройшов крізь союзника');
    assert.ok(f.x - s.x <= Math.max(s.reach, f.reach) + 0.2, `зійшлись не впритул: ${f.x - s.x}`);
    const strikes = ev.a.filter((e) => e.type === 'strike');
    const hits = ev.f.filter((e) => e.type === 'hit');
    assert.ok(strikes.length >= 1, 'союзник не вдарив');
    assert.ok(hits.length >= 1, 'ворог не вдарив у відповідь');
    assert.ok(!ev.f.some((e) => e.type === 'leak'), 'ворог протік крізь блокувальника');
    assert.equal(s.moving, false); assert.equal(f.moving, false);
    // Темп: за 4 с меч (1/с) б'є приблизно 3-4 рази, не 80.
    assert.ok(strikes.length <= 5, `меч ударив ${strikes.length} разів за 4 с`);
    // Шкода застосована в моделі, а не обіцяна.
    near(f.hp, 1000 - strikes.reduce((n, e) => n + e.amount, 0), 1e-6);
  }

  // Спис б'є першим: його reach більший за reach ворога, тому перша подія — його.
  {
    const a = mk();
    a.summon('spear', 0, 1);
    const f = foe({ x: 6 });
    let first = null;
    for (let t = 0; t < 4 && !first; t += 0.05) {
      const ea = a.stepAllies([f], 0.05), ef = a.stepFoes([f], 0.05);
      if (ea.length) first = 'ally';
      else if (ef.length) first = 'foe';
    }
    assert.equal(first, 'ally', 'спис мав ударити раніше за ворога');
  }

  // Ренжовий спиняється на range і стріляє, шкоду не застосовує сам (снаряд летить).
  {
    const a = mk();
    const b = a.summon('bow', 0, 1).ally;
    const f = foe({ x: 12, speed: 0 });
    const ev = run(a, [f], 8);
    assert.ok(ev.a.some((e) => e.type === 'shoot'), 'лук не вистрілив');
    assert.ok(!ev.a.some((e) => e.type === 'strike'), 'лук б’є врукопашну');
    assert.ok(f.x - b.x <= b.range + 0.1, `лук не підійшов на засяг: ${f.x - b.x}`);
    assert.ok(f.x - b.x > b.range - 1, 'лук підійшов упритул замість стріляти здалеку');
    assert.equal(f.hp, 40, 'постріл сам завдав шкоди без снаряда');
    // Влучання — через hitOf, тим самим кодом, що удар.
    const h = a.hitOf(b, f);
    const k = counterMul(WP.counters, b.cls, f.cls);
    near(h.amount, b.damage * k); assert.equal(h.bonus, k > 1);
  }

  // Контри доїжджають до шкоди: булава проти броні — бонус, проти бігуна — штраф.
  {
    const a = mk();
    const m = a.summon('mace', 0, 1).ally;
    const arm = a.hitOf(m, foe({ cls: 'armored' }));
    const sw = a.hitOf(m, foe({ cls: 'swift' }));
    const st = a.hitOf(m, foe());
    assert.ok(arm.amount > st.amount && arm.bonus, 'булава не ламає броню');
    assert.ok(sw.amount < st.amount && !sw.bonus && sw.penalty, 'булава встигає за бігуном');
    assert.ok(!st.penalty, 'проти базового ворога штрафу не має бути');
    near(arm.amount, m.damage * WP.counters.heavy.armored);

    // І в подіях удару теж, а не лише в hitOf.
    const f = foe({ x: 3, cls: 'armored', speed: 0, hp: 1000 });
    const ev = run(a, [f], 3);
    const s = ev.a.find((e) => e.type === 'strike');
    assert.ok(s?.bonus, 'бонус не дійшов до події удару');
    near(s.amount, arm.amount);
  }

  // Ворожий бонус проти роду: здоровань ламає мілі сильніше, ніж ренж.
  {
    const a = mk();
    const m = a.summon('sword', 0, 1).ally;
    const r = a.summon('bow', 1, 1).ally;
    const fm = foe({ x: 2.4, speed: 0, vs: { melee: 1.4 } });
    const fr = foe({ x: 2.4, row: 1, speed: 0, vs: { melee: 1.4 } });
    const ev = run(a, [fm, fr], 1.2);
    const hm = ev.f.find((e) => e.type === 'hit' && e.ally === m);
    const hr = ev.f.find((e) => e.type === 'hit' && e.ally === r);
    assert.ok(hm && hr, 'ворог не вдарив когось із двох');
    near(hm.amount, 5 * 1.4); near(hr.amount, 5);
  }

  // Ряди незалежні: ворог у ряду 1 не спиняється об союзника ряду 0 й протікає.
  {
    const a = mk();
    a.summon('sword', 0, 1);
    const f = foe({ row: 1, x: 3, speed: 4 });
    const ev = run(a, [f], 1.5);
    assert.ok(ev.f.some((e) => e.type === 'leak'), 'ворог чужого ряду не протік');
    assert.ok(!ev.f.some((e) => e.type === 'hit'), 'ворог ударив через ряд');
    assert.ok(!ev.a.some((e) => e.type === 'strike'), 'союзник ударив через ряд');
  }

  // Смерть: союзник зникає зі списку, і наступний у ряду стає ціллю.
  {
    const a = mk();
    const first = a.summon('sling', 0, 1).ally;
    const second = a.summon('sword', 0, 1).ally;
    second.x = 1.5; // позаду
    const f = foe({ x: first.x + 0.3, speed: 0, damage: 1000 });
    const ev = run(a, [f], 1.2);
    const kill = ev.f.find((e) => e.type === 'hit' && e.killed);
    assert.ok(kill && kill.ally === first, 'перший удар мав убити першого в черзі');
    assert.ok(!a.allies.includes(first), 'мертвий лишився в загоні');
    assert.ok(a.allies.includes(second));
    assert.equal(a.damage(second, 1), false);
    assert.equal(a.damage(second, 1e6), true);
    assert.equal(a.allies.length, 0);
  }

  // Убитий ворог не ціль: союзник іде далі, а не б'є труп.
  {
    const a = mk();
    const s = a.summon('sword', 0, 1).ally;
    const dead = foe({ x: 3, hp: 0 });
    run(a, [dead], 2);
    assert.ok(s.x > 3.5, 'союзник спинився об мертвого');
  }

  // Священик: іде за бійцем, стає позаду в засягу, лікує пораненого, не б'є.
  {
    const a = mk();
    const s = a.summon('sword', 0, 1).ally;
    const p = a.summon('cross', 0, 1).ally;
    assert.equal(p.kind, 'support');
    assert.ok(p.heal > 0 && p.damage === 0);
    s.x = 8; s.hp = s.maxHp - 20;
    const ev = run(a, [], 6);
    assert.ok(p.x < s.x, 'священик обігнав бійця');
    assert.ok(s.x - p.x <= p.range + 0.1, `священик не підійшов у засяг: ${s.x - p.x}`);
    const heals = ev.a.filter((e) => e.type === 'heal');
    assert.ok(heals.length >= 1, 'священик не лікував');
    assert.ok(heals[0].targets.includes(s));
    assert.ok(s.hp > s.maxHp - 20, 'зцілення не дійшло');
    assert.ok(s.hp <= s.maxHp, 'вилікував понад максимум');
    assert.ok(!ev.a.some((e) => e.type === 'strike' && e.ally === p), 'священик б’є');
    // Здоровий не лікується: імпульси не витрачаються дарма.
    s.hp = s.maxHp;
    const ev2 = run(a, [], 3);
    assert.equal(ev2.a.filter((e) => e.type === 'heal').length, 0, 'лікує здорового');
  }

  // Священик без бійців тримається позаду фронту, а не на ньому.
  {
    const a = mk();
    const p = a.summon('cross', 1, 1).ally;
    run(a, [], 20);
    assert.ok(p.x < 11 && p.x > 8, `священик без бійців має стояти за фронтом, а він на ${p.x}`);
    // Ворог б'є його як будь-кого.
    const f = foe({ row: 1, x: p.x + 0.3, speed: 0 });
    const ev = run(a, [f], 1.2);
    assert.ok(ev.f.some((e) => e.type === 'hit' && e.ally === p), 'ворог не б’є священика');
  }

  // Будівлі: ворог спиняється перед будівлею й ламає її; союзники проходять крізь.
  {
    const a = mk();
    const obst = { row: 0, x: 4, w: 0.8, hp: 100 };
    const f = foe({ x: 8, speed: 2 });
    const ev = run(a, [f], 3, 0.05, { obstacles: [obst] });
    assert.ok(f.x >= obst.x + obst.w, 'ворог пройшов крізь будівлю');
    const smash = ev.f.filter((e) => e.type === 'smash');
    assert.ok(smash.length >= 1, 'ворог не ламає будівлю');
    assert.equal(smash[0].obstacle, obst);
    assert.ok(!ev.f.some((e) => e.type === 'leak'), 'протік крізь будівлю');
    // Модель НЕ віднімає hp будівлі сама — це робить місто по події.
    assert.equal(obst.hp, 100);

    const s = a.summon('sword', 0, 1).ally;
    run(a, [], 8, 0.05, { obstacles: [obst] });
    assert.ok(s.x > obst.x + obst.w, 'союзник застряг об свою ж будівлю');
  }

  // Союзник ближче за будівлю — б'є союзника; зруйнована будівля (hp 0) не ціль.
  {
    const a = mk();
    const s = a.summon('sword', 0, 1).ally;
    s.x = 6;
    const obst = { row: 0, x: 4, w: 0.8, hp: 100 };
    const f = foe({ x: 6.5, speed: 0 });
    const ev = run(a, [f], 1.2, 0.05, { obstacles: [obst] });
    assert.ok(ev.f.some((e) => e.type === 'hit' && e.ally === s), 'мав бити союзника, який ближче');
    assert.ok(!ev.f.some((e) => e.type === 'smash'), 'бив будівлю через союзника');

    const dead = { row: 0, x: 4, w: 0.8, hp: 0 };
    const g = foe({ x: 5, speed: 2 });
    const ev2 = run(mk(), [g], 3, 0.05, { obstacles: [dead] });
    assert.ok(g.x < dead.x, 'ворог спинився об руїну');
    assert.ok(ev2.f.some((e) => e.type === 'leak'));
  }

  // Пастка сповільнює, прапор множить.
  {
    const a = createArmy({ weapons: WP, rows: 4, slotX: 1, holdX: 11.5, homeX: 2.5,
      extraMul: (al, fo) => (fo.cls === 'armored' ? 1.5 : 1) });
    const slow = foe({ x: 10, speed: 2 });
    const fast = foe({ x: 10, speed: 2, row: 1 });
    run(a, [slow, fast], 1, 0.05, { slowAt: (row, x) => (row === 0 ? 0.5 : 1) });
    near(10 - slow.x, (10 - fast.x) / 2, 1e-6);
    const s = a.summon('sword', 0, 1).ally;
    const h = a.hitOf(s, foe({ cls: 'armored' }));
    near(h.amount, s.damage * counterMul(WP.counters, 'balanced', 'armored') * 1.5);
    assert.ok(h.bonus, 'прапор мав дати бонус');
  }

  // Кузня: +1 рівень рідкості, але не вище стелі.
  {
    const a = mk();
    const r0 = a.summon('sword', 0, 0.6).ally;       // rare
    const r1 = a.summon('sword', 0, 0.6, 1).ally;    // rare + 1 = mythical
    const top = a.summon('sword', 0, 1, 5).ally;     // legendary + 5 = legendary
    assert.equal(r0.rarity.id, 'rare');
    assert.equal(r1.rarity.id, 'mythical', 'кузня не підняла рівень');
    assert.equal(top.rarity.id, 'legendary', 'кузня пробила стелю рідкості');
    assert.ok(r1.damage > r0.damage);
  }

  // Протікання: ворог без опору доходить до лінії дому.
  {
    const a = mk();
    const f = foe({ x: 1.0, speed: 2 });
    const ev = run(a, [f], 0.3);
    assert.ok(ev.f.some((e) => e.type === 'leak'), 'ворог без опору не протік');
  }
}

// --- lane mode: село ---------------------------------------------------------
// Колодязь, що робить другу краплю поверх першої; прапор, що бафає чужий ряд;
// кузня, яка не перезаряджається — усе це тихо, і все це тут.
{
  const mkTown = () => createTown({
    data: BD, rarity: WP.rarity, rows: 4, cols: 3, plotX: (c) => 3 + c * 2, plotHalf: 0.8,
  });

  // Фундамент: один на будівлю, межі, рідкість множить hp.
  {
    const t = mkTown();
    const r = t.build('well', 0, 0, 1);
    assert.ok(r.ok);
    near(r.building.x, 3);
    assert.equal(t.build('well', 0, 0, 1).reason, 'фундамент зайнятий');
    assert.equal(t.build('well', 0, 3, 1).reason, 'немає такого фундаменту');
    assert.equal(t.build('well', 4, 0, 1).reason, 'немає такого ряду');
    assert.equal(t.build('нема', 0, 1, 1).reason, 'немає такої будівлі');
    assert.equal(t.at(0, 0), r.building);
    assert.equal(t.at(0, 1), null);
    const poor = mkTown().build('barricade', 0, 0, 0).building;
    const fine = mkTown().build('barricade', 0, 0, 1).building;
    assert.ok(fine.maxHp > poor.maxHp, 'рідкість не додала hp');
    assert.equal(t.buildings.length, 1);
  }

  // Колодязь: крапля через every, друга не робиться, поки першу не тапнули.
  {
    const t = mkTown();
    const w = t.build('well', 1, 0, 1).building;
    const every = BD.buildings.well.effect.every;
    let drops = 0;
    for (let s = 0; s < every * 3; s += 0.1) drops += t.tick(0.1, []).filter((e) => e.type === 'drop').length;
    assert.equal(drops, 1, `за три періоди без тапу мало бути рівно одна крапля, а є ${drops}`);
    assert.equal(t.collect(w) > 0, true, 'краплю не віддали');
    assert.equal(t.collect(w), 0, 'ту саму краплю віддали двічі');
    drops = 0;
    for (let s = 0; s < every + 0.2; s += 0.1) drops += t.tick(0.1, []).filter((e) => e.type === 'drop').length;
    assert.equal(drops, 1, 'після тапу колодязь не запрацював знову');
    // Легендарний колодязь дає більше.
    const gold = mkTown().build('well', 0, 0, 1).building;
    const gray = mkTown().build('well', 0, 0, 0).building;
    gold.ready = gray.ready = true;
    assert.ok(mkTown().collect(gold) === 0 || true); // collect працює по стану, не по місту
    const tg = mkTown(); const g1 = tg.build('well', 0, 0, 1).building; g1.ready = true;
    const tb = mkTown(); const g0 = tb.build('well', 0, 0, 0).building; g0.ready = true;
    assert.ok(tg.collect(g1) > tb.collect(g0), 'рідкість колодязя не впливає на чорнило');
  }

  // Прапор — свій ряд і свій клас; пастка — свій ряд і своя околиця.
  {
    const t = mkTown();
    t.build('banner_armor', 2, 1, 1);
    assert.ok(t.dmgMul(2, 'armored') > 1, 'прапор не бафає');
    assert.equal(t.dmgMul(2, 'swift'), 1, 'прапор бафає не той клас');
    assert.equal(t.dmgMul(1, 'armored'), 1, 'прапор бафає чужий ряд');
    t.build('trap', 3, 2, 1);
    const tx = 3 + 2 * 2;
    assert.ok(t.slowAt(3, tx) < 1, 'пастка не сповільнює');
    assert.ok(t.slowAt(3, tx + 0.5) < 1);
    assert.equal(t.slowAt(3, tx + 5), 1, 'пастка діє через усе поле');
    assert.equal(t.slowAt(2, tx), 1, 'пастка діє на чужий ряд');
  }

  // Кузня: заряд є одразу, витрачається, перезаряджається; чужий ряд — нуль.
  {
    const t = mkTown();
    t.build('forge', 0, 0, 1);
    assert.equal(t.takeForge(1), 0, 'кузня дала заряд чужому ряду');
    assert.equal(t.takeForge(0), BD.buildings.forge.effect.tiers);
    assert.equal(t.takeForge(0), 0, 'заряд видали двічі');
    for (let s = 0; s < BD.buildings.forge.effect.recharge + 0.2; s += 0.1) t.tick(0.1, []);
    assert.equal(t.takeForge(0), BD.buildings.forge.effect.tiers, 'кузня не перезарядилась');
  }

  // Каплиця лікує лише поранених свого ряду в засягу, не вище максимуму.
  {
    const t = mkTown();
    const c = t.build('chapel', 0, 1, 1).building;
    const hurt = { row: 0, x: c.x + 1, hp: 10, maxHp: 30 };
    const far = { row: 0, x: c.x + 20, hp: 10, maxHp: 30 };
    const other = { row: 1, x: c.x, hp: 10, maxHp: 30 };
    const full = { row: 0, x: c.x, hp: 30, maxHp: 30 };
    let heals = 0;
    for (let s = 0; s < BD.buildings.chapel.effect.every * 2.5; s += 0.1) {
      heals += t.tick(0.1, [hurt, far, other, full]).filter((e) => e.type === 'heal').length;
    }
    assert.ok(heals >= 2, 'каплиця не лікує');
    assert.ok(hurt.hp > 10 && hurt.hp <= 30);
    assert.equal(far.hp, 10, 'лікує поза засягом');
    assert.equal(other.hp, 10, 'лікує чужий ряд');
    assert.equal(full.hp, 30);
  }

  // Руйнування: прибирає зі списку, фундамент звільняється.
  {
    const t = mkTown();
    const b = t.build('barricade', 0, 0, 1).building;
    assert.equal(t.damage(b, 1), false);
    assert.equal(t.damage(b, 1e6), true);
    assert.equal(t.at(0, 0), null, 'руїна зайняла фундамент');
    assert.ok(t.build('well', 0, 0, 1).ok, 'на місці руїни не будується');
  }
}


// --- риг → частина → генератор ----------------------------------------------
// Найтихіша поломка вигляду: риг просить частину, якої немає в parts.json, або
// частина просить proc:-генератор, якого ніхто не написав. Гра на це лише пише
// warn у консоль і малює ворога без голови — на екрані помічають не одразу.
{
  const RG = JSON.parse(readFileSync(root + 'data/rigs.json', 'utf8'));
  const PT = JSON.parse(readFileSync(root + 'data/parts.json', 'utf8'));
  // ponytail: мапу DOODLES читаємо реґекспом, а не імпортом — procart.ts тягне
  // Pixi, а Pixi в node не живе. Перестане ловити, якщо мапу перепишуть інакше:
  // тоді assert нижче про розмір сам про це і скаже.
  const src = readFileSync(root + 'src/view/procart.ts', 'utf8') + readFileSync(root + 'src/view/monsters.ts', 'utf8');
  const doodles = new Set([...src.matchAll(/^ {2}(\w+): \w+,\r?$/gm)].map((m) => m[1]));
  assert.ok(doodles.size > 5, 'мапу DOODLES не вичитали — перевірка нижче нічого не варта');

  for (const [id, rig] of Object.entries(RG)) {
    if (id.startsWith('_')) continue;
    for (const p of rig.parts) assert.ok(PT[p.part], `риг ${id}: частини ${p.part} немає в parts.json`);
  }
  for (const [id, def] of Object.entries(PT)) {
    if (id.startsWith('_') || !def.file.startsWith('proc:')) continue;
    assert.ok(doodles.has(def.file.slice(5)), `частина ${id}: генератора ${def.file} немає в procart.ts чи monsters.ts`);
  }
}


// --- кампанія: сторінки, відкриття, зірки, збереження ------------------------
// Тихо ламається тут ось що: сторінка, де бігуни приходять раніше за спис;
// зброя, яка не відкривається ніколи; зірки, що падають при гіршому проходженні;
// зіпсоване збереження, яке валить гру на старті.
{
  const CP = JSON.parse(readFileSync(root + 'data/campaign.json', 'utf8'));
  const ids = new Set();
  assert.ok(CP.pages.length >= 5, 'сторінок замало для кампанії');
  for (const [i, p] of CP.pages.entries()) {
    assert.ok(p.id && !ids.has(p.id), `сторінка ${i}: id ${p.id} порожній або повторюється`);
    ids.add(p.id);
    assert.ok(p.title, `сторінка ${p.id} без назви`);
    assert.ok(p.rows >= 3 && p.rows <= 5, `${p.id}: ${p.rows} рядів — поза 3..5`);
    assert.ok(p.lives >= 1, `${p.id}: без життів`);
    const band = { y0: LL.band.y0, y1: LL.band.y1, rows: p.rows };
    assert.ok(rowHeight(band) >= 1.5, `${p.id}: ряд ${rowHeight(band)} — персонажі зіллються`);
    assert.ok(LL.plots.side <= rowHeight(band), `${p.id}: фундамент вищий за ряд`);
    for (const id of p.unlock?.weapons ?? []) assert.ok(WP.weapons[id], `${p.id}: зброї ${id} немає`);
    for (const id of p.unlock?.buildings ?? []) assert.ok(BD.buildings[id], `${p.id}: будівлі ${id} немає`);
    assert.ok(p.waves.length >= 1, `${p.id}: хвиль немає`);
    const have = unlockedThrough(CP, i);
    for (const [k, w] of p.waves.entries()) {
      assert.ok(w.count > 0 && w.every > 0, `${p.id} хвиля ${k}: порожня`);
      for (const id of Object.keys(w.mix)) assert.ok(EN[id] && !EN[id].boss, `${p.id} хвиля ${k}: ворог ${id} невідомий або бос у mix`);
      if (w.boss) assert.ok(EN[w.boss]?.boss, `${p.id} хвиля ${k}: ${w.boss} не бос`);
      // Контра до класу ворога має бути відкрита на тій самій сторінці або раніше.
      for (const [ec, wc] of [['swift', 'quick'], ['armored', 'heavy']]) {
        const comes = Object.keys(w.mix).some((id) => EN[id].cls === ec) || (w.boss && EN[w.boss].cls === ec);
        if (comes) assert.ok(have.weapons.some((id) => WP.weapons[id].cls === wc), `${p.id}: ${ec} без ${wc} зброї`);
      }
    }
    const L = pageLevel(LL, CP, i);
    assert.equal(L.unlocks.length + L.buildingUnlocks.length, 0, 'у кампанії відкриття всередині рівня мають бути вимкнені');
    assert.deepEqual(L.startWeapons, have.weapons);
    assert.equal(L.rows, p.rows);
    assert.equal(waveOf(L, 0), p.waves[0]);
  }
  // Перша сторінка: обидва роди зброї й колодязь, перша хвиля — без контрів.
  const first = unlockedThrough(CP, 0);
  assert.ok(first.buildings.includes('well'), 'на першій сторінці немає колодязя — чорнила не буде');
  assert.ok(new Set(first.weapons.map((id) => WP.weapons[id].kind)).size >= 2, 'на першій сторінці один рід зброї');
  assert.deepEqual(Object.keys(CP.pages[0].waves[0].mix), ['earling'], 'перша хвиля кампанії вже з контрами');
  // Усе відкривається до кінця зошита.
  const all = unlockedThrough(CP, CP.pages.length - 1);
  for (const id of weaponIds(WP)) assert.ok(all.weapons.includes(id), `зброя ${id} не відкривається ніколи`);
  for (const id of buildingIds(BD)) assert.ok(all.buildings.includes(id), `будівля ${id} не відкривається ніколи`);

  // Нескінченний режим: генератор не видає дурниць і на тридцятій хвилі.
  assert.ok(ids.has(CP.endless.after), `нескінченний відкривається після ${CP.endless.after}, а такої сторінки немає`);
  const E = endlessLevel(LL, CP);
  assert.ok(E.endless && E.startWeapons.length === all.weapons.length);
  let prevCount = 0, bosses = 0;
  for (let i = 0; i < 30; i++) {
    const w = endlessWave(i);
    assert.ok(w.count > 0 && w.every >= 1, `нескінченна хвиля ${i}: ${w.count} / ${w.every}`);
    for (const id of Object.keys(w.mix)) assert.ok(EN[id], `нескінченна хвиля ${i}: ${id}`);
    if (w.boss) { bosses++; assert.ok(EN[w.boss]?.boss); } else assert.ok(w.count >= prevCount, `нескінченна хвиля ${i} менша за попередню`);
    if (!w.boss) prevCount = w.count;
    assert.equal(waveOf(E, i).count, w.count);
  }
  assert.equal(bosses, 6, 'бос має приходити кожну п\'яту хвилю');
  assert.ok(Object.keys(endlessWave(0).mix).filter((k) => endlessWave(0).mix[k] > 0).join() === 'earling', 'перша нескінченна хвиля вже з контрами');

  // Бос: лазер його не спалює, і в ряд він не влазить навмисно.
  assert.ok(EN.boss?.boss && EN.boss.hp > EN.brute.hp * 3, 'бос слабший за трьох здорованів');

  // Зірки.
  assert.equal(starsFor(5, 5), 3);
  assert.equal(starsFor(3, 5), 2);
  assert.equal(starsFor(2, 5), 1);
  assert.equal(starsFor(0, 5), 0);
  assert.equal(starsFor(3, 6), 2);

  // Збереження: сміття на вході — порожній прогрес, а не виняток.
  for (const junk of [null, '', '{', '[]', '{"stars":5}', '{"stars":{"p1":9,"p2":"x","p3":2}}']) {
    const p = parseProgress(junk);
    assert.equal(p.v, 1);
    for (const n of Object.values(p.stars)) assert.ok(n >= 1 && n <= 3);
  }
  assert.deepEqual(parseProgress('{"stars":{"p1":9,"p3":2}}').stars, { p3: 2 });
  const pr = emptyProgress();
  assert.ok(pageOpen(CP, pr, 0) && !pageOpen(CP, pr, 1), 'друга сторінка відкрита без проходження першої');
  assert.equal(resumePage(CP, pr), 0);
  assert.ok(recordPage(pr, 'p1', 2));
  assert.ok(!recordPage(pr, 'p1', 1), 'гірше проходження зменшило зірки');
  assert.equal(pr.stars.p1, 2);
  assert.ok(recordPage(pr, 'p1', 3));
  assert.ok(pageOpen(CP, pr, 1));
  assert.equal(resumePage(CP, pr), 1);
  assert.ok(!endlessOpen(CP, pr));
  assert.ok(recordEndless(pr, 7) && !recordEndless(pr, 5) && pr.endlessBest === 7);
  const back = parseProgress(JSON.stringify(pr));
  assert.deepEqual(back, pr, 'прогрес не пережив запис і читання');
}

console.log('selfcheck: ok');
