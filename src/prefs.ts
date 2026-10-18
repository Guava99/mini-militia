// Small per-device preferences. localStorage can be blocked (private windows), so every access is guarded.

export function getPlayerName(): string {
  try {
    const saved = localStorage.getItem('mm_name');
    if (saved) return saved;
  } catch { /* ignore */ }
  return `Player${Math.floor(100 + Math.random() * 900)}`;
}

export function setPlayerName(name: string) {
  try { localStorage.setItem('mm_name', name); } catch { /* ignore */ }
}

/** The reconnect token lives in sessionStorage: one per tab, so two tabs are two players, but a reload resumes. */
export function sessionStore(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try { return sessionStorage; } catch { return undefined; }
}
