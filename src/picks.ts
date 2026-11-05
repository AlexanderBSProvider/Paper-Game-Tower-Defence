// Вибір форм ворогів із шоуруму: роль → риг. Живе в localStorage, щоб гра
// одразу показувала обране. Остаточний вибір переноситься в laneEnemies.json —
// тоді цей механізм лише не заважає (порожній вибір нічого не перекриває).

const KEY = 'paper-td:enemy-picks:v1';

export type Picks = Record<string, string>;

export function loadPicks(): Picks {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return d && typeof d === 'object' ? d as Picks : {};
  } catch { return {}; }
}

export function savePicks(p: Picks): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* інкогніто: просто без збереження */ }
}

/** Перекрити риги ролей тим, що обрано в шоурумі (лише існуючими ригами). */
export function applyPicks<T extends { rig: string }>(enemies: Record<string, T>, rigs: Record<string, unknown>, p = loadPicks()): void {
  for (const [role, rig] of Object.entries(p)) {
    if (enemies[role] && rigs[rig]) enemies[role].rig = rig;
  }
}
