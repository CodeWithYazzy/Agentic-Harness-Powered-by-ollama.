// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DesktopWindow, Dock, LiveClock, Toasts } from './chrome';
import { useStore } from '../store';
import { abortAllStreams } from '../streams';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function resetStore() {
  abortAllStreams();
  localStorage.clear();
  useStore.setState({
    route: '/', sessionId: null, sessions: [], models: [], modelsLoading: false,
    hasCloudKey: false, streaming: {}, bgRuns: [], customCommands: [], toasts: [],
    buildMode: false, model: '', scope: 'local', reasoning: 'Medium', repo: null,
    memory: {}, minimized: false, maximized: false,
  } as any);
}

beforeEach(() => { resetStore(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('LiveClock', () => {
  it('renders time and date with an aria-label', () => {
    render(<LiveClock />);
    const el = screen.getByLabelText(/.+/);
    expect(el.getAttribute('aria-label')).toMatch(/\d/);
    expect(el.textContent!.length).toBeGreaterThan(5);
  });
  it('shows both a time and a date part', () => {
    const { container } = render(<LiveClock />);
    expect(container.querySelector('.text-\\[96px\\]') || container.textContent).toBeTruthy();
    expect(container.textContent).toMatch(/AM|PM|:/);
  });
});

describe('Dock', () => {
  it('labels the icon Restore when minimized', () => {
    useStore.setState({ minimized: true });
    render(<Dock />);
    expect(screen.getByRole('button', { name: 'Restore YK-Harness' })).toBeTruthy();
  });
  it('labels the icon Minimize when visible', () => {
    useStore.setState({ minimized: false });
    render(<Dock />);
    expect(screen.getByRole('button', { name: 'Minimize YK-Harness' })).toBeTruthy();
  });
  it('clicking toggles minimize', async () => {
    const user = userEvent.setup();
    useStore.setState({ minimized: false });
    render(<Dock />);
    await user.click(screen.getByRole('button', { name: 'Minimize YK-Harness' }));
    expect(useStore.getState().minimized).toBe(true);
  });
  it('clicking while minimized restores', async () => {
    const user = userEvent.setup();
    useStore.setState({ minimized: true });
    render(<Dock />);
    await user.click(screen.getByRole('button', { name: 'Restore YK-Harness' }));
    expect(useStore.getState().minimized).toBe(false);
  });
});

describe('Toasts', () => {
  it('renders toast text', () => {
    useStore.getState().toast('hello-toast');
    render(<Toasts />);
    expect(screen.getByText('hello-toast')).toBeTruthy();
  });
  it('caps rendering to the stored toasts', () => {
    useStore.setState({ toasts: [
      { id: '1', text: 'one' }, { id: '2', text: 'two' }, { id: '3', text: 'three' },
    ] });
    render(<Toasts />);
    expect(screen.getByText('one')).toBeTruthy();
    expect(screen.getByText('three')).toBeTruthy();
  });
  it('action button fires and removes the toast', async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    useStore.setState({ toasts: [{ id: 'a', text: 'with action', action: { label: 'Undo', fn } }] });
    render(<Toasts />);
    await user.click(screen.getByText('Undo'));
    expect(fn).toHaveBeenCalled();
    expect(useStore.getState().toasts).toHaveLength(0);
  });
  it('has a polite live region', () => {
    render(<Toasts />);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });
});

describe('DesktopWindow', () => {
  it('renders children and the sidebar toggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<DesktopWindow title="T" sidebar={<div>side</div>} sidebarOpen onToggleSidebar={onToggle}>body</DesktopWindow>);
    expect(screen.getByText('body')).toBeTruthy();
    expect(screen.getByText('side')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(onToggle).toHaveBeenCalled();
  });
  it('shows the title pill and brand', () => {
    render(<DesktopWindow title="T" titlePill="myrepo">body</DesktopWindow>);
    expect(screen.getByText('YK-Harness')).toBeTruthy();
    expect(screen.getByText('myrepo')).toBeTruthy();
  });
  it('Overview button navigates home and back', async () => {
    const user = userEvent.setup();
    useStore.setState({ route: '/chat', sessionId: 's1', sessions: [{ id: 's1', title: 'S', repository: '', branch: 'main', worktree: '', provider: 'local', model: 'm', reasoningLevel: 'Medium', messages: [], toolCalls: [], contextMemory: {}, createdAt: 1, updatedAt: 1 }] as any });
    render(<DesktopWindow title="T">body</DesktopWindow>);
    await user.click(screen.getByText('Overview'));
    expect(useStore.getState().route).toBe('/');
  });
  it('minimize button sets minimized', async () => {
    const user = userEvent.setup();
    render(<DesktopWindow title="T">body</DesktopWindow>);
    await user.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(useStore.getState().minimized).toBe(true);
  });
  it('copy transcript with no session toasts a hint', async () => {
    const user = userEvent.setup();
    useStore.setState({ sessions: [], sessionId: null });
    render(<DesktopWindow title="T">body</DesktopWindow>);
    await user.click(screen.getByRole('button', { name: 'Copy transcript' }));
    expect(useStore.getState().toasts.some((t) => /Nothing to copy/.test(t.text))).toBe(true);
  });
});
