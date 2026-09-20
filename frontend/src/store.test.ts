// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./api', () => ({
  apiAgentRuns: vi.fn(),
  providers: {
    local: { listModels: vi.fn(), health: vi.fn() },
    cloud: { listModels: vi.fn(), health: vi.fn() },
  },
}));

import { useStore, FREE_CLOUD_MODELS } from './store';
import { apiAgentRuns, providers } from './api';
import { trackStream, abortAllStreams } from './streams';

const mockedRuns = vi.mocked(apiAgentRuns);
const localList = vi.mocked(providers.local.listModels);
const cloudList = vi.mocked(providers.cloud.listModels);

function resetStore() {
  abortAllStreams();
  useStore.setState({
    route: '/',
    sessionId: null,
    sessions: [],
    models: [],
    modelsLoading: false,
    hasCloudKey: false,
    streaming: {},
    bgRuns: [],
    customCommands: [],
    toasts: [],
    buildMode: false,
    model: '',
    scope: 'local',
    reasoning: 'Medium',
    repo: null,
    memory: {},
    minimized: false,
    maximized: false,
  } as any);
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  mockedRuns.mockReset();
  localList.mockReset();
  cloudList.mockReset();
  localList.mockResolvedValue([]);
  cloudList.mockResolvedValue([]);
  fetchMock = vi.fn(async () => ({ json: async () => ({}), ok: true } as any));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function mkSession(over: any = {}) {
  const now = Date.now();
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    title: 'T',
    repository: '', branch: 'main', worktree: '',
    provider: 'local', model: 'm', reasoningLevel: 'Medium',
    messages: [], toolCalls: [], contextMemory: {},
    createdAt: now, updatedAt: now,
    ...over,
  };
}
function mkMsg(over: any = {}) {
  return { id: `m-${Math.random().toString(36).slice(2, 8)}`, role: 'user', content: 'hi', createdAt: Date.now(), ...over };
}

// ---------- newSession ----------
describe('newSession', () => {
  it('creates a session and selects it on /chat', () => {
    useStore.getState().newSession();
    const st = useStore.getState();
    expect(st.sessions).toHaveLength(1);
    expect(st.sessionId).toBe(st.sessions[0].id);
    expect(st.route).toBe('/chat');
  });
  it('reuses an existing empty draft instead of stacking', () => {
    useStore.getState().newSession();
    const first = useStore.getState().sessionId;
    useStore.getState().newSession();
    const st = useStore.getState();
    expect(st.sessions).toHaveLength(1);
    expect(st.sessionId).toBe(first);
  });
  it('creates a second session when the first has messages', () => {
    useStore.getState().newSession();
    const s = useStore.getState().sessions[0];
    useStore.getState().pushMessage(s.id, mkMsg({ content: 'hello' }));
    useStore.getState().newSession();
    expect(useStore.getState().sessions).toHaveLength(2);
  });
  it('clears streaming flags on new session', () => {
    useStore.setState({ streaming: { x: true } as any });
    useStore.getState().newSession();
    expect(useStore.getState().streaming).toEqual({});
  });
  it('opens the sidebar on the very first session', () => {
    useStore.setState({ sessionListOpen: false } as any);
    useStore.getState().newSession();
    expect(useStore.getState().sessionListOpen).toBe(true);
  });
});

// ---------- openSession ----------
describe('openSession', () => {
  it('switches the active session and route', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg()] });
    const b = mkSession({ id: 'b', messages: [mkMsg()] });
    useStore.setState({ sessions: [a, b], sessionId: 'a', route: '/chat' });
    useStore.getState().openSession('b');
    expect(useStore.getState().sessionId).toBe('b');
    expect(useStore.getState().route).toBe('/chat');
  });
  it('aborts other sessions streams but keeps the target flag', () => {
    const ca = new AbortController();
    const cb = new AbortController();
    const spyA = vi.spyOn(ca, 'abort');
    trackStream('a', ca);
    trackStream('b', cb);
    useStore.setState({ streaming: { a: true, b: true } as any });
    useStore.getState().openSession('b');
    expect(spyA).toHaveBeenCalled();
    expect(cb.signal.aborted).toBe(false);
    expect(useStore.getState().streaming).toEqual({ b: true });
  });
});

// ---------- deleteSession ----------
describe('deleteSession', () => {
  it('removes the session', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg()] });
    const b = mkSession({ id: 'b', messages: [mkMsg()] });
    useStore.setState({ sessions: [a, b], sessionId: 'b' });
    useStore.getState().deleteSession('a');
    expect(useStore.getState().sessions.map((s) => s.id)).toEqual(['b']);
  });
  it('falls back to newest remaining when deleting the active one', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg()] });
    const b = mkSession({ id: 'b', messages: [mkMsg()] });
    useStore.setState({ sessions: [a, b], sessionId: 'a', route: '/chat' });
    useStore.getState().deleteSession('a');
    expect(useStore.getState().sessionId).toBe('b');
    expect(useStore.getState().route).toBe('/chat');
  });
  it('goes home when deleting the last session', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg()] });
    useStore.setState({ sessions: [a], sessionId: 'a', route: '/chat' });
    useStore.getState().deleteSession('a');
    expect(useStore.getState().sessions).toHaveLength(0);
    expect(useStore.getState().sessionId).toBeNull();
    expect(useStore.getState().route).toBe('/');
  });
  it('keeps selection when deleting an inactive session', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg()] });
    const b = mkSession({ id: 'b', messages: [mkMsg()] });
    useStore.setState({ sessions: [a, b], sessionId: 'b', route: '/chat' });
    useStore.getState().deleteSession('a');
    expect(useStore.getState().sessionId).toBe('b');
  });
  it('undo toast restores the deleted session at its index', () => {
    const a = mkSession({ id: 'a', title: 'A', messages: [mkMsg()] });
    const b = mkSession({ id: 'b', title: 'B', messages: [mkMsg()] });
    useStore.setState({ sessions: [a, b], sessionId: 'b' });
    useStore.getState().deleteSession('a');
    const toast = useStore.getState().toasts.find((t) => t.text === 'Session deleted');
    expect(toast?.action?.label).toBe('Undo');
    toast!.action!.fn();
    expect(useStore.getState().sessions.map((s) => s.id)).toEqual(['a', 'b']);
  });
  it('fires a DELETE fetch for the session', () => {
    const a = mkSession({ id: 'gone', messages: [mkMsg()] });
    useStore.setState({ sessions: [a], sessionId: 'gone' });
    useStore.getState().deleteSession('gone');
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/gone', expect.objectContaining({ method: 'DELETE' }));
  });
});

// ---------- duplicateSession ----------
describe('duplicateSession', () => {
  it('copies with a new id and (copy) title and selects it', () => {
    const a = mkSession({ id: 'a', title: 'Work', messages: [mkMsg({ id: 'm1', content: 'hi' })] });
    useStore.setState({ sessions: [a], sessionId: 'a' });
    useStore.getState().duplicateSession('a');
    const st = useStore.getState();
    expect(st.sessions).toHaveLength(2);
    const copy = st.sessions[0];
    expect(copy.id).not.toBe('a');
    expect(copy.title).toBe('Work (copy)');
    expect(st.sessionId).toBe(copy.id);
  });
  it('gives copied messages fresh ids', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg({ id: 'm1' }), mkMsg({ id: 'm2' })] });
    useStore.setState({ sessions: [a] });
    useStore.getState().duplicateSession('a');
    const copy = useStore.getState().sessions[0];
    expect(copy.messages.map((m) => m.id)).not.toContain('m1');
    expect(copy.messages).toHaveLength(2);
  });
  it('clears toolCalls on the copy', () => {
    const a = mkSession({ id: 'a', toolCalls: [{ id: 't', name: 'x', status: 'complete' } as any] });
    useStore.setState({ sessions: [a] });
    useStore.getState().duplicateSession('a');
    expect(useStore.getState().sessions[0].toolCalls).toEqual([]);
  });
  it('is a no-op for unknown ids', () => {
    useStore.setState({ sessions: [] });
    useStore.getState().duplicateSession('ghost');
    expect(useStore.getState().sessions).toHaveLength(0);
  });
});

// ---------- renameSession ----------
describe('renameSession', () => {
  it('renames with trim', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg()] });
    useStore.setState({ sessions: [a] });
    useStore.getState().renameSession('a', '  New title  ');
    expect(useStore.getState().sessions[0].title).toBe('New title');
  });
  it('ignores empty titles', () => {
    const a = mkSession({ id: 'a', title: 'Keep', messages: [mkMsg()] });
    useStore.setState({ sessions: [a] });
    useStore.getState().renameSession('a', '   ');
    expect(useStore.getState().sessions[0].title).toBe('Keep');
  });
  it('caps titles at 80 chars', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg()] });
    useStore.setState({ sessions: [a] });
    useStore.getState().renameSession('a', 'x'.repeat(200));
    expect(useStore.getState().sessions[0].title.length).toBe(80);
  });
});

// ---------- pushMessage / appendToken / deletes ----------
describe('messages', () => {
  it('titles the session from the first user message', () => {
    const a = mkSession({ id: 'a', title: 'New session' });
    useStore.setState({ sessions: [a] });
    useStore.getState().pushMessage('a', mkMsg({ role: 'user', content: 'explain redux patterns here' }));
    expect(useStore.getState().sessions[0].title).toBe('explain redux patterns here'.slice(0, 42));
  });
  it('falls back to attachment names for empty first content', () => {
    const a = mkSession({ id: 'a', title: 'New session' });
    useStore.setState({ sessions: [a] });
    useStore.getState().pushMessage('a', mkMsg({ role: 'user', content: '', atts: [{ name: 'spec.txt', size: 10, kind: 'text' }] as any }));
    expect(useStore.getState().sessions[0].title).toContain('spec.txt');
  });
  it('does not retitle on later messages', () => {
    const a = mkSession({ id: 'a', title: 'First', messages: [mkMsg({ content: 'one' })] });
    useStore.setState({ sessions: [a] });
    useStore.getState().pushMessage('a', mkMsg({ role: 'user', content: 'second title attempt' }));
    expect(useStore.getState().sessions[0].title).toBe('First');
  });
  it('appendToken concatenates onto the target message', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg({ id: 'm1', content: 'hel' })] });
    useStore.setState({ sessions: [a] });
    useStore.getState().appendToken('a', 'm1', 'lo');
    expect(useStore.getState().sessions[0].messages[0].content).toBe('hello');
  });
  it('deleteMessage drops only the target', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg({ id: 'm1' }), mkMsg({ id: 'm2' })] });
    useStore.setState({ sessions: [a] });
    useStore.getState().deleteMessage('a', 'm1');
    expect(useStore.getState().sessions[0].messages.map((m) => m.id)).toEqual(['m2']);
  });
  it('deleteMessagesAfter keeps the target and drops the rest', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg({ id: 'm1' }), mkMsg({ id: 'm2' }), mkMsg({ id: 'm3' })] });
    useStore.setState({ sessions: [a] });
    useStore.getState().deleteMessagesAfter('a', 'm2');
    expect(useStore.getState().sessions[0].messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });
  it('deleteMessagesAfter with unknown id leaves messages alone', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg({ id: 'm1' })] });
    useStore.setState({ sessions: [a] });
    useStore.getState().deleteMessagesAfter('a', 'ghost');
    expect(useStore.getState().sessions[0].messages).toHaveLength(1);
  });
});

// ---------- persist / load ----------
describe('persistence', () => {
  it('persistSessions writes localStorage sessions and id', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg()] });
    useStore.setState({ sessions: [a], sessionId: 'a' });
    useStore.getState().persistSessions();
    expect(JSON.parse(localStorage.getItem('od.sessions')!)[0].id).toBe('a');
    expect(localStorage.getItem('od.sessionId')).toBe('a');
  });
  it('persistSessions POSTs sessions to the bridge', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg()] });
    useStore.setState({ sessions: [a], sessionId: 'a' });
    useStore.getState().persistSessions();
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'POST' }));
  });
  it('loadSessions merges server+local newest-wins', async () => {
    const oldS = mkSession({ id: 'x', title: 'old', updatedAt: 100, messages: [mkMsg()] });
    const newS = mkSession({ id: 'x', title: 'new', updatedAt: 200, messages: [mkMsg()] });
    fetchMock.mockResolvedValueOnce({ json: async () => ({ sessions: [oldS] }), ok: true } as any);
    localStorage.setItem('od.sessions', JSON.stringify([newS]));
    await useStore.getState().loadSessions();
    expect(useStore.getState().sessions[0].title).toBe('new');
  });
  it('loadSessions prunes stacked empty drafts to one', async () => {
    const e1 = mkSession({ id: 'e1', messages: [] });
    const e2 = mkSession({ id: 'e2', messages: [] });
    const full = mkSession({ id: 'f', messages: [mkMsg()] });
    fetchMock.mockResolvedValueOnce({ json: async () => ({ sessions: [e1, e2, full] }), ok: true } as any);
    await useStore.getState().loadSessions();
    expect(useStore.getState().sessions.filter((s) => !s.messages.length)).toHaveLength(1);
  });
  it('loadSessions drops trailing empty assistant stubs', async () => {
    const s = mkSession({ id: 'a', messages: [mkMsg({ role: 'user', content: 'q' }), mkMsg({ role: 'assistant', content: '  ' })] });
    fetchMock.mockResolvedValueOnce({ json: async () => ({ sessions: [s] }), ok: true } as any);
    await useStore.getState().loadSessions();
    expect(useStore.getState().sessions[0].messages).toHaveLength(1);
  });
  it('loadSessions restores the saved sessionId', async () => {
    const a = mkSession({ id: 'a', messages: [mkMsg()] });
    const b = mkSession({ id: 'b', updatedAt: Date.now() + 1000, messages: [mkMsg()] });
    fetchMock.mockResolvedValueOnce({ json: async () => ({ sessions: [a, b] }), ok: true } as any);
    localStorage.setItem('od.sessionId', 'a');
    await useStore.getState().loadSessions();
    expect(useStore.getState().sessionId).toBe('a');
  });
  it('loadSessions picks newest non-empty when no saved id', async () => {
    const a = mkSession({ id: 'a', updatedAt: 100, messages: [mkMsg()] });
    const b = mkSession({ id: 'b', updatedAt: 500, messages: [mkMsg()] });
    fetchMock.mockResolvedValueOnce({ json: async () => ({ sessions: [a, b] }), ok: true } as any);
    await useStore.getState().loadSessions();
    expect(useStore.getState().sessionId).toBe('b');
  });
});

// ---------- refreshModels ----------
describe('refreshModels', () => {
  function cfgFetch(cloudKey = '', customCommands: any[] = []) {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/config')) return { json: async () => ({ cloudKey, customCommands }), ok: true } as any;
      return { json: async () => ({}), ok: true } as any;
    });
  }
  it('tiers local vs free-cloud vs api-cloud', async () => {
    cfgFetch('');
    localList.mockResolvedValue([{ name: 'llama3' }]);
    cloudList.mockResolvedValue([{ name: 'gpt-oss:20b' }, { name: 'fancy-pro' }]);
    await useStore.getState().refreshModels();
    const ms = useStore.getState().models;
    expect(ms.find((m) => m.name === 'llama3')?.tier).toBe('local');
    expect(ms.find((m) => m.name === 'gpt-oss:20b')?.tier).toBe('free-cloud');
    expect(ms.find((m) => m.name === 'fancy-pro')?.tier).toBe('api-cloud');
  });
  it('sets hasCloudKey when config key is masked', async () => {
    cfgFetch('***');
    await useStore.getState().refreshModels();
    expect(useStore.getState().hasCloudKey).toBe(true);
  });
  it('dedupes the bare twin when keyless and alias exists', async () => {
    cfgFetch('');
    localList.mockResolvedValue([]);
    cloudList.mockResolvedValue([{ name: 'gpt-oss:20b' }, { name: 'gpt-oss:20b:cloud' }]);
    await useStore.getState().refreshModels();
    const names = useStore.getState().models.map((m) => m.name);
    expect(names).toContain('gpt-oss:20b:cloud');
    expect(names).not.toContain('gpt-oss:20b');
  });
  it('keeps both twins when a key is set', async () => {
    cfgFetch('sk-live');
    localList.mockResolvedValue([]);
    cloudList.mockResolvedValue([{ name: 'gpt-oss:20b' }, { name: 'gpt-oss:20b:cloud' }]);
    await useStore.getState().refreshModels();
    const names = useStore.getState().models.map((m) => m.name);
    expect(names).toContain('gpt-oss:20b');
    expect(names).toContain('gpt-oss:20b:cloud');
  });
  it('remaps a bare selection onto the alias after keyless dedupe', async () => {
    cfgFetch('');
    localList.mockResolvedValue([]);
    cloudList.mockResolvedValue([{ name: 'gpt-oss:20b' }, { name: 'gpt-oss:20b:cloud' }]);
    useStore.setState({ model: 'gpt-oss:20b', scope: 'cloud' });
    await useStore.getState().refreshModels();
    expect(useStore.getState().model).toBe('gpt-oss:20b:cloud');
  });
  it('revalidates scope when the same model moved scopes', async () => {
    cfgFetch('');
    localList.mockResolvedValue([{ name: 'm1' }]);
    cloudList.mockResolvedValue([]);
    useStore.setState({ model: 'm1', scope: 'cloud' });
    await useStore.getState().refreshModels();
    expect(useStore.getState().scope).toBe('local');
  });
  it('clears a stale selection missing from the fresh list (auto-selects local-first)', async () => {
    cfgFetch('');
    localList.mockResolvedValue([{ name: 'fresh' }]);
    cloudList.mockResolvedValue([]);
    useStore.setState({ model: 'ghost', scope: 'local' });
    await useStore.getState().refreshModels();
    expect(useStore.getState().model).not.toBe('ghost');
    expect(useStore.getState().model).toBe('fresh');
  });
  it('auto-selects a local model first', async () => {
    cfgFetch('');
    localList.mockResolvedValue([{ name: 'local-a' }]);
    cloudList.mockResolvedValue([{ name: 'cloud-b' }]);
    useStore.setState({ model: '' });
    await useStore.getState().refreshModels();
    expect(useStore.getState().model).toBe('local-a');
    expect(useStore.getState().scope).toBe('local');
  });
  it('sets customCommands from config', async () => {
    cfgFetch('', [{ name: 'x', prompt: 'do x things here' }]);
    await useStore.getState().refreshModels();
    expect(useStore.getState().customCommands[0]).toMatchObject({ cmd: '/x' });
  });
  it('FREE_CLOUD_MODELS contains the documented starters', () => {
    expect(FREE_CLOUD_MODELS.has('gpt-oss:20b')).toBe(true);
    expect(FREE_CLOUD_MODELS.has('gemma4:31b')).toBe(true);
  });
});

// ---------- toasts / streaming / misc ----------
describe('toasts and flags', () => {
  it('dedupes identical toast text', () => {
    useStore.getState().toast('hello');
    useStore.getState().toast('hello');
    expect(useStore.getState().toasts.filter((t) => t.text === 'hello')).toHaveLength(1);
  });
  it('caps visible toasts at 3 (newest wins)', () => {
    useStore.getState().toast('t1');
    useStore.getState().toast('t2');
    useStore.getState().toast('t3');
    useStore.getState().toast('t4');
    const tx = useStore.getState().toasts;
    expect(tx).toHaveLength(3);
    expect(tx.map((t) => t.text)).toEqual(['t2', 't3', 't4']);
  });
  it('expires toasts after 5s', () => {
    vi.useFakeTimers();
    useStore.getState().toast('ephemeral');
    expect(useStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(5100);
    expect(useStore.getState().toasts).toHaveLength(0);
    vi.useRealTimers();
  });
  it('set() patches streaming flags directly', () => {
    useStore.getState().set({ streaming: { s1: true } });
    expect(useStore.getState().streaming.s1).toBe(true);
    useStore.getState().set({ streaming: {} });
    expect(useStore.getState().streaming).toEqual({});
  });
  it('refreshBgRuns sets bgRuns from the bridge', async () => {
    mockedRuns.mockResolvedValue({ ok: true, runs: [{ id: 'r1', label: 'L', model: 'm', status: 'running', createdAt: 1 }] } as any);
    await useStore.getState().refreshBgRuns();
    expect(useStore.getState().bgRuns).toHaveLength(1);
    expect(useStore.getState().bgRuns[0].id).toBe('r1');
  });
  it('refreshBgRuns keeps old list when the bridge fails', async () => {
    mockedRuns.mockRejectedValue(new Error('down'));
    useStore.setState({ bgRuns: [{ id: 'old', label: 'O', model: 'm', status: 'done', createdAt: 1 }] });
    await useStore.getState().refreshBgRuns();
    expect(useStore.getState().bgRuns[0].id).toBe('old');
  });
  it('toggleOverview goes home from chat and back when a session exists', () => {
    useStore.setState({ route: '/chat', sessionId: 's1' });
    useStore.getState().toggleOverview();
    expect(useStore.getState().route).toBe('/');
    useStore.getState().toggleOverview();
    expect(useStore.getState().route).toBe('/chat');
  });
  it('toggleOverview is a no-op home with no session', () => {
    useStore.setState({ route: '/', sessionId: null });
    useStore.getState().toggleOverview();
    expect(useStore.getState().route).toBe('/');
  });
  it('activeSession returns the selected session', () => {
    const a = mkSession({ id: 'a', messages: [mkMsg()] });
    useStore.setState({ sessions: [a], sessionId: 'a' });
    expect(useStore.getState().activeSession()?.id).toBe('a');
  });
  it('stores buildMode/reasoning/model/scope defaults', () => {
    const st = useStore.getState();
    expect(typeof st.buildMode).toBe('boolean');
    expect(['Low', 'Medium', 'High']).toContain(st.reasoning);
    expect(typeof st.model).toBe('string');
    expect(['local', 'cloud']).toContain(st.scope);
  });
});
