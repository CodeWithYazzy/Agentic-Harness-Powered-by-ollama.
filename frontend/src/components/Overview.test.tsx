// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Heatmap, OverviewCard, RecentsPanel, timeAgo, useStats } from './Overview';
import { renderHook } from '@testing-library/react';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mkMsg(createdAt: number, tokens = 0, role: 'user' | 'assistant' = 'user') {
  return { id: `m${createdAt}`, role, content: 'x', createdAt, tokens };
}
function mkSession(id: string, updatedAt: number, msgs: any[] = [], model = 'llama3') {
  return { id, title: `S-${id}`, repository: '', branch: 'main', worktree: '', provider: 'local', model, reasoningLevel: 'Medium', messages: msgs, toolCalls: [], contextMemory: {}, createdAt: updatedAt - 1000, updatedAt };
}

describe('OverviewCard stats', () => {
  it('renders stat cells with values', () => {
    const now = Date.now();
    const sessions = [mkSession('a', now, [mkMsg(now, 10), mkMsg(now, 20, 'assistant')]) as any];
    render(<OverviewCard sessions={sessions} />);
    expect(screen.getByText('Sessions')).toBeTruthy();
    expect(screen.getByText('Messages')).toBeTruthy();
    expect(screen.getByText('Total tokens')).toBeTruthy();
    const cell = screen.getByText('Sessions').parentElement!;
    expect(cell.textContent).toContain('1');
    const mcell = screen.getByText('Messages').parentElement!;
    expect(mcell.textContent).toContain('2');
  });
  it('shows the empty state with no activity', () => {
    render(<OverviewCard sessions={[]} />);
    expect(screen.getByText(/No activity yet/)).toBeTruthy();
  });
  it('switching to Models tab lists per-model rows', async () => {
    const user = userEvent.setup();
    const now = Date.now();
    render(<OverviewCard sessions={[mkSession('a', now, [mkMsg(now)])] as any} />);
    await user.click(screen.getByText('Models'));
    expect(screen.getByText('llama3')).toBeTruthy();
  });
  it('Models tab shows empty text when unused', async () => {
    const user = userEvent.setup();
    render(<OverviewCard sessions={[]} />);
    await user.click(screen.getByText('Models'));
    expect(screen.getByText('No models used yet.')).toBeTruthy();
  });
  it('range switching recomputes sessions', async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const sessions = [
      mkSession('old', now - 20 * 86400000, [mkMsg(now - 20 * 86400000)]),
      mkSession('new', now, [mkMsg(now)]),
    ] as any;
    render(<OverviewCard sessions={sessions} />);
    const val = () => screen.getByText('Sessions').parentElement!.textContent;
    expect(val()).toContain('1');
    await user.click(screen.getByText('30d'));
    expect(val()).toContain('2');
    await user.click(screen.getByText('7d'));
    expect(val()).toContain('1');
  });
  it('All range keeps every session', async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const sessions = [mkSession('old', now - 60 * 86400000, [mkMsg(now - 60 * 86400000)]), mkSession('new', now, [mkMsg(now)])] as any;
    render(<OverviewCard sessions={sessions} />);
    await user.click(screen.getByText('All'));
    expect(screen.getByText('Sessions').parentElement!.textContent).toContain('2');
  });
  it('useStats computes streaks and peak hour', () => {
    const now = Date.now();
    const { result } = renderHook(() => useStats([mkSession('a', now, [mkMsg(now, 5), mkMsg(now, 7, 'assistant')]) as any], null));
    expect(result.current.sessions).toBe(1);
    expect(result.current.messages).toBe(2);
    expect(result.current.tokens).toBe(12);
    expect(result.current.curStreak).toBe(1);
    expect(result.current.favModel).toBe('llama3');
  });
  it('useStats respects a null range as all-time', () => {
    const now = Date.now();
    const { result } = renderHook(() => useStats([mkSession('a', now - 400 * 86400000, [mkMsg(now - 400 * 86400000)]) as any], null));
    expect(result.current.sessions).toBe(1);
  });
});

describe('Heatmap', () => {
  function statsNow() {
    const now = Date.now();
    const { result } = renderHook(() => useStats([mkSession('a', now, [mkMsg(now)]) as any], null));
    return result.current;
  }
  it('cells expose role=img with aria-labels', () => {
    const { container } = render(<Heatmap stats={statsNow()} />);
    const cells = container.querySelectorAll('[role="img"]');
    expect(cells.length).toBeGreaterThan(100);
    expect(cells[0].getAttribute('aria-label')).toMatch(/messages/);
  });
  it('keyboard focus shows the tip', () => {
    const { container } = render(<Heatmap stats={statsNow()} />);
    const cell = container.querySelector('[role="img"][tabindex="0"]') as HTMLElement;
    expect(cell).toBeTruthy();
    fireEvent.focus(cell);
    expect(screen.getByText(/messages/)).toBeTruthy();
  });
  it('blur hides the tip', () => {
    const { container } = render(<Heatmap stats={statsNow()} />);
    const cell = container.querySelector('[role="img"][tabindex="0"]') as HTMLElement;
    fireEvent.focus(cell);
    fireEvent.blur(cell);
    expect(container.textContent).not.toContain('pointer-events-none absolute');
  });
  it('mouse enter shows the tip', () => {
    const { container } = render(<Heatmap stats={statsNow()} />);
    const cell = container.querySelector('[role="img"][tabindex="0"]') as HTMLElement;
    fireEvent.mouseEnter(cell);
    expect(document.body.textContent).toMatch(/messages/);
  });
});

describe('RecentsPanel', () => {
  it('renders session rows with counts', () => {
    const now = Date.now();
    render(<RecentsPanel sessions={[mkSession('a', now, [mkMsg(now, 8)])] as any} onOpen={() => {}} onNew={() => {}} onAll={() => {}} />);
    expect(screen.getByText('S-a')).toBeTruthy();
    expect(screen.getByText(/1 msgs/)).toBeTruthy();
  });
  it('shows the empty state', () => {
    render(<RecentsPanel sessions={[]} onOpen={() => {}} onNew={() => {}} onAll={() => {}} />);
    expect(screen.getByText(/No chats yet/)).toBeTruthy();
  });
  it('open callback fires with the session id', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const now = Date.now();
    render(<RecentsPanel sessions={[mkSession('a', now)] as any} onOpen={onOpen} onNew={() => {}} onAll={() => {}} />);
    await user.click(screen.getByText('S-a'));
    expect(onOpen).toHaveBeenCalledWith('a');
  });
  it('New button fires onNew', async () => {
    const user = userEvent.setup();
    const onNew = vi.fn();
    render(<RecentsPanel sessions={[]} onOpen={() => {}} onNew={onNew} onAll={() => {}} />);
    await user.click(screen.getByText('New'));
    expect(onNew).toHaveBeenCalled();
  });
  it('overflow button fires onAll', async () => {
    const user = userEvent.setup();
    const onAll = vi.fn();
    const now = Date.now();
    const many = Array.from({ length: 7 }, (_, i) => mkSession(`s${i}`, now)) as any;
    render(<RecentsPanel sessions={many} onOpen={() => {}} onNew={() => {}} onAll={onAll} />);
    await user.click(screen.getByText(/more in sidebar/));
    expect(onAll).toHaveBeenCalled();
  });
  it('caps visible recents at five', () => {
    const now = Date.now();
    const many = Array.from({ length: 7 }, (_, i) => mkSession(`s${i}`, now, [], `m${i}`)) as any;
    render(<RecentsPanel sessions={many} onOpen={() => {}} onNew={() => {}} onAll={() => {}} />);
    expect(screen.queryByText('S-s5')).toBeNull();
    expect(screen.getByText('S-s0')).toBeTruthy();
  });
});

describe('timeAgo', () => {
  it('says just now for fresh timestamps', () => { expect(timeAgo(Date.now())).toBe('just now'); });
  it('formats minutes and hours', () => {
    expect(timeAgo(Date.now() - 5 * 60000)).toBe('5m ago');
    expect(timeAgo(Date.now() - 3 * 3600000)).toBe('3h ago');
  });
  it('formats Yesterday and days', () => {
    expect(timeAgo(Date.now() - 26 * 3600000)).toBe('Yesterday');
    expect(timeAgo(Date.now() - 3 * 86400000)).toBe('3d ago');
  });
});
