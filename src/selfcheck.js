// Селфчек математики, яку легко зламати тихо. Фреймворків не ставимо:
//   node src/selfcheck.js
// Мовчазний вихід 0 = все гаразд.

import assert from 'node:assert/strict';
import { buildPath, posAt, distToPath } from './pathmath.js';
import { createGrid, lineCells, WALL, BASE } from './grid.js';
import { computeFlow, reaches, stepFrom, routeFrom, simplify, wouldSeal, distAt } from './flow.js';
import { createWallet } from './economy.js';
import { pickTarget, leadPoint, splashHits } from './combat.js';

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

// --- бій -------------------------------------------------------------------

// distAt каже те саме, що reaches, але числом і без -1 назовні
{
  const g = mkGrid();
  const f = computeFlow(g, GOALS);
  assert.equal(distAt(f, 2, 0), 5);
  assert.equal(distAt(f, 2, 5), 0);
  assert.equal(distAt(f, -1, 0), Infinity);   // поза полем
  assert.equal(distAt(f, 0, 99), Infinity);
  g.fill(1, 1, 1, 1, WALL);
  assert.equal(distAt(computeFlow(g, GOALS), 1, 1), Infinity); // під стіною
}

// Ціль: не найближчий, а той, кому лишилось найменше до бази
{
  const rank = (e) => e.rank;
  const far = { x: 0, y: 0, hp: 10, rank: 9 };   // поруч із баштою, але щойно зайшов
  const near = { x: 2, y: 0, hp: 10, rank: 2 };  // далі, але майже дійшов
  assert.equal(pickTarget(0, 0, 5, [far, near], rank), near);

  // Поза радіусом не рахується, хоч би як близько був до бази
  assert.equal(pickTarget(0, 0, 1.5, [far, near], rank), far);
  assert.equal(pickTarget(0, 0, 5, [], rank), null);
  assert.equal(pickTarget(9, 9, 1, [far, near], rank), null);

  // Мертвих не добиваємо
  assert.equal(pickTarget(0, 0, 5, [{ x: 0, y: 0, hp: 0, rank: 1 }], rank), null);

  // Радіус включний: рівно на межі ще ціль
  assert.ok(pickTarget(0, 0, 2, [{ x: 2, y: 0, hp: 1, rank: 1 }], rank));
  assert.equal(pickTarget(0, 0, 2, [{ x: 2.001, y: 0, hp: 1, rank: 1 }], rank), null);

  // Рівні за прогресом — б'ємо ближчого (коротший підліт)
  const a = { x: 3, y: 0, hp: 1, rank: 4 };
  const b = { x: 1, y: 0, hp: 1, rank: 4 };
  assert.equal(pickTarget(0, 0, 5, [a, b], rank), b);

  // Усі недосяжні (ще над полем) — ціль усе одно є, найближча
  const u1 = { x: 4, y: 0, hp: 1, rank: Infinity };
  const u2 = { x: 1, y: 0, hp: 1, rank: Infinity };
  assert.equal(pickTarget(0, 0, 5, [u1, u2], rank), u2);
}

// Упередження: снаряд і ціль мають опинитись у точці зустрічі одночасно
{
  // Ціль іде вниз на 1/с, снаряд 2/с, старт у неї над головою на 2 клітинки
  const m = leadPoint(0, 0, 0, 2, 0, 1, 2);
  near(m.t, 2);          // 2 + 1*t = 2*t  →  t = 2
  near(m.y, 4);
  near(m.x, 0);

  // Нерухома ціль — просто час прольоту
  const still = leadPoint(0, 0, 3, 4, 0, 0, 5);
  near(still.t, 1);
  near(still.x, 3); near(still.y, 4);

  // Загальний випадок: у точці зустрічі шляхи справді сходяться
  for (const [tx, ty, vx, vy, sp] of [[5, 1, -1, 0.5, 4], [-3, 6, 1.5, -1, 6], [2, 2, 0, -1.5, 3]]) {
    const r = leadPoint(0, 0, tx, ty, vx, vy, sp);
    near(Math.hypot(r.x, r.y), sp * r.t, 1e-6); // снаряд встигає рівно за r.t
    near(r.x, tx + vx * r.t, 1e-6);             // і ціль приходить туди ж
    near(r.y, ty + vy * r.t, 1e-6);
    assert.ok(r.t > 0, 'час зустрічі має бути в майбутньому');
  }

  // Ціль швидша за снаряд і тікає — зустрічі немає, б'ємо по поточній позиції
  const escape = leadPoint(0, 0, 1, 0, 10, 0, 2);
  near(escape.x, 1); near(escape.y, 0);
  assert.ok(Number.isFinite(escape.t));

  // Ціль тікає рівно зі швидкістю снаряда: вироджений випадок не дає NaN
  const same = leadPoint(0, 0, 2, 0, 3, 0, 3);
  assert.ok(Number.isFinite(same.x) && Number.isFinite(same.y));
}

// Сплеш
{
  const es = [
    { x: 0, y: 0, hp: 5 },
    { x: 1, y: 0, hp: 5 },
    { x: 3, y: 0, hp: 5 },
    { x: 0.5, y: 0, hp: 0 }, // вже закреслений
  ];
  assert.equal(splashHits(0, 0, 1.5, es).length, 2);
  assert.equal(splashHits(0, 0, 0, es).length, 1);   // рівно в точці
  assert.equal(splashHits(9, 9, 1, es).length, 0);
  // Радіус включний
  assert.equal(splashHits(0, 0, 1, es).length, 2);
}

console.log('selfcheck: ok');
