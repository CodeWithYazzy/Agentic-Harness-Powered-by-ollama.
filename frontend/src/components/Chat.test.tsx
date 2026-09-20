// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ApprovalCard,
  AskCard,
  Markdown,
  MessageMenu,
  ModeSwitchCard,
  ToolHeader,
  UserBubble,
} from './Chat';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Markdown code', () => {
  it('renders fenced code blocks as pre', () => {
    render(<Markdown text={'```js\nconst a = 1;\n```'} />);
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toContain('const a = 1;');
  });
  it('renders inline code as code element', () => {
    render(<Markdown text={'use `x` here'} />);
    expect(document.querySelector('code')?.textContent).toBe('x');
  });
  it('renders bold as strong', () => {
    render(<Markdown text={'a **bold** word'} />);
    expect(document.querySelector('strong')?.textContent).toBe('bold');
  });
  it('renders italic as em', () => {
    render(<Markdown text={'a *ital* word'} />);
    expect(document.querySelector('em')?.textContent).toBe('ital');
  });
  it('renders links with target _blank and rel noreferrer', () => {
    render(<Markdown text={'[docs](https://example.com)'} />);
    const a = document.querySelector('a')!;
    expect(a.textContent).toBe('docs');
    expect(a.getAttribute('href')).toBe('https://example.com');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noreferrer');
  });
  it('never renders javascript: links as anchors (S9)', () => {
    render(<Markdown text={'[click](javascript:alert(1))'} />);
    expect(document.querySelector('a')).toBeNull();
    expect(document.body.textContent).toContain('click');
  });
  it('never renders data: links as anchors (S9)', () => {
    render(<Markdown text={'[img](data:text/html,<script>alert(1)</script>)'} />);
    expect(document.querySelector('a')).toBeNull();
  });
  it('renders mailto links as anchors', () => {
    render(<Markdown text={'[mail](mailto:a@b.c)'} />);
    expect(document.querySelector('a')?.getAttribute('href')).toBe('mailto:a@b.c');
  });
  it('renders file paths as buttons that call onFile', async () => {
    const onFile = vi.fn();
    const user = userEvent.setup();
    render(<Markdown text={'see src/app.ts for details'} onFile={onFile} />);
    const btn = screen.getByRole('button', { name: 'src/app.ts' });
    await user.click(btn);
    expect(onFile).toHaveBeenCalledWith('src/app.ts');
  });
  it('does not make file buttons without onFile', () => {
    render(<Markdown text={'see src/app.ts here'} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('renders h1 with the largest class', () => {
    render(<Markdown text={'# Title one'} />);
    expect(screen.getByText('Title one').parentElement?.className).toContain('text-[17px]');
  });
  it('renders h2 with medium class', () => {
    render(<Markdown text={'## Title two'} />);
    expect(screen.getByText('Title two').parentElement?.className).toContain('text-[15px]');
  });
  it('renders h3 with small class', () => {
    render(<Markdown text={'### Title three'} />);
    expect(screen.getByText('Title three').parentElement?.className).toContain('text-[14px]');
  });
  it('renders h4 headings too', () => {
    render(<Markdown text={'#### Title four'} />);
    expect(screen.getByText('Title four')).toBeTruthy();
  });
  it('renders quotes as blockquote', () => {
    render(<Markdown text={'> quoted line'} />);
    expect(document.querySelector('blockquote')?.textContent).toContain('quoted line');
  });
  it('renders unordered lists', () => {
    render(<Markdown text={'- a\n- b'} />);
    const ul = document.querySelector('ul');
    expect(ul?.querySelectorAll('li')).toHaveLength(2);
  });
  it('renders ordered lists', () => {
    render(<Markdown text={'1. a\n2. b'} />);
    const ol = document.querySelector('ol');
    expect(ol?.querySelectorAll('li')).toHaveLength(2);
  });
  it('breaks paragraphs on blank lines', () => {
    render(<Markdown text={'one\n\ntwo'} />);
    expect(document.querySelectorAll('p')).toHaveLength(2);
  });
  it('does not execute <script> tags (renders as text)', () => {
    render(<Markdown text={'<script>alert(1)</script>'} />);
    expect(document.querySelector('script')).toBeNull();
    expect(document.body.textContent).toContain('<script>');
  });
  it('does not create img elements for <img onerror> payloads', () => {
    render(<Markdown text={'<img src=x onerror=alert(1)>'} />);
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img');
  });
  it('root carries break-words class', () => {
    const { container } = render(<Markdown text={'hi'} />);
    expect(container.firstElementChild?.className).toContain('break-words');
  });
});

describe('UserBubble', () => {
  it('shows attachment chips with names', () => {
    render(<UserBubble m={{ id: '1', role: 'user', content: 'hi', createdAt: 1, atts: [{ name: 'a.txt', size: 12, kind: 'text' }] } as any} />);
    expect(screen.getByText('a.txt')).toBeTruthy();
  });
  it('shows message content', () => {
    render(<UserBubble m={{ id: '1', role: 'user', content: 'hello world', createdAt: 1 } as any} />);
    expect(screen.getByText('hello world')).toBeTruthy();
  });
  it('renders nothing for empty content without attachments', () => {
    const { container } = render(<UserBubble m={{ id: '1', role: 'user', content: '', createdAt: 1 } as any} />);
    expect(container.querySelector('.break-words')).toBeNull();
    expect(container.textContent).toBe('');
  });
  it('shows multiple chips', () => {
    render(<UserBubble m={{ id: '1', role: 'user', content: '', createdAt: 1, atts: [{ name: 'a.txt', size: 1, kind: 'text' }, { name: 'b.png', size: 2, kind: 'image' }] } as any} />);
    expect(screen.getByText('a.txt')).toBeTruthy();
    expect(screen.getByText('b.png')).toBeTruthy();
  });
});

describe('MessageMenu', () => {
  it('opens on click showing actions', async () => {
    const user = userEvent.setup();
    render(<MessageMenu actions={['copy', 'delete']} align="left" onAction={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Message actions' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByText('Copy')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });
  it('fires the action callback and closes', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<MessageMenu actions={['copy']} align="left" onAction={onAction} />);
    await user.click(screen.getByRole('button', { name: 'Message actions' }));
    await user.click(screen.getByText('Copy'));
    expect(onAction).toHaveBeenCalledWith('copy');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
  it('Escape closes the menu', async () => {
    const user = userEvent.setup();
    render(<MessageMenu actions={['copy']} align="left" onAction={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Message actions' }));
    expect(screen.queryByRole('menu')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
  it('flipUp positions the menu with bottom-7', async () => {
    const user = userEvent.setup();
    render(<MessageMenu actions={['copy']} align="left" flipUp onAction={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Message actions' }));
    expect(screen.getByRole('menu').className).toContain('bottom-7');
  });
  it('non-flip menu uses top-7', async () => {
    const user = userEvent.setup();
    render(<MessageMenu actions={['copy']} align="left" onAction={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Message actions' }));
    expect(screen.getByRole('menu').className).toContain('top-7');
  });
});

describe('ToolHeader', () => {
  it('renders the label as text', () => {
    render(<ToolHeader label="Read app.ts" />);
    expect(screen.getByText('Read app.ts')).toBeTruthy();
  });
  it('is not a button and has no click role', () => {
    render(<ToolHeader label="Showed diff" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ApprovalCard', () => {
  it('shows the tool name', () => {
    render(<ApprovalCard tool="run_shell" input={{ cmd: 'ls' }} onDecision={() => {}} />);
    expect(screen.getByText('run_shell')).toBeTruthy();
    expect(screen.getByText('needs approval')).toBeTruthy();
  });
  it('shows input JSON', () => {
    render(<ApprovalCard tool="t" input={{ cmd: 'ls -la' }} onDecision={() => {}} />);
    expect(document.querySelector('pre')?.textContent).toContain('ls -la');
  });
  it('Allow once fires (true, false)', async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<ApprovalCard tool="t" input={{}} onDecision={fn} />);
    await user.click(screen.getByText('Allow once'));
    expect(fn).toHaveBeenCalledWith(true, false);
  });
  it('Always allow fires (true, true)', async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<ApprovalCard tool="t" input={{}} onDecision={fn} />);
    await user.click(screen.getByText(/Always allow/));
    expect(fn).toHaveBeenCalledWith(true, true);
  });
  it('Deny fires (false, false)', async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<ApprovalCard tool="t" input={{}} onDecision={fn} />);
    await user.click(screen.getByText('Deny'));
    expect(fn).toHaveBeenCalledWith(false, false);
  });
});

describe('AskCard', () => {
  const qs = [
    { question: 'Pick color?', options: [{ label: 'red' }, { label: 'blue' }] },
    { question: 'Pick size?', options: [{ label: 's' }, { label: 'm' }] },
  ];
  it('submit is disabled until all questions answered', async () => {
    const user = userEvent.setup();
    render(<AskCard questions={qs} onAnswer={() => {}} onDecline={() => {}} />);
    const btn = screen.getByText('Answer') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await user.click(screen.getByText('red'));
    expect((screen.getByText('Answer') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByText('s'));
    expect((screen.getByText('Answer') as HTMLButtonElement).disabled).toBe(false);
  });
  it('answers with string[][] shape', async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(<AskCard questions={qs} onAnswer={onAnswer} onDecline={() => {}} />);
    await user.click(screen.getByText('blue'));
    await user.click(screen.getByText('m'));
    await user.click(screen.getByText('Answer'));
    expect(onAnswer).toHaveBeenCalledWith([['blue'], ['m']]);
  });
  it('Skip calls onDecline', async () => {
    const user = userEvent.setup();
    const onDecline = vi.fn();
    render(<AskCard questions={qs} onAnswer={() => {}} onDecline={onDecline} />);
    await user.click(screen.getByText('Skip'));
    expect(onDecline).toHaveBeenCalled();
  });
  it('selecting an option highlights it', async () => {
    const user = userEvent.setup();
    render(<AskCard questions={qs} onAnswer={() => {}} onDecline={() => {}} />);
    await user.click(screen.getByText('red'));
    expect(screen.getByText('red').className).toContain('border-[#0b66e4]');
  });
});

describe('ModeSwitchCard', () => {
  it('mentions Build mode in copy', () => {
    render(<ModeSwitchCard onApprove={() => {}} onDeny={() => {}} />);
    expect(screen.getByText('This looks like a build task')).toBeTruthy();
    expect(screen.getByText('Go to Build mode')).toBeTruthy();
    expect(screen.getAllByText(/Build mode/).length).toBeGreaterThanOrEqual(2);
  });
  it('approve button fires onApprove', async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<ModeSwitchCard onApprove={fn} onDeny={() => {}} />);
    await user.click(screen.getByText('Go to Build mode'));
    expect(fn).toHaveBeenCalled();
  });
  it('deny button fires onDeny', async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<ModeSwitchCard onApprove={() => {}} onDeny={fn} />);
    await user.click(screen.getByText('Stay in chat'));
    expect(fn).toHaveBeenCalled();
  });
});
