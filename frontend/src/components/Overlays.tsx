import { motion } from 'framer-motion';
import { CopyPlus, Eye, FileCode2, Folder, GitBranch, Pencil, Search, Settings as SettingsIcon, Square, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiAgentRun, apiAgentStopRun, apiDrives, apiFsBrowse, apiLsDir, apiMemory, apiMemoryClear, apiRepoInfo, apiRepoOpen, providers } from '../api';
import { TierBadge, fmtSize } from './Composer';
import { popoverAnim } from '../motion';
import { bindLabel, DEFAULT_BINDS, loadBinds, saveBinds } from '../shortcuts';
import type { KeyBind } from '../shortcuts';
import { useStore } from '../store';
import type { CommitInfo, ModelInfo, ProviderScope } from '../types';

function Shell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] flex items-start justify-center bg-black/20 p-6 pt-[12vh]" onClick={onClose}>
      <motion.div
        {...popoverAnim}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? 'max-w-[760px]' : 'max-w-[520px]'} overflow-hidden rounded-2xl border border-black/10 bg-white shadow-win`}
      >
        <div className="flex items-center gap-2 border-b border-black/[0.06] px-4 py-2.5">
          <span className="flex-1 text-[14px] font-medium">{title}</span>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-[#8a8a90] hover:bg-black/5"><X size={15} /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2 thin-scroll">{children}</div>
      </motion.div>
    </motion.div>
  );
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const set = useStore((s) => s.set);
  const sessions = useStore((s) => s.sessions);
  const models = useStore((s) => s.models);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  useEffect(() => { if (open) setQ(''); }, [open ]);
  useEffect(() => { setHi(0); }, [q, open ]);
  useEffect(() => {
    if (open) document.querySelector('[data-ph="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [hi, open ]);
  if (!open) return null;
  const actions = [
    'New session', 'Open directory', 'Switch model',
    'View Git diff', 'View commit', 'View status', 'Create PR', 'Open settings',
  ].filter((a) => a.toLowerCase().includes(q.toLowerCase()));
  const ms = models.filter((m) => m.name.toLowerCase().includes(q.toLowerCase())).slice(0, 10);
  const ss = sessions.filter((s) => s.title.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
  const st = useStore.getState();
  const pick = (fn: () => void) => { fn(); set({ paletteOpen: false }); };
  // visible rows, grouped so cloud models are discoverable (not sliced off)
  const msLocal = ms.filter((m) => m.scope === 'local').slice(0, 4);
  const msCloud = ms.filter((m) => m.scope === 'cloud').slice(0, 4);
  const msShown = [...msLocal, ...msCloud];
  const flat: Array<{ kind: 'action' | 'model' | 'session'; run: () => void }> = [
    ...actions.map((a) => ({ kind: 'action' as const, run: () => doAction(a) })),
    ...msShown.map((m) => ({ kind: 'model' as const, run: () => selectModel(m) })),
    ...ss.map((s) => ({ kind: 'session' as const, run: () => { st.openSession(s.id); set({ paletteOpen: false }); } })),
  ];
  const selectModel = (m: { name: string; scope: ProviderScope }) => {
    const full = st.models.find((x) => x.name === m.name);
    if (full?.tier === 'api-cloud' && !st.hasCloudKey) {
      st.set({ settingsOpen: true });
      st.toast('API models need an Ollama API key — paste it in Settings to continue.');
      set({ paletteOpen: false });
      return;
    }
    st.set({ model: m.name, scope: m.scope });
    try { localStorage.setItem('od.model', m.name); localStorage.setItem('od.scope', m.scope); } catch { /* ignore */ }
    set({ paletteOpen: false });
  };
  const doAction = (a: string) => {
    if (a === 'New session') pick(() => st.newSession());
    else if (a === 'Open settings') pick(() => st.set({ settingsOpen: true }));
    else if (a === 'Open directory') pick(() => st.set({ repoPickerOpen: true }));
    else if (a === 'Switch model') pick(() => window.dispatchEvent(new CustomEvent('od:models')));
    else if (a === 'View Git diff') pick(() => window.dispatchEvent(new CustomEvent('od:send-text', { detail: '/diff' })));
    else if (a === 'View commit') pick(() => window.dispatchEvent(new CustomEvent('od:send-text', { detail: '/commit' })));
    else if (a === 'View status') pick(() => window.dispatchEvent(new CustomEvent('od:send-text', { detail: '/status' })));
    else if (a === 'Create PR') pick(() => st.toast('Open a session with uncommitted changes to create a PR'));
    else set({ paletteOpen: false });
  };
  return (
    <Shell title="Command palette" onClose={() => set({ paletteOpen: false })}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') set({ paletteOpen: false });
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, flat.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          // Enter runs the highlighted hit — no dead keyboard path
          if (e.key === 'Enter' && flat[Math.min(hi, flat.length - 1)]) flat[Math.min(hi, flat.length - 1)].run();
        }}
        placeholder="Search sessions, directories, models, actions"
        aria-label="Search sessions, directories, models, actions"
        className="mb-1 w-full rounded-lg bg-black/[0.04] px-3 py-2 text-[14px] outline-none" />
      {!!actions.length && <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[#aeaeb2]">Actions</div>}
      {actions.map((a, i) => (
        <button key={a} data-ph={hi === i ? '1' : undefined} onClick={() => doAction(a)} onMouseEnter={() => setHi(i)}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-black/[0.05] ${hi === i ? 'bg-black/[0.05]' : ''}`}>
          <Search size={14} className="text-[#8a8a90]" />{a}
        </button>
      ))}
      {!!msShown.length && <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[#aeaeb2]">Models</div>}
      {msLocal.length > 0 && msCloud.length > 0 && <div className="px-3 pb-0.5 text-[11px] text-[#aeaeb2]">Local</div>}
      {msLocal.map((m, i) => {
        const idx = actions.length + i;
        return (
          <button key={m.scope + m.name} data-ph={hi === idx ? '1' : undefined} onClick={() => selectModel(m)} onMouseEnter={() => setHi(idx)}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-black/[0.05] ${hi === idx ? 'bg-black/[0.05]' : ''}`}>
            <span className="flex-1 truncate">{m.name}</span><span className="text-[12px] text-[#8a8a90]">{m.scope}</span>
          </button>
        );
      })}
      {msLocal.length > 0 && msCloud.length > 0 && <div className="px-3 pb-0.5 pt-1 text-[11px] text-[#aeaeb2]">Cloud</div>}
      {msCloud.map((m, i) => {
        const idx = actions.length + msLocal.length + i;
        return (
          <button key={m.scope + m.name} data-ph={hi === idx ? '1' : undefined} onClick={() => selectModel(m)} onMouseEnter={() => setHi(idx)}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-black/[0.05] ${hi === idx ? 'bg-black/[0.05]' : ''}`}>
            <span className="flex-1 truncate">{m.name}</span><span className="text-[12px] text-[#8a8a90]">{m.scope}</span>
          </button>
        );
      })}
      {!!ss.length && <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[#aeaeb2]">Sessions</div>}
      {ss.map((s, i) => {
        const idx = actions.length + msShown.length + i;
        return (
          <button key={s.id} data-ph={hi === idx ? '1' : undefined} onClick={() => { st.openSession(s.id); set({ paletteOpen: false }); }} onMouseEnter={() => setHi(idx)}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-black/[0.05] ${hi === idx ? 'bg-black/[0.05]' : ''}`}>
            <FileCode2 size={14} className="text-[#8a8a90]" />{s.title}
          </button>
        );
      })}
    </Shell>
  );
}

export function SessionListPanel() {
  const sessions = useStore((s) => s.sessions);
  const sessionId = useStore((s) => s.sessionId);
  const repo = useStore((s) => s.repo);
  const bgRuns = useStore((s) => s.bgRuns);
  const st = useStore.getState();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [viewRun, setViewRun] = useState<{ title: string; content: string } | null>(null);
  const cancelRef = useRef(false);
  useEffect(() => {
    st.refreshBgRuns();
    const t = setInterval(() => st.refreshBgRuns(), 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const viewBg = async (id: string, label: string) => {
    const r = await apiAgentRun(id).catch(() => null);
    setViewRun({ title: `Background: ${label || id}`, content: r?.run?.answer || '(no answer yet — still running?)' });
  };
  const commitRename = (id: string) => {
    st.renameSession(id, draft);
    setEditing(null);
  };
  const shown = sessions.filter((s) => s.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="flex h-full flex-col bg-white/60 p-2">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="flex-1 text-[13px] font-semibold">Sessions</span>
        {!!sessions.length && (
          <span className="rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[11px] text-[#6e6e73]">{sessions.length}</span>
        )}
      </div>
      <div className="px-1 pb-1.5">
        <button onClick={() => st.newSession()} className="mb-1.5 w-full rounded-lg bg-black py-1.5 text-[13px] font-medium text-white hover:bg-black/80">+ New</button>
        <div className="flex items-center gap-1.5 rounded-lg bg-black/[0.04] px-2 py-1.5">
          <Search size={13} className="shrink-0 text-[#8a8a90]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#aeaeb2]"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear search" className="rounded p-0.5 text-[#8a8a90] hover:bg-black/10"><X size={12} /></button>
          )}
        </div>
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto pt-1.5">
        {shown.map((s) => (
          <div key={s.id} className={`group flex items-center gap-0.5 rounded-lg px-2 py-1.5 ${s.id === sessionId ? 'bg-black/[0.06]' : 'hover:bg-black/[0.04]'}`}>
            {editing === s.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(s.id);
                  if (e.key === 'Escape') { cancelRef.current = true; setEditing(null); }
                }}
                onBlur={() => {
                  if (cancelRef.current) { cancelRef.current = false; return; }
                  commitRename(s.id);
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label="Rename session"
                className="min-w-0 flex-1 rounded-md border border-black/15 bg-white px-1.5 py-0.5 text-[13px] outline-none"
              />
            ) : (
              <button onClick={() => st.openSession(s.id)} title={s.title} className="min-w-0 flex-1 truncate text-left text-[13px]">{s.title}</button>
            )}
            {editing !== s.id && (
              <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => { setDraft(s.title); setEditing(s.id); }}
                  aria-label="Rename session" title="Rename"
                  className="rounded-md p-1.5 text-[#8a8a90] hover:bg-black/10 hover:text-black"
                ><Pencil size={14} /></button>
                <button
                  onClick={() => st.duplicateSession(s.id)}
                  aria-label="Duplicate session" title="Duplicate"
                  className="rounded-md p-1.5 text-[#8a8a90] hover:bg-black/10 hover:text-black"
                ><CopyPlus size={14} /></button>
                <button
                  onClick={() => st.deleteSession(s.id)}
                  aria-label="Delete session" title="Delete (Undo available)"
                  className="rounded-md p-1.5 text-[#8a8a90] hover:bg-black/10 hover:text-black"
                ><Trash2 size={14} /></button>
              </span>
            )}
          </div>
        ))}
        {!shown.length && (
          <div className="px-2 py-4 text-[13px] text-[#8a8a90]">
            {sessions.length ? `No matches for "${q}".` : 'No sessions yet.'}
          </div>
        )}
      </div>
      <div className="border-t border-black/[0.06] pt-1">
        <button onClick={() => st.set({ repoPickerOpen: true })} title={repo?.path || 'Open a directory'}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-[#6e6e73] hover:bg-black/[0.04]">
          <Folder size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{repo?.name || 'Open directory…'}</span>
        </button>
        {!!bgRuns.length && (
          <div className="px-1 pb-1">
            <div className="px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[#aeaeb2]">
              Background{bgRuns.some((r) => r.status === 'running') ? ' •' : ''}
            </div>
            {bgRuns.map((r) => (
              <div key={r.id} className="group flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-black/[0.04]">
                <span title={r.status} className={`h-2 w-2 shrink-0 rounded-full ${r.status === 'running' ? 'animate-pulse bg-[#0b66e4]' : r.status === 'done' ? 'bg-[#1a9e54]' : r.status === 'stopped' ? 'bg-[#aeaeb2]' : 'bg-[#d43a3a]'}`} />
                <button onClick={() => viewBg(r.id, r.label)} title={r.label} className="min-w-0 flex-1 truncate text-left text-[13px]">{r.label || r.id}</button>
                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => viewBg(r.id, r.label)} aria-label="View answer" title="View answer" className="rounded-md p-1.5 text-[#8a8a90] hover:bg-black/10 hover:text-black"><Eye size={14} /></button>
                  {r.status === 'running' && (
                    <button onClick={async () => { await apiAgentStopRun(r.id).catch(() => {}); st.refreshBgRuns(); }} aria-label="Stop run" title="Stop" className="rounded-md p-1.5 text-[#8a8a90] hover:bg-black/10 hover:text-black"><Square size={13} /></button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => st.set({ settingsOpen: true })} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-[#6e6e73] hover:bg-black/[0.04]">
          <SettingsIcon size={14} />Settings
        </button>
      </div>
      {viewRun && <CodeViewer file={viewRun.title} content={viewRun.content} onClose={() => setViewRun(null)} />}
    </div>
  );
}

export interface HookDef { event: string; match: string; command: string }
export function HookEditor({ hooks, onChange }: { hooks: HookDef[]; onChange: (h: HookDef[]) => void }) {
  const [event, setEvent] = useState('PreToolUse');
  const [match, setMatch] = useState('*');
  const [command, setCommand] = useState('');
  const add = () => {
    const c = command.trim();
    if (!c) return;
    onChange([...hooks, { event, match: match.trim() || '*', command: c.slice(0, 2000) }]);
    setCommand('');
  };
  return (
    <div>
      {(hooks || []).map((h, i) => (
        <div key={i} className="flex items-center gap-2 py-1 text-[13px]">
          <span className="shrink-0 rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[11px]">{h.event}</span>
          <span className="shrink-0 rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[11px]">{h.match}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={h.command}>{h.command}</span>
          <button onClick={() => onChange(hooks.filter((_, j) => j !== i))} aria-label="Delete hook" className="shrink-0 rounded p-1 text-[#8a8a90] hover:bg-black/10 hover:text-black"><X size={13} /></button>
        </div>
      ))}
      {!hooks?.length && <div className="py-1 text-[12px] text-[#8a8a90]">No hooks yet.</div>}
      <div className="flex items-center gap-1.5 py-1">
        <select value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Hook event" className="shrink-0 rounded-lg border border-black/10 bg-white px-1.5 py-1 text-[12px] outline-none">
          <option>PreToolUse</option>
          <option>PostToolUse</option>
          <option>Stop</option>
        </select>
        <input value={match} onChange={(e) => setMatch(e.target.value)} placeholder="tool or *" aria-label="Hook tool match" className="w-24 shrink-0 rounded-lg border border-black/10 px-2 py-1 font-mono text-[12px] outline-none" />
        <input value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder="PowerShell command…" aria-label="Hook command" className="min-w-0 flex-1 rounded-lg border border-black/10 px-2 py-1 font-mono text-[12px] outline-none" />
        <button onClick={add} disabled={!command.trim()} className="shrink-0 rounded-lg bg-black px-2.5 py-1 text-[12px] text-white disabled:opacity-40">Add</button>
      </div>
    </div>
  );
}

export function McpEditor({ cfg, setCfg, save, toast }: {
  cfg: { mcpServers?: Record<string, { command: string; args: string[]; env: Record<string, string> }> };
  setCfg: (c: never) => void; save: (o?: never) => Promise<void>; toast: (t: string) => void;
}) {
  const [live, setLive] = useState<Record<string, { status: string; tools: string[]; error?: string }>>({});
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const refresh = async () => {
    const j = await fetch('/api/mcp').then((r) => r.json()).catch(() => null);
    if (j?.ok && Array.isArray(j.servers)) {
      const m: Record<string, { status: string; tools: string[]; error?: string }> = {};
      for (const s of j.servers) m[s.name] = { status: s.status, tools: s.tools || [], error: s.error };
      setLive(m);
    }
  };
  useEffect(() => { refresh(); }, []);
  const servers = cfg.mcpServers || {};
  const splitArgs = (s: string) => (s.match(/[^\s"]+|"([^"]*)"/g) || []).map((a) => a.replace(/^"|"$/g, '')).filter(Boolean).slice(0, 20);
  const add = async () => {
    const n = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    const c = command.trim();
    if (!n || !c) { toast('Name + command required'); return; }
    const next = { ...cfg, mcpServers: { ...servers, [n]: { command: c.slice(0, 500), args: splitArgs(args), env: {} } } };
    setCfg(next as never);
    await save(next as never);
    toast(`MCP server ${n} saved — starting…`);
    await fetch('/api/mcp/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) }).catch(() => {});
    setName(''); setCommand(''); setArgs('');
    refresh();
  };
  const stop = async (n: string) => {
    await fetch('/api/mcp/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) }).catch(() => {});
    refresh();
  };
  const start = async (n: string) => {
    await fetch('/api/mcp/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) }).catch(() => {});
    refresh();
  };
  const remove = async (n: string) => {
    await stop(n);
    const nx = { ...servers };
    delete nx[n];
    const next = { ...cfg, mcpServers: nx };
    setCfg(next as never);
    await save(next as never);
    refresh();
  };
  const dot = (s?: string) => s === 'running' ? 'bg-[#1a9e54]' : s === 'starting' ? 'animate-pulse bg-[#0b66e4]' : 'bg-[#aeaeb2]';
  return (
    <div>
      {Object.keys(servers).map((n) => {
        const st = live[n];
        return (
          <div key={n} className="flex items-center gap-2 py-1 text-[13px]">
            <span title={st?.status || 'stopped'} className={`h-2 w-2 shrink-0 rounded-full ${dot(st?.status)}`} />
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={`${servers[n].command} ${(servers[n].args || []).join(' ')}${st?.tools?.length ? ` · tools: ${st.tools.join(', ')}` : ''}${st?.error ? ` · ${st.error}` : ''}`}>{n}</span>
            {st?.status === 'running' ? (
              <button onClick={() => stop(n)} className="shrink-0 rounded-lg border border-black/10 px-2 py-0.5 text-[12px] hover:bg-black/[0.04]">Stop</button>
            ) : (
              <button onClick={() => start(n)} className="shrink-0 rounded-lg border border-black/10 px-2 py-0.5 text-[12px] hover:bg-black/[0.04]">Start</button>
            )}
            <button onClick={() => remove(n)} aria-label={`Delete ${n}`} className="shrink-0 rounded p-1 text-[#8a8a90] hover:bg-black/10 hover:text-black"><X size={13} /></button>
          </div>
        );
      })}
      {!Object.keys(servers).length && <div className="py-1 text-[12px] text-[#8a8a90]">No MCP servers configured.</div>}
      <div className="flex items-center gap-1.5 py-1">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" aria-label="Server name" className="w-24 shrink-0 rounded-lg border border-black/10 px-2 py-1 font-mono text-[12px] outline-none" />
        <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="command (node, python…)" aria-label="Server command" className="w-36 shrink-0 rounded-lg border border-black/10 px-2 py-1 font-mono text-[12px] outline-none" />
        <input value={args} onChange={(e) => setArgs(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder="args…" aria-label="Server args" className="min-w-0 flex-1 rounded-lg border border-black/10 px-2 py-1 font-mono text-[12px] outline-none" />
        <button onClick={add} disabled={!name.trim() || !command.trim()} className="shrink-0 rounded-lg bg-black px-2.5 py-1 text-[12px] text-white disabled:opacity-40">Add</button>
      </div>
    </div>
  );
}

export function CustomCmdEditor({ customs, onChange }: { customs: { name: string; prompt: string }[]; onChange: (c: { name: string; prompt: string }[]) => void }) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const add = () => {
    const n = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 30);
    const p = prompt.trim();
    if (!n || !p || (customs || []).some((c) => c.name === n)) return;
    onChange([...(customs || []), { name: n, prompt: p.slice(0, 2000) }]);
    setName(''); setPrompt('');
  };
  return (
    <div>
      {(customs || []).map((c, i) => (
        <div key={c.name} className="flex items-center gap-2 py-1 text-[13px]">
          <span className="shrink-0 rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[11px]">/{c.name}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-[#6e6e73]" title={c.prompt}>{c.prompt}</span>
          <button onClick={() => onChange(customs.filter((_, j) => j !== i))} aria-label={`Delete /${c.name}`} className="shrink-0 rounded p-1 text-[#8a8a90] hover:bg-black/10 hover:text-black"><X size={13} /></button>
        </div>
      ))}
      {!customs?.length && <div className="py-1 text-[12px] text-[#8a8a90]">No custom commands. They appear in / menu and run as agent prompts.</div>}
      <div className="flex items-center gap-1.5 py-1">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="/name" aria-label="Command name" className="w-24 shrink-0 rounded-lg border border-black/10 px-2 py-1 font-mono text-[12px] outline-none" />
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder="prompt…" aria-label="Command prompt" className="min-w-0 flex-1 rounded-lg border border-black/10 px-2 py-1 text-[12px] outline-none" />
        <button onClick={add} disabled={!name.trim() || !prompt.trim()} className="shrink-0 rounded-lg bg-black px-2.5 py-1 text-[12px] text-white disabled:opacity-40">Add</button>
      </div>
    </div>
  );
}

export function KeybindEditor() {
  const [binds, setBinds] = useState<Record<'palette' | 'send' | 'models', KeyBind>>(DEFAULT_BINDS);
  const [rec, setRec] = useState<'palette' | 'send' | 'models' | null>(null);
  useEffect(() => { setBinds(loadBinds()); }, []);
  useEffect(() => {
    if (!rec) return;
    const fn = (e: KeyboardEvent) => {
      e.preventDefault();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const next = { ...binds, [rec]: { key: e.key.length === 1 ? e.key.toLowerCase() : e.key, shift: e.shiftKey } };
      setBinds(next);
      saveBinds(next);
      setRec(null);
    };
    window.addEventListener('keydown', fn, true);
    return () => window.removeEventListener('keydown', fn, true);
  }, [rec, binds ]);
  const rows: Array<{ k: 'palette' | 'send' | 'models'; label: string }> = [
    { k: 'palette', label: 'Command palette' },
    { k: 'send', label: 'Send message' },
    { k: 'models', label: 'Model picker' },
  ];
  return (
    <div>
      {rows.map((r) => (
        <div key={r.k} className="flex items-center gap-2 py-1 text-[13px]">
          <span className="flex-1 text-[#3a3a3c]">{r.label}</span>
          <button
            onClick={() => setRec(r.k)}
            className={`shrink-0 rounded-lg border px-2.5 py-1 font-mono text-[12px] ${rec === r.k ? 'border-[#0b66e4] bg-[#eef3fd] text-[#0b66e4]' : 'border-black/10 hover:bg-black/[0.04]'}`}
          >{rec === r.k ? 'press keys…' : bindLabel(binds[r.k])}</button>
        </div>
      ))}
      <div className="flex items-center justify-between py-1">
        <span className="text-[12px] text-[#8a8a90]">Mod = Ctrl (⌘ on Mac). Takes effect immediately.</span>
        <button onClick={() => { setBinds({ ...DEFAULT_BINDS }); saveBinds({ ...DEFAULT_BINDS }); }} className="rounded-lg border border-black/10 px-2 py-0.5 text-[12px] hover:bg-black/[0.04]">Reset</button>
      </div>
    </div>
  );
}

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);
  const [cfg, setCfg] = useState<{ localEndpoint: string; cloudEndpoint: string; cloudKey: string; defaultModel: string; toolPolicy?: Record<string, string>; hooks?: HookDef[]; mcpServers?: Record<string, { command: string; args: string[]; env: Record<string, string> }>; customCommands?: { name: string; prompt: string }[] }>({ localEndpoint: 'http://localhost:11434', cloudEndpoint: 'https://ollama.com', cloudKey: '', defaultModel: '' });
  const [local, setLocal] = useState('checking…');
  const [cloud, setCloud] = useState('checking…');
  const [tools, setTools] = useState<{ name: string; description: string; readOnly: boolean; policy: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    fetch('/api/config').then((r) => r.json()).then((j) => {
      setCfg(j);
      setCloud(j.cloudKey ? 'Key set — press Test to verify' : 'No key set');
    }).catch(() => {});
    providers.local.health().then((h) => setLocal(h.ok ? `Connected (${h.count} models)` : 'Unavailable')).catch(() => setLocal('Unavailable'));
    fetch('/api/tools').then((r) => r.json()).then((j) => { if (j.ok && Array.isArray(j.tools)) setTools(j.tools); }).catch(() => {});
  }, [open ]);
  if (!open) return null;
  const save = async (override?: typeof cfg) => {
    const body = override || cfg;
    await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
    if (!override) {
      useStore.getState().refreshModels();
      toast('Settings saved');
      set({ settingsOpen: false });
    }
  };
  const row = 'flex items-center justify-between gap-3 py-2 text-[14px]';
  return (
    <Shell title="Settings" onClose={() => set({ settingsOpen: false })}>
      <div className="px-3 py-1">
        <div className={row}><span className="text-[#6e6e73]">Local endpoint</span>
          <input value={cfg.localEndpoint} onChange={(e) => setCfg({ ...cfg, localEndpoint: e.target.value })} className="w-64 rounded-lg border border-black/10 px-2 py-1 font-mono text-[12px]" /></div>
        <div className={row}><span className="text-[#6e6e73]">Local status</span>
          <span className="flex items-center gap-1.5 text-[13px]"><span className={`h-2 w-2 rounded-full ${local.startsWith('Connected') ? 'bg-[#1a9e54]' : 'bg-[#d43a3a]'}`} />{local}</span></div>
        <div className={row}><span className="text-[#6e6e73]">Cloud endpoint</span>
          <input value={cfg.cloudEndpoint} onChange={(e) => setCfg({ ...cfg, cloudEndpoint: e.target.value })} className="w-64 rounded-lg border border-black/10 px-2 py-1 font-mono text-[12px]" /></div>
        <div className={row}><span className="text-[#6e6e73]">Cloud key</span>
          <input type="password" value={cfg.cloudKey} onChange={(e) => setCfg({ ...cfg, cloudKey: e.target.value })} placeholder="Leave as ••• to keep saved key" className="w-64 rounded-lg border border-black/10 px-2 py-1 font-mono text-[12px]" /></div>
        <div className={row}><span className="text-[#6e6e73]">Cloud status</span><span className="text-[13px]">{cloud}</span></div>
        <div className={row}><span className="text-[#6e6e73]">Cloud usage</span><a href="https://ollama.com/pricing" target="_blank" rel="noreferrer" className="text-[13px] text-[#0b66e4] underline">Free starter usage · upgrade for more</a></div>
        <div className="py-1 text-[12px] text-[#8a8a90]">No key? Run <span className="font-mono">ollama signin</span> once (free) in a terminal for starter cloud models.</div>
        {!!tools.length && (
          <div className="mt-1 border-t border-black/[0.06] pt-2">
            <div className="py-1 text-[13px] font-medium">Tool permissions</div>
            <div className="thin-scroll max-h-56 overflow-y-auto">
              {tools.map((t) => {
                const pol = cfg.toolPolicy?.[t.name] || t.policy;
                return (
                  <div key={t.name} className="flex items-center gap-2 py-1 text-[13px]">
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={t.description}>{t.name}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${t.readOnly ? 'bg-[#e6f6ec] text-[#1a7a45]' : 'bg-[#fbf3e4] text-[#9a6a0a]'}`}>{t.readOnly ? 'read' : 'write'}</span>
                    <select
                      value={pol}
                      aria-label={`${t.name} permission`}
                      onChange={(e) => setCfg({ ...cfg, toolPolicy: { ...(cfg.toolPolicy || {}), [t.name]: e.target.value } })}
                      className="shrink-0 rounded-lg border border-black/10 bg-white px-1.5 py-1 text-[12px] outline-none"
                    >
                      <option value="allow">Allow</option>
                      <option value="ask">Ask</option>
                      <option value="deny">Deny</option>
                    </select>
                  </div>
                );
              })}
            </div>
            <div className="py-1 text-[12px] text-[#8a8a90]">Ask = approval card in chat · write tools ask by default · subagents never interrupt (ask counts as deny).</div>
          </div>
        )}
        <div className="mt-1 border-t border-black/[0.06] pt-2">
          <div className="py-1 text-[13px] font-medium">Hooks</div>
          <HookEditor hooks={cfg.hooks || []} onChange={(hooks) => setCfg({ ...cfg, hooks })} />
          <div className="py-1 text-[12px] text-[#8a8a90]">PowerShell with $env:YK_TOOL, $env:YK_INPUT_JSON{', $env:YK_OUTPUT_JSON'}. PreToolUse blocks on non-zero exit.</div>
        </div>
        <div className="mt-1 border-t border-black/[0.06] pt-2">
          <div className="py-1 text-[13px] font-medium">Custom commands</div>
          <CustomCmdEditor customs={cfg.customCommands || []} onChange={(customCommands) => setCfg({ ...cfg, customCommands })} />
          <div className="py-1 text-[12px] text-[#8a8a90]">Saved with Settings. Usage: /name plus optional extra text.</div>
        </div>
        <div className="mt-1 border-t border-black/[0.06] pt-2">
          <div className="py-1 text-[13px] font-medium">Keybindings</div>
          <KeybindEditor />
        </div>
        <div className="mt-1 border-t border-black/[0.06] pt-2">
          <div className="py-1 text-[13px] font-medium">MCP servers</div>
          <McpEditor cfg={cfg} setCfg={setCfg} save={save} toast={toast} />
          <div className="py-1 text-[12px] text-[#8a8a90]">stdio servers (e.g. node/python scripts). Their tools appear as mcp__server__tool in build mode, ask-by-default.</div>
        </div>
        <div className={row}><span className="text-[#6e6e73]">Theme</span><span className="text-[13px]">Light (dark architecture ready)</span></div>
        <div className="flex justify-end gap-2 py-3">
          <button onClick={async () => {
            setLocal('checking…');
            setCloud('checking…');
            const [l, lib, kc] = await Promise.all([
              providers.local.health().catch(() => ({ ok: false })),
              providers.cloud.listModels().then((m) => ({ ok: true, count: m.length })).catch(() => ({ ok: false })),
              fetch('/api/ollama/keycheck', { method: 'POST' }).then((r) => r.json()).catch(() => ({ ok: false, reason: 'error' })),
            ]);
            setLocal(l.ok ? `Connected (${(l as { count?: number }).count} models)` : 'Unavailable');
            // listing is public — the key proof is the keycheck below
            const n = (lib as { count?: number }).count;
            setCloud(!lib.ok ? 'Unreachable'
              : kc.reason === 'valid' ? `Key valid · ${n} cloud models`
              : kc.reason === 'invalid' ? 'Key rejected (401) — check the key'
              : kc.reason === 'limit' ? 'Key ok, credits exhausted'
              : kc.reason === 'nokey' ? `No key · ${n} models listed`
              : 'Key check failed');
            toast(l.ok ? 'Local connected' : 'Local unavailable');
            if (kc.reason === 'invalid') toast('API key rejected — check the key');
            else if (kc.reason === 'limit') toast('Key ok, credits exhausted — upgrade on ollama.com');
          }} className="rounded-lg border border-black/10 px-3 py-1.5 text-[13px] hover:bg-black/[0.03]">Test connection</button>
          <button onClick={() => save()} className="rounded-lg bg-black px-3 py-1.5 text-[13px] text-white">Save</button>
        </div>
      </div>
    </Shell>
  );
}

export function RepoPicker() {
  const isOpen = useStore((s) => s.repoPickerOpen);
  const set = useStore((s) => s.set);
  const repo = useStore((s) => s.repo);
  const st = useStore.getState();
  const [path, setPath] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [expPath, setExpPath] = useState('');
  const [expParent, setExpParent] = useState('');
  const [expDirs, setExpDirs] = useState<{ name: string; hasGit?: boolean; drive?: boolean }[] | null>(null);
  const [expLoading, setExpLoading] = useState(false);
  const [memNotes, setMemNotes] = useState<string[]>([]);
  useEffect(() => {
    if (isOpen) {
      setPath(repo?.path || '');
      setExplorerOpen(false);
      setExpDirs(null);
      setExpPath('');
      setExpParent('');
      try { setRecent(JSON.parse(localStorage.getItem('od.repos') || '[]')); } catch { setRecent([]); }
      if (repo?.path) apiMemory(repo.path).then((m) => { if (m.ok && Array.isArray(m.notes)) setMemNotes(m.notes); }).catch(() => {});
      else setMemNotes([]);
    }
  }, [isOpen, repo?.path ]);
  useEffect(() => {
    if (!isOpen) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') set({ repoPickerOpen: false }); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [isOpen, set ]);
  if (!isOpen) return null;
  const close = () => set({ repoPickerOpen: false });
  const remember = (p: string) => {
    try {
      const list = [p, ...JSON.parse(localStorage.getItem('od.repos') || '[]').filter((x: string) => x !== p)].slice(0, 5);
      localStorage.setItem('od.repos', JSON.stringify(list));
      setRecent(list);
    } catch { /* ignore */ }
  };
  const submit = async (p?: string) => {
    const target = (p || path).trim();
    if (!target) return;
    const open = await apiRepoOpen(target).catch(() => null);
    if (!open || !open.ok) { st.toast('Directory not found — check the path'); return; }
    const info = await apiRepoInfo(target).catch(() => null);
    const isGit = !!open.isGit && !!info?.branch;
    const base = target.split(/[/\\]/).pop() || 'repo';
    st.set({ repo: { path: target, name: info?.name || base, branch: info?.branch || 'main', dirty: !!info?.dirty && isGit, diffStat: (isGit && info?.diffStat) || '', status: (isGit && info?.status) || '' } });
    remember(target);
    st.toast(isGit ? 'Git repository ready' : 'Directory ready');
    close();
  };
  const loadExp = async (p: string) => {
    const target = p.trim();
    setExpLoading(true);
    try {
      if (!target) {
        const d = await apiDrives().catch(() => null);
        setExpDirs(((d?.drives) || []).map((x: string) => ({ name: x, drive: true })));
        setExpPath('');
        setExpParent('');
      } else {
        const r = await apiLsDir(target).catch(() => null);
        if (r?.ok) {
          setExpDirs(r.dirs || []);
          setExpPath(r.path || target);
          setExpParent(r.parent || '');
        } else {
          st.toast('Cannot list directory');
        }
      }
    } finally {
      setExpLoading(false);
    }
  };
  return (
    <Shell title="Open directory" onClose={close}>
      <div className="p-3">
        <div className="break-all text-[13px] text-[#6e6e73]">Current: <span className="font-mono text-[12px]">{repo?.path || '(none)'}</span></div>
        {!!memNotes.length && (
          <div className="mt-2 rounded-lg border border-black/10 bg-black/[0.02] p-2">
            <div className="flex items-center gap-2 px-1 pb-1">
              <span className="flex-1 text-[12px] font-semibold text-[#6e6e73]">Project memory ({memNotes.length})</span>
              <button
                onClick={async () => { if (repo?.path) { await apiMemoryClear(repo.path).catch(() => {}); setMemNotes([]); } }}
                className="rounded-md px-1.5 py-0.5 text-[11px] text-[#8a8a90] hover:bg-black/[0.06] hover:text-black"
              >Clear</button>
            </div>
            {memNotes.map((n, i) => (
              <div key={i} className="px-1 py-0.5 text-[12px] text-[#3a3a3c]">• {n}</div>
            ))}
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <button
            onClick={async () => {
              // native folder dialog first; in-app explorer stays as fallback
              try {
                const r = await apiFsBrowse();
                if (r?.ok && r.path) { setPath(r.path); st.toast(`Picked ${r.path}`); }
                else if (r && !r.cancelled) st.toast(r.error || 'Folder dialog failed — use the in-app explorer below');
              } catch { st.toast('Folder dialog failed — use the in-app explorer below'); }
            }}
            className="flex-1 rounded-lg border border-black/10 px-3 py-1.5 text-[13px] hover:bg-black/[0.03]"
          >Browse…</button>
          <button
            onClick={() => {
              const v = !explorerOpen;
              setExplorerOpen(v);
              if (v) loadExp(path || '');
            }}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-[13px] hover:bg-black/[0.03]"
          >{explorerOpen ? 'Hide files' : 'Files'}</button>
        </div>
        {explorerOpen && (
          <div className="mt-2 overflow-hidden rounded-lg border border-black/10">
            <div className="flex items-center gap-1.5 border-b border-black/[0.06] bg-black/[0.02] px-2 py-1.5">
              <button
                disabled={!expParent || expLoading}
                onClick={() => loadExp(expParent)}
                title="Up one level"
                className="rounded-md px-1.5 py-0.5 text-[13px] hover:bg-black/[0.06] disabled:opacity-30"
              >↑</button>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#3a3a3c]" title={expPath}>{expPath || 'Drives'}</span>
              {!!expPath && (
                <button onClick={() => submit(expPath)} className="shrink-0 rounded-lg bg-black px-2.5 py-1 text-[12px] text-white">Select this directory</button>
              )}
            </div>
            <div className="thin-scroll max-h-48 overflow-y-auto p-1">
              {expLoading && <div className="px-2 py-2 text-[13px] text-[#8a8a90]">Loading…</div>}
              {!expLoading && (expDirs || []).map((d) => (
                <button
                  key={(d.drive ? 'drv:' : '') + d.name}
                  onClick={() => loadExp(d.drive ? d.name : `${expPath.replace(/[/\\]$/, '')}\\${d.name}`)}
                  title={d.drive ? `Open ${d.name}` : 'Open directory — then Select this directory to confirm'}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-black/[0.04]"
                >
                  <Folder size={14} className="shrink-0 text-[#8a8a90]" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{d.name}</span>
                  {d.hasGit && <span className="shrink-0 rounded bg-[#eef3fd] px-1.5 py-0.5 text-[10px] font-medium text-[#0b66e4]">git</span>}
                </button>
              ))}
              {!expLoading && expDirs && !expDirs.length && (
                <div className="px-2 py-2 text-[13px] text-[#8a8a90]">No subdirectories.</div>
              )}
            </div>
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <input autoFocus value={path} onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="/path/to/directory"
            className="flex-1 rounded-lg border border-black/10 px-2.5 py-1.5 font-mono text-[13px]" />
          <button onClick={() => submit()} className="rounded-lg bg-black px-3 py-1.5 text-[13px] text-white">Open</button>
        </div>
        {!!recent.length && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recent.map((r) => (
              <button
                key={r}
                onClick={() => submit(r)}
                title={r}
                className="max-w-full truncate rounded-lg bg-black/[0.04] px-2 py-1 font-mono text-[12px] hover:bg-black/[0.08]"
              >{r.split(/[/\\]/).pop() || r}</button>
            ))}
          </div>
        )}
        <div className="mt-2 text-[12px] text-[#8a8a90]">Files and git stay confined to this directory. Nothing runs outside it.</div>
      </div>
    </Shell>
  );
}

export function CommitDetails({ commit, onClose, onShowFiles }: { commit: CommitInfo | null; onClose: () => void; onShowFiles: (c: CommitInfo) => void }) {
  if (!commit) return null;
  return (
    <Shell title={`${commit.short} — commit details`} onClose={onClose} wide>
      <div className="space-y-2 px-3 py-2 text-[14px]">
        <div className="font-medium">{commit.subject}</div>
        <div className="flex gap-4 text-[13px] text-[#6e6e73]">
          <span>{commit.author}</span><span>{commit.date}</span>
          <span className="font-mono text-[12px]">{commit.hash.slice(0, 12)}</span>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={() => onShowFiles(commit)} className="rounded-lg border border-black/10 px-2.5 py-1 text-[13px] hover:bg-black/[0.03]">Files changed</button>
          <button onClick={() => { navigator.clipboard?.writeText(commit.hash).catch(() => {}); }} className="rounded-lg border border-black/10 px-2.5 py-1 text-[13px] hover:bg-black/[0.03]">Copy hash</button>
        </div>
      </div>
    </Shell>
  );
}

export function FileListModal({ title, files, onClose, onOpen }: { title: string; files: string[]; onClose: () => void; onOpen: (f: string) => void }) {
  return (
    <Shell title={title} onClose={onClose}>
      {files.map((f) => (
        <button key={f} onClick={() => onOpen(f)} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left font-mono text-[13px] hover:bg-black/[0.05]">
          <FileCode2 size={14} className="text-[#8a8a90]" />{f}
        </button>
      ))}
      {!files.length && <div className="px-3 py-4 text-[13px] text-[#8a8a90]">No files.</div>}
    </Shell>
  );
}

export function CodeViewer({ file, content, onClose }: { file: string | null; content: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  if (!file) return null;
  const lines = content.split('\n');
  const indexed = lines.map((l, i) => ({ l, n: i + 1 }));
  const shown = q ? indexed.filter(({ l }) => l.toLowerCase().includes(q.toLowerCase())) : indexed;
  return (
    <Shell title={file} onClose={onClose} wide>
      <div className="flex items-center gap-2 px-3 py-1">
        <Search size={14} className="text-[#8a8a90]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search file" aria-label="Search file" className="w-56 rounded-lg bg-black/[0.04] px-2 py-1 text-[13px] outline-none" />
        <span className="flex-1" />
        <button onClick={() => navigator.clipboard?.writeText(content).catch(() => {})} className="rounded-lg border border-black/10 px-2 py-1 text-[12px] hover:bg-black/[0.03]">Copy</button>
      </div>
      <pre className="mx-2 mb-2 overflow-auto rounded-lg bg-[#f6f6f7] p-3 font-mono text-[13px] leading-[1.55] thin-scroll">
        {shown.length > 800 && <div className="mb-2 text-[12px] text-[#8a8a90]">Showing first 800 of {shown.length} lines — refine the search.</div>}
        {shown.slice(0, 800).map(({ l, n }) => (
          <div key={n} className="flex gap-3"><span className="w-8 select-none text-right text-[#aeaeb2]">{n}</span><span className="whitespace-pre-wrap">{l}</span></div>
        ))}
      </pre>
    </Shell>
  );
}

export function DiffViewerModal({ diff, onClose }: { diff: string | null; onClose: () => void }) {
  if (diff === null) return null;
  // ''.split('\n') is [''] — normalize so a truly empty diff hits the clean branch
  const all = diff.trim() === '' ? [] : diff.split('\n');
  const lines = all.slice(0, 1200);
  return (
    <Shell title="Diff" onClose={onClose} wide>
      {all.length > 1200 && <div className="px-3 py-1 text-[12px] text-[#8a8a90]">Showing first 1200 of {all.length} lines.</div>}
      <pre className="mx-2 mb-2 overflow-auto rounded-lg bg-[#f6f6f7] p-3 font-mono text-[12.5px] leading-[1.5] thin-scroll">
        {lines.map((l, i) => (
          <div key={i} className={`flex gap-3 rounded px-1 ${l.startsWith('+') && !l.startsWith('+++') ? 'bg-[#e6f6ec]' : l.startsWith('-') && !l.startsWith('---') ? 'bg-[#fdecec]' : l.startsWith('@@') ? 'text-[#0b66e4]' : ''}`}>
            <span className="w-8 select-none text-right text-[#aeaeb2]">{i + 1}</span>
            <span className="whitespace-pre-wrap">{l}</span>
          </div>
        ))}
        {!lines.length && <span className="text-[#8a8a90]">Working tree is clean.</span>}
      </pre>
    </Shell>
  );
}

export function PRMenu({ anchor, onClose }: { anchor: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!anchor) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [anchor, onClose ]);
  if (!anchor) return null;
  const st = useStore.getState();
  const items: { label: string; fn: () => void }[] = [
    { label: 'Create PR', fn: () => st.toast('Open a session with uncommitted changes to create a PR') },
    { label: 'Review changes', fn: () => window.dispatchEvent(new CustomEvent('od:send-text', { detail: 'Review my uncommitted diff' })) },
    { label: 'View diff', fn: () => window.dispatchEvent(new CustomEvent('od:send-text', { detail: '/diff' })) },
    { label: 'Open branch', fn: () => st.toast(`On branch ${st.repo?.branch || 'main'}`) },
    { label: 'Copy branch name', fn: () => { navigator.clipboard?.writeText(st.repo?.branch || 'main').then(() => st.toast('Branch copied')).catch(() => st.toast('Copy failed')); } },
  ];
  return (
    <div className="fixed inset-0 z-[75]" onClick={onClose}>
      <motion.div {...popoverAnim} onClick={(e) => e.stopPropagation()} role="menu" aria-label="Pull request actions"
        className="absolute bottom-36 left-1/2 z-[76] w-[220px] -translate-x-1/2 rounded-xl border border-black/10 bg-white p-1.5 shadow-pop">
        {items.map((a) => (
          <button key={a.label} onClick={() => { a.fn(); onClose(); }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] hover:bg-black/[0.05]">
            <GitBranch size={14} className="text-[#8a8a90]" />{a.label}
          </button>
        ))}
      </motion.div>
    </div>
  );
}

function ModelMeta({ m }: { m: ModelInfo }) {
  const d = (m.details || {}) as Record<string, unknown>;
  const bits = [
    typeof m.size === 'number' && m.size > 0 ? fmtSize(m.size) : '',
    typeof d.parameter_size === 'string' && d.parameter_size ? d.parameter_size : '',
    typeof d.quantization_level === 'string' && d.quantization_level ? d.quantization_level : '',
    typeof d.family === 'string' && d.family ? d.family : '',
  ].filter(Boolean);
  if (!bits.length) return null;
  return <span className="block truncate text-[11px] text-[#8a8a90]">{bits.join(' · ')}</span>;
}

export function ModelManager({ models, onRefresh }: { models: ModelInfo[]; onRefresh: () => void }) {
  const toast = useStore((s) => s.toast);
  const [scope, setScope] = useState<ProviderScope>('local');
  const shown = models.filter((m) => m.scope === scope);
  return (
    <Shell title="Models" onClose={onRefresh}>
      <div className="flex gap-2 px-3 py-2">
        {(['local', 'cloud'] as const).map((s) => (
          <button key={s} onClick={() => setScope(s)} className={`rounded-lg px-2.5 py-1 text-[13px] ${scope === s ? 'bg-black text-white' : 'bg-black/[0.05]'}`}>{s}</button>
        ))}
        <span className="flex-1" />
        <button onClick={() => { useStore.getState().refreshModels(); toast('Refreshing models…'); }} className="rounded-lg border border-black/10 px-2.5 py-1 text-[13px]">Refresh</button>
      </div>
      {(models.filter((m) => m.scope === scope)).map((m: ModelInfo) => (
        <div key={m.scope + m.name} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/[0.04]">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px]">{m.name}</span>
            <ModelMeta m={m} />
          </span>
          <TierBadge tier={m.tier} />
        </div>
      ))}
      {!!shown.length && (
        <div className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-[#8a8a90]">
          Local stays on this machine. Free cloud = starter models on a free account. API cloud needs a key in Settings. Cloud prompts leave this machine.
        </div>
      )}
      {!shown.length && (
        <div className="px-3 py-4 text-[13px] text-[#8a8a90]">
          {scope === 'local' ? 'No local models — pull one with `ollama pull <name>`.' : 'No cloud models — add your key in Settings.'}
        </div>
      )}
    </Shell>
  );
}
