import { create } from 'zustand';
import { apiAgentRuns, providers } from './api';
import { abortAllStreams, abortStream } from './streams';
import type { AgentContextMemory, BgRun, CommitInfo, ModelInfo, ModelTier, ProviderScope, ReasoningLevel, RepositoryContext, Session } from './types';

interface UIState {
  route: '/' | '/chat' | '/settings';
  sessionId: string | null;
  sessions: Session[];
  models: ModelInfo[];
  modelsLoading: boolean;
  hasCloudKey: boolean;
  ollamaLocal: { ok: boolean; checked: boolean; error?: string };
  ollamaCloud: { ok: boolean; checked: boolean; error?: string };
  repo: RepositoryContext | null;
  repoPathInput: string;
  model: string;
  scope: ProviderScope;
  reasoning: ReasoningLevel;
  paletteOpen: boolean;
  settingsOpen: boolean;
  repoPickerOpen: boolean;
  sessionListOpen: boolean;
  streaming: Record<string, boolean>;
  bgRuns: BgRun[];
  customCommands: { cmd: string; desc: string; prompt: string }[];
  buildMode: boolean;
  statusLine: string;
  toasts: { id: string; text: string; action?: { label: string; fn: () => void } }[];
  memory: AgentContextMemory;
  minimized: boolean;
  maximized: boolean;
}

interface Actions {
  set: (p: Partial<UIState>) => void;
  toast: (text: string, action?: { label: string; fn: () => void }) => void;
  newSession: () => void;
  openSession: (id: string) => void;
  toggleOverview: () => void;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  duplicateSession: (id: string) => void;
  activeSession: () => Session | undefined;
  pushMessage: (sid: string, m: Session['messages'][number]) => void;
  deleteMessage: (sid: string, mid: string) => void;
  deleteMessagesAfter: (sid: string, mid: string) => void;
  appendToken: (sid: string, mid: string, token: string) => void;
  persistSessions: () => void;
  persistLocal: () => void;
  loadSessions: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshBgRuns: () => Promise<void>;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const stored = (k: string, fb: string) => { try { return localStorage.getItem(k) || fb; } catch { return fb; } };

// Cloud models covered by free-account starter usage (per ollama.com).
// Everything else on cloud needs an API key / usage credits.
// L7: hardcoded snapshot — re-check against ollama.com/pricing when touching
// model tiers; unknown future models safely default to 'api-cloud'.
export const FREE_CLOUD_MODELS = new Set([
  'gemma4:31b',
  'gpt-oss:120b',
  'gpt-oss:20b',
  'nemotron-3-nano:30b',
  'nemotron-3-super',
  'nemotron-3-ultra',
]);

function blankSession(model: string, scope: ProviderScope, reasoning: ReasoningLevel, repo: RepositoryContext | null): Session {
  const now = Date.now();
  return {
    id: uid(), title: 'New session',
    repository: repo?.path || '', branch: repo?.branch || 'main', worktree: '',
    provider: scope, model, reasoningLevel: reasoning,
    messages: [], toolCalls: [], contextMemory: {},
    createdAt: now, updatedAt: now,
  };
}

export const useStore = create<UIState & Actions>((set, get) => ({
  route: stored('od.route', '/') === '/chat' ? '/chat' : '/',
  sessionId: null,
  sessions: [],
  models: [],
  modelsLoading: false,
  hasCloudKey: false,
  ollamaLocal: { ok: false, checked: false },
  ollamaCloud: { ok: false, checked: false },
  repo: (() => {
    // reopen where the user left off — branch/dirty revalidated on boot
    try {
      const raw = localStorage.getItem('od.repo');
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || typeof p.path !== 'string' || !p.path) return null;
      return { path: p.path, name: p.name || p.path, branch: 'main', dirty: false, diffStat: '' };
    } catch { return null; }
  })(),
  repoPathInput: '',
  model: stored('od.model', ''),
  scope: (stored('od.scope', 'local') as ProviderScope),
  reasoning: (stored('od.reasoning', 'Medium') as ReasoningLevel),
  paletteOpen: false,
  settingsOpen: false,
  repoPickerOpen: false,
  sessionListOpen: (() => { try { return localStorage.getItem('od.sidebar') !== '0'; } catch { return true; } })(),
  streaming: {},
  bgRuns: [],
  customCommands: [],
  refreshBgRuns: async () => {
    try {
      const j = await apiAgentRuns();
      if (j.ok && Array.isArray(j.runs)) set({ bgRuns: j.runs });
    } catch { /* bridge down — keep old list */ }
  },
  buildMode: stored('od.buildMode', 'chat') === 'build',
  statusLine: '',
  toasts: [],
  memory: {},
  minimized: stored('od.win', '') === 'min',
  maximized: stored('od.win', '') === 'max',

  set: (p) => set(p),
  toast: (text, action) => {
    // dedupe: never stack identical toasts
    if (get().toasts.some((t) => t.text === text)) return;
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { id, text, action }].slice(-3) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
  },
  newSession: () => {
    // fresh start: kill any in-flight thinking so old + new never run together
    abortAllStreams();
    set({ streaming: {} });
    const { model, scope, reasoning, repo, sessions } = get();
    // never stack empty drafts: reuse the empty one if it exists
    const existing = sessions.find((s) => s.messages.length === 0);
    if (existing) {
      set({ sessionId: existing.id, route: '/chat' });
      return;
    }
    const firstEver = sessions.length === 0;
    const s = blankSession(model, scope, reasoning, repo);
    if (firstEver) { try { localStorage.setItem('od.sidebar', '1'); } catch { /* ignore */ } }
    set((st) => ({
      sessions: [s, ...st.sessions],
      sessionId: s.id,
      route: '/chat',
      // first session: open the sidebar so sessions + settings are discoverable
      sessionListOpen: firstEver ? true : st.sessionListOpen,
    }));
    get().persistSessions();
  },
  openSession: (id) => {
    // single-stream invariant: switching away kills other runs so a hidden
    // stream can never keep burning tokens with no visible Stop button
    const nx = { ...get().streaming };
    for (const k of Object.keys(nx)) if (k !== id) { abortStream(k); delete nx[k]; }
    set({ sessionId: id, route: '/chat', streaming: nx });
  },
  toggleOverview: () => {
    const { route, sessionId } = get();
    if (route === '/') {
      // already home: go back only if there is a session, else silent no-op
      if (sessionId) set({ route: '/chat' });
    } else {
      set({ route: '/' });
    }
  },
  renameSession: (id, title) => {
    const t = title.trim().slice(0, 80);
    if (!t) return;
    set((st) => ({ sessions: st.sessions.map((s) => (s.id === id ? { ...s, title: t } : s)) }));
    get().persistSessions();
  },
  deleteSession: (id) => {
    // kill its stream first — otherwise tokens keep appending into a ghost
    abortStream(id);
    const st = get();
    const idx = st.sessions.findIndex((s) => s.id === id);
    const doomed = idx >= 0 ? st.sessions[idx] : null;
    const rest = st.sessions.filter((s) => s.id !== id);
    const nx = { ...st.streaming };
    delete nx[id];
    if (st.sessionId === id) {
      // never leave a ghost view: fall back to newest remaining, else home
      set(rest.length
        ? { sessions: rest, sessionId: rest[0].id, route: '/chat' as const, streaming: nx }
        : { sessions: rest, sessionId: null, route: '/' as const, streaming: nx });
    } else {
      set({ sessions: rest, streaming: nx });
    }
    get().persistSessions();
    fetch(`/api/sessions/${id}`, { method: 'DELETE' }).catch(() => {});
    // single click deletes; Undo restores within the toast lifetime
    if (doomed) {
      get().toast('Session deleted', {
        label: 'Undo',
        fn: () => {
          const cur = get().sessions;
          const at = Math.min(idx, cur.length);
          set({ sessions: [...cur.slice(0, at), doomed, ...cur.slice(at)] });
          get().persistSessions();
        },
      });
    }
  },
  duplicateSession: (id) => {
    const src = get().sessions.find((s) => s.id === id);
    if (!src) return;
    const now = Date.now();
    const copy: Session = {
      ...src,
      id: uid(),
      title: `${src.title} (copy)`.slice(0, 80),
      messages: src.messages.map((m) => ({ ...m, id: uid() })),
      toolCalls: [],
      createdAt: now, updatedAt: now,
    };
    set((st) => ({ sessions: [copy, ...st.sessions], sessionId: copy.id, route: '/chat' }));
    get().persistSessions();
  },
  activeSession: () => get().sessions.find((s) => s.id === get().sessionId),
  pushMessage: (sid, m) => {
    set((st) => ({
      sessions: st.sessions.map((s) => {
        if (s.id !== sid) return s;
        const title = s.messages.length === 0 && m.role === 'user'
          ? m.content.slice(0, 42) || (m.atts?.length ? `Attached: ${m.atts.map((a) => a.name).join(', ').slice(0, 32)}` : '') || s.title
          : s.title;
        return { ...s, title, messages: [...s.messages, m], updatedAt: Date.now() };
      }),
    }));
    get().persistSessions();
  },
  appendToken: (sid, mid, token) => {
    set((st) => ({
      sessions: st.sessions.map((s) => {
        if (s.id !== sid) return s;
        return { ...s, messages: s.messages.map((m) => (m.id === mid ? { ...m, content: m.content + token } : m)), updatedAt: Date.now() };
      }),
    }));
  },
  deleteMessage: (sid, mid) => {
    set((st) => ({
      sessions: st.sessions.map((s) => (
        s.id !== sid ? s : { ...s, messages: s.messages.filter((m) => m.id !== mid), updatedAt: Date.now() }
      )),
    }));
    get().persistSessions();
  },
  // rewind: keep everything up to and including mid, drop the rest
  deleteMessagesAfter: (sid, mid) => {
    set((st) => ({
      sessions: st.sessions.map((s) => {
        if (s.id !== sid) return s;
        const i = s.messages.findIndex((m) => m.id === mid);
        if (i < 0) return s;
        return { ...s, messages: s.messages.slice(0, i + 1), updatedAt: Date.now() };
      }),
    }));
    get().persistSessions();
  },
  persistSessions: () => {
    get().persistLocal();
    const { sessions } = get();
    // sync every session (rename/duplicate of an inactive row must survive reload too)
    sessions.slice(0, 50).forEach((s) => {
      fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) }).catch(() => {});
    });
  },
  persistLocal: () => {
    try {
      localStorage.setItem('od.sessions', JSON.stringify(get().sessions.slice(0, 50)));
      const sid = get().sessionId;
      if (sid) localStorage.setItem('od.sessionId', sid);
      else localStorage.removeItem('od.sessionId');
    } catch { /* ignore */ }
  },
  loadSessions: async () => {
    const prune = (list: Session[]) => {
      // keep at most one empty draft (the newest) — kills stacked blanks
      let keptEmpty = false;
      return list.filter((s) => {
        if ((s.messages || []).length > 0) return true;
        if (!keptEmpty) { keptEmpty = true; return true; }
        return false;
      });
    };
    const adopt = (list: Session[]) => {
      const pruned = prune(list).map((s) => {
        // drop trailing empty assistant stubs left behind by abort/reload —
        // finalize always stamps durationSec, so emptiness alone is the signal
        const msgs = [...(s.messages || [])];
        while (msgs.length && msgs[msgs.length - 1].role === 'assistant' && !msgs[msgs.length - 1].content?.trim()) msgs.pop();
        return { ...s, messages: msgs };
      });
      // reopen where the user left off — saved id wins, else newest non-empty
      let saved: string | null = null;
      try { saved = localStorage.getItem('od.sessionId'); } catch { /* ignore */ }
      set((st) => ({
        sessions: pruned,
        sessionId: st.sessionId
          || (saved && pruned.some((s) => s.id === saved) ? saved : null)
          || pruned.find((s) => (s.messages || []).length > 0)?.id
          || null,
      }));
    };
    let server: Session[] = [];
    let local: Session[] = [];
    try {
      const r = await fetch('/api/sessions');
      const j = await r.json();
      if (Array.isArray(j.sessions)) server = j.sessions;
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem('od.sessions');
      if (raw) { const p = JSON.parse(raw); if (Array.isArray(p)) local = p; }
    } catch { /* ignore */ }
    // per session keep the newest copy — a reload mid-stream must not resurrect
    // the server's stale (pre-token) version over local partial output
    const byId = new Map<string, Session>();
    for (const s of [...server, ...local]) {
      if (!s || typeof s.id !== 'string') continue;
      const cur = byId.get(s.id);
      if (!cur || (s.updatedAt || 0) >= (cur.updatedAt || 0)) byId.set(s.id, s);
    }
    const merged = [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (merged.length) adopt(merged);
  },
  refreshModels: async () => {
    set({ modelsLoading: true });
    try {
      const [l, c, cfg] = await Promise.allSettled([
        providers.local.listModels(),
        providers.cloud.listModels(),
        fetch('/api/config').then((r) => r.json()).catch(() => ({})),
      ]);
      // config masks a saved key as '***' — any value means a key is stored
      const key = cfg.status === 'fulfilled' ? String(cfg.value?.cloudKey || '') : '';
      set({ hasCloudKey: !!key });
      // user-defined slash commands ride along with config
      try {
        const customs = cfg.status === 'fulfilled' && Array.isArray(cfg.value?.customCommands)
          ? cfg.value.customCommands.map((c: { name: string; prompt: string }) => ({ cmd: `/${c.name}`, desc: String(c.prompt).slice(0, 80), prompt: String(c.prompt) }))
          : [];
        set({ customCommands: customs });
      } catch { /* ignore */ }
      // starter models covered by free-account usage (per ollama.com pricing); everything else needs key/credits.
      // `:cloud`-suffixed entries are cloud aliases saved by `ollama run` — tier them by base name, never as local.
      const baseName = (n: string) => n.replace(/:cloud$|-cloud$/, '');
      const tierOf = (scope: ProviderScope, name: string): ModelTier =>
        scope === 'local' && !/:cloud$|-cloud$/.test(name)
          ? 'local'
          : FREE_CLOUD_MODELS.has(baseName(name)) ? 'free-cloud' : 'api-cloud';
      const models: ModelInfo[] = [
        ...(l.status === 'fulfilled' ? l.value.map((m) => ({ ...m, name: m.name, scope: 'local' as const, tier: tierOf('local', m.name) })) : []),
        ...(c.status === 'fulfilled' ? c.value.map((m) => ({ ...m, name: m.name, scope: 'cloud' as const, tier: tierOf('cloud', m.name) })) : []),
      ];
      // keyless: a resolved `:cloud` alias and its bare twin route to the same
      // daemon target — show only the alias, not both. (With a key they are
      // genuinely different routes: API vs daemon.)
      const aliasBases = new Set(
        models.filter((m) => /:cloud$|-cloud$/.test(m.name)).map((m) => baseName(m.name)),
      );
      const deduped = !key && aliasBases.size
        ? models.filter((m) => {
          if (m.scope !== 'cloud') return true;
          if (/:cloud$|-cloud$/.test(m.name)) return true;
          return !aliasBases.has(baseName(m.name));
        })
        : models;
      set({ models: deduped });
      // reconcile the saved selection with the fresh list
      const cur = get().model;
      const hit = cur ? deduped.find((m) => m.name === cur) : undefined;
      if (hit) {
        // scope can drift (alias moved local<->cloud) — adopt the truth
        if (hit.scope !== get().scope) {
          set({ scope: hit.scope });
          try { localStorage.setItem('od.scope', hit.scope); } catch { /* ignore */ }
        }
      } else if (deduped.length && cur) {
        // keyless dedupe hid the bare twin — remap onto the alias (same
        // daemon target) instead of silently flipping to another model
        const twin = deduped.find((m) => baseName(m.name) === baseName(cur) && /:cloud$|-cloud$/.test(m.name));
        if (twin) {
          set({ model: twin.name, scope: twin.scope });
          try { localStorage.setItem('od.model', twin.name); localStorage.setItem('od.scope', twin.scope); } catch { /* ignore */ }
        } else {
          set({ model: '' });
          try { localStorage.removeItem('od.model'); } catch { /* ignore */ }
        }
      }
      // auto-select the first local model when nothing is chosen yet
      if (deduped.length && !get().model) {
        const pick = deduped.find((m) => m.scope === 'local') || deduped[0];
        set({ model: pick.name, scope: pick.scope });
        try { localStorage.setItem('od.model', pick.name); localStorage.setItem('od.scope', pick.scope); } catch { /* ignore */ }
      }
    } catch { /* keep previous list */ }
    set({ modelsLoading: false });
  },
}));

export function setLastCommits(commits: CommitInfo[]) {
  useStore.setState((st) => ({ memory: { ...st.memory, lastCommits: commits } }));
}
