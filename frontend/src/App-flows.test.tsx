// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./api', () => ({
  apiAgentCompact: vi.fn(),
  apiAgentRunsStart: vi.fn(),
  apiAgentRuns: vi.fn(),
  apiFileRead: vi.fn(),
  apiGit: vi.fn(),
  apiHomedir: vi.fn(async () => ({ ok: false })),
  apiMemory: vi.fn(),
  apiRepoInfo: vi.fn(),
  providers: {
    local: { listModels: vi.fn(), health: vi.fn() },
    cloud: { listModels: vi.fn(), health: vi.fn() },
  },
  runAgentStream: vi.fn(),
}));

import App from './App';
import { useStore } from './store';
import { abortAllStreams } from './streams';
import { apiAgentRuns, providers, runAgentStream } from './api';

let fetchMock: ReturnType<typeof vi.fn>;
function mockFetch(config: any = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('/api/sessions') && !String(url).includes('/api/sessions/')) {
      if ((fetchMock as any).__method === 'GET' || true) return { json: async () => ({ sessions: [] }), ok: true } as any;
    }
    if (String(url).includes('/api/config')) return { json: async () => ({ cloudKey: '', customCommands: [], ...config }), ok: true } as any;
    if (String(url).includes('/api/health')) return { json: async () => ({ ok: true }), ok: true } as any;
    return { json: async () => ({}), ok: true } as any;
  });
}

function resetStore() {
  abortAllStreams();
  localStorage.clear();
  useStore.setState({
    route: '/chat', sessionId: null, sessions: [], models: [], modelsLoading: false,
    hasCloudKey: false, ollamaLocal: { ok: true, checked: true }, ollamaCloud: { ok: false, checked: true },
    repo: null, repoPathInput: '', model: '', scope: 'local', reasoning: 'Medium',
    paletteOpen: false, settingsOpen: false, repoPickerOpen: false, sessionListOpen: false,
    streaming: {}, bgRuns: [], customCommands: [], buildMode: false, statusLine: '',
    toasts: [], memory: {}, minimized: false, maximized: false,
  } as any);
}

function mkSession(id: string, messages: any[] = []) {
  const now = Date.now();
  return { id, title: 'S', repository: '', branch: 'main', worktree: '', provider: 'local', model: 'llama3', reasoningLevel: 'Medium', messages, toolCalls: [], contextMemory: {}, createdAt: now, updatedAt: now };
}
const um = (content: string) => ({ id: `u-${content.slice(0, 4)}-${Math.random().toString(36).slice(2, 6)}`, role: 'user', content, createdAt: Date.now() });
const am = (content: string, extra: any = {}) => ({ id: `a-${Math.random().toString(36).slice(2, 6)}`, role: 'assistant', content, createdAt: Date.now(), ...extra });

async function sendText(raw: string) {
  const ta = screen.getByLabelText('Message composer') as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: raw } });
  fireEvent.keyDown(ta, { key: 'Enter' });
}

beforeEach(() => {
  resetStore();
  (Element.prototype as any).scrollIntoView = vi.fn();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
  vi.mocked(apiAgentRuns).mockReset().mockResolvedValue({ ok: true, runs: [] } as any);
  vi.mocked(runAgentStream).mockReset().mockResolvedValue(undefined as any);
  vi.mocked(providers.local.listModels).mockReset().mockResolvedValue([{ name: 'llama3' }]);
  vi.mocked(providers.cloud.listModels).mockReset().mockResolvedValue([]);
  vi.mocked(providers.local.health).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(providers.cloud.health).mockReset().mockResolvedValue({ ok: false });
  fetchMock = vi.fn(async () => ({ json: async () => ({}), ok: true } as any));
  vi.stubGlobal('fetch', fetchMock);
  mockFetch();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('App slash locals', () => {
  it('/cost pushes a usage message with token math', async () => {
    const s = mkSession('s1', [um('abcd'), am('abcdefgh')] as any);
    useStore.setState({ sessions: [s] as any, sessionId: 's1', model: 'llama3', models: [{ name: 'llama3', scope: 'local', tier: 'local' }] as any });
    render(<App />);
    await sendText('/cost');
    await waitFor(() => expect(useStore.getState().sessions[0].messages.some((m) => m.content.includes('Session usage'))).toBe(true));
    const cost = useStore.getState().sessions[0].messages.find((m) => m.content.includes('Session usage'))!;
    expect(cost.content).toContain('~1');
    expect(cost.content).toContain('~2');
    expect(vi.mocked(runAgentStream)).not.toHaveBeenCalled();
  });
  it('/agents lists Explore/Plan/General', async () => {
    const s = mkSession('s1', []);
    useStore.setState({ sessions: [s] as any, sessionId: 's1', model: 'llama3', models: [{ name: 'llama3', scope: 'local', tier: 'local' }] as any });
    render(<App />);
    await sendText('/agents');
    await waitFor(() => expect(useStore.getState().sessions[0].messages.some((m) => /Explore/.test(m.content))).toBe(true));
    const msg = useStore.getState().sessions[0].messages.find((m) => /Explore/.test(m.content))!;
    expect(msg.content).toContain('Plan');
    expect(msg.content).toContain('General');
  });
  it('/export triggers a download', async () => {
    const s = mkSession('s1', [um('hi')] as any);
    useStore.setState({ sessions: [s] as any, sessionId: 's1', model: 'llama3', models: [{ name: 'llama3', scope: 'local', tier: 'local' }] as any });
    const create = vi.fn(() => 'blob:url');
    const revoke = vi.fn();
    (URL as any).createObjectURL = create;
    (URL as any).revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App />);
    await sendText('/export');
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(useStore.getState().toasts.some((t) => /downloaded/i.test(t.text))).toBe(true);
    click.mockRestore();
  });
  it('unknown slash toasts with the command name', async () => {
    const s = mkSession('s1', []);
    useStore.setState({ sessions: [s] as any, sessionId: 's1', model: 'llama3', models: [{ name: 'llama3', scope: 'local', tier: 'local' }] as any });
    render(<App />);
    await sendText('/zzzqx-nope');
    await waitFor(() => expect(useStore.getState().toasts.some((t) => /Unknown command "\/zzzqx-nope"/.test(t.text))).toBe(true));
    expect(vi.mocked(runAgentStream)).not.toHaveBeenCalled();
  });
  it('/search bare shows usage toast', async () => {
    const s = mkSession('s1', []);
    useStore.setState({ sessions: [s] as any, sessionId: 's1', model: 'llama3', models: [{ name: 'llama3', scope: 'local', tier: 'local' }] as any });
    render(<App />);
    await sendText('/search');
    await waitFor(() => expect(useStore.getState().toasts.some((t) => /Usage: \/search/.test(t.text))).toBe(true));
  });
  it('/run in chat mode is blocked with a Build toast', async () => {
    const s = mkSession('s1', []);
    useStore.setState({ sessions: [s] as any, sessionId: 's1', model: 'llama3', buildMode: false, models: [{ name: 'llama3', scope: 'local', tier: 'local' }] as any });
    render(<App />);
    await sendText('/run zzzqx-echo');
    await waitFor(() => expect(useStore.getState().toasts.some((t) => /Build mode/.test(t.text))).toBe(true));
    expect(vi.mocked(runAgentStream)).not.toHaveBeenCalled();
  });
  it('/git without a directory toasts guidance, no network', async () => {
    const s = mkSession('s1', []);
    useStore.setState({ sessions: [s] as any, sessionId: 's1', model: 'llama3', repo: null, models: [{ name: 'llama3', scope: 'local', tier: 'local' }] as any });
    render(<App />);
    await sendText('/git');
    await waitFor(() => expect(useStore.getState().toasts.some((t) => /Open a directory/.test(t.text))).toBe(true));
    expect(vi.mocked(runAgentStream)).not.toHaveBeenCalled();
  });
  it('/git with a directory passes through to the agent', async () => {
    const s = mkSession('s1', []);
    useStore.setState({ sessions: [s] as any, sessionId: 's1', model: 'llama3', repo: { path: 'C:\\r', name: 'r', branch: 'main', dirty: false, diffStat: '' } as any, models: [{ name: 'llama3', scope: 'local', tier: 'local' }] as any });
    render(<App />);
    await sendText('/git');
    await waitFor(() => expect(vi.mocked(runAgentStream)).toHaveBeenCalled());
    const body = vi.mocked(runAgentStream).mock.calls[0][0] as any;
    expect(body.messages.map((m: any) => m.content).join('\n')).toContain('/git');
  });
  it('/search with query expands to a codebase search request', async () => {
    const s = mkSession('s1', []);
    useStore.setState({ sessions: [s] as any, sessionId: 's1', model: 'llama3', models: [{ name: 'llama3', scope: 'local', tier: 'local' }] as any });
    render(<App />);
    await sendText('/search zzzqx-needle');
    await waitFor(() => expect(vi.mocked(runAgentStream)).toHaveBeenCalled());
    const body = vi.mocked(runAgentStream).mock.calls[0][0] as any;
    expect(body.messages.map((m: any) => m.content).join('\n')).toContain('zzzqx-needle');
  });
  it('/run in build mode sends the shell command to the agent', async () => {
    const s = mkSession('s1', []);
    useStore.setState({ sessions: [s] as any, sessionId: 's1', model: 'llama3', buildMode: true, repo: { path: 'C:\\r', name: 'r', branch: 'main', dirty: false, diffStat: '' } as any, models: [{ name: 'llama3', scope: 'local', tier: 'local' }] as any });
    render(<App />);
    await sendText('/run zzzqx-echo');
    await waitFor(() => expect(vi.mocked(runAgentStream)).toHaveBeenCalled());
    const body = vi.mocked(runAgentStream).mock.calls[0][0] as any;
    expect(body.messages.map((m: any) => m.content).join('\n')).toContain('zzzqx-echo');
  });
  it('custom /rr command expands prompt plus extra input', async () => {
    const s = mkSession('s1', []);
    useStore.setState({ sessions: [s] as any, sessionId: 's1', model: 'llama3', customCommands: [{ cmd: '/rr', desc: 'r', prompt: 'ZZZQX-PROMPT' }] as any, models: [{ name: 'llama3', scope: 'local', tier: 'local' }] as any });
    render(<App />);
    await sendText('/rr extra words');
    await waitFor(() => expect(vi.mocked(runAgentStream)).toHaveBeenCalled());
    const body = vi.mocked(runAgentStream).mock.calls[0][0] as any;
    const all = body.messages.map((m: any) => m.content).join('\n');
    expect(all).toContain('ZZZQX-PROMPT');
    expect(all).toContain('extra words');
  });
});

describe('App BUILD_INTENT gate', () => {
  async function gateSetup() {
    const s = mkSession('s1', []);
    useStore.setState({ sessions: [s] as any, sessionId: 's1', model: 'llama3', buildMode: false, models: [{ name: 'llama3', scope: 'local', tier: 'local' }] as any });
    render(<App />);
    await sendText('create a full game');
  }
  it('build-looking chat shows ModeSwitchCard, not network', async () => {
    await gateSetup();
    expect(await screen.findByText('This looks like a build task')).toBeTruthy();
    expect(vi.mocked(runAgentStream)).not.toHaveBeenCalled();
  });
  it('approve flips to build and sends without duplicating the user message', async () => {
    const user = userEvent.setup();
    await gateSetup();
    await user.click(await screen.findByText('Go to Build mode'));
    await waitFor(() => expect(useStore.getState().buildMode).toBe(true));
    await waitFor(() => expect(vi.mocked(runAgentStream)).toHaveBeenCalled());
    const count = useStore.getState().sessions[0].messages.filter((m) => m.role === 'user' && m.content === 'create a full game').length;
    expect(count).toBe(1);
  });
  it('deny sends as chat without flipping buildMode', async () => {
    const user = userEvent.setup();
    await gateSetup();
    await user.click(await screen.findByText('Stay in chat'));
    await waitFor(() => expect(vi.mocked(runAgentStream)).toHaveBeenCalled());
    expect(useStore.getState().buildMode).toBe(false);
    const count = useStore.getState().sessions[0].messages.filter((m) => m.role === 'user' && m.content === 'create a full game').length;
    expect(count).toBe(1);
  });
  it('questions never trigger the gate even when build-worded (L8)', async () => {
    const s = mkSession('s1', []);
    useStore.setState({ sessions: [s] as any, sessionId: 's1', model: 'llama3', buildMode: false, models: [{ name: 'llama3', scope: 'local', tier: 'local' }] as any });
    render(<App />);
    await sendText('how do I run the tests?');
    expect(screen.queryByText('This looks like a build task')).toBeNull();
  });
  it('API-tier model without a key opens settings instead of sending', async () => {
    vi.mocked(providers.cloud.listModels).mockResolvedValue([{ name: 'api-pro' }]);
    const s = mkSession('s1', []);
    useStore.setState({
      sessions: [s] as any, sessionId: 's1', model: 'api-pro', scope: 'cloud', hasCloudKey: false,
      models: [{ name: 'api-pro', scope: 'cloud', tier: 'api-cloud' }] as any, buildMode: true,
    });
    render(<App />);
    await sendText('hello there plain');
    await waitFor(() => expect(useStore.getState().settingsOpen).toBe(true));
    expect(useStore.getState().toasts.some((t) => /API key/.test(t.text))).toBe(true);
    expect(vi.mocked(runAgentStream)).not.toHaveBeenCalled();
  });
});
