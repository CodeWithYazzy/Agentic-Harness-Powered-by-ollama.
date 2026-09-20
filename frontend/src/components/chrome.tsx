import { AnimatePresence, motion } from 'framer-motion';
import { Copy, MoreVertical, PanelLeft, Play, Settings as SettingsIcon, Terminal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { popoverAnim, windowAnim } from '../motion';
import { shortcutText } from '../shortcuts';
import { useStore } from '../store';
import { SpiderGlyph } from './Composer';

export function Wallpaper({ children, wide, maximized }: { children: ReactNode; wide?: boolean; maximized?: boolean }) {
  return (
    <div
      className={`flex h-screen w-full items-center justify-center overflow-hidden ${maximized ? 'p-0' : 'p-4 sm:p-6'}`}
      style={{
        background:
          'radial-gradient(120% 60% at 85% 0%, #8fd0f5 0%, rgba(143,208,245,0) 55%), radial-gradient(100% 55% at 8% 100%, #0b54c7 0%, rgba(11,84,199,0) 60%), linear-gradient(180deg, #79c3ef 0%, #cfd4d8 34%, #ece7db 46%, #9fd0ef 62%, #2f7fe0 82%, #0e3fae 100%)',
      }}
    >
      {/* soft wave bands to echo reference wallpaper */}
      <div className="pointer-events-none fixed inset-0" style={{
        background:
          'radial-gradient(90% 34% at 12% 62%, rgba(255,255,255,.35) 0%, rgba(255,255,255,0) 60%), radial-gradient(70% 26% at 88% 70%, rgba(255,255,255,.28) 0%, rgba(255,255,255,0) 60%)',
      }} />
      <div className={`relative flex max-h-full min-h-0 w-full flex-col ${maximized ? 'max-w-none' : wide ? 'max-w-[1620px]' : 'max-w-[1060px]'}`}>{children}</div>
    </div>
  );
}

export function DesktopWindow({ title, titlePill, children, sidebar, sidebarOpen, onToggleSidebar }: {
  title: string; titlePill?: string; children: ReactNode; sidebar?: ReactNode; sidebarOpen?: boolean; onToggleSidebar?: () => void;
}) {
  const route = useStore((s) => s.route);
  const maximized = useStore((s) => s.maximized);
  const st = useStore.getState();
  return (
    <motion.div
      {...windowAnim}
      className={`flex w-full shrink-0 flex-col overflow-hidden border border-white/60 bg-[#f8f8f9]/[.97] shadow-win backdrop-blur-xl transition-[height,border-radius] ${maximized ? 'h-screen max-h-none rounded-none border-0' : 'h-[calc(100vh-7rem)] max-h-[900px] min-h-[430px] rounded-[18px]'}`}
    >
      <div className="relative flex h-12 shrink-0 items-center gap-3 border-b border-black/[0.04] px-4">
        <button
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          className="rounded-md p-1.5 text-[#6e6e73] hover:bg-black/5"
        >
          <PanelLeft size={15} />
        </button>
        <div className="flex-1" />
        <div className="absolute left-1/2 top-1/2 flex max-w-[50%] -translate-x-1/2 -translate-y-1/2 items-center gap-2 text-[14px]" title={title || undefined}>
          <SpiderGlyph scale={1} />
          <span className="truncate font-medium text-[#1c1c1e]">YK-Harness</span>
          {titlePill && (
            <span className="max-w-[140px] truncate rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[12px] text-[#6e6e73]">{titlePill}</span>
          )}
        </div>
        <div className="relative flex shrink-0 items-center gap-0.5 text-[#6e6e73]">
          <button
            onClick={() => useStore.getState().toggleOverview()}
            title={route === '/' ? 'Back to session' : 'Go to Overview'}
            className={`mr-1 rounded-md border px-2 py-1 text-[13px] ${route === '/' ? 'border-black/25 bg-black/[0.06] font-semibold text-black' : 'border-black/15 hover:bg-black/5'}`}
          >
            Overview
          </button>
          <button aria-label="Command palette" title={`Command palette (${shortcutText.palette})`} onClick={() => useStore.getState().set({ paletteOpen: true })} className="rounded-md p-1.5 hover:bg-black/5"><Terminal size={15} /></button>
          <button aria-label="Copy transcript" title="Copy session transcript" onClick={copyTranscript} className="rounded-md p-1.5 hover:bg-black/5"><Copy size={15} /></button>
          <button aria-label="Resend last message" title="Resend last message" onClick={() => window.dispatchEvent(new CustomEvent('od:resend'))} className="rounded-md p-1.5 hover:bg-black/5"><Play size={15} /></button>
          <button aria-label="Settings" title="Settings" onClick={() => useStore.getState().set({ settingsOpen: true })} className="rounded-md p-1.5 hover:bg-black/5"><SettingsIcon size={15} /></button>
          <TitleMenuButton />
          <div className="group ml-1.5 flex items-center gap-1 border-l border-black/[0.08] pl-2.5">
            <button
              onClick={() => st.set({ minimized: true })}
              aria-label="Minimize" title="Minimize (genie)"
              className="flex h-5 w-5 items-center justify-center"
            ><span className="flex h-3 w-3 items-center justify-center rounded-full bg-[#febc2e] text-[10px] font-bold text-black/50"><span className="hidden leading-none group-hover:block">–</span></span></button>
            <button
              onClick={() => st.set({ maximized: !st.maximized })}
              aria-label="Maximize" title={maximized ? 'Restore window' : 'Maximize'}
              className="flex h-5 w-5 items-center justify-center"
            ><span className="flex h-3 w-3 items-center justify-center rounded-full bg-[#28c840] text-[8px] font-bold text-black/50"><span className="hidden leading-none group-hover:block">+</span></span></button>
            <button
              onClick={() => st.toast('Runs in your browser tab — close the tab to quit')}
              aria-label="Close" title="Close"
              className="flex h-5 w-5 items-center justify-center"
            ><span className="flex h-3 w-3 items-center justify-center rounded-full bg-[#ff5f57] text-[9px] font-bold text-black/50 shadow-inner"><span className="hidden leading-none group-hover:block">×</span></span></button>
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {sidebar && (
          <motion.aside
            initial={false}
            animate={{ width: sidebarOpen ? 248 : 0, opacity: sidebarOpen ? 1 : 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`shrink-0 overflow-hidden ${sidebarOpen ? 'border-r border-black/[0.06]' : ''}`}
          >
            <div className="h-full w-[248px]">{sidebar}</div>
          </motion.aside>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </motion.div>
  );
}

async function copyTranscript() {
  const st = useStore.getState();
  const s = st.activeSession();
  if (!s || !s.messages.length) { st.toast('Nothing to copy'); return; }
  const clean = (t: string) => t.replace(/__COMMITS__:[^\n]*\n?/, '').replace(/__TOOL__:[^:]+:/g, '').trim();
  const text = s.messages.map((m) => {
    const extra = m.atts?.length ? ` [Attached: ${m.atts.map((x) => x.name).join(', ')}]` : '';
    return `${m.role === 'user' ? 'You' : 'Assistant'}: ${clean(m.content)}${extra}`;
  }).join('\n\n');
  try { await navigator.clipboard.writeText(text); st.toast('Transcript copied'); }
  catch { st.toast('Copy failed'); }
}

function TitleMenuButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', fn);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fn); window.removeEventListener('keydown', esc); };
  }, [open ]);
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] text-[#1c1c1e] hover:bg-black/[0.05]';
  const go = (fn: () => void) => { fn(); setOpen(false); };
  const st = useStore.getState();
  return (
    <div ref={ref} className="relative">
      <button aria-label="Session menu" title="Session menu" onClick={() => setOpen((o) => !o)} className="rounded-md p-1.5 hover:bg-black/5"><MoreVertical size={15} /></button>
      <AnimatePresence>
        {open && (
          <motion.div
            {...popoverAnim}
            className="absolute right-0 top-9 z-50 w-[212px] rounded-xl border border-black/10 bg-white p-1.5 text-[#1c1c1e] shadow-pop"
          >
            <button className={item} onClick={() => go(() => { const s = st.activeSession(); if (s) st.duplicateSession(s.id); else st.toast('No active session'); })}>Duplicate session</button>
            <button className={item} onClick={() => go(() => { const s = st.activeSession(); if (s) st.deleteSession(s.id); else st.toast('No active session'); })}>Delete session</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // minute-precision display — wake once per minute, not 60 renders/min
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      t = setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
    };
    t = setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
    return () => clearTimeout(t);
  }, []);
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <div className="pointer-events-none fixed inset-0 z-[1] flex items-center justify-center" aria-label={`${date} ${time}`}>
      <div className="text-center">
        <div className="text-[96px] font-bold tabular-nums text-black/10" style={{ lineHeight: 1 }}>{time}</div>
        <div className="mt-2 text-[24px] font-medium tabular-nums text-black/10">{date}</div>
      </div>
    </div>
  );
}

function DockIcon({ x, label, active, running, onClick, children }: {
  x: number | null; label: string; active: boolean; running: boolean; onClick: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  let scale = 1;
  let lift = 0;
  if (x !== null && ref.current) {
    const r = ref.current.getBoundingClientRect();
    const d = Math.abs(x - (r.left + r.width / 2));
    const f = Math.max(0, 1 - d / 110);
    scale = 1 + f * f * 0.55;
    lift = f * f * -14;
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        ref={ref}
        onClick={onClick}
        title={label}
        aria-label={label}
        style={{ transform: `scale(${scale}) translateY(${lift}px)` }}
        className={`flex h-12 w-12 items-center justify-center rounded-2xl border shadow-win backdrop-blur-xl transition-[border-radius] ${active ? 'border-white/60 bg-white/85' : 'border-white/40 bg-white/55'}`}
      >
        {children}
      </button>
      <span className={`h-1 w-1 rounded-full ${running ? 'bg-white/90' : 'bg-transparent'}`} />
    </div>
  );
}

export function Dock() {
  const minimized = useStore((s) => s.minimized);
  const maximized = useStore((s) => s.maximized);
  const [mx, setMx] = useState<number | null>(null);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const st = useStore.getState();
  void maximized;
  return (
    <div
      onMouseMove={(e) => {
        // throttle magnification to one state update per frame (no layout thrash)
        const x = e.clientX;
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(() => setMx(x));
      }}
      onMouseLeave={() => { cancelAnimationFrame(raf.current); setMx(null); }}
      className="fixed bottom-4 left-1/2 z-[90] flex -translate-x-1/2 items-end gap-2.5 rounded-3xl border border-white/40 bg-white/25 px-3.5 pb-2 pt-2.5 shadow-win backdrop-blur-2xl"
    >
      <DockIcon
        x={mx} label={minimized ? 'Restore YK-Harness' : 'Minimize YK-Harness'}
        active={!minimized} running
        onClick={() => st.set({ minimized: !st.minimized })}
      >
        <SpiderGlyph scale={3} />
      </DockIcon>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const minimized = useStore((s) => s.minimized);
  return (
    <div role="status" aria-live="polite" className={`pointer-events-none fixed left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2 ${minimized ? 'bottom-24' : 'bottom-6'}`}>
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            {...popoverAnim}
            className="pointer-events-auto flex max-w-[480px] items-center gap-3 rounded-full border border-black/10 bg-[#1c1c1e] py-1.5 pl-4 pr-2 text-[13px] text-white shadow-pop"
          >
            <span className="break-words">{t.text}</span>
            {t.action && (
              <button
                onClick={() => { t.action!.fn(); useStore.getState().set({ toasts: useStore.getState().toasts.filter((x) => x.id !== t.id) }); }}
                className="rounded-full bg-white px-2.5 py-0.5 text-[12px] font-semibold text-black hover:bg-white/85"
              >{t.action.label}</button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
