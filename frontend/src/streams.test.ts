// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { abortAllStreams, abortStream, trackStream, untrackStream } from './streams';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  abortAllStreams();
  vi.restoreAllMocks();
});

describe('streams registry', () => {
  it('track then abort signals the controller', () => {
    const c = new AbortController();
    const spy = vi.spyOn(c, 'abort');
    trackStream('s1', c);
    abortStream('s1');
    expect(spy).toHaveBeenCalled();
    expect(c.signal.aborted).toBe(true);
  });
  it('aborting an unknown id is safe', () => {
    expect(() => abortStream('nope')).not.toThrow();
  });
  it('tracking overwrites and aborts the previous controller', () => {
    const a = new AbortController();
    const b = new AbortController();
    const spyA = vi.spyOn(a, 'abort');
    trackStream('s1', a);
    trackStream('s1', b);
    expect(spyA).toHaveBeenCalled();
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
  });
  it('abort removes the entry so a second abort does not re-fire', () => {
    const c = new AbortController();
    const spy = vi.spyOn(c, 'abort');
    trackStream('s1', c);
    abortStream('s1');
    abortStream('s1');
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('untrack removes without aborting', () => {
    const c = new AbortController();
    const spy = vi.spyOn(c, 'abort');
    trackStream('s1', c);
    untrackStream('s1');
    expect(spy).not.toHaveBeenCalled();
    expect(() => abortStream('s1')).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
  it('untrack of unknown id is safe', () => {
    expect(() => untrackStream('ghost')).not.toThrow();
  });
  it('abortAll aborts every tracked stream', () => {
    const a = new AbortController();
    const b = new AbortController();
    trackStream('a', a);
    trackStream('b', b);
    abortAllStreams();
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
  });
  it('abortAll clears the registry', () => {
    const a = new AbortController();
    const spy = vi.spyOn(a, 'abort');
    trackStream('a', a);
    abortAllStreams();
    abortStream('a');
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('abortAll on empty registry is safe', () => {
    expect(() => abortAllStreams()).not.toThrow();
  });
  it('streams are independent per session id', () => {
    const a = new AbortController();
    const b = new AbortController();
    trackStream('a', a);
    trackStream('b', b);
    abortStream('a');
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
  });
  it('tolerates a controller whose abort throws', () => {
    const evil = { abort: () => { throw new Error('boom'); } } as unknown as AbortController;
    trackStream('x', evil);
    expect(() => abortStream('x')).not.toThrow();
  });
});
