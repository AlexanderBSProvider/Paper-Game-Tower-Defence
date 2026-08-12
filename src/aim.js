// Вибір цілей, який легко зламати тихо, тому живе окремо й без Pixi.

/**
 * Ланцюг рикошету. Від точки влучання стрибаємо до найближчого ворога, якого
 * ще не били, далі — від нього, і так `count` разів.
 *
 * Рахуємо від попередньої жертви, а не від башти: снаряд відскакує від того,
 * у кого щойно влучив, тож ланцюг тягнеться крізь натовп, а не розходиться
 * зіркою з однієї точки.
 *
 * @param {{x:number,y:number}[]} enemies
 * @param {object[]} exclude кого не чіпати (зазвичай перша ціль)
 */
export function chainTargets(x, y, enemies, radius, count, exclude = []) {
  const used = new Set(exclude);
  const out = [];
  let cx = x, cy = y;

  for (let i = 0; i < count; i++) {
    let best = null, bestD = Infinity;
    for (const e of enemies) {
      if (used.has(e)) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d > radius || d >= bestD) continue;
      best = e; bestD = d;
    }
    if (!best) break;
    used.add(best);
    out.push(best);
    cx = best.x; cy = best.y;
  }
  return out;
}

/**
 * Ціль для другого ствола: та, що з іншого боку від першої.
 * Без перевірки напрямку «б'є у два боки» вироджується в подвійний постріл
 * в одного й того самого ворога.
 */
export function oppositeTarget(tx, ty, first, enemies, radius, rank) {
  const fx = first.x - tx, fy = first.y - ty;
  let best = null, bestR = Infinity;
  for (const e of enemies) {
    if (e === first) continue;
    const dx = e.x - tx, dy = e.y - ty;
    if (Math.hypot(dx, dy) > radius) continue;
    if (dx * fx + dy * fy >= 0) continue; // той самий бік
    const r = rank(e);
    if (r >= bestR) continue;
    best = e; bestR = r;
  }
  return best;
}
