import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Asterisk, ChevronRight, Copy, FileText, MoreHorizontal, RefreshCw, Repeat, Rewind, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fmtSize } from './Composer';
import { msgAnim, popoverAnim } from '../motion';
import type { CommitInfo, Message } from '../types';

export function ThinkingDots({ line }: { line: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex items-center gap-2 text-[13px] text-[#6e6e73]">
      <HeartbeatMark size={15} />
      <span>{line}</span>
      <span className="flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1 w-1 rounded-full bg-[#aeaeb2]"
            animate={reduce ? { opacity: 1 } : { opacity: [0.25, 1, 0.25] }}
            transition={reduce ? { duration: 0 } : { duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
          />
        ))}
      </span>
    </div>
  );
}

export function HeartbeatMark({ size = 15 }: { size?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      className="inline-flex"
      initial={false}
      animate={reduce ? { scale: 1 } : { scale: [1, 1.45, 1, 1.3, 1] }}
      transition={reduce ? { duration: 0 } : { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
    >
      <Asterisk size={size} className="text-[#1c1c1e]" />
    </motion.span>
  );
}

export function CommitList({ commits, onOpen }: { commits: CommitInfo[]; onOpen: (c: CommitInfo) => void }) {
  return (
    <ul className="mt-1.5 space-y-1.5">
      {commits.map((c) => (
        <li key={c.hash} className="flex items-baseline gap-2 text-[14px] leading-relaxed">
          <span className="text-[#1c1c1e]">•</span>
          <button onClick={() => onOpen(c)} className="shrink-0 rounded bg-[#f1f1f2] px-1 font-mono text-[13px] hover:bg-black/10" title={c.hash}>
            {c.short}
          </button>
          <span className="text-[#1c1c1e]">{renderSubject(c.subject)}</span>
        </li>
      ))}
    </ul>
  );
}

function renderSubject(subject: string) {
  const m = subject.match(/\(#(\d+)\)\s*$/);
  if (!m) return subject;
  return (
    <>
      {subject.slice(0, m.index)}
      <span className="text-[#0b66e4]">(#{m[1]})</span>
    </>
  );
}

export function ToolHeader({ label }: { label: string }) {
  // display-only header (no action) — plain styling, not a fake control
  return (
    <div className="flex items-center gap-0.5 text-[14px] text-[#6e6e73]">
      <span>{label}</span>
      <ChevronRight size={15} />
    </div>
  );
}

export function UserBubble({ m }: { m: Message }) {
  return (
    <motion.div {...msgAnim} className="flex justify-end">
      <div className="max-w-[80%]">
        {!!m.atts?.length && (
          <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
            {m.atts.map((a, i) => (
              <span key={i} className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2 py-1 text-[12px]">
                <FileText size={13} className="shrink-0 text-[#6e6e73]" />
                <span className="max-w-[160px] truncate font-medium" title={a.name}>{a.name}</span>
                <span className="shrink-0 text-[#8a8a90]">{fmtSize(a.size)}</span>
              </span>
            ))}
          </div>
        )}
        {!!m.content && <div className="break-words rounded-xl bg-[#f0f0f1] px-3 py-1.5 text-[14px]">{m.content}</div>}
      </div>
    </motion.div>
  );
}

export type MenuAction = 'copy' | 'resend' | 'regenerate' | 'rewind' | 'delete';

const ACTION_META: Record<MenuAction, { label: string; danger?: boolean }> = {
  copy: { label: 'Copy' },
  resend: { label: 'Resend' },
  regenerate: { label: 'Regenerate' },
  rewind: { label: 'Rewind to here', danger: true },
  delete: { label: 'Delete', danger: true },
};

function ActionIcon({ action }: { action: MenuAction }) {
  const cls = 'text-[#6e6e73]';
  if (action === 'copy') return <Copy size={14} className={cls} />;
  if (action === 'resend') return <Repeat size={14} className={cls} />;
  if (action === 'regenerate') return <RefreshCw size={14} className={cls} />;
  if (action === 'rewind') return <Rewind size={14} className={cls} />;
  return <Trash2 size={14} className="text-[#d43a3a]" />;
}

export function MessageMenu({ actions, align, flipUp, onAction }: {
  actions: MenuAction[]; align: 'left' | 'right'; flipUp?: boolean; onAction: (a: MenuAction) => void;
}) {
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
  return (
    <div ref={ref} className={`relative ${align === 'right' ? 'flex justify-end' : 'flex justify-start'}`}>
      <button
        aria-label="Message actions"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1 text-[#aeaeb2] opacity-0 transition-opacity hover:bg-black/[0.06] hover:text-black group-hover:opacity-100"
      ><MoreHorizontal size={15} /></button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} onContextMenu={() => setOpen(false)} />
            <motion.div
              {...popoverAnim}
              role="menu"
              className={`absolute z-30 w-[168px] rounded-xl border border-black/10 bg-white p-1.5 shadow-pop ${flipUp ? 'bottom-7' : 'top-7'} ${align === 'right' ? 'right-0' : 'left-0'}`}
            >
            {actions.map((a) => (
              <button
                key={a}
                onClick={() => { setOpen(false); onAction(a); }}
                className="mb-0.5 flex w-full items-center gap-2.5 rounded-lg border border-black/[0.06] bg-white px-2.5 py-2 text-left text-[13px] last:mb-0 hover:bg-black/[0.04]"
              >
                <ActionIcon action={a} />
                <span className={ACTION_META[a].danger ? 'text-[#d43a3a]' : ''}>{ACTION_META[a].label}</span>
              </button>
            ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AssistantBlock({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <motion.div {...msgAnim}>
      {label && <ToolHeader label={label} />}
      <div className="mt-1 text-[14px] leading-relaxed">{children}</div>
    </motion.div>
  );
}

// Minimal markdown renderer (no deps, no dangerouslySetInnerHTML):
// fenced code, headings, quotes, lists + inline code/bold/italic/links.
const FILE_RE = '[\\w\\-./]+\\.(go|ts|tsx|js|jsx|py|rs|md|json|yaml|yml|toml|css|html)';
function mdInline(text: string, kp: string, onFile?: (f: string) => void): ReactNode[] {
  const re = new RegExp(`(\`[^\`\\n]+\`|\\*\\*[^*\\n]+\\*\\*|\\*[^*\\n]+\\*|\\[[^\\]]+\\]\\([^\\)\\s]+\\))` + (onFile ? `|(${FILE_RE})` : ''), 'g');
  return text.split(re).filter((p) => p !== '' && p !== undefined).map((p, i) => {
    const k = `${kp}-${i}`;
    if (/^`[^`\n]+`$/.test(p)) return <code key={k} className="rounded bg-black/[0.06] px-1 font-mono text-[13px]">{p.slice(1, -1)}</code>;
    if (/^\*\*[^*\n]+\*\*$/.test(p)) return <strong key={k} className="font-semibold">{p.slice(2, -2)}</strong>;
    if (/^\*[^*\n]+\*$/.test(p)) return <em key={k}>{p.slice(1, -1)}</em>;
    const lm = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    // S9: link targets are model/tool controlled — only http(s)/mailto become
    // anchors; javascript:/data:/vbscript: render as inert text, never <a href>.
    if (lm) {
      if (/^(https?:\/\/|mailto:)/i.test(lm[2])) {
        return <a key={k} href={lm[2]} target="_blank" rel="noreferrer" className="text-[#0b66e4] underline">{lm[1]}</a>;
      }
      return <span key={k}>{lm[1]} ({lm[2]})</span>;
    }
    if (onFile && new RegExp(`^${FILE_RE}$`).test(p)) {
      return <button key={k} onClick={() => onFile(p)} title={`Open ${p}`} className="font-mono text-[13px] text-[#0b66e4] underline">{p}</button>;
    }
    return <span key={k}>{p}</span>;
  });
}

export function Markdown({ text, onFile }: { text: string; onFile?: (f: string) => void }) {
  const out: ReactNode[] = [];
  let key = 0;
  for (const seg of text.split(/(```[\s\S]*?(?:```|$))/g)) {
    if (!seg) continue;
    if (seg.startsWith('```')) {
      const inner = seg.replace(/^```[^\n]*\n?/, '').replace(/```\s*$/, '').replace(/\n$/, '');
      out.push(<pre key={key++} className="thin-scroll mt-2 overflow-x-auto rounded-lg bg-[#f4f4f5] p-2.5 font-mono text-[13px] leading-relaxed">{inner}</pre>);
      continue;
    }
    const lines = seg.split('\n');
    let i = 0;
    let para: string[] = [];
    const flush = () => {
      if (!para.length) return;
      const k = key++;
      out.push(<p key={k} className="whitespace-pre-wrap leading-relaxed">{mdInline(para.join('\n'), `p${k}`, onFile)}</p>);
      para = [];
    };
    while (i < lines.length) {
      const ln = lines[i];
      if (!ln.trim()) { flush(); i++; continue; }
      const h = ln.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        flush();
        const k = key++;
        const cls = h[1].length === 1 ? 'text-[17px] font-semibold' : h[1].length === 2 ? 'text-[15px] font-semibold' : 'text-[14px] font-semibold';
        out.push(<div key={k} className={`mt-2 ${cls}`}>{mdInline(h[2], `h${k}`, onFile)}</div>);
        i++;
        continue;
      }
      if (/^>\s?/.test(ln)) {
        flush();
        const q: string[] = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
        const k = key++;
        out.push(<blockquote key={k} className="border-l-2 border-black/15 pl-2.5 text-[#3a3a3c]">{mdInline(q.join('\n'), `q${k}`, onFile)}</blockquote>);
        continue;
      }
      if (/^\s*[-*]\s+/.test(ln)) {
        flush();
        const items: string[] = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
        const k = key++;
        out.push(<ul key={k} className="list-disc space-y-0.5 pl-5">{items.map((t, j) => <li key={j}>{mdInline(t, `u${k}-${j}`, onFile)}</li>)}</ul>);
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(ln)) {
        flush();
        const items: string[] = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
        const k = key++;
        out.push(<ol key={k} className="list-decimal space-y-0.5 pl-5">{items.map((t, j) => <li key={j}>{mdInline(t, `o${k}-${j}`, onFile)}</li>)}</ol>);
        continue;
      }
      para.push(ln);
      i++;
    }
    flush();
  }
  return <div className="break-words space-y-1.5 text-[14px] text-[#1c1c1e]">{out}</div>;
}

// ---- chat→build intercept: build-looking request in chat mode ----
export function ModeSwitchCard({ onApprove, onDeny }: { onApprove: () => void; onDeny: () => void }) {
  return (
    <div className="rounded-xl border border-[#0b66e4]/30 bg-[#eef3fd] p-3.5 text-[14px]">
      <div className="font-medium">This looks like a build task</div>
      <div className="mt-1 text-[13px] text-[#3a3a3c]">Chat mode answers and explains only — it never creates files or runs commands. Go to Build mode?</div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button onClick={onApprove} className="rounded-lg bg-black px-3 py-1.5 text-[13px] font-medium text-white hover:bg-black/80">Go to Build mode</button>
        <button onClick={onDeny} className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-[13px] hover:bg-black/[0.04]">Stay in chat</button>
      </div>
    </div>
  );
}

// ---- Phase 1: tool approval + ask_user cards (agent permission gates) ----
export function ApprovalCard({ tool, input, onDecision }: {
  tool: string; input: unknown; onDecision: (allow: boolean, always: boolean) => void;
}) {
  let pretty = '';
  try { pretty = JSON.stringify(input, null, 2) || ''; } catch { pretty = String(input); }
  return (
    <div className="rounded-xl border border-[#b26a00]/30 bg-[#fbf3e4] p-3.5 text-[14px]">
      <div className="flex items-center gap-2 font-medium">
        <span className="rounded-md bg-[#b26a00] px-1.5 py-0.5 font-mono text-[11px] text-white">{tool}</span>
        <span>needs approval</span>
      </div>
      {!!pretty && pretty !== '{}' && (
        <pre className="thin-scroll mt-2 max-h-[160px] overflow-auto rounded-lg bg-white/70 p-2 font-mono text-[12px] leading-relaxed">{pretty.slice(0, 1500)}</pre>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button onClick={() => onDecision(true, false)} className="rounded-lg bg-black px-3 py-1.5 text-[13px] font-medium text-white hover:bg-black/80">Allow once</button>
        <button onClick={() => onDecision(true, true)} className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-[13px] hover:bg-black/[0.04]">Always allow {tool}</button>
        <button onClick={() => onDecision(false, false)} className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-[13px] text-[#d43a3a] hover:bg-black/[0.04]">Deny</button>
      </div>
    </div>
  );
}

export interface AskQuestion { question: string; options: { label: string; description?: string }[] }
export function AskCard({ questions, onAnswer, onDecline }: {  questions: AskQuestion[]; onAnswer: (answers: string[][]) => void; onDecline: () => void;
}) {
  const [sel, setSel] = useState<Record<number, string>>({});
  const ready = questions.every((_, i) => sel[i]);
  return (
    <div className="rounded-xl border border-[#0b66e4]/30 bg-[#eef3fd] p-3.5 text-[14px]">
      <div className="font-medium">Agent asks you</div>
      {questions.map((q, i) => (
        <div key={i} className="mt-2.5">
          <div className="text-[13px] text-[#3a3a3c]">{q.question}</div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {(q.options || []).map((o) => (
              <button
                key={o.label}
                onClick={() => setSel((s) => ({ ...s, [i]: o.label }))}
                title={o.description}
                className={`rounded-lg border px-2.5 py-1.5 text-left text-[13px] ${sel[i] === o.label ? 'border-[#0b66e4] bg-white font-medium shadow-sm' : 'border-black/15 bg-white/70 hover:bg-white'}`}
              >
                {o.label}
                {!!o.description && <span className="block text-[11px] font-normal text-[#8a8a90]">{o.description}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="mt-3 flex gap-2">
        <button disabled={!ready} onClick={() => onAnswer(questions.map((_, i) => [sel[i]]))} className="rounded-lg bg-black px-3 py-1.5 text-[13px] font-medium text-white hover:bg-black/80 disabled:opacity-40">Answer</button>
        <button onClick={onDecline} className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-[13px] hover:bg-black/[0.04]">Skip</button>
      </div>
    </div>
  );
}
