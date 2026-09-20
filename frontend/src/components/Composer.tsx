import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, Box, Check, FileText, Folder, GitBranch, History, Laptop, Paperclip, Plus, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { COMMANDS } from '../commands';
import { loadBinds, matchBind, shortcutText } from '../shortcuts';
import { msgAnim, popoverAnim } from '../motion';
import { useStore } from '../store';
import type { Attachment, ModelInfo, ModelTier, ReasoningLevel } from '../types';

const MAX_ATTS = 15;
const MAX_TEXT_CHARS = 12000;
const TEXT_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'c', 'h', 'hpp', 'cpp', 'cs', 'rb', 'php', 'swift', 'kt', 'css', 'scss', 'html', 'xml', 'json', 'md', 'markdown', 'txt', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'env', 'sh', 'bash', 'sql', 'vue', 'svelte', 'dockerfile', 'makefile', 'gitignore', 'log']);

export function fmtSize(b: number) {
  if (!b || b <= 0) return '0 B';
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} KB`;
  return `${b} B`;
}

function resizeImage(file: File, maxDim = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const sc = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * sc));
        c.height = Math.max(1, Math.round(img.height * sc));
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function RepoPills({ compact }: { compact?: boolean }) {
  const repo = useStore((s) => s.repo);
  const set = useStore((s) => s.set);
  const name = repo?.name;
  const branch = repo?.branch;
  const pill = 'flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2 py-1 text-[13px] text-[#3a3a3c]';
  if (!repo) {
    return (
      <div className="flex items-center gap-1.5">
        <button className={pill} onClick={() => set({ repoPickerOpen: true })}>
          <Folder size={13} className="text-[#8a8a90]" />Open directory…
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={pill}><Laptop size={13} className="shrink-0 text-[#8a8a90]" />Local</span>
      <button className={`${pill} min-w-0 max-w-[260px]`} onClick={() => set({ repoPickerOpen: true })} title={name || 'Change directory'}>
        <Folder size={13} className="shrink-0 text-[#8a8a90]" /><span className="truncate">{name}</span>
      </button>
      <span className={`${pill} min-w-0 max-w-[160px]`}><GitBranch size={13} className="shrink-0 text-[#8a8a90]" /><span className="truncate">{branch}</span></span>
      {!compact && <span className={pill}><Box size={13} className="text-[#8a8a90]" />worktree</span>}
      <button aria-label="Add context" className="rounded-lg border border-black/10 bg-white p-1.5 text-[#6e6e73] hover:bg-black/5"><Plus size={13} /></button>
    </div>
  );
}

const TIER_META: Record<ModelTier, { label: string; dot: string; cls: string; hint: string }> = {
  local: { label: 'Free·Local', dot: 'bg-[#1a9e54]', cls: 'bg-[#e6f6ec] text-[#1a7a45]', hint: 'Free · runs on this machine · nothing leaves your device (high privacy)' },
  'free-cloud': { label: 'Free·Cloud', dot: 'bg-[#0b66e4]', cls: 'bg-[#eef3fd] text-[#0b66e4]', hint: 'Starter model — free-account usage on ollama.com · prompts leave this machine (low privacy)' },
  'api-cloud': { label: 'API·Cloud', dot: 'bg-[#b26a00]', cls: 'bg-[#fbf3e4] text-[#9a6a0a]', hint: 'Needs API key / usage credits · runs on ollama.com · prompts leave this machine (low privacy)' },
};
export function TierBadge({ tier }: { tier?: ModelTier }) {
  const m = TIER_META[tier || 'local'];
  return (
    <span title={m.hint} className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

export function ModelSelector({ up = true }: { up?: boolean }) {
  const models = useStore((s) => s.models);
  const modelsLoading = useStore((s) => s.modelsLoading);
  const ollamaLocal = useStore((s) => s.ollamaLocal);
  const model = useStore((s) => s.model);
  const set = useStore((s) => s.set);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const list: ModelInfo[] = models.filter((m) =>
    m.name.toLowerCase().includes(q.toLowerCase()),
  );
  const local = list.filter((m) => (m.tier || 'local') === 'local');
  const freeCloud = list.filter((m) => m.tier === 'free-cloud');
  const apiCloud = list.filter((m) => m.tier === 'api-cloud' || (m.scope === 'cloud' && !m.tier));
  const flat = [...local, ...freeCloud, ...apiCloud];
  useEffect(() => {
    if (!open) return;
    document.querySelector('[data-mhi="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (matchBind(e, loadBinds().models)) { e.preventDefault(); setOpen((o) => !o); }
    };
    const ext = () => { setOpen(true); setHi(0); setQ(''); };
    window.addEventListener('keydown', fn);
    window.addEventListener('od:models', ext);
    return () => { window.removeEventListener('keydown', fn); window.removeEventListener('od:models', ext); };
  }, []);

  const pick = (m: ModelInfo) => {
    // API tier without a key: land in Settings instead of a dead chat
    if ((m.tier === 'api-cloud') && !useStore.getState().hasCloudKey) {
      set({ settingsOpen: true });
      useStore.getState().toast('API models need an Ollama API key — paste it in Settings to continue.');
      setOpen(false);
      return;
    }
    set({ model: m.name, scope: m.scope });
    try {
      localStorage.setItem('od.model', m.name);
      localStorage.setItem('od.scope', m.scope);
    } catch { /* ignore */ }
    setOpen(false);
  };
  const group = (title: string, items: ModelInfo[], off: number) => (
    items.length ? (
      <div>
        <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[#aeaeb2]">{title}</div>
        {items.map((m, i) => {
          const idx = off + i;
          return (
            <button
              key={m.scope + m.name}
              role="option"
              aria-selected={idx === hi}
              data-mhi={idx === hi ? '1' : undefined}
              onMouseEnter={() => setHi(idx)}
              onClick={() => pick(m)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] text-left text-[14px] ${idx === hi ? 'bg-black/[0.05]' : ''}`}
            >
              <span className="flex-1 truncate" title={m.name}>{m.name}</span>
              {m.default && <span className="rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[11px] text-[#6e6e73]">Default</span>}
              <TierBadge tier={m.tier} />
              {m.name === model && <Check size={15} className="text-[#0b66e4]" />}
              <span className="w-4 text-right text-[13px] text-[#aeaeb2]">{idx + 1}</span>
            </button>
          );
        })}
      </div>
    ) : null
  );

  return (
    <div ref={ref} className="relative">
      <button onClick={() => { setOpen((o) => !o); setHi(0); setQ(''); }} title={model || 'Pick a model'} className={`block max-w-[200px] truncate rounded-md px-1.5 py-0.5 text-[13px] ${model ? 'font-medium' : 'text-[#aeaeb2]'}`} aria-haspopup="listbox" aria-expanded={open}>
        {model || 'Select model'}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            {...popoverAnim}
            role="listbox"
            className={`absolute ${up ? 'bottom-8' : 'top-8'} right-0 z-50 w-[264px] rounded-xl border border-black/10 bg-white p-1.5 shadow-pop`}
          >
            <div className="px-2.5 pb-1 pt-1.5 text-[13px] font-medium text-[#8a8a90]">Models</div>
            <input
              autoFocus
              value={q}
              onChange={(e) => { setQ(e.target.value); setHi(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, flat.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
                if (e.key === 'Enter' && flat.length) pick(flat[Math.min(hi, flat.length - 1)]);
                if (e.key === 'Escape') setOpen(false);
              }}
              placeholder="Search models"
              className="mx-1 mb-1 w-[calc(100%-8px)] rounded-lg bg-black/[0.04] px-2.5 py-1.5 text-[13px] outline-none placeholder:text-[#aeaeb2]"
            />
            <div className="max-h-[280px] overflow-y-auto thin-scroll">
              {group('Local', local, 0)}
              {group('Free cloud', freeCloud, local.length)}
              {group('API cloud', apiCloud, local.length + freeCloud.length)}
              {!q && !!flat.length && (
                <div className="px-2.5 pb-1.5 pt-2 text-[11px] leading-relaxed text-[#8a8a90]">
                  Local stays on this machine. Free cloud = starter models on a free account. API cloud needs a key in Settings. Cloud prompts leave this machine.
                </div>
              )}
              {!flat.length && (
                <div className="px-3 py-3 text-[13px] text-[#8a8a90]">
                  {q ? 'No models match.' : modelsLoading ? 'Discovering models…' : !ollamaLocal.checked ? 'Checking Ollama…' : !ollamaLocal.ok ? 'Offline — start `ollama serve` for local models. Cloud models need network.' : 'No models found. Pull one (`ollama pull <name>`) or configure cloud access.'}
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => useStore.getState().refreshModels()} className="rounded-lg border border-black/10 px-2 py-1 text-[12px] hover:bg-black/[0.03]">Refresh</button>
                    <button onClick={() => { setOpen(false); set({ settingsOpen: true }); }} className="rounded-lg border border-black/10 px-2 py-1 text-[12px] hover:bg-black/[0.03]">Settings</button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ReasoningSelector() {
  const reasoning = useStore((s) => s.reasoning);
  const set = useStore((s) => s.set);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const levels: ReasoningLevel[] = ['Low', 'Medium', 'High'];
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', fn);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fn); window.removeEventListener('keydown', esc); };
  }, [open ]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label="Reasoning level" className="rounded-md px-1.5 py-0.5 text-[13px] text-[#3a3a3c] hover:bg-black/5">{reasoning}</button>
      <AnimatePresence>
        {open && (
          <motion.div {...popoverAnim} className="absolute bottom-8 right-0 z-50 w-[150px] rounded-xl border border-black/10 bg-white p-1.5 shadow-pop">
            {levels.map((l) => (
              <button key={l} onClick={() => { set({ reasoning: l }); try { localStorage.setItem('od.reasoning', l); } catch {} setOpen(false); }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-[7px] text-left text-[14px] hover:bg-black/[0.05]">
                <span>{l}</span>
                {l === reasoning && <Check size={15} className="text-[#0b66e4]" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DiffBar({ onPR }: { onPR: () => void }) {
  const repo = useStore((s) => s.repo);
  if (!repo) return null;
  const m = repo.diffStat.match(/(\d+)\s+insertion/)?.[1];
  const d = repo.diffStat.match(/(\d+)\s+deletion/)?.[1];
  const fmt = (n: string) => Number(n).toLocaleString('en-US');
  return (
    <motion.div {...msgAnim} className="mb-2 flex items-center gap-2 rounded-lg bg-[#f4f4f5] px-3 py-2 text-[13px]">
      <span className="flex-1" />
      {m || d ? (
        <span className="rounded-md border border-black/10 bg-white px-1.5 py-0.5 font-mono text-[12px]">
          <span className="text-[#1a9e54]">+{m ? fmt(m) : '0'}</span> <span className="text-[#d43a3a]">-{d ? fmt(d) : '0'}</span>
        </span>
      ) : (
        <span className="text-[12px] text-[#8a8a90]">{repo.dirty ? 'Uncommitted changes' : 'Working tree clean'}</span>
      )}
      <button onClick={onPR} disabled={!repo.dirty && !repo.diffStat} className="rounded-md border border-black/10 bg-white px-2 py-0.5 text-[13px] hover:bg-black/[0.03] disabled:opacity-40">
        Create PR ▾
      </button>
    </motion.div>
  );
}

const SPIDER_ROWS = [
  'X............X',
  '.X..........X.',
  '..X........X..',
  '...XXXXXXXX...',
  '..XXXXXXXXXX..',
  '...XXXXXXXX...',
  '....XXXXXX....',
  '.....X..X.....',
];

export function SpiderGlyph({ scale = 2 }: { scale?: number }) {
  return (
    <svg width={14 * scale} height={8 * scale} style={{ display: 'block' }} aria-hidden>
      {SPIDER_ROWS.flatMap((row, y) =>
        row.split('').flatMap((c, x) =>
          c === 'X' ? [<rect key={`${x}-${y}`} x={x * scale} y={y * scale} width={scale} height={scale} fill={(x + y) % 3 === 0 ? '#000' : '#1c1c1e'} />] : [],
        ),
      )}
    </svg>
  );
}

export function Spider({ energy, working }: { energy: number; working: boolean }) {
  // black pixel spider hanging off the textbox edge.
  // gentle typing -> sways; fast typing or background work -> spins in place.
  const reduce = useReducedMotion();
  const typing = energy > 0.4;
  const spin = working || energy > 7;
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute -left-[11px] top-1/2"
      style={{ transformOrigin: '50% -26px' }}
      initial={false}
      animate={reduce ? { rotate: 0 } : typing && !spin ? { rotate: [-10, 9, -6, 4, 0] } : { rotate: 0 }}
      transition={reduce ? { duration: 0 } : typing && !spin ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.25 }}
    >
      <div className="mx-auto h-[26px] w-px bg-black/40" />
      <motion.div
        initial={false}
        animate={reduce ? { rotate: 0 } : spin ? { rotate: 360 } : { rotate: 0 }}
        transition={reduce ? { duration: 0 } : spin ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : { duration: 0.25 }}
        style={{ transformOrigin: '50% 50%' }}
      >
        <SpiderGlyph scale={2} />
      </motion.div>
    </motion.div>
  );
}

export function ModeSwitch() {
  const buildMode = useStore((s) => s.buildMode);
  const set = useStore((s) => s.set);
  const flip = (v: boolean) => {
    set({ buildMode: v });
    try { localStorage.setItem('od.buildMode', v ? 'build' : 'chat'); } catch { /* ignore */ }
  };
  const btn = 'rounded-md px-2.5 py-1 text-[12px] font-medium capitalize transition-colors';
  return (
    <div className="mr-1 flex items-center gap-0.5 rounded-lg border border-black/10 bg-black/[0.03] p-0.5" role="group" aria-label="Chat or Build mode">
      <button onClick={() => flip(false)} aria-pressed={!buildMode} title="Chat — answers and explanations only" className={`${btn} ${!buildMode ? 'bg-white text-black shadow-sm' : 'text-[#8a8a90] hover:text-black'}`}>Chat</button>
      <button onClick={() => flip(true)} aria-pressed={buildMode} title="Build — full files and apply steps" className={`${btn} ${buildMode ? 'bg-black text-white shadow-sm' : 'text-[#8a8a90] hover:text-black'}`}>Build</button>
    </div>
  );
}

export function Composer({ sid, onSend, onPR, onStop, placeholder }: { sid?: string; onSend: (text: string, atts?: Attachment[], opts?: { background?: boolean }) => void; onPR: () => void; onStop: (sid?: string) => void; placeholder?: string }) {
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [bg, setBg] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cmdHi, setCmdHi] = useState(0);
  const [focused, setFocused] = useState(false);
  const [accept, setAccept] = useState(() => {
    try { return localStorage.getItem('od.acceptEdits') !== 'review'; } catch { return true; }
  });
  const streaming = !!useStore((s) => (sid ? s.streaming[sid] : false));
  const buildMode = useStore((s) => s.buildMode);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const canSend = (text.trim().length > 0 || atts.length > 0) && !streaming;
  // typing speed (chars/sec over a sliding window) drives the spider's energy
  const [energy, setEnergy] = useState(0);
  const keysRef = useRef<number[]>([]);
  const pushKey = () => {
    const now = Date.now();
    keysRef.current = [...keysRef.current.filter((t) => now - t < 1200), now].slice(-24);
    setEnergy(keysRef.current.length / 1.2);
  };
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      keysRef.current = keysRef.current.filter((x) => now - x < 1200);
      const v = keysRef.current.length / 1.2;
      setEnergy((e) => (Math.abs(e - v) > 0.05 ? v : e));
    }, 400);
    return () => clearInterval(t);
  }, []);

  const customs = useStore((s) => s.customCommands);
  const lastTok = (text.split(' ').pop() || '').toLowerCase();
  const allCommands = [...COMMANDS, ...customs];
  const filtered = allCommands.filter((c) => c.cmd.toLowerCase().startsWith(lastTok) || c.desc.toLowerCase().includes(lastTok));
  // filter can shrink under the highlight — clamp, and keep it in view
  useEffect(() => { setCmdHi((h) => Math.min(h, Math.max(filtered.length - 1, 0))); }, [filtered.length]);
  useEffect(() => {
    if (!menuOpen) return;
    document.querySelector('[data-cmdhi="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [cmdHi, menuOpen]);

  const send = () => {
    const t = text.trim();
    if ((!t && !atts.length) || streaming) return;
    if (t === '/settings') { useStore.getState().set({ settingsOpen: true }); setText(''); return; }
    onSend(t, atts, bg ? { background: true } : undefined);
    setText('');
    setAtts([]);
    setMenuOpen(false);
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  const addFiles = async (list: FileList | null) => {
    if (!list || !list.length) return;
    const room = MAX_ATTS - atts.length;
    if (room <= 0) { useStore.getState().toast(`Max ${MAX_ATTS} files at a time`); return; }
    const picked = [...list].slice(0, room);
    if (list.length > room) useStore.getState().toast(`Only first ${room} files kept (max ${MAX_ATTS})`);
    const next: Attachment[] = [];
    for (const f of picked) {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      try {
        if (f.type.startsWith('image/')) {
          const image = await resizeImage(f);
          next.push({ id, name: f.name, size: f.size, mime: f.type, kind: 'image', image });
        } else if (f.type.startsWith('text/') || TEXT_EXTS.has(ext) || (!f.type && f.size < 512 * 1024)) {
          const raw = await f.text();
          next.push({ id, name: f.name, size: f.size, mime: f.type || 'text/plain', kind: 'text', text: raw.slice(0, MAX_TEXT_CHARS) });
        } else {
          next.push({ id, name: f.name, size: f.size, mime: f.type || 'file', kind: 'file' });
        }
      } catch {
        useStore.getState().toast(`Could not read ${f.name}`);
      }
    }
    if (next.length) setAtts((a) => [...a, ...next].slice(0, MAX_ATTS));
  };

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      // never hijack keys typed inside other inputs (settings, repo picker, rename…)
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || (t.tagName === 'TEXTAREA' && t !== taRef.current))) return;
      const binds = loadBinds();
      if (matchBind(e, binds.send)) { e.preventDefault(); send(); }
      if (matchBind(e, binds.palette)) { e.preventDefault(); useStore.getState().set({ paletteOpen: true }); }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, streaming, atts]);

  return (
    <div>
      <DiffBar onPR={onPR} />
      <div className="relative">
        <Spider energy={energy} working={streaming} />
        <AnimatePresence>
          {menuOpen && text.startsWith('/') && (
            <motion.div
              {...popoverAnim}
              className="absolute bottom-[52px] left-0 z-50 max-h-[300px] w-[300px] overflow-y-auto thin-scroll rounded-xl border border-black/10 bg-white p-1.5 shadow-pop"
            >
              {filtered.map((c, i) => (
                <button
                  key={c.cmd}
                  data-cmdhi={i === cmdHi ? '1' : undefined}
                  onMouseEnter={() => setCmdHi(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setText(c.cmd + ' '); setMenuOpen(false); taRef.current?.focus(); }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left ${i === cmdHi ? 'bg-black/[0.05]' : ''}`}
                >
                  <span className="font-mono text-[13px] font-medium">{c.cmd}</span>
                  <span className="truncate text-[12px] text-[#8a8a90]">{c.desc}</span>
                </button>
              ))}
              {!filtered.length && <div className="px-3 py-2 text-[13px] text-[#8a8a90]">No commands match.</div>}
            </motion.div>
          )}
        </AnimatePresence>
        <div className={`rounded-xl border bg-white transition-all duration-180 ${focused ? 'border-black/25 shadow-[0_2px_12px_rgba(0,0,0,0.06)]' : 'border-black/20'}`}>
          {!!atts.length && (
            <div className="thin-scroll flex gap-1.5 overflow-x-auto px-3 pt-2.5">
              {atts.map((a) => (
                <span key={a.id} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-black/10 bg-black/[0.03] py-1 pl-1 pr-1.5">
                  {a.kind === 'image' && a.image
                    ? <img src={a.image} alt={a.name} className="h-8 w-8 rounded-md object-cover" />
                    : <FileText size={15} className="ml-0.5 shrink-0 text-[#6e6e73]" />}
                  <span className="max-w-[140px]">
                    <span className="block truncate text-[12px] font-medium leading-tight" title={a.name}>{a.name}</span>
                    <span className="block text-[11px] leading-tight text-[#8a8a90]">{fmtSize(a.size)}</span>
                  </span>
                  <button onClick={() => setAtts((x) => x.filter((y) => y.id !== a.id))} aria-label={`Remove ${a.name}`} className="rounded p-0.5 text-[#8a8a90] hover:bg-black/10"><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-start">
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            <button
              onClick={() => fileRef.current?.click()}
              aria-label="Attach files" title="Attach files (up to 15)"
              className="ml-1.5 mt-2 shrink-0 rounded-lg p-1.5 text-[#6e6e73] hover:bg-black/5"
            ><Paperclip size={16} /></button>
            <textarea
            ref={taRef}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              pushKey();
              setMenuOpen(e.target.value.startsWith('/'));
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); setMenuOpen(false); }}
            onKeyDown={(e) => {
              if (menuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                setCmdHi((h) => (e.key === 'ArrowDown' ? Math.min(h + 1, filtered.length - 1) : Math.max(h - 1, 0)));
              } else if (menuOpen && e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                // exact command typed ("/diff") → run at once, no second Enter.
                // partial ("/di") → complete first so args can still be typed.
                if (allCommands.some((c) => c.cmd === text.trim())) { setMenuOpen(false); send(); }
                else if (filtered[cmdHi]) { setText(filtered[cmdHi].cmd + ' '); setMenuOpen(false); }
                else { setMenuOpen(false); send(); }
              } else if (e.key === 'Enter' && !e.shiftKey && !menuOpen) {
                e.preventDefault();
                send();
              } else if (e.key === 'Escape') {
                if (streaming) onStop(sid);
                else setMenuOpen(false);
              }
            }}
            placeholder={placeholder || 'Type / for commands'}
            aria-label="Message composer"
            className="w-full min-w-0 flex-1 resize-none bg-transparent py-3 pl-1 pr-3.5 text-[14px] outline-none placeholder:text-[#aeaeb2]"
          />
          </div>
          <div className="flex items-center justify-end gap-1.5 px-3 pb-2">
            {!streaming && (
              <button onClick={() => setBg((v) => !v)} aria-pressed={bg} aria-label="Run in background" title={bg ? 'Background run ON — answer lands in the sidebar' : 'Run in background'}
                className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium transition-all ${bg ? 'bg-[#0b66e4] text-white' : 'text-[#8a8a90] hover:bg-black/[0.06] hover:text-black'}`}>
                <History size={13} />{bg ? 'Background' : ''}
              </button>
            )}            {streaming ? (
              <button onClick={() => onStop(sid)} aria-label="Stop generation" title="Stop (Esc)"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-black text-white transition-transform hover:scale-105 active:scale-95">
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button onClick={send} disabled={!canSend} aria-label="Send message" title={canSend ? `Send (${shortcutText.send})` : 'Type a message first'}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-all ${canSend ? 'bg-black text-white hover:scale-105 hover:bg-black/80 active:scale-95' : 'cursor-not-allowed bg-black/[0.07] text-[#b9b9be]'}`}>
                <ArrowUp size={15} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center text-[13px]">
        <ModeSwitch />
        <button
          onClick={() => {
            if (!buildMode) { useStore.getState().toast('Edits live in Build mode — flip the switch first'); return; }
            const v = !accept;
            setAccept(v);
            try { localStorage.setItem('od.acceptEdits', v ? 'accept' : 'review'); } catch { /* ignore */ }
          }}
          title={buildMode ? 'Toggle whether the agent applies edits directly or shows them for review' : 'Available in Build mode'}
          className={`rounded-md px-1 py-0.5 font-medium hover:bg-black/5 ${buildMode ? '' : 'opacity-40'}`}
        >
          {accept ? 'Accept edits' : 'Review edits'}
        </button>
        <span className="flex-1" />
        <ModelSelector />
        <ReasoningSelector />
        <span className={`ml-2 h-2.5 w-2.5 rounded-full border ${streaming ? 'animate-spin border-[#0b66e4] border-t-transparent' : 'border-black/20'}`} aria-label={streaming ? 'generating' : 'idle'} />
      </div>
    </div>
  );
}
