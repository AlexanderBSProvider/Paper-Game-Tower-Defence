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
import { createBuild, qualityMul, gunOf, inkMul, canReink, MAX_INK } from '../dist/model/build.js';
import { chainTargets, oppositeTarget } from '../dist/model/aim.js';
import { rowY, rowOf, rowHeight } from '../dist/model/lane.js';
import { createSquad } from '../dist/model/squad.js';

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
}

// --- lane mode: загін -------------------------------------------------------
{
  const stats = { hp: 10, damage: 2, rate: 1, life: 10, range: 3, reach: 0.5 };
  const mk = () => createSquad({
    rows: 3, cols: 3, xLeft: 1, xRight: 5,
    melee: stats, ranged: stats,
  });

  // Колонки рівномірні: тил біля вежі, передова праворуч.
  {
    const s = mk();
    near(s.colX(0), 1);
    near(s.colX(1), 3);
    near(s.colX(2), 5);
  }

  // Мілі стає в передову, ренж — у тил. Порядок постановки не має значення:
  // лінія збирається сама, інакше гравець мусив би думати про черговість.
  {
    const s = mk();
    const a = s.add('ranged', 0, 1);
    const b = s.add('melee', 0, 1);
    assert.ok(a.ok && b.ok);
    assert.equal(a.ally.col, 0, 'ренж — у тил');
    assert.equal(b.ally.col, 2, 'мілі — на передову');

    // Другий ренж займає наступну з тилу, а не будь-яку вільну.
    const c = s.add('ranged', 0, 1);
    assert.ok(c.ok);
    assert.equal(c.ally.col, 1);
  }

  // Ряд повний → місце поступається НАЙСЛАБШИЙ за якістю, і саме його колонка
  // дістається новому. Тут легко тихо взяти першого-ліпшого.
  {
    const s = mk();
    s.add('melee', 0, 0.9);
    const weak = s.add('melee', 0, 0.2);
    s.add('melee', 0, 0.8);
    assert.equal(s.allies.length, 3);

    const r = s.add('melee', 0, 1);
    assert.ok(r.ok);
    assert.equal(r.replaced?.id, weak.ally.id, 'виштовхнули не найслабшого');
    assert.equal(r.ally.col, weak.ally.col, 'новий не став на місце виштовханого');
    assert.equal(s.allies.length, 3, 'коробка виросла понад норму');
  }

  // Ряди незалежні: повний нульовий не заважає першому.
  {
    const s = mk();
    for (let i = 0; i < 3; i++) s.add('melee', 0, 1);
    const r = s.add('melee', 1, 1);
    assert.ok(r.ok);
    assert.equal(r.replaced, null, 'вільний ряд не мав нікого виштовхувати');
    assert.equal(s.allies.length, 4);
  }

  assert.equal(s2ok(mk().add('melee', 9, 1)), 'немає такого ряду');
  assert.equal(s2ok(mk().add('melee', -1, 1)), 'немає такого ряду');

  // blockerAt — те, через що ворог або йде далі, або спиняється.
  {
    const s = mk();
    const front = s.add('melee', 0, 1).ally;   // col 2, x = 5
    const back = s.add('melee', 0, 1).ally;    // col 1, x = 3
    s.add('melee', 1, 1);                      // інший ряд — не має впливати
    const shooter = s.add('ranged', 0, 1).ally; // col 0, x = 1

    // Ворог праворуч від усіх: спиняє найправіший мілі, а не найближчий до вежі.
    assert.equal(s.blockerAt(0, 9)?.id, front.id, 'блокує не передовий');
    // Ворог уже проминув передового — далі його тримає наступний.
    assert.equal(s.blockerAt(0, 4)?.id, back.id);
    // Попереду лишився тільки ренжовий — він не блокує.
    assert.equal(s.blockerAt(0, 2), null, 'ренжовий не має блокувати рух');
    assert.notEqual(s.blockerAt(0, 9)?.id, shooter.id);
    // Чужий ряд не рахується.
    assert.equal(s.blockerAt(2, 9), null, 'блокувальник знайшовся не в тому ряду');
  }

  // Якість керує і живучістю, і тим, скільки протримається: недбалий силует
  // згасає раніше за старанний. Це і є та ціна поспіху, на якій тримається бій.
  {
    const s = mk();
    const sloppy = s.add('melee', 0, 0).ally;
    const careful = s.add('melee', 1, 1).ally;
    assert.ok(careful.maxLife > sloppy.maxLife, 'недбалий має в\'янути швидше');
    assert.ok(careful.maxHp > sloppy.maxHp);
    assert.ok(careful.damage > sloppy.damage);

    // Згасання прибирає зі списку й повідомляє, кого саме — щоб хаб зняв риг.
    const gone = s.tick(sloppy.maxLife + 0.01);
    assert.equal(gone.length, 1);
    assert.equal(gone[0].id, sloppy.id);
    assert.ok(!s.allies.includes(sloppy));
    assert.ok(s.allies.includes(careful), 'старанний згас разом із недбалим');
  }

  // Смерть від шкоди прибирає одразу, недобитий лишається.
  {
    const s = mk();
    const a = s.add('melee', 0, 1).ally;
    assert.equal(s.damage(a, 1), false);
    assert.ok(s.allies.includes(a));
    assert.equal(s.damage(a, 1e6), true);
    assert.ok(!s.allies.includes(a), 'мертвий лишився в загоні');
  }

  // Ренжовий несе готовий Gun — combat.ts заводить його тим самим викликом,
  // що й вежу. Без цього ренжові просто не стріляли б.
  {
    const s = mk();
    const r = s.add('ranged', 0, 1).ally;
    const m = s.add('melee', 0, 1).ally;
    assert.ok(r.gun, 'ренжовий без гармати');
    assert.ok(r.gun.damage > 0 && r.gun.range > 0);
    assert.equal(m.gun, undefined, 'мілі не має бути гармати');
  }
}

// --- переобведення деталі ---------------------------------------------------
// Друга вісь росту вежі. Найтихіший спосіб зламати: зробити так, щоб рівень 0
// давав не рівно 1.0 — тоді мовчки поїде баланс лабіринту, який переобведення
// не використовує взагалі.
{
  assert.equal(inkMul(0), 1, 'рівень 0 мусить давати рівно 1.0, інакше поїде лабіринт');
  assert.ok(inkMul(1) > inkMul(0), 'переобведення має підсилювати');
  assert.equal(inkMul(MAX_INK), inkMul(MAX_INK + 99), 'вище стелі не росте');

  const TP = JSON.parse(readFileSync(
    fileURLToPath(new URL('../data/towerparts.json', import.meta.url)), 'utf8'));

  const b = createBuild(TP.parts, TP);
  b.add('stump', null, 1);
  const spikes = b.add('spikes', { node: b.nodes[0].id, name: 'left' }, 1);
  assert.ok(spikes.ok);

  const dmg0 = b.stats().damage;
  assert.equal(b.nodes.find((n) => n.id === spikes.id).ink, 0, 'нова деталь має ink 0');

  const r = b.reink(spikes.id, 1);
  assert.ok(r.ok && r.ink === 1, 'переобведення не підняло рівень');
  assert.ok(b.stats().damage > dmg0, 'переобведення не додало шкоди');

  // Стеля тримається, і зайвий раз чорнило не бере.
  for (let i = 1; i < MAX_INK; i++) assert.ok(b.reink(spikes.id, 1).ok, `рівень ${i + 1} не став`);
  const capped = b.reink(spikes.id, 1);
  assert.ok(!capped.ok, 'переобведення пробило стелю');
  assert.equal(b.nodes.find((n) => n.id === spikes.id).ink, MAX_INK);

  assert.ok(!b.reink(999, 1).ok, 'переобвели неіснуючу деталь');

  // Деталь БЕЗ статів переобводити не можна, і це не дрібниця: заміряно, що
  // inkScale дає тумбі +0.008 радіуса за рівень при ціні 12 чорнила. Мовчки
  // продавати таке — гірше, ніж чесно відмовити.
  {
    const c = createBuild(TP.parts, TP);
    c.add('stump', null, 1);
    assert.equal(TP.parts.stump.stats, undefined, 'тест утратив сенс: у тумби зʼявились стати');
    const base = c.nodes[0];
    assert.equal(canReink(base), false, 'заготовку не мало б бути дозволено переобводити');
    const r = c.reink(base.id, 1);
    assert.ok(!r.ok, 'заготовку переобвели, хоч підсилювати в ній нема чого');
    assert.equal(base.ink, 0, 'відмовлене переобведення все одно підняло рівень');

    // А зброю — можна, і вона від цього росте.
    const w = c.add('spikes', { node: base.id, name: 'left' }, 1);
    const node = c.nodes.find((n) => n.id === w.id);
    assert.equal(canReink(node), true, 'зброю мало б бути дозволено переобводити');
    const dmg0 = c.stats().damage;
    assert.ok(c.reink(w.id, 1).ok);
    assert.ok(c.stats().damage > dmg0, 'переобведення зброї не дало шкоди');

    // canReink закривається на стелі — UI питає саме його, тому воно мусить
    // враховувати не лише стати.
    while (c.reink(w.id, 1).ok) { /* до стелі */ }
    assert.equal(canReink(node), false, 'canReink не бачить стелі');
  }

  // Опис рига несе рівень назовні — інакше гравець не побачив би різниці.
  const def = b.rigDef();
  const grown = def.parts.find((p) => p.part === 'spikes');
  assert.ok(grown.scale > 1, 'переобведена деталь не підросла у rigDef');
  const base = def.parts.find((p) => p.part === 'stump');
  assert.equal(base.scale, 1, 'необведена деталь мусить лишитись розміру 1');
}

// --- lane mode: дані рівня й союзників --------------------------------------
// Найтихіший спосіб зламати режим — перейменувати ключ у JSON: загін мовчки
// візьме дефолти, і союзник стане слабшим, ніж задумано, без жодної помилки.
{
  const root = fileURLToPath(new URL('..', import.meta.url));
  const LL = JSON.parse(readFileSync(root + 'data/laneLevel.json', 'utf8'));
  const AL = JSON.parse(readFileSync(root + 'data/allies.json', 'utf8'));

  // Геометрія рівня має бути осмисленою: вежа зліва, спавн справа, загін між ними.
  assert.ok(LL.towerX < LL.squad.xLeft, 'загін стоїть позаду вежі');
  assert.ok(LL.squad.xLeft < LL.squad.xRight, 'колонки загону переплутані');
  assert.ok(LL.squad.xRight < LL.spawnX, 'передова колонка за точкою спавну');
  assert.ok(LL.band.y0 < LL.band.y1, 'смуга рядів вивернута');
  assert.ok(LL.rows >= 1);
  assert.ok(LL.core.cols > LL.spawnX - 2, `ядро ${LL.core.cols} вужче за спавн ${LL.spawnX}`);

  // Ряди мають лишатись у смузі та не злипатись.
  const band = { y0: LL.band.y0, y1: LL.band.y1, rows: LL.rows };
  assert.ok(rowHeight(band) >= 1, `ряд ${rowHeight(band)} клітинки — вороги зіллються`);
  assert.ok(rowY(band, 0) > band.y0 && rowY(band, LL.rows - 1) < band.y1);
  assert.ok(LL.band.y1 <= LL.core.rows, 'смуга рядів вилазить за ядро');

  assert.ok(LL.waves.length, 'хвиль немає');
  for (const [i, w] of LL.waves.entries()) {
    assert.ok(w.count > 0 && w.every > 0, `хвиля ${i} порожня`);
    assert.ok(w.row == null || (w.row >= 0 && w.row < LL.rows), `хвиля ${i}: ряду ${w.row} не існує`);
  }

  // Обидва типи союзників мають бути в каталозі — squad.ts шукає їх за іменем.
  for (const kind of ['melee', 'ranged']) {
    const d = AL[kind];
    assert.ok(d, `у allies.json немає ${kind}`);
    assert.ok(d.outline?.length, `${kind}: немає контуру`);
    for (const [i, s] of d.outline.entries()) {
      assert.ok(s.length >= 2, `${kind}: штрих ${i} з однієї точки`);
      for (const [x, y] of s) {
        assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1,
          `${kind}: точка (${x},${y}) поза коробкою 0..1 — обведення промахнеться повз рамку`);
      }
    }
    assert.ok(d.stats.hp > 0 && d.stats.damage > 0 && d.stats.rate > 0 && d.stats.life > 0,
      `${kind}: стати неповні`);
    assert.ok(d.cost > 0, `${kind}: без ціни`);
  }
  assert.ok(AL.ranged.stats.range > 0, 'ренжовий без радіуса — стрілятиме впритул');
  assert.ok(AL.melee.stats.reach > 0, 'мілі без reach — не зупинить нікого');

  // Найголовніше: справжні дані справді дають робочий загін.
  const squad = createSquad({
    rows: LL.rows, cols: LL.squad.cols,
    xLeft: LL.squad.xLeft, xRight: LL.squad.xRight,
    melee: AL.melee.stats, ranged: AL.ranged.stats,
  });
  const m = squad.add('melee', 0, 1).ally;
  const r = squad.add('ranged', 0, 1).ally;
  assert.ok(m.hp > 0 && m.damage > 0 && m.reach > 0, 'мілі зібрався з дефолтів, а не з даних');
  assert.ok(r.gun.range > 1, 'ренжовому не доїхав радіус із даних');
  assert.ok(m.x > r.x, 'мілі має стояти попереду ренжового');
  assert.equal(squad.blockerAt(0, LL.spawnX)?.id, m.id, 'мілі з даних не блокує');
}

/** Причина відмови add(), щоб не розписувати ok-перевірку щоразу. */
function s2ok(r) {
  return r.ok ? null : r.reason;
}

console.log('selfcheck: ok');
