// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../api', () => ({
  apiAgentRun: vi.fn(),
  apiAgentStopRun: vi.fn(),
  apiAgentRuns: vi.fn(),
  apiDrives: vi.fn(),
  apiFsBrowse: vi.fn(async () => ({ ok: false, cancelled: true })),
  apiLsDir: vi.fn(),
  apiMemory: vi.fn(),
  apiMemoryClear: vi.fn(),
  apiRepoInfo: vi.fn(),
  apiRepoOpen: vi.fn(),
  providers: {
    local: { listModels: vi.fn(), health: vi.fn().mockResolvedValue({ ok: true, count: 2 }) },
    cloud: { listModels: vi.fn(), health: vi.fn() },
  },
}));

import {
  CodeViewer,
  CommandPalette,
  CustomCmdEditor,
  DiffViewerModal,
  FileListModal,
  HookEditor,
  KeybindEditor,
  McpEditor,
  ModelManager,
  PRMenu,
  RepoPicker,
  SessionListPanel,
  SettingsModal,
} from './Overlays';
import { useStore } from '../store';
import { abortAllStreams } from '../streams';
import { apiAgentRun, apiAgentStopRun, apiAgentRuns, apiDrives, apiLsDir, apiMemory, apiMemoryClear, apiRepoInfo, apiRepoOpen, providers } from '../api';
import { DEFAULT_BINDS } from '../shortcuts';

function resetStore() {
  abortAllStreams();
  localStorage.clear();
  useStore.setState({
    route: '/', sessionId: null, sessions: [], models: [], modelsLoading: false,
    hasCloudKey: false, streaming: {}, bgRuns: [], customCommands: [], toasts: [],
    buildMode: false, model: '', scope: 'local', reasoning: 'Medium', repo: null,
    memory: {}, paletteOpen: false, settingsOpen: false, repoPickerOpen: false,
    sessionListOpen: true, minimized: false, maximized: false,
  } as any);
}

beforeEach(() => {
  resetStore();
  (Element.prototype as any).scrollIntoView = vi.fn();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
  vi.mocked(apiAgentRuns).mockReset();
  vi.mocked(apiAgentRun).mockReset();
  vi.mocked(apiAgentStopRun).mockReset();
  vi.mocked(apiDrives).mockReset();
  vi.mocked(apiLsDir).mockReset();
  vi.mocked(apiMemory).mockReset();
  vi.mocked(apiMemoryClear).mockReset();
  vi.mocked(apiRepoInfo).mockReset();
  vi.mocked(apiRepoOpen).mockReset();
  vi.mocked(apiAgentRuns).mockResolvedValue({ ok: true, runs: [] } as any);
  vi.mocked(apiMemory).mockResolvedValue({ ok: true, notes: [] } as any);
  vi.mocked(apiMemoryClear).mockResolvedValue({ ok: true } as any);
  vi.mocked(providers.local.health).mockResolvedValue({ ok: true, count: 2 } as any);
  vi.mocked(providers.cloud.health).mockResolvedValue({ ok: false } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}), ok: true } as any)));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mkSession(id: string, title: string, msgs: any[] = []) {
  const now = Date.now();
  return { id, title, repository: '', branch: 'main', worktree: '', provider: 'local', model: 'm', reasoningLevel: 'Medium', messages: msgs, toolCalls: [], contextMemory: {}, createdAt: now, updatedAt: now };
}

// ---------- CommandPalette ----------
describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    useStore.setState({ paletteOpen: false });
    const { container } = render(<CommandPalette />);
    expect(container.textContent).toBe('');
  });
  it('Escape closes the palette', async () => {
    useStore.setState({ paletteOpen: true, sessions: [], models: [] });
    render(<CommandPalette />);
    fireEvent.keyDown(screen.getByLabelText('Search sessions, directories, models, actions'), { key: 'Escape' });
    expect(useStore.getState().paletteOpen).toBe(false);
  });
  it('Enter runs the top action hit (New session)', async () => {
    const user = userEvent.setup();
    useStore.setState({ paletteOpen: true, sessions: [], models: [] });
    render(<CommandPalette />);
    const input = screen.getByLabelText('Search sessions, directories, models, actions');
    await user.type(input, 'new sess');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useStore.getState().sessions.length).toBeGreaterThan(0);
    expect(useStore.getState().paletteOpen).toBe(false);
  });
  it('Enter selects a model hit when no action matches', async () => {
    const user = userEvent.setup();
    useStore.setState({ paletteOpen: true, sessions: [], models: [{ name: 'zebramodel', scope: 'local' } as any], hasCloudKey: true });
    render(<CommandPalette />);
    const input = screen.getByLabelText('Search sessions, directories, models, actions');
    await user.clear(input);
    await user.type(input, 'zebra');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useStore.getState().model).toBe('zebramodel');
  });
  it('Enter opens a session hit when nothing else matches', async () => {
    const user = userEvent.setup();
    const s = mkSession('s9', 'zebrasession', [{ id: 'm', role: 'user', content: 'hi', createdAt: 1 }]);
    useStore.setState({ paletteOpen: true, sessions: [s], models: [], sessionId: null } as any);
    render(<CommandPalette />);
    const input = screen.getByLabelText('Search sessions, directories, models, actions');
    await user.type(input, 'zebrases');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useStore.getState().sessionId).toBe('s9');
  });
  it('shows empty state with no hits', async () => {
    const user = userEvent.setup();
    useStore.setState({ paletteOpen: true, sessions: [], models: [] });
    render(<CommandPalette />);
    await user.type(screen.getByLabelText('Search sessions, directories, models, actions'), 'qqq-nomatch-zzz');
    expect(screen.queryByText('Models')).toBeNull();
    expect(screen.queryByText('Sessions')).toBeNull();
  });
  it('API model without key opens settings instead of selecting', async () => {
    const user = userEvent.setup();
    useStore.setState({ paletteOpen: true, sessions: [], models: [{ name: 'api-pro', scope: 'cloud', tier: 'api-cloud' } as any], hasCloudKey: false });
    render(<CommandPalette />);
    await user.click(screen.getByText('api-pro'));
    expect(useStore.getState().settingsOpen).toBe(true);
    expect(useStore.getState().paletteOpen).toBe(false);
  });
});

// ---------- SessionListPanel ----------
describe('SessionListPanel', () => {
  it('search filters sessions', async () => {
    const user = userEvent.setup();
    useStore.setState({ sessions: [mkSession('a', 'alpha'), mkSession('b', 'beta')] as any });
    render(<SessionListPanel />);
    await user.type(screen.getByLabelText('Search sessions'), 'alp');
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.queryByText('beta')).toBeNull();
  });
  it('shows no-matches text', async () => {
    const user = userEvent.setup();
    useStore.setState({ sessions: [mkSession('a', 'alpha')] as any });
    render(<SessionListPanel />);
    await user.type(screen.getByLabelText('Search sessions'), 'zzz');
    expect(screen.getByText(/No matches/)).toBeTruthy();
  });
  it('rename commits on Enter', async () => {
    const user = userEvent.setup();
    useStore.setState({ sessions: [mkSession('a', 'old')] as any, sessionId: 'a' });
    render(<SessionListPanel />);
    await user.click(screen.getByRole('button', { name: 'Rename session' }));
    const input = screen.getByLabelText('Rename session');
    await user.clear(input);
    await user.type(input, 'shiny{enter}');
    expect(useStore.getState().sessions[0].title).toBe('shiny');
  });
  it('delete then undo restores the session', async () => {
    const user = userEvent.setup();
    useStore.setState({ sessions: [mkSession('a', 'A'), mkSession('b', 'B')] as any, sessionId: 'b' });
    render(<SessionListPanel />);
    const dels = screen.getAllByRole('button', { name: 'Delete session' });
    await user.click(dels[0]);
    expect(useStore.getState().sessions).toHaveLength(1);
    const undo = useStore.getState().toasts.find((t) => t.text === 'Session deleted')!;
    undo.action!.fn();
    expect(useStore.getState().sessions).toHaveLength(2);
  });
  it('background section renders runs', () => {
    useStore.setState({
      sessions: [], bgRuns: [{ id: 'r1', label: 'nightly', model: 'm', status: 'running', createdAt: 1 }],
    } as any);
    render(<SessionListPanel />);
    expect(screen.getByText('nightly')).toBeTruthy();
    expect(screen.getByText('Background •')).toBeTruthy();
  });
  it('stop button calls the API and refreshes', async () => {
    const user = userEvent.setup();
    vi.mocked(apiAgentStopRun).mockResolvedValue({ ok: true } as any);
    vi.mocked(apiAgentRuns).mockResolvedValue({ ok: true, runs: [{ id: 'r1', label: 'nightly', model: 'm', status: 'running', createdAt: 1 }] } as any);
    useStore.setState({ sessions: [], bgRuns: [{ id: 'r1', label: 'nightly', model: 'm', status: 'running', createdAt: 1 }] } as any);
    render(<SessionListPanel />);
    await user.click(await screen.findByRole('button', { name: 'Stop run' }));
    expect(apiAgentStopRun).toHaveBeenCalledWith('r1');
  });
  it('view opens the answer in a CodeViewer', async () => {
    const user = userEvent.setup();
    vi.mocked(apiAgentRun).mockResolvedValue({ run: { answer: 'hello-bg' } } as any);
    vi.mocked(apiAgentRuns).mockResolvedValue({ ok: true, runs: [{ id: 'r1', label: 'nightly', model: 'm', status: 'done', createdAt: 1 }] } as any);
    useStore.setState({ sessions: [], bgRuns: [{ id: 'r1', label: 'nightly', model: 'm', status: 'done', createdAt: 1 }] } as any);
    render(<SessionListPanel />);
    await user.click(await screen.findByRole('button', { name: 'View answer' }));
    await waitFor(() => expect(screen.getByText('hello-bg')).toBeTruthy());
  });
});

// ---------- HookEditor ----------
describe('HookEditor', () => {
  it('Add is disabled with an empty command', () => {
    render(<HookEditor hooks={[]} onChange={() => {}} />);
    expect((screen.getByText('Add') as HTMLButtonElement).disabled).toBe(true);
  });
  it('adds a hook on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<HookEditor hooks={[]} onChange={onChange} />);
    await user.type(screen.getByLabelText('Hook command'), 'echo hi');
    await user.click(screen.getByText('Add'));
    expect(onChange).toHaveBeenCalledWith([{ event: 'PreToolUse', match: '*', command: 'echo hi' }]);
  });
  it('deletes a hook', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<HookEditor hooks={[{ event: 'Stop', match: '*', command: 'x' }]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Delete hook' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
  it('does not add blank commands via Enter', async () => {
    const onChange = vi.fn();
    render(<HookEditor hooks={[]} onChange={onChange} />);
    fireEvent.keyDown(screen.getByLabelText('Hook command'), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------- CustomCmdEditor ----------
describe('CustomCmdEditor', () => {
  it('adds a custom command', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CustomCmdEditor customs={[]} onChange={onChange} />);
    await user.type(screen.getByLabelText('Command name'), 'ship');
    await user.type(screen.getByLabelText('Command prompt'), 'ship it now');
    await user.click(screen.getByText('Add'));
    expect(onChange).toHaveBeenCalledWith([{ name: 'ship', prompt: 'ship it now' }]);
  });
  it('refuses duplicate names', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CustomCmdEditor customs={[{ name: 'ship', prompt: 'old' }]} onChange={onChange} />);
    await user.type(screen.getByLabelText('Command name'), 'ship');
    await user.type(screen.getByLabelText('Command prompt'), 'new prompt');
    await user.click(screen.getByText('Add'));
    expect(onChange).not.toHaveBeenCalled();
  });
  it('deletes a command', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CustomCmdEditor customs={[{ name: 'ship', prompt: 'p' }]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Delete /ship' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

// ---------- KeybindEditor ----------
describe('KeybindEditor', () => {
  it('records a new keybinding from a keydown', async () => {
    render(<KeybindEditor />);
    fireEvent.click(screen.getByText('Command palette').parentElement!.querySelector('button')!);
    expect(screen.getByText('press keys…')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    await waitFor(() => expect(JSON.parse(localStorage.getItem('od.binds')!).palette.key).toBe('j'));
  });
  it('reset restores defaults', async () => {
    const user = userEvent.setup();
    localStorage.setItem('od.binds', JSON.stringify({ palette: { key: 'j' }, send: { key: 'Enter' }, models: { key: 'p', shift: true } }));
    render(<KeybindEditor />);
    await user.click(screen.getByText('Reset'));
    expect(JSON.parse(localStorage.getItem('od.binds')!)).toEqual(DEFAULT_BINDS);
  });
});

// ---------- McpEditor ----------
describe('McpEditor', () => {
  const shell = (cfg: any = {}) => {
    const setCfg = vi.fn();
    const save = vi.fn().mockResolvedValue(undefined);
    const toast = vi.fn();
    return { setCfg, save, toast, cfg: { mcpServers: {}, ...cfg } };
  };
  it('shows empty state with no servers', async () => {
    (globalThis.fetch as any).mockResolvedValue({ json: async () => ({ ok: false }), ok: true } as any);
    const s = shell();
    render(<McpEditor cfg={s.cfg} setCfg={s.setCfg} save={s.save} toast={s.toast} />);
    expect(await screen.findByText('No MCP servers configured.')).toBeTruthy();
  });
  it('add stays disabled and Enter path validates name+command', async () => {
    const user = userEvent.setup();
    const s = shell();
    render(<McpEditor cfg={s.cfg} setCfg={s.setCfg} save={s.save} toast={s.toast} />);
    await waitFor(() => expect(screen.getByText('Add')).toBeTruthy());
    expect((screen.getByText('Add') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByLabelText('Server args'));
    fireEvent.keyDown(screen.getByLabelText('Server args'), { key: 'Enter' });
    expect(s.toast).toHaveBeenCalledWith('Name + command required');
  });
  it('adds a server, saves and starts it', async () => {
    const user = userEvent.setup();
    const s = shell();
    render(<McpEditor cfg={s.cfg} setCfg={s.setCfg} save={s.save} toast={s.toast} />);
    await user.type(screen.getByLabelText('Server name'), 'srv');
    await user.type(screen.getByLabelText('Server command'), 'node');
    await user.type(screen.getByLabelText('Server args'), 'a.js');
    await user.click(screen.getByText('Add'));
    expect(s.setCfg).toHaveBeenCalled();
    expect(s.save).toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/mcp/start', expect.objectContaining({ method: 'POST' }));
  });
  it('start and stop hit the bridge', async () => {
    const user = userEvent.setup();
    const s = shell({ mcpServers: { srv: { command: 'node', args: [], env: {} } } });
    (globalThis.fetch as any).mockResolvedValue({ json: async () => ({ ok: true, servers: [] }), ok: true } as any);
    render(<McpEditor cfg={s.cfg} setCfg={s.setCfg} save={s.save} toast={s.toast} />);
    await user.click(screen.getByText('Start'));
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/mcp/start', expect.objectContaining({ method: 'POST' }));
  });
  it('delete removes the server', async () => {
    const user = userEvent.setup();
    const s = shell({ mcpServers: { srv: { command: 'node', args: [], env: {} } } });
    render(<McpEditor cfg={s.cfg} setCfg={s.setCfg} save={s.save} toast={s.toast} />);
    await user.click(screen.getByRole('button', { name: 'Delete srv' }));
    expect(s.setCfg).toHaveBeenCalled();
  });
});

// ---------- SettingsModal ----------
describe('SettingsModal', () => {
  function mockConfigFetch() {
    (globalThis.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes('/api/config')) return { json: async () => ({ localEndpoint: 'http://L', cloudEndpoint: 'http://C', cloudKey: '***', defaultModel: 'm', toolPolicy: {}, hooks: [], customCommands: [], mcpServers: {} }), ok: true } as any;
      if (String(url).includes('/api/tools')) return { json: async () => ({ ok: true, tools: [{ name: 'read_file', description: 'reads', readOnly: true, policy: 'allow' }] }), ok: true } as any;
      if (String(url).includes('/api/mcp')) return { json: async () => ({ ok: true, servers: [] }), ok: true } as any;
      return { json: async () => ({}), ok: true } as any;
    });
  }
  it('returns null when closed', () => {
    useStore.setState({ settingsOpen: false });
    const { container } = render(<SettingsModal />);
    expect(container.textContent).toBe('');
  });
  it('loads config values into fields', async () => {
    mockConfigFetch();
    useStore.setState({ settingsOpen: true });
    render(<SettingsModal />);
    expect(await screen.findByDisplayValue('http://L')).toBeTruthy();
    expect(await screen.findByDisplayValue('http://C')).toBeTruthy();
  });
  it('tool policy select updates state', async () => {
    const user = userEvent.setup();
    mockConfigFetch();
    useStore.setState({ settingsOpen: true });
    render(<SettingsModal />);
    const sel = await screen.findByLabelText('read_file permission') as HTMLSelectElement;
    await user.selectOptions(sel, 'deny');
    expect(sel.value).toBe('deny');
  });
});

// ---------- RepoPicker ----------
describe('RepoPicker', () => {
  it('returns null when closed', () => {
    useStore.setState({ repoPickerOpen: false });
    const { container } = render(<RepoPicker />);
    expect(container.textContent).toBe('');
  });
  it('lists drives via the Files explorer', async () => {
    const user = userEvent.setup();
    vi.mocked(apiDrives).mockResolvedValue({ ok: true, drives: ['C:\\'] } as any);
    useStore.setState({ repoPickerOpen: true, repo: null });
    render(<RepoPicker />);
    await user.click(screen.getByText('Files'));
    expect(await screen.findByText('C:\\')).toBeTruthy();
  });
  it('navigates into a drive via ls', async () => {
    const user = userEvent.setup();
    vi.mocked(apiDrives).mockResolvedValue({ ok: true, drives: ['C:\\'] } as any);
    vi.mocked(apiLsDir).mockResolvedValue({ ok: true, dirs: [{ name: 'proj' }], path: 'C:\\', parent: '' } as any);
    useStore.setState({ repoPickerOpen: true, repo: null });
    render(<RepoPicker />);
    await user.click(screen.getByText('Files'));
    await user.click(await screen.findByText('C:\\'));
    expect(apiLsDir).toHaveBeenCalled();
    expect(await screen.findByText('proj')).toBeTruthy();
  });
  it('hides Select-this-directory without a path', async () => {
    const user = userEvent.setup();
    vi.mocked(apiDrives).mockResolvedValue({ ok: true, drives: [] } as any);
    useStore.setState({ repoPickerOpen: true, repo: null });
    render(<RepoPicker />);
    await user.click(screen.getByText('Files'));
    await waitFor(() => expect(screen.queryByText('Select this directory')).toBeNull());
  });
  it('Browse… fills the path from the native dialog', async () => {
    const user = userEvent.setup();
    const { apiFsBrowse } = await import('../api');
    vi.mocked(apiFsBrowse).mockResolvedValue({ ok: true, path: 'C:\\picked' } as any);
    useStore.setState({ repoPickerOpen: true, repo: null });
    render(<RepoPicker />);
    await user.click(screen.getByText('Browse…'));
    await waitFor(() => expect(screen.getByDisplayValue('C:\\picked')).toBeTruthy());
  });
  it('Browse… cancel leaves the picker usable', async () => {
    const user = userEvent.setup();
    const { apiFsBrowse } = await import('../api');
    vi.mocked(apiFsBrowse).mockResolvedValue({ ok: false, cancelled: true } as any);
    useStore.setState({ repoPickerOpen: true, repo: null });
    render(<RepoPicker />);
    await user.click(screen.getByText('Browse…'));
    await waitFor(() => expect(screen.getByText('Files')).toBeTruthy());
  });
  it('renders memory notes and clears them', async () => {
    const user = userEvent.setup();
    vi.mocked(apiMemory).mockResolvedValue({ ok: true, notes: ['uses pnpm', 'has e2e'] } as any);
    useStore.setState({ repoPickerOpen: true, repo: { path: '/r', name: 'r', branch: 'main', dirty: false, diffStat: '' } });
    render(<RepoPicker />);
    expect(await screen.findByText(/uses pnpm/)).toBeTruthy();
    await user.click(screen.getByText('Clear'));
    expect(apiMemoryClear).toHaveBeenCalledWith('/r');
  });
});

// ---------- ModelManager / Diff / Code / PR / misc ----------
describe('ModelManager', () => {
  it('switches scopes and shows models', async () => {
    const user = userEvent.setup();
    render(<ModelManager models={[{ name: 'l1', scope: 'local' } as any, { name: 'c1', scope: 'cloud' } as any]} onRefresh={() => {}} />);
    expect(screen.getByText('l1')).toBeTruthy();
    await user.click(screen.getByText('cloud'));
    expect(screen.getByText('c1')).toBeTruthy();
  });
  it('shows the meta line for sized models', () => {
    render(<ModelManager models={[{ name: 'l1', scope: 'local', size: 2e9, details: { parameter_size: '7B' } } as any]} onRefresh={() => {}} />);
    expect(screen.getByText(/7B/)).toBeTruthy();
  });
  it('shows empty states per scope', async () => {
    const user = userEvent.setup();
    render(<ModelManager models={[]} onRefresh={() => {}} />);
    expect(screen.getByText(/No local models/)).toBeTruthy();
    await user.click(screen.getByText('cloud'));
    expect(screen.getByText(/No cloud models/)).toBeTruthy();
  });
});

describe('DiffViewerModal', () => {
  it('returns null for null diff', () => {
    const { container } = render(<DiffViewerModal diff={null} onClose={() => {}} />);
    expect(container.textContent).toBe('');
  });
  it('shows a truncation notice past 1200 lines', () => {
    const big = Array.from({ length: 1300 }, (_, i) => `+line ${i}`).join('\n');
    render(<DiffViewerModal diff={big} onClose={() => {}} />);
    expect(screen.getByText(/Showing first 1200 of 1300 lines/)).toBeTruthy();
  });
  it('renders an empty diff with the clean-tree message (FIXED dead branch)', () => {
    const { container } = render(<DiffViewerModal diff={''} onClose={() => {}} />);
    expect(container.querySelector('pre')).toBeTruthy();
    expect(screen.getByText(/Working tree is clean/)).toBeTruthy();
  });
});

describe('CodeViewer', () => {
  it('returns null without a file', () => {
    const { container } = render(<CodeViewer file={null} content="x" onClose={() => {}} />);
    expect(container.textContent).toBe('');
  });
  it('search filters lines', async () => {
    const user = userEvent.setup();
    render(<CodeViewer file="a.ts" content={'alpha\nbeta\nalpha2'} onClose={() => {}} />);
    await user.type(screen.getByLabelText('Search file'), 'beta');
    expect(screen.getByText('beta')).toBeTruthy();
    expect(screen.queryByText('alpha')).toBeNull();
  });
  it('shows an 800-line notice for huge files', () => {
    const big = Array.from({ length: 900 }, (_, i) => `line ${i}`).join('\n');
    render(<CodeViewer file="big.ts" content={big} onClose={() => {}} />);
    expect(screen.getByText(/Showing first 800 of 900 lines/)).toBeTruthy();
  });
});

describe('PRMenu', () => {
  it('returns null when anchor is false', () => {
    const { container } = render(<PRMenu anchor={false} onClose={() => {}} />);
    expect(container.textContent).toBe('');
  });
  it('menu items fire and close', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const spy = vi.spyOn(window, 'dispatchEvent');
    render(<PRMenu anchor onClose={onClose} />);
    await user.click(screen.getByText('View diff'));
    expect(spy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('Escape closes the menu', () => {
    const onClose = vi.fn();
    render(<PRMenu anchor onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('FileListModal', () => {
  it('opens a file on click', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<FileListModal title="T" files={['a.ts']} onClose={() => {}} onOpen={onOpen} />);
    await user.click(screen.getByText('a.ts'));
    expect(onOpen).toHaveBeenCalledWith('a.ts');
  });
  it('shows empty state', () => {
    render(<FileListModal title="T" files={[]} onClose={() => {}} onOpen={() => {}} />);
    expect(screen.getByText('No files.')).toBeTruthy();
  });
});
