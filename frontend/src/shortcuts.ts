// OS-aware shortcut labels. Key handling accepts both ⌘ and Ctrl everywhere;
// labels follow the current platform (macOS -> ⌘, Windows/Linux -> Ctrl).
export const isMac = () =>
  typeof navigator !== 'undefined' &&
  (/mac|iphone|ipad|ipod|darwin/i.test(navigator.platform || '') ||
    (/mac/i.test(navigator.userAgent || '') && !/windows/i.test(navigator.userAgent || '')));

export const modLabel = () => (isMac() ? '⌘' : 'Ctrl');
export const modShiftLabel = () => (isMac() ? '⇧⌘' : 'Ctrl+Shift');
export const enterLabel = () => (isMac() ? '⌘⏎' : 'Ctrl+Enter');

// Remappable global bindings (mod = Ctrl/Cmd always). Stored in localStorage.
export interface KeyBind { key: string; shift?: boolean }
export const DEFAULT_BINDS: Record<'palette' | 'send' | 'models', KeyBind> = {
  palette: { key: 'k' },
  send: { key: 'Enter' },
  models: { key: 'p', shift: true },
};
export function loadBinds(): Record<'palette' | 'send' | 'models', KeyBind> {
  // deep copy: callers must never mutate the shared DEFAULT_BINDS entries
  const fresh = (): Record<'palette' | 'send' | 'models', KeyBind> => ({
    palette: { ...DEFAULT_BINDS.palette },
    send: { ...DEFAULT_BINDS.send },
    models: { ...DEFAULT_BINDS.models },
  });
  try {
    const raw = localStorage.getItem('od.binds');
    if (!raw) return fresh();
    const p = JSON.parse(raw);
    const out = fresh();
    for (const k of Object.keys(DEFAULT_BINDS) as (keyof typeof DEFAULT_BINDS)[]) {
      const b = p[k];
      if (b && typeof b.key === 'string' && b.key.length <= 12) out[k] = { key: b.key, shift: !!b.shift };
    }
    return out;
  } catch { return fresh(); }
}
export function saveBinds(b: Record<'palette' | 'send' | 'models', KeyBind>) {
  try { localStorage.setItem('od.binds', JSON.stringify(b)); } catch { /* ignore */ }
}
export function matchBind(e: KeyboardEvent, b: KeyBind) {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !!e.shiftKey === !!b.shift && e.key.toLowerCase() === b.key.toLowerCase();
}
export function bindLabel(b: KeyBind) {
  return `${modLabel()}${b.shift ? '+Shift' : ''}+${b.key.length === 1 ? b.key.toUpperCase() : b.key}`;
}

export const shortcutText = {
  get palette() { try { return bindLabel(loadBinds().palette); } catch { return `${modLabel()}K`; } },
  get send() { try { return bindLabel(loadBinds().send); } catch { return enterLabel(); } },
  get models() { try { return bindLabel(loadBinds().models); } catch { return `${modShiftLabel()}P`; } },
};
