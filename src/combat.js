// Бойова математика: кого бити, куди стріляти, кого зачепить вибух.
//
// Без Pixi і без власного стану — тому ганяється в node (див. selfcheck.js).
// Координати й радіуси в клітинках, швидкості в клітинках/с.

/**
 * Ціль для башти.
 *
 * Б'ємо не по найближчому, а по тому, кому лишилось найменше кроків до бази.
 * Найближчий міг щойно зайти в радіус і має попереду півполя; той, хто майже
 * дійшов, — остання нагода його зупинити. `rank` бере ту саму BFS-відстань,
 * якою ворог і йде, тож політика вогню тримається на тих же числах, що й рух,
 * і сама перебудовується, щойно гравець перекроїв лабіринт.
 *
 * @param {number} x         позиція башти
 * @param {number} y
 * @param {number} range     радіус у клітинках
 * @param {{x:number,y:number,hp:number}[]} enemies кандидати
 * @param {(e:object) => number} rank менше = ближче до бази, Infinity = недосяжний
 * @returns {object|null}
 */
export function pickTarget(x, y, range, enemies, rank) {
  const r2 = range * range;
  let best = null, bestRank = Infinity, bestD2 = Infinity;

  for (const e of enemies) {
    if (e.hp <= 0) continue;
    const dx = e.x - x, dy = e.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;

    const rk = rank(e);
    // Рівні за прогресом — беремо ближчого: у нього коротший підліт.
    if (rk < bestRank || (rk === bestRank && d2 < bestD2)) {
      best = e; bestRank = rk; bestD2 = d2;
    }
  }
  return best;
}

/**
 * Точка зустрічі зі снарядом скінченної швидкості.
 *
 * Ядро гармати летить помітний час, і якщо цілитись у поточну позицію, сплеш
 * лягає ворогові за спину — на швидкості 1.5 клітинки/с він встигає вийти з
 * радіуса. Розв'язуємо |d + v·t| = speed·t відносно t.
 *
 * @returns {{t:number, x:number, y:number}} час підльоту й куди вести.
 *   Якщо зустрічі не існує (ціль швидша за снаряд і тікає) — б'ємо по
 *   поточній позиції: снаряд просто наздоганяє, скільки вийде.
 */
export function leadPoint(sx, sy, tx, ty, vx, vy, speed) {
  const dx = tx - sx, dy = ty - sy;
  const a = vx * vx + vy * vy - speed * speed;
  const b = 2 * (dx * vx + dy * vy);
  const c = dx * dx + dy * dy;

  let t = null;
  if (Math.abs(a) < 1e-9) {
    // Ціль тікає рівно зі швидкістю снаряда — лишається лінійне рівняння.
    if (Math.abs(b) > 1e-9) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      // Найраніша додатна зустріч: пізніша дає той самий постріл, тільки довший.
      for (const r of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
        if (r > 0 && (t == null || r < t)) t = r;
      }
    }
  }

  if (t == null || !Number.isFinite(t)) {
    return { t: speed > 0 ? Math.hypot(dx, dy) / speed : 0, x: tx, y: ty };
  }
  return { t, x: tx + vx * t, y: ty + vy * t };
}

/** Кого накриє вибух радіуса r у точці (x, y). */
export function splashHits(x, y, r, enemies) {
  const r2 = r * r;
  return enemies.filter((e) => e.hp > 0 && (e.x - x) ** 2 + (e.y - y) ** 2 <= r2);
}
