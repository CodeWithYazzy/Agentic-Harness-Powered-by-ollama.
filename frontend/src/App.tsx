import { Asterisk, Folder } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { COMMANDS } from './commands';
import { loadBinds, matchBind } from './shortcuts';
import { abortStream, trackStream, untrackStream } from './streams';
import { apiAgentCompact, apiAgentRunsStart, apiFileRead, apiGit, apiHomedir, apiMemory, apiRepoInfo, providers, runAgentStream } from './api';
import { ApprovalCard, AskCard, AssistantBlock, CommitList, HeartbeatMark, Markdown, MessageMenu, ModeSwitchCard, ThinkingDots, ToolHeader, UserBubble } from './components/Chat';
import type { AskQuestion, MenuAction } from './components/Chat';
import { Composer, fmtSize } from './components/Composer';
import { OverviewCard, RecentsPanel } from './components/Overview';
import {
  CodeViewer, CommandPalette, CommitDetails, DiffViewerModal, FileListModal,
  ModelManager, PRMenu, RepoPicker, SessionListPanel, SettingsModal,
} from './components/Overlays';
import { DesktopWindow, Dock, LiveClock, Toasts, Wallpaper } from './components/chrome';
import { useStore } from './store';
import type { Attachment, CommitInfo, Message, Session } from './types';

const uid = () => Math.random().toString(36).slice(2, 10);

// build-looking requests typed in chat mode trigger the go-to-build card
const BUILD_INTENT = /\b(create|build|make|implement|write|generate|develop|scaffold)\b.{0,50}\b(app|game|website|web app|file|files|code|function|features?|components?|api|project|program|script|page|ui|button|form|auth|login|database)\b|\b(fix|refactor|update|change|modify|add|remove|delete|integrate|connect|deploy)\b.{0,50}\b(bug|code|files?|feature|function|component|api|auth|error|tests?|project|repo|button|form|ui|page|screen|modal|mode|theme|endpoint)\b|\bfull\b.{0,25}\b(game|app|website|project)\b|\b(run|execute|test)\b.{0,50}\b(tests?|suite|code|command|script|build)\b/i;

// max turns sent per request — stored history stays complete, only the
// outbound prompt is trimmed (quota + context-window hygiene)
const HISTORY_SEND = 20;

const SUGGESTIONS = [
  'Explain what this directory does',
  'Show me the recent commits',
  'Is my working tree clean?',
  'Review my uncommitted diff',
  'Find TODOs and FIXMEs',
  'Summarize the README',
  'What changed in the last commit?',
  'List the project structure',
];
function pickSugg(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const out: string[] = [];
  for (let i = 0; i < 5; i++) out.push(SUGGESTIONS[(h + i * 3) % SUGGESTIONS.length]);
  return out;
}

export default function App() {
  const route = useStore((s) => s.route);
  const set = useStore((s) => s.set);
  const st = useStore.getState;
  const [commitSel, setCommitSel] = useState<CommitInfo | null>(null);
  const [filesModal, setFilesModal] = useState<{ title: string; files: string[] } | null>(null);
  const [codeFile, setCodeFile] = useState<string | null>(null);
  const [codeContent, setCodeContent] = useState('');
  const [diff, setDiff] = useState<string | null>(null);
  const [prOpen, setPrOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [statusLine, setStatusLine] = useState('');
  // pending permission gates from the agent (tool approvals + ask_user)
  const [approvals, setApprovals] = useState<Record<string, { tool?: string; input?: unknown; questions?: AskQuestion[] }>>({});
  // chat→build intercept: original request waits on the card
  const [modePrompt, setModePrompt] = useState<{ text: string; atts: Attachment[]; background?: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // resolve a pending gate: answer the bridge, drop the card
  const resolveApproval = async (id: string, allow: boolean, always = false, answers?: unknown) => {
    const tool = approvals[id]?.tool;
    setApprovals((a) => { const nx = { ...a }; delete nx[id]; return nx; });
    try {
      await fetch('/api/agent/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, allow, always, tool, answers }) });
    } catch { /* bridge may have moved on */ }
  };

  // ---- launch: sessions, health, discovery (all dynamic, no hardcoded data) ----
  useEffect(() => {
    st().loadSessions();
    providers.local.health().then((h) => set({ ollamaLocal: { ok: h.ok, checked: true, error: h.ok ? undefined : 'unavailable' } })).catch(() => set({ ollamaLocal: { ok: false, checked: true } }));
    providers.cloud.health().then((h) => set({ ollamaCloud: { ok: h.ok, checked: true } })).catch(() => set({ ollamaCloud: { ok: false, checked: true } }));
    st().refreshModels();
    // stay fresh: re-check health every 30s, refresh models on focus (30s throttle)
    const recheck = () => {
      providers.local.health().then((h) => set({ ollamaLocal: { ok: h.ok, checked: true, error: h.ok ? undefined : 'unavailable' } })).catch(() => set({ ollamaLocal: { ok: false, checked: true } }));
      providers.cloud.health().then((h) => set({ ollamaCloud: { ok: h.ok, checked: true } })).catch(() => set({ ollamaCloud: { ok: false, checked: true } }));
    };
    const iv = setInterval(recheck, 30000);
    let lastFocus = 0;
    const onFocus = () => { const n = Date.now(); if (n - lastFocus > 30000) { lastFocus = n; st().refreshModels(); } };
    window.addEventListener('focus', onFocus);
    // refresh-safe window: persist view state on every change, restore on boot
    const unsub = useStore.subscribe((s) => {
      try {
        localStorage.setItem('od.route', s.route === '/chat' ? '/chat' : '/');
        localStorage.setItem('od.win', s.maximized ? 'max' : s.minimized ? 'min' : '');
        if (s.repo?.path) localStorage.setItem('od.repo', JSON.stringify({ path: s.repo.path, name: s.repo.name }));
        else localStorage.removeItem('od.repo');
      } catch { /* ignore */ }
    });
    const fn = (e: KeyboardEvent) => {
      if (matchBind(e, loadBinds().palette)) { e.preventDefault(); set({ paletteOpen: true }); }
      if (e.key === 'Escape') {
        set({ paletteOpen: false, settingsOpen: false, sessionListOpen: false, repoPickerOpen: false });
        setModelsOpen(false); setCommitSel(null); setFilesModal(null);
        setCodeFile(null); setDiff(null); setPrOpen(false);
      }
    };
    window.addEventListener('keydown', fn);
    return () => { window.removeEventListener('keydown', fn); window.removeEventListener('focus', onFocus); clearInterval(iv); unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autoscroll only when already near the bottom (no yanking while reading)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  });

  const cleanText = (t: string) => t.replace(/__COMMITS__:[^\n]*\n?/, '').replace(/__TOOL__:[^:]+:/g, '').trim();

  const openFile = useCallback(async (f: string) => {
    const repoPath = st().repo?.path;
    if (!repoPath) { st().toast('Open a directory first'); return; }
    let r: { ok: boolean; type?: string; content?: string; entries?: { name: string }[]; error?: string } | any;
    try {
      r = await apiFileRead(repoPath, f);
    } catch { st().toast('Bridge unreachable — is it running? Check Settings'); return; }
    if (r.ok && r.type === 'file') { setCodeFile(f); setCodeContent(r.content); }
    else if (r.ok && r.type === 'dir') { setFilesModal({ title: f, files: r.entries.map((e: { name: string }) => f.replace(/\/$/, '') + '/' + e.name) }); }
    else st().toast(r.error || 'Cannot open file');
  }, [st]);

  const refreshRepo = useCallback(async () => {
    const p = st().repo?.path;
    if (!p) return;
    const info = await apiRepoInfo(p).catch(() => null);
    if (info?.ok) set({ repo: { path: p, name: info.name || st().repo?.name || 'repo', branch: info.branch || st().repo?.branch || 'main', dirty: info.dirty, diffStat: info.diffStat, status: info.status } });
  }, [set, st]);

  // boot: revalidate a restored directory (branch/dirty go stale across refresh)
  useEffect(() => {
    if (st().repo?.path) refreshRepo();
    else {
      // never strand the user with no directory: default to home (terminal default)
      apiHomedir().then((h) => {
        if (h?.ok && h.path) {
          set({ repo: { path: h.path, name: h.name || h.path, branch: 'main', dirty: false, diffStat: '' } });
          refreshRepo();
        }
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Phase 3 locals: compact / cost / doctor / export (no agent round-trip) ----
  const ensureChatSession = () => {
    let s0 = st().activeSession();
    if (!s0) { st().newSession(); s0 = st().activeSession(); }
    if (s0) set({ route: '/chat' });
    return s0;
  };
  const runCompact = async (s0: Session | undefined) => {
    if (!s0) return;
    const model = st().model;
    if (!model) { st().toast('Pick a model first'); return; }
    st().pushMessage(s0.id, { id: uid(), role: 'user', content: '/compact', createdAt: Date.now() });
    st().toast('Compacting session…');
    try {
      const cur = st().activeSession();
      const r = await apiAgentCompact({ model, scope: st().scope, messages: cur?.messages || s0.messages, keepLast: 6 });
      if (!r.ok || !r.summary) { st().toast('Compact failed — bridge or model unreachable'); return; }
      const tail = (st().activeSession()?.messages || []).slice(-6);
      set({
        sessions: st().sessions.map((x) => (x.id === s0.id
          ? { ...x, messages: [{ id: uid(), role: 'assistant', content: `Session summary (compacted, older turns trimmed):\n${r.summary}`, createdAt: Date.now() }, ...tail], updatedAt: Date.now() }
          : x)),
      });
      st().persistSessions();
      st().toast('Session compacted');
    } catch { st().toast('Compact failed'); }
  };
  const showCost = (s0: Session | undefined) => {
    if (!s0) return;
    const msgs = s0.messages;
    let uChars = 0, aChars = 0, thinkSec = 0, runs = 0;
    for (const m of msgs) {
      if (m.role === 'user') uChars += m.content.length;
      else { aChars += m.content.length; if (m.durationSec !== undefined) { thinkSec += m.durationSec; runs++; } }
    }
    const tok = (c: number) => (c / 4 > 1000 ? `~${(c / 4000).toFixed(1)}k` : `~${Math.round(c / 4)}`);
    st().pushMessage(s0.id, { id: uid(), role: 'user', content: '/cost', createdAt: Date.now() });
    st().pushMessage(s0.id, {
      id: uid(), role: 'assistant', createdAt: Date.now(),
      content: `Session usage\n- Messages: ${msgs.length} (${msgs.filter((m) => m.role === 'user').length} you / ${msgs.filter((m) => m.role === 'assistant').length} agent)\n- In: ${tok(uChars)} tokens · out: ${tok(aChars)} tokens\n- Thinking time: ${thinkSec.toFixed(0)}s across ${runs} runs\n- Model: ${st().model || '(none)'}\n\nCounts are chars/4 estimates. API-cloud billing follows ollama.com pricing.`,
    });
    st().persistSessions();
  };
  const runDoctor = async (s0: Session | undefined) => {
    if (!s0) return;
    st().pushMessage(s0.id, { id: uid(), role: 'user', content: '/doctor', createdAt: Date.now() });
    const lines: string[] = [];
    try {
      const h = await fetch('/api/health').then((r) => r.json()).catch(() => null);
      lines.push(`- Bridge: ${h?.ok ? 'ok (:47911)' : 'UNREACHABLE — restart the backend'}`);
    } catch { lines.push('- Bridge: UNREACHABLE — restart the backend'); }
    const loc = st().ollamaLocal, clo = st().ollamaCloud;
    lines.push(`- Ollama local: ${!loc.checked ? 'checking…' : loc.ok ? 'ok' : 'DOWN — run \`ollama serve\`'}`);
    lines.push(`- Ollama cloud: ${!clo.checked ? 'checking…' : clo.ok ? 'reachable' : 'unreachable (network or key?)'}`);
    const ms = st().models;
    lines.push(`- Models: ${ms.length} known (${ms.filter((m) => (m.tier || 'local') === 'local').length} local, ${ms.filter((m) => m.tier === 'free-cloud').length} free cloud, ${ms.filter((m) => m.tier === 'api-cloud').length} API cloud)`);
    const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => null);
    if (cfg) lines.push(`- Endpoints: local ${cfg.localEndpoint || '?'} · cloud ${cfg.cloudEndpoint || '?'} · key ${cfg.cloudKey ? 'set' : 'not set'}`);
    const repo = st().repo;
    lines.push(`- Directory: ${repo ? `${repo.path} (branch ${repo.branch}${repo.dirty ? ', dirty' : ', clean'})` : 'none open'}`);
    st().pushMessage(s0.id, { id: uid(), role: 'assistant', content: `Doctor report\n${lines.join('\n')}`, createdAt: Date.now() });
    st().persistSessions();
  };
  const showAgents = (s0: Session | undefined) => {
    if (!s0) return;
    st().pushMessage(s0.id, { id: uid(), role: 'user', content: '/agents', createdAt: Date.now() });
    st().pushMessage(s0.id, {
      id: uid(), role: 'assistant', createdAt: Date.now(),
      content: `Subagents (spawned with the Agent tool)\n- Explore — fast read-only recon of the codebase\n- Plan — read-only numbered implementation plan, no code\n- General — full task runner (build mode only, writes gated by approvals)\n\nAsk naturally ("explore the auth code", "plan dark mode") or spawn directly, including teams: parallel up to 3. A subagent can never spawn its own subagent.`,
    });
    st().persistSessions();
  };
  const showMemory = async (s0: Session | undefined) => {
    if (!s0) return;
    st().pushMessage(s0.id, { id: uid(), role: 'user', content: '/memory', createdAt: Date.now() });
    const repo = st().repo?.path;
    if (!repo) { st().pushMessage(s0.id, { id: uid(), role: 'assistant', content: 'No directory open — memory is per-directory.', createdAt: Date.now() }); return; }
    const m = await apiMemory(repo).catch(() => null);
    const notes = m?.ok && Array.isArray(m.notes) ? m.notes : [];
    st().pushMessage(s0.id, {
      id: uid(), role: 'assistant', createdAt: Date.now(),
      content: notes.length
        ? `Project memory for this directory (auto-learned, injected into every run):\n${notes.map((n: string) => `• ${n}`).join('\n')}\n\nClear it in the directory picker.`
        : 'No memory stored for this directory yet — durable facts are learned automatically from tool runs.',
    });
    st().persistSessions();
  };
  const exportSession = (s0: Session | undefined) => {    if (!s0) return;
    try {
      // H9: strip internal __COMMITS__/__TOOL__ markers so the download is a
      // clean transcript, not persisted protocol.
      const cleaned = { ...s0, messages: s0.messages.map((m) => ({ ...m, content: cleanText(m.content) })) };
      const blob = new Blob([JSON.stringify(cleaned, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(s0.title || 'session').replace(/[^\w\-]+/g, '_').slice(0, 60)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      st().toast('Transcript downloaded');
    } catch { st().toast('Export failed'); }
  };

  const send = useCallback(async (text: string, atts: Attachment[] = [], opts?: { background?: boolean; skipModeGate?: boolean; skipPush?: boolean }) => {
    const raw = text;
    let model = st().model, scope = st().scope;
    const reasoning = st().reasoning;
    // local slash commands (never hit the network)
    if (text === '/models') { setModelsOpen(true); return; }
    if (text === '/settings') { set({ settingsOpen: true }); return; }
    if (text === '/help') {
      let s0 = st().activeSession();
      if (!s0) { st().newSession(); s0 = st().activeSession(); }
      if (!s0) return;
      set({ route: '/chat' });
      st().pushMessage(s0.id, { id: uid(), role: 'user', content: text, createdAt: Date.now() });
      st().pushMessage(s0.id, {
        id: uid(), role: 'assistant', createdAt: Date.now(), toolLabel: 'Available commands',
        content: COMMANDS.map((c) => `${c.cmd} — ${c.desc}`).join('\n'),
      });
      st().persistSessions();
      return;
    }
    // ---- slash commands: locals first, then agent expansions, then git family ----
    if (text === '/compact') { await runCompact(ensureChatSession()); return; }
    if (text === '/cost') { showCost(ensureChatSession()); return; }
    if (text === '/doctor') { await runDoctor(ensureChatSession()); return; }
    if (text === '/export') { exportSession(ensureChatSession()); return; }
    if (text === '/agents') { showAgents(ensureChatSession()); return; }
    if (text === '/memory') { await showMemory(ensureChatSession()); return; }
    if (text === '/hooks' || text === '/mcp' || text === '/permissions') {
      set({ settingsOpen: true });
      st().toast(text === '/hooks' ? 'Opened Settings — Hooks live below Tool permissions.' : text === '/mcp' ? 'Opened Settings — MCP servers are at the bottom.' : 'Opened Settings — Tool permissions are under Cloud usage.');
      return;
    }
    if (/^\/search\s*$/.test(text)) { st().toast('Usage: /search <query>'); return; }
    if (/^\/run\s*$/.test(text)) { st().toast('Usage: /run <command> (build mode)'); return; }
    if (/^\/plan\s*$/.test(text)) { st().toast('Usage: /plan <task> — read-only implementation plan'); return; }
    const expansions: Array<{ re: RegExp; rep: string | ((m: RegExpMatchArray) => string); build?: boolean }> = [
      { re: /^\/files\b/, rep: 'List the project structure: top-level folders, key files, and what each part does. Use glob.' },
      { re: /^\/search\s+(.+)/, rep: (m) => `Search the codebase for "${m[1].trim()}" and explain every match with file paths and line numbers.` },
      { re: /^\/run\s+(.+)/, rep: (m) => `Run this shell command in the open directory and explain the result: ${m[1].trim()}`, build: true },
      { re: /^\/test\b/, rep: 'Run the project test suite (look for package.json scripts, Makefile, pytest, or go test first) and report pass/fail per suite.', build: true },
      { re: /^\/review\b/, rep: 'Review my uncommitted diff: what changed, bugs, risks. Use git_diff.' },
      { re: /^\/commit\b/, rep: 'Draft a conventional commit message for my uncommitted changes (check git_diff and recent git_log style). Output ONLY the message, do not commit anything.' },
      { re: /^\/plan\s+(.+)/, rep: (m) => `Use the Agent tool with agent Plan to make a numbered implementation plan for: ${m[1].trim()}. Read-only: explore with tools, write no code, output the plan only.` },
      { re: /^\/pr\b/, rep: 'Walk me through creating a pull request for the current branch: summarize the changes, then suggest a title and description.' },
      { re: /^\/init\b/, rep: 'Introduce this project: structure, stack, how to build, run, and test it. Use glob and file reads.' },
    ];
    for (const e of expansions) {
      const m = text.match(e.re);
      if (m) {
        if (e.build && !st().buildMode) { st().toast('Runs live in Build mode — flip the switch first'); return; }
        text = typeof e.rep === 'function' ? e.rep(m) : e.rep;
        break;
      }
    }
    // user-defined commands from Settings (/name [extra] → prompt + extra)
    if (text.startsWith('/')) {
      const cm = text.match(/^\/([a-z0-9][a-z0-9-_]*)([\s\S]*)$/i);
      const custom = cm && st().customCommands.find((c) => c.cmd === `/${cm[1].toLowerCase()}`);
      if (custom) {
        const extra = (cm[2] || '').trim();
        text = custom.prompt + (extra ? `\n\nExtra input: ${extra}` : '');
      }
    }
    if (text.startsWith('/') && !/^\/(log|status|diff|branch|show|commit|git)\b/.test(text)) {
      st().toast(`Unknown command "${text.split(' ')[0]}" — try /help`);
      return;
    }
    // directory-dependent commands need a directory — fail fast with guidance
    if (/^\/(log|status|diff|branch|show|commit|git)\b/.test(text) && !st().repo?.path) {
      st().toast('Open a directory first');
      return;
    }
    // need a model before hitting the network — auto-pick instead of hanging on Thinking…
    if (!model) {
      const ms = st().models;
      const pick = ms.find((m) => m.scope === 'local') || ms[0];
      if (!pick) { st().toast('No models found — start Ollama (`ollama serve`) or add a cloud key in Settings'); return; }
      model = pick.name; scope = pick.scope;
      set({ model, scope });
      try { localStorage.setItem('od.model', model); localStorage.setItem('od.scope', scope); } catch { /* ignore */ }
    }
    // API-tier models need a key: open Settings instead of failing mid-run
    if (!st().hasCloudKey && (st().models.find((m) => m.name === model)?.tier === 'api-cloud')) {
      set({ settingsOpen: true });
      st().toast('API models need an Ollama API key — paste it in Settings to continue.');
      return;
    }
    let s = st().activeSession();
    if (!s) { st().newSession(); s = st().activeSession(); }
    if (!s) return;
    const sid = s.id;
    // chat mode + build-looking request → ask on the message itself.
    // Questions (trailing ?) never trigger the gate — "how do I run tests?"
    // is asking, not building (L8).
    const looksQuestion = /\?\s*$/.test(raw.trim());
    if (!raw.startsWith('/') && !st().buildMode && !opts?.skipModeGate && !looksQuestion && BUILD_INTENT.test(raw)) {
      const gateMsg: Message = {
        id: uid(), role: 'user', content: raw.trim(), createdAt: Date.now(),
        ...(atts.length ? { atts: atts.map((a) => ({ name: a.name, size: a.size, kind: a.kind })) } : {}),
      };
      st().pushMessage(sid, gateMsg);
      set({ route: '/chat' });
      setModePrompt({ text: raw, atts, background: opts?.background });
      return;
    }
    // cloud without a key rides `ollama signin`; if that path fails the backend
    // answers with the exact fix — never silently hang here, just send
    // same session is already thinking: don't stack a second run on it
    if (st().streaming[sid]) { st().toast('Still thinking here — stop it first or switch sessions'); return; }
    if (text === '/diff') {
      const repo = st().repo?.path;
      if (!repo) { st().toast('Open a directory first'); return; }
      try {
        const r = await apiGit(repo, 'git_diff');
        setDiff(r.ok ? r.output : (r.error || ''));
      } catch { st().toast('Bridge unreachable — is it running? Check Settings'); }
      return;
    }
    set({ streaming: { ...st().streaming, [sid]: true }, route: '/chat' });
    // attachments: chips in chat, full content + images go to the model
    const shownText = text.trim();
    let apiText = text;
    const blocks: string[] = [];
    for (const a of atts) {
      if (a.kind === 'text' && a.text) blocks.push(`--- file: ${a.name} ---\n${a.text}`);
      else if (a.kind === 'image') blocks.push(`[image attached: ${a.name}]`);
      else blocks.push(`[file attached: ${a.name} (${a.mime || 'unknown type'}, ${fmtSize(a.size)}) — binary content, use name/type only]`);
    }
    const caps = (st().models.find((m) => m.name === model)?.details as { capabilities?: string[] } | undefined)?.capabilities;
    const vision = !!caps?.includes('vision');
    const images = vision ? atts.filter((a) => a.kind === 'image' && a.image).map((a) => String(a.image).split(',').pop() || '') : [];
    if (atts.some((a) => a.kind === 'image') && !vision) blocks.push('(note: attached images were omitted — this model cannot view images)');
    if (blocks.length) apiText += `\n\n<attachments>\n${blocks.join('\n\n')}\n</attachments>`;
    const userMsg: Message = {
      id: uid(), role: 'user', content: shownText, createdAt: Date.now(),
      ...(atts.length ? { atts: atts.map((a) => ({ name: a.name, size: a.size, kind: a.kind })) } : {}),
    };
    // gate re-entry already pushed the user message — don't duplicate it
    if (!opts?.skipPush) st().pushMessage(sid, userMsg);
    const aid = uid();
    // background run: hand off to the runs registry, keep chatting here
    if (opts?.background) {
      const hist = [...s.messages, { ...userMsg, content: apiText }].slice(-HISTORY_SEND).map((m) => ({ role: m.role, content: m.content }));
      try {
        const r = await apiAgentRunsStart({
          repo: st().repo?.path || s.repository || '', model, scope, reasoning,
          mode: st().buildMode ? 'build' : 'chat', messages: hist, context: st().memory, images,
        });
        if (r.ok) {
          st().pushMessage(sid, { id: aid, role: 'assistant', content: 'Running in background — the answer will land in the sidebar under Background.', createdAt: Date.now() });
          st().toast('Background run started', { label: 'Sidebar', fn: () => set({ sessionListOpen: true }) });
          st().refreshBgRuns();
        } else st().toast('Could not start background run');
      } catch { st().toast('Could not start background run'); }
      return;
    }
    st().pushMessage(sid, { id: aid, role: 'assistant', content: '', createdAt: Date.now() });
    setStatusLine('Thinking…');
    const ctrl = new AbortController();
    trackStream(sid, ctrl);
    const t0 = Date.now();
    let toolLabel = '';
    let evalCount = 0;
    // batch tokens: one store update per frame instead of per token
    let pending = '';
    let lastPersist = 0;
    const flush = () => {
      if (!pending) return;
      st().appendToken(sid, aid, pending);
      pending = '';
      // refresh-safe: checkpoint partial output locally (server sync happens at finalize)
      const now = Date.now();
      if (now - lastPersist > 2000) { lastPersist = now; st().persistLocal(); }
    };
    const timer = setInterval(flush, 64);
    try {
      // history cap: send only recent turns — full history bloats the prompt
      // and burns quota on long sessions (stored history stays complete)
      const hist = [...s.messages, { ...userMsg, content: apiText }].slice(-HISTORY_SEND);
      await runAgentStream({
        repo: st().repo?.path || s.repository || '',
        model, scope, reasoning,
        mode: st().buildMode ? 'build' : 'chat',
        messages: hist.map((m) => ({ role: m.role, content: m.content })),
        context: st().memory,
        images,
      }, (e) => {
        if (e.type === 'status') setStatusLine(`${e.phase === 'thinking' ? 'Thinking' : e.phase === 'reading' ? 'Reading files' : e.phase === 'inspecting' ? 'Inspecting Git' : e.phase === 'running' ? 'Running command' : 'Generating'}…`);
        else if (e.type === 'tool') {
          flush();
          toolLabel = e.tool === 'git_log' ? `Showed last ${((e.commits as CommitInfo[]) || []).length} commits` : e.tool === 'git_show' ? `Showed commit ${String((e.ref as string) || (e.input as { ref?: string } | undefined)?.ref || '').slice(0, 12) || 'stat'}` : e.tool === 'git_diff' ? 'Showed working-tree diff' : e.tool === 'read_file' ? `Read ${e.file}` : String(e.tool);
          if (e.commits) {
            set({ memory: { ...st().memory, lastCommits: e.commits as CommitInfo[] } });
            st().appendToken(sid, aid, `__COMMITS__:${JSON.stringify(e.commits)}`);
          } else if (e.output) {
            st().appendToken(sid, aid, `\n__TOOL__:${e.tool}:${(e.output as string).slice(0, 6000)}`);
          }
          refreshRepo();
        } else if (e.type === 'token') { pending += String(e.token); }
        else if (e.type === 'context' && Array.isArray(e.lastCommits)) set({ memory: { ...st().memory, lastCommits: e.lastCommits as CommitInfo[] } });
        else if (e.type === 'limit') {
          flush();
          st().toast(e.tier === 'free'
            ? 'Your free cloud usage is over. Add an API key in Settings or credits on ollama.com to continue.'
            : 'Your credits are over. Add credits on ollama.com to continue.',
            { label: 'Settings', fn: () => set({ settingsOpen: true }) });
        }
        else if (e.type === 'auth') {
          flush();
          st().toast('Your API key was rejected. Check it in Settings.', { label: 'Settings', fn: () => set({ settingsOpen: true }) });
        }
        else if (e.type === 'error') { flush(); st().appendToken(sid, aid, `\n${e.error}`); }
        else if (e.type === 'tool_approval') {
          flush();
          setStatusLine('Waiting for your approval…');
          setApprovals((a) => ({ ...a, [String(e.id)]: { tool: String(e.tool || 'tool'), input: e.input } }));
        }
        else if (e.type === 'ask_user') {
          flush();
          setStatusLine('Agent asks you…');
          setApprovals((a) => ({ ...a, [String(e.id)]: { questions: (e.questions as AskQuestion[]) || [] } }));
        }
        else if (e.type === 'done') { if (typeof e.eval_count === 'number') evalCount = e.eval_count; }
      }, ctrl.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') pending += '\nRequest failed. Is the bridge running? Check Settings.';
    }
    clearInterval(timer);
    flush();
    // finalize: attach tool label + timing + tokens to the assistant message
    const cur = st().sessions.find((x) => x.id === sid);
    if (cur) {
      const msgs = cur.messages.map((m) => (m.id === aid ? { ...m, toolLabel: toolLabel || undefined, durationSec: (Date.now() - t0) / 1000, tokens: evalCount || undefined } : m));
      set({ sessions: st().sessions.map((x) => (x.id === sid ? { ...x, messages: msgs } : x)) });
      st().persistSessions();
    }
    const nx = { ...st().streaming };
    delete nx[sid];
    untrackStream(sid);
    set({ streaming: nx });
    setStatusLine('');
    refreshRepo();
  }, [refreshRepo, set, st]);

  // Stop targets the session the button belongs to — never the merely active one
  const stop = useCallback((sid?: string) => {
    abortStream(sid || st().activeSession()?.id || '');
  }, [st]);
  const messageAction = useCallback(async (m: Message, a: MenuAction) => {
    const s = st().activeSession();
    if (!s) return;
    if (a === 'copy') {
      try {
        const extra = m.atts?.length ? `\n[Attached: ${m.atts.map((x) => x.name).join(', ')}]` : '';
        await navigator.clipboard.writeText(cleanText(m.content) + extra);
        st().toast('Copied');
      }
      catch { st().toast('Copy failed'); }
    } else if (a === 'delete') {
      st().deleteMessage(s.id, m.id);
    } else if (a === 'rewind') {
      if (st().streaming[s.id]) { st().toast('Stop the run first'); return; }
      const n = s.messages.findIndex((x) => x.id === m.id);
      const drop = n >= 0 ? s.messages.length - n - 1 : 0;
      if (!drop) { st().toast('Nothing below to rewind'); return; }
      if (window.confirm(`Rewind to here? ${drop} message${drop === 1 ? '' : 's'} below will be deleted.`)) {
        st().deleteMessagesAfter(s.id, m.id);
        st().toast('Rewound');
      }
    } else if (a === 'resend') {
      if (s && st().streaming[s.id]) return;
      send(m.content);
    } else if (a === 'regenerate') {
      if (s && st().streaming[s.id]) return;
      const idx = s.messages.findIndex((x) => x.id === m.id);
      const before = idx >= 0 ? s.messages.slice(0, idx) : s.messages;
      // cut back to the triggering user turn — keeping it would re-push it
      // in send() and duplicate it ([U1,U1,A2])
      const uidx = before.map((x) => x.role).lastIndexOf('user');
      if (uidx < 0) { st().toast('Nothing to regenerate'); return; }
      const lastUser = before[uidx];
      set({ sessions: st().sessions.map((x) => (x.id === s.id ? { ...x, messages: before.slice(0, uidx), updatedAt: Date.now() } : x)) });
      await send(lastUser.content);
    }
  }, [send, set, st]);
  useEffect(() => {
    const fn = () => {
      const s0 = st().activeSession();
      if (s0 && st().streaming[s0.id]) return;
      const s = s0;
      const lastUser = [...(s?.messages || [])].reverse().find((m) => m.role === 'user');
      if (!lastUser) { st().toast('Nothing to resend'); return; }
      send(lastUser.content);
    };
    const ext = (e: Event) => {
      const t = (e as CustomEvent).detail;
      if (typeof t === 'string' && t.trim()) send(t);
    };
    window.addEventListener('od:resend', fn);
    window.addEventListener('od:send-text', ext);
    return () => { window.removeEventListener('od:resend', fn); window.removeEventListener('od:send-text', ext); };
  }, [send, st]);
  const sessionId = useStore((s) => s.sessionId);
  const sessions = useStore((s) => s.sessions);
  const session = sessions.find((x) => x.id === sessionId);
  const streamingMap = useStore((s) => s.streaming);
  const sessionLive = !!streamingMap[session?.id || ''];
  const lastAssistantId = [...(session?.messages || [])].reverse().find((x) => x.role === 'assistant')?.id;
  const repo = useStore((s) => s.repo);
  const ollamaLocal = useStore((s) => s.ollamaLocal);
  const sessionListOpen = useStore((s) => s.sessionListOpen);

  const showFilesForCommit = async (c: CommitInfo) => {
    const repoPath = st().repo?.path;
    if (!repoPath) { st().toast('Open a directory first'); return; }
    let r: { ok: boolean; output?: string; error?: string };
    try {
      r = await apiGit(repoPath, 'git_show', { ref: c.hash });
    } catch { st().toast('Bridge unreachable — is it running? Check Settings'); return; }
    if (!r.ok) { st().toast(r.error || 'Could not inspect commit'); return; }
    const out: string = r.output || '';
    const files = [...out.matchAll(/(?:^|\n)\s*[\w\-./]+\.\w{1,5}(?=\s*\||\s*$)/gm)].map((m) => m[0].trim()).filter(Boolean).slice(0, 60);
    const diffFiles = [...out.matchAll(/^diff --git a\/(\S+) b\/\S+/gm)].map((m) => m[1]);
    const all = [...new Set([...diffFiles, ...files])].slice(0, 60);
    if (!all.length) { st().toast('No files in this commit'); return; }
    setFilesModal({ title: `${c.short} — files changed`, files: all });
  };

  const renderAssistantContent = (m: Message) => {
    if (m.content.includes('__COMMITS__:')) {
      const raw = m.content.split('__COMMITS__:')[1].split('\n')[0];
      let commits: CommitInfo[] = [];
      try { commits = JSON.parse(raw); } catch { /* keep empty */ }
      const rest = m.content.split('\n').slice(1).join('\n');
      return (
        <>
          <ToolHeader label={m.toolLabel || `Showed last ${commits.length} commits`} />
          <CommitList commits={commits} onOpen={setCommitSel} />
          {rest.trim() && <div className="mt-2 whitespace-pre-wrap">{rest}</div>}
        </>
      );
    }
    if (m.content.includes('__TOOL__:')) {
      const [head, ...rest] = m.content.split('__TOOL__:');
      // chunks look like `tool:payload` — drop the tool prefix, show output
      const out = rest.map((c) => { const i = c.indexOf(':'); return i >= 0 ? c.slice(i + 1).trimStart() : c; }).join('\n').trim();
      const shown = out.slice(0, 600);
      return (
        <>
          {head && <Markdown text={head} onFile={openFile} />}
          {!!shown && (
            <div className="mt-1 whitespace-pre-wrap text-[13px] text-[#3a3a3e]">
              {shown}{out.length > shown.length && <span className="text-[#aeaeb2]"> …truncated</span>}
            </div>
          )}
        </>
      );
    }
    if (!m.content && useStore.getState().streaming[session?.id || '']) return <ThinkingDots line={statusLine || 'Thinking…'} />;
    return <Markdown text={m.content} onFile={openFile} />;
  };

  const homeTitle = (
    <span className="flex items-center gap-1.5 text-[21px] font-medium tracking-tight">
      <Asterisk size={22} className="text-black" />What&rsquo;s up next, part2?
    </span>
  );

  const minimized = useStore((s) => s.minimized);
  const maximized = useStore((s) => s.maximized);

  return (
    <>
    <Wallpaper maximized={maximized}>
      <div className="relative z-[2] flex min-h-0 w-full items-stretch justify-center gap-5">
      <AnimatePresence>
        {!minimized && (
          <motion.div
            key="app-window"
            initial={false}
            animate={{ scaleY: 1, scaleX: 1, y: 0, opacity: 1, borderRadius: 18 }}
            exit={{
              scaleY: [1, 0.32, 0.07, 0.02],
              scaleX: [1, 0.94, 0.62, 0.5],
              y: [0, '5vh', '28vh', '44vh'],
              opacity: [1, 1, 1, 0],
              borderRadius: [18, 24, 30, 34],
              transition: { duration: 0.6, times: [0, 0.35, 0.7, 1], ease: [0.55, 0.06, 0.68, 0.19] },
            }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: '50% 100%' }}
            className="flex min-h-0 min-w-0 flex-1 justify-center"
          >
            <DesktopWindow
        title={route === '/' ? '' : session?.title || 'New session'}
                sidebar={<SessionListPanel />}
                sidebarOpen={sessionListOpen}
                onToggleSidebar={() => {
                  const v = !st().sessionListOpen;
                  set({ sessionListOpen: v });
                  try { localStorage.setItem('od.sidebar', v ? '1' : '0'); } catch { /* ignore */ }
                }}
              >
        {!ollamaLocal.checked ? null : !ollamaLocal.ok && (
          <button onClick={() => set({ settingsOpen: true })}
            className="flex w-full items-center justify-center gap-2 bg-[#fff7e8] px-4 py-1.5 text-[13px] text-[#8a5a00] hover:bg-[#fff1d6]">
            Ollama unavailable — Connect · Retry · Settings
          </button>
        )}
        {route === '/' ? (
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-8 pb-6 pt-5">
            {homeTitle}
            <div className="mt-5 flex max-w-[920px] flex-wrap gap-5">
              <div className="min-w-[320px] max-w-[560px] flex-1"><OverviewCard sessions={sessions} /></div>
              <RecentsPanel
                sessions={sessions}
                onOpen={(id) => st().openSession(id)}
                onNew={() => st().newSession()}
                onAll={() => set({ sessionListOpen: true })}
              />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col px-8 pb-5">
            <div className="mx-auto w-full max-w-[820px] pt-4">
              <button
                onClick={() => set({ repoPickerOpen: true })}
                title={`${session?.repository || repo?.path || 'No directory'} — click to change this chat's directory`}
                className="flex max-w-full items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2 py-1 text-[13px] text-[#3a3a3c] hover:bg-black/[0.03]"
              >
                <Folder size={13} className="shrink-0 text-[#8a8a90]" />
                <span className="truncate">{(session?.repository || repo?.path || '').split(/[\\/]/).pop() || repo?.name || 'No directory'}</span>
                {!!repo?.branch && <span className="shrink-0 text-[12px] text-[#8a8a90]">{repo.branch}</span>}
              </button>
            </div>
            <div ref={scrollRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto py-6">
              <div className="mx-auto max-w-[820px] space-y-5">
                {(!session || !session.messages.length) && (
                  <div className="flex flex-col items-center gap-2.5 py-10 text-center">
                    <div className="text-[22px] font-medium tracking-tight">What can I help with?</div>
                    <div className="mt-1.5 flex max-w-[560px] flex-wrap justify-center gap-2">
                      {pickSugg(session?.id || 'new').map((s) => (
                        <button key={s} onClick={() => send(s)} className="rounded-full border border-black/10 bg-white px-3 py-1 text-[13px] hover:bg-black/[0.03]">{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {session?.messages.map((m, i, arr) => (
                  <div key={m.id} className="group relative">
                    {m.role === 'user' ? (
                      <>
                        <UserBubble m={m} />
                        <MessageMenu align="right" flipUp={i >= arr.length - 2} actions={['resend', 'rewind', 'copy', 'delete']} onAction={(a) => messageAction(m, a)} />
                      </>
                    ) : (
                      <AssistantBlock>
                        {renderAssistantContent(m)}
                        {((m.id === lastAssistantId && sessionLive && m.content) || (m.durationSec !== undefined && m.content && !m.content.includes('__COMMITS__:'))) && (
                          <div className="mt-2 flex items-center gap-2 text-[13px] text-[#8a8a90]">
                            {(m.id === lastAssistantId && sessionLive)
                              ? <><HeartbeatMark size={13} /><span>thinking…</span></>
                              : <><Asterisk size={13} className="text-[#aeaeb2]" /><span>thought for {(m.durationSec || 0).toFixed(0)}s</span></>}
                          </div>
                        )}
                        <MessageMenu align="left" flipUp={i >= arr.length - 2} actions={['regenerate', 'copy', 'delete']} onAction={(a) => messageAction(m, a)} />
                      </AssistantBlock>
                    )}
                  </div>
                ))}
                {Object.entries(approvals).map(([id, a]) => (
                  <div key={id}>
                    {a.questions ? (
                      <AskCard questions={a.questions} onAnswer={(answers) => resolveApproval(id, true, false, answers)} onDecline={() => resolveApproval(id, false)} />
                    ) : (
                      <ApprovalCard tool={a.tool || 'tool'} input={a.input} onDecision={(allow, always) => resolveApproval(id, allow, always)} />
                    )}
                  </div>
                ))}
                {modePrompt && (
                  <ModeSwitchCard
                    onApprove={() => {
                      const mp = modePrompt;
                      setModePrompt(null);
                      set({ buildMode: true });
                      try { localStorage.setItem('od.buildMode', 'build'); } catch { /* ignore */ }
                      send(mp.text, mp.atts, { skipModeGate: true, skipPush: true, background: mp.background });
                    }}
                    onDeny={() => {
                      const mp = modePrompt;
                      setModePrompt(null);
                      send(mp.text, mp.atts, { skipModeGate: true, skipPush: true, background: mp.background });
                    }}
                  />
                )}
              </div>
            </div>
            <div className="mx-auto w-full max-w-[860px] pt-2">
              <Composer sid={session?.id} onSend={send} onStop={stop} onPR={() => setPrOpen(true)} />
            </div>
          </div>
        )}
            </DesktopWindow>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
      {minimized ? <Dock /> : null}
      <CommandPalette />
      <SettingsModal />
      <RepoPicker />
      <CommitDetails commit={commitSel} onClose={() => setCommitSel(null)} onShowFiles={showFilesForCommit} />
      {filesModal && <FileListModal title={filesModal.title} files={filesModal.files} onClose={() => setFilesModal(null)} onOpen={(f) => { setFilesModal(null); openFile(f); }} />}
      <CodeViewer file={codeFile} content={codeContent} onClose={() => setCodeFile(null)} />
      <DiffViewerModal diff={diff} onClose={() => setDiff(null)} />
      <PRMenu anchor={prOpen} onClose={() => setPrOpen(false)} />
      {modelsOpen && <ModelManager models={useStore.getState().models} onRefresh={() => setModelsOpen(false)} />}
      <Toasts />
    </Wallpaper>
    <LiveClock />
    </>
  );
}

export { uid };
