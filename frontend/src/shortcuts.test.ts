// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BINDS,
  bindLabel,
  loadBinds,
  matchBind,
  saveBinds,
  shortcutText,
  modLabel,
  modShiftLabel,
  enterLabel,
  isMac,
} from './shortcuts';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function kb(key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey,
    shiftKey: !!opts.shiftKey,
    altKey: !!opts.altKey,
    bubbles: true,
  } as KeyboardEventInit);
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals?.();
});

describe('DEFAULT_BINDS values', () => {
  it('palette defaults to k without shift', () => {
    expect(DEFAULT_BINDS.palette).toEqual({ key: 'k' });
  });
  it('send defaults to Enter without shift', () => {
    expect(DEFAULT_BINDS.send).toEqual({ key: 'Enter' });
  });
  it('models defaults to p with shift', () => {
    expect(DEFAULT_BINDS.models).toEqual({ key: 'p', shift: true });
  });
  it('has exactly three binds', () => {
    expect(Object.keys(DEFAULT_BINDS).sort()).toEqual(['models', 'palette', 'send']);
  });
});

describe('loadBinds', () => {
  it('returns defaults when nothing stored', () => {
    expect(loadBinds()).toEqual(DEFAULT_BINDS);
  });
  it('returns defaults on corrupt JSON', () => {
    localStorage.setItem('od.binds', '{not json');
    expect(loadBinds()).toEqual(DEFAULT_BINDS);
  });
  it('returns defaults when stored value is a JSON non-object', () => {
    localStorage.setItem('od.binds', JSON.stringify([1, 2, 3]));
    expect(loadBinds()).toEqual(DEFAULT_BINDS);
  });
  it('applies partial overrides and keeps other defaults', () => {
    localStorage.setItem('od.binds', JSON.stringify({ palette: { key: 'j' } }));
    const b = loadBinds();
    expect(b.palette).toEqual({ key: 'j', shift: false });
    expect(b.send).toEqual(DEFAULT_BINDS.send);
    expect(b.models).toEqual(DEFAULT_BINDS.models);
  });
  it('ignores entries with non-string key', () => {
    localStorage.setItem('od.binds', JSON.stringify({ palette: { key: 42 } }));
    expect(loadBinds().palette).toEqual(DEFAULT_BINDS.palette);
  });
  it('ignores keys longer than 12 chars', () => {
    localStorage.setItem('od.binds', JSON.stringify({ send: { key: 'AVeryLongKeyName123' } }));
    expect(loadBinds().send).toEqual(DEFAULT_BINDS.send);
  });
  it('accepts a 12-char key', () => {
    const k = 'A'.repeat(12);
    localStorage.setItem('od.binds', JSON.stringify({ send: { key: k } }));
    expect(loadBinds().send.key).toBe(k);
  });
  it('coerces shift to boolean', () => {
    localStorage.setItem('od.binds', JSON.stringify({ models: { key: 'x', shift: 1 } }));
    expect(loadBinds().models).toEqual({ key: 'x', shift: true });
  });
  it('ignores unknown bind names', () => {
    localStorage.setItem('od.binds', JSON.stringify({ palette: { key: 'j' }, extra: { key: 'z' } }));
    const b = loadBinds() as any;
    expect(b.extra).toBeUndefined();
    expect(b.palette.key).toBe('j');
  });
  it('does not poison defaults when localStorage is empty across calls', () => {
    expect(loadBinds()).toEqual(loadBinds());
    expect(DEFAULT_BINDS.palette.key).toBe('k');
  });
  it('returns deep copies: mutating the result never touches DEFAULT_BINDS (FIXED shallow-copy bug)', () => {
    const b = loadBinds();
    b.palette.key = 'MUTATED';
    b.send.shift = true;
    expect(DEFAULT_BINDS.palette).toEqual({ key: 'k' });
    expect(DEFAULT_BINDS.send).toEqual({ key: 'Enter' });
    expect(loadBinds().palette).toEqual({ key: 'k' });
  });
});

describe('saveBinds round-trip', () => {
  it('persists and reloads custom binds', () => {
    saveBinds({ palette: { key: 'j' }, send: { key: 'Enter' }, models: { key: 'o', shift: true } });
    expect(loadBinds()).toEqual({ palette: { key: 'j', shift: false }, send: { key: 'Enter', shift: false }, models: { key: 'o', shift: true } });
  });
  it('round-trips shift flags', () => {
    saveBinds({ palette: { key: 'k', shift: true }, send: { key: 's' }, models: { key: 'p' } });
    const b = loadBinds();
    expect(b.palette.shift).toBe(true);
    expect(b.models.shift).toBe(false);
  });
  it('does not throw when localStorage.setItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('denied'); });
    expect(() => saveBinds(DEFAULT_BINDS)).not.toThrow();
    spy.mockRestore();
  });
});

describe('matchBind', () => {
  it('matches ctrl+k for palette', () => {
    expect(matchBind(kb('k', { ctrlKey: true }), { key: 'k' })).toBe(true);
  });
  it('matches meta(cmd)+k as mod variant', () => {
    expect(matchBind(kb('k', { metaKey: true }), { key: 'k' })).toBe(true);
  });
  it('rejects when neither ctrl nor meta is held', () => {
    expect(matchBind(kb('k'), { key: 'k' })).toBe(false);
  });
  it('requires exact shift match: shift held but bind has none', () => {
    expect(matchBind(kb('k', { ctrlKey: true, shiftKey: true }), { key: 'k' })).toBe(false);
  });
  it('requires exact shift match: shift missing but bind needs it', () => {
    expect(matchBind(kb('p', { ctrlKey: true }), { key: 'p', shift: true })).toBe(false);
  });
  it('matches when both require shift', () => {
    expect(matchBind(kb('p', { ctrlKey: true, shiftKey: true }), { key: 'p', shift: true })).toBe(true);
  });
  it('rejects when alt is held', () => {
    expect(matchBind(kb('k', { ctrlKey: true, altKey: true }), { key: 'k' })).toBe(false);
  });
  it('is case-insensitive on the key', () => {
    expect(matchBind(kb('K', { ctrlKey: true }), { key: 'k' })).toBe(true);
    expect(matchBind(kb('k', { ctrlKey: true }), { key: 'K' })).toBe(true);
  });
  it('matches multi-char keys like Enter', () => {
    expect(matchBind(kb('Enter', { ctrlKey: true }), { key: 'Enter' })).toBe(true);
  });
  it('matches multi-char keys case-insensitively', () => {
    expect(matchBind(kb('enter', { ctrlKey: true }), { key: 'Enter' })).toBe(true);
  });
  it('rejects wrong key', () => {
    expect(matchBind(kb('j', { ctrlKey: true }), { key: 'k' })).toBe(false);
  });
});

describe('labels follow platform + custom binds', () => {
  it('modLabel is Cmd glyph on mac', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Mac' });
    expect(modLabel()).toBe('⌘');
  });
  it('modLabel is Ctrl off mac', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows NT' });
    expect(modLabel()).toBe('Ctrl');
  });
  it('bindLabel uppercases single-char keys', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' });
    expect(bindLabel({ key: 'k' })).toBe('Ctrl+K');
  });
  it('bindLabel keeps multi-char keys as-is', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' });
    expect(bindLabel({ key: 'Enter' })).toBe('Ctrl+Enter');
  });
  it('bindLabel includes +Shift when set', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' });
    expect(bindLabel({ key: 'p', shift: true })).toBe('Ctrl+Shift+P');
  });
  it('shortcutText.palette reflects custom binds', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' });
    saveBinds({ ...DEFAULT_BINDS, palette: { key: 'j' } });
    expect(shortcutText.palette).toBe('Ctrl+J');
  });
  it('shortcutText.send reflects custom binds', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' });
    saveBinds({ ...DEFAULT_BINDS, send: { key: 's' } });
    expect(shortcutText.send).toBe('Ctrl+S');
  });
  it('shortcutText.models reflects shift binds', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' });
    saveBinds({ ...DEFAULT_BINDS, models: { key: 'o', shift: true } });
    expect(shortcutText.models).toBe('Ctrl+Shift+O');
  });
  it('isMac detects darwin via platform', () => {
    vi.stubGlobal('navigator', { platform: 'darwin', userAgent: '' });
    expect(isMac()).toBe(true);
  });
  it('modShiftLabel and enterLabel differ by platform', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Macintosh' });
    expect(modShiftLabel()).toBe('⇧⌘');
    expect(enterLabel()).toBe('⌘⏎');
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' });
    expect(modShiftLabel()).toBe('Ctrl+Shift');
    expect(enterLabel()).toBe('Ctrl+Enter');
  });
});
