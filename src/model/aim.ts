// Вибір цілей, який легко зламати тихо, тому живе окремо й без Pixi.

/** Мінімум, який потрібен цим функціям. Дженерик, а не Enemy: так combat
 *  отримує назад свої ж Enemy, а selfcheck ганяє їх на голих {x,y}. */
interface Pt {
  x: number;
  y: number;
}

/**
 * Ланцюг рикошету. Від точки влучання стрибаємо до найближчого ворога, якого
 * ще не били, далі — від нього, і так `count` разів.
 *
 * Рахуємо від попередньої жертви, а не від башти: снаряд відскакує від того,
 * у кого щойно влучив, тож ланцюг тягнеться крізь натовп, а не розходиться
 * зіркою з однієї точки.
 *
 * @param exclude кого не чіпати (зазвичай перша ціль)
 */
export function chainTargets<T extends Pt>(
  x: number, y: number, enemies: readonly T[],
  radius: number, count: number, exclude: readonly T[] = [],
): T[] {
  const used = new Set<T>(exclude);
  const out: T[] = [];
  let cx = x, cy = y;

  for (let i = 0; i < count; i++) {
    let best: T | null = null, bestD = Infinity;
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
export function oppositeTarget<T extends Pt>(
  tx: number, ty: number, first: T, enemies: readonly T[],
  radius: number, rank: (e: T) => number,
): T | null {
  const fx = first.x - tx, fy = first.y - ty;
  let best: T | null = null, bestR = Infinity;
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
