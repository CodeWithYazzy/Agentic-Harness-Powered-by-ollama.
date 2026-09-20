// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer, ModelSelector, ReasoningSelector, ModeSwitch, fmtSize } from './Composer';
import { useStore } from '../store';
import { abortAllStreams } from '../streams';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function resetStore() {
  abortAllStreams();
  localStorage.clear();
  useStore.setState({
    route: '/chat', sessionId: null, sessions: [], models: [], modelsLoading: false,
    hasCloudKey: false, streaming: {}, bgRuns: [], customCommands: [], toasts: [],
    buildMode: false, model: '', scope: 'local', reasoning: 'Medium', repo: null,
    memory: {}, settingsOpen: false, paletteOpen: false,
  } as any);
}

beforeEach(() => {
  resetStore();
  (Element.prototype as any).scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}), ok: true } as any)));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const M = (name: string, scope: 'local' | 'cloud' = 'local', tier: any = 'local') => ({ name, scope, tier });

describe('fmtSize', () => {
  it('formats bytes', () => { expect(fmtSize(0)).toBe('0 B'); expect(fmtSize(500)).toBe('500 B'); });
  it('formats KB', () => { expect(fmtSize(1500)).toBe('2 KB'); });
  it('formats MB and GB', () => { expect(fmtSize(2e6)).toBe('2.0 MB'); expect(fmtSize(3e9)).toBe('3.0 GB'); });
});

describe('ModelSelector', () => {
  it('trigger shows placeholder when no model', () => {
    render(<ModelSelector />);
    expect(screen.getByText('Select model')).toBeTruthy();
  });
  it('trigger truncates long names but keeps full title', () => {
    const long = 'very-long-model-name-'.repeat(6);
    useStore.setState({ model: long });
    render(<ModelSelector />);
    const btn = screen.getByTitle(long);
    expect(btn.className).toContain('truncate');
    expect(btn.textContent).toBe(long);
  });
  it('filters list by query', async () => {
    const user = userEvent.setup();
    useStore.setState({ models: [M('llama3'), M('mistral')] });
    render(<ModelSelector />);
    await user.click(screen.getByText('Select model'));
    await user.type(screen.getByPlaceholderText('Search models'), 'llam');
    expect(screen.getByText('llama3')).toBeTruthy();
    expect(screen.queryByText('mistral')).toBeNull();
  });
  it('renders tier groups Local/Free/API', async () => {
    const user = userEvent.setup();
    useStore.setState({ models: [M('l1', 'local', 'local'), M('f1', 'cloud', 'free-cloud'), M('a1', 'cloud', 'api-cloud')], hasCloudKey: true });
    render(<ModelSelector />);
    await user.click(screen.getByText('Select model'));
    expect(screen.getByText('Local')).toBeTruthy();
    expect(screen.getByText('Free cloud')).toBeTruthy();
    expect(screen.getByText('API cloud')).toBeTruthy();
  });
  it('Enter picks the highlighted model', async () => {
    const user = userEvent.setup();
    useStore.setState({ models: [M('llama3'), M('mistral')] });
    render(<ModelSelector />);
    await user.click(screen.getByText('Select model'));
    const input = screen.getByPlaceholderText('Search models');
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useStore.getState().model).toBe('llama3');
  });
  it('arrows move highlight and clamp at ends', async () => {
    const user = userEvent.setup();
    useStore.setState({ models: [M('a'), M('b')] });
    render(<ModelSelector />);
    await user.click(screen.getByText('Select model'));
    const input = screen.getByPlaceholderText('Search models');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useStore.getState().model).toBe('b');
    // reopen after the popover exit animation finishes, arrow up clamps at 0
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'b' }));
    const input2 = screen.getByPlaceholderText('Search models');
    fireEvent.keyDown(input2, { key: 'ArrowUp' });
    fireEvent.keyDown(input2, { key: 'Enter' });
    expect(useStore.getState().model).toBe('a');
  });
  it('API-tier without key opens settings instead of selecting', async () => {
    const user = userEvent.setup();
    useStore.setState({ models: [M('pro-model', 'cloud', 'api-cloud')], hasCloudKey: false, model: '' });
    render(<ModelSelector />);
    await user.click(screen.getByText('Select model'));
    await user.click(screen.getByText('pro-model'));
    expect(useStore.getState().settingsOpen).toBe(true);
    expect(useStore.getState().model).toBe('');
    expect(useStore.getState().toasts.some((t) => /API key/i.test(t.text))).toBe(true);
  });
  it('API-tier with key selects normally', async () => {
    const user = userEvent.setup();
    useStore.setState({ models: [M('pro-model', 'cloud', 'api-cloud')], hasCloudKey: true, model: '' });
    render(<ModelSelector />);
    await user.click(screen.getByText('Select model'));
    await user.click(screen.getByText('pro-model'));
    expect(useStore.getState().model).toBe('pro-model');
  });
});

describe('ReasoningSelector', () => {
  it('offers Low/Medium/High options', async () => {
    const user = userEvent.setup();
    render(<ReasoningSelector />);
    await user.click(screen.getByRole('button', { name: 'Reasoning level' }));
    expect(screen.getAllByText('Low').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Medium').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('High').length).toBeGreaterThanOrEqual(1);
  });
  it('sets the level and persists od.reasoning', async () => {
    const user = userEvent.setup();
    useStore.setState({ reasoning: 'Medium' });
    render(<ReasoningSelector />);
    await user.click(screen.getByRole('button', { name: 'Reasoning level' }));
    await user.click(screen.getByText('High'));
    expect(useStore.getState().reasoning).toBe('High');
    expect(localStorage.getItem('od.reasoning')).toBe('High');
  });
});

describe('ModeSwitch', () => {
  it('flips to build and persists od.buildMode', async () => {
    const user = userEvent.setup();
    useStore.setState({ buildMode: false });
    render(<ModeSwitch />);
    await user.click(screen.getByText('Build'));
    expect(useStore.getState().buildMode).toBe(true);
    expect(localStorage.getItem('od.buildMode')).toBe('build');
  });
  it('flips back to chat', async () => {
    const user = userEvent.setup();
    useStore.setState({ buildMode: true });
    render(<ModeSwitch />);
    await user.click(screen.getByText('Chat'));
    expect(useStore.getState().buildMode).toBe(false);
  });
  it('exposes aria-pressed on both buttons', () => {
    useStore.setState({ buildMode: false });
    render(<ModeSwitch />);
    expect(screen.getByText('Chat').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Build').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Composer slash menu', () => {
  const base = { onPR: () => {}, onStop: () => {} };
  it('filters case-insensitively', async () => {
    const user = userEvent.setup();
    render(<Composer sid="s1" onSend={() => {}} {...base} />);
    await user.click(screen.getByLabelText('Message composer'));
    await user.type(screen.getByLabelText('Message composer'), '/DIFF');
    expect(await screen.findByText('/diff')).toBeTruthy();
  });
  it('Enter on exact match calls onSend immediately', async () => {
    const onSend = vi.fn();
    render(<Composer sid="s1" onSend={onSend} {...base} />);
    const ta = screen.getByLabelText('Message composer');
    fireEvent.change(ta, { target: { value: '/diff' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('/diff', [], undefined);
  });
  it('partial text completes instead of sending', async () => {
    const onSend = vi.fn();
    render(<Composer sid="s1" onSend={onSend} {...base} />);
    const ta = screen.getByLabelText('Message composer') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '/di' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect(ta.value).toBe('/diff ');
  });
  it('no-match Enter sends the raw text', async () => {
    const onSend = vi.fn();
    render(<Composer sid="s1" onSend={onSend} {...base} />);
    const ta = screen.getByLabelText('Message composer');
    fireEvent.change(ta, { target: { value: '/zzz-nope' } });
    expect(screen.getByText('No commands match.')).toBeTruthy();
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('/zzz-nope', [], undefined);
  });
  it('arrows move highlight and Escape closes the menu', async () => {
    const user = userEvent.setup();
    render(<Composer sid="s1" onSend={() => {}} {...base} />);
    const ta = screen.getByLabelText('Message composer');
    await user.type(ta, '/');
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    fireEvent.keyDown(ta, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('No commands match.')).toBeNull());
  });
  it('highlight clamps when the filter shrinks', async () => {
    const onSend = vi.fn();
    render(<Composer sid="s1" onSend={onSend} {...base} />);
    const ta = screen.getByLabelText('Message composer') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '/' } });
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    fireEvent.change(ta, { target: { value: '/diff' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('/diff', [], undefined);
  });
  it('plain Enter without menu sends', async () => {
    const onSend = vi.fn();
    render(<Composer sid="s1" onSend={onSend} {...base} />);
    const ta = screen.getByLabelText('Message composer');
    fireEvent.change(ta, { target: { value: 'hello' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('hello', [], undefined);
  });
});

describe('Composer send/background/attachments', () => {
  const base = { onPR: () => {}, onStop: () => {} };
  it('bg toggle sets aria-pressed and passes background:true', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Composer sid="s1" onSend={onSend} {...base} />);
    const bg = screen.getByRole('button', { name: 'Run in background' });
    expect(bg.getAttribute('aria-pressed')).toBe('false');
    await user.click(bg);
    expect(screen.getByRole('button', { name: 'Run in background' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByLabelText('Message composer'), { target: { value: 'hi' } });
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledWith('hi', [], { background: true });
  });
  it('paperclip reveals a file input accepting multiple files', async () => {
    const user = userEvent.setup();
    render(<Composer sid="s1" onSend={() => {}} {...base} />);
    await user.click(screen.getByRole('button', { name: 'Attach files' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.multiple).toBe(true);
  });
  it('send is disabled when empty', () => {
    render(<Composer sid="s1" onSend={() => {}} {...base} />);
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('send is disabled while streaming and shows Stop', () => {
    useStore.setState({ streaming: { s1: true } });
    const onStop = vi.fn();
    render(<Composer sid="s1" onSend={() => {}} onPR={() => {}} onStop={onStop} />);
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop generation' })).toBeTruthy();
  });
  it('Escape while streaming calls onStop', () => {
    useStore.setState({ streaming: { s1: true } });
    const onStop = vi.fn();
    render(<Composer sid="s1" onSend={() => {}} onPR={() => {}} onStop={onStop} />);
    fireEvent.keyDown(screen.getByLabelText('Message composer'), { key: 'Escape' });
    expect(onStop).toHaveBeenCalledWith('s1');
  });
});
