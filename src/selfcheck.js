// Селфчек математики, яку легко зламати тихо. Фреймворків не ставимо:
//   node src/selfcheck.js
// Мовчазний вихід 0 = все гаразд.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPath, posAt, distToPath } from './pathmath.js';
import { createGrid, lineCells, WALL, BASE } from './grid.js';
import { computeFlow, reaches, stepFrom, routeFrom, simplify, wouldSeal } from './flow.js';
import { createWallet } from './economy.js';
import { makeTemplate, scoreTrace, magnetize, resample, nearestOn } from './trace.js';
import { createBuild, qualityMul, gunOf } from './build.js';

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
}

console.log('selfcheck: ok');
