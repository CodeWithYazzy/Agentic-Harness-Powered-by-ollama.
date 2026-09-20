import { useMemo, useState } from 'react';
import type { Session } from '../types';

const LEVELS = ['#e6e6e8', '#bcd4f3', '#8fb8ea', '#5d97dd', '#2f6fd0'];
const DAY = 86400000;

interface Stats {
  sessions: number;
  messages: number;
  tokens: number;
  activeDays: number;
  curStreak: number;
  longStreak: number;
  peakHour: string;
  favModel: string;
  weeks: number[][];
  weekStarts: number[];
  maxCount: number;
  byModel: { name: string; sessions: number; messages: number }[];
}

export function useStats(sessions: Session[], rangeMs: number | null): Stats {
  return useMemo(() => {
    const now = Date.now();
    const since = rangeMs === null ? 0 : now - rangeMs;
    // all day math on LOCAL-midnight basis (UTC epoch days shift in +0530 etc.)
    const sod = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    const todaySod = sod(now);
    const dayNum = (t: number) => Math.round((sod(t) - todaySod) / DAY); // 0 = today, negative = past
    const inRange = sessions.filter((s) => s.updatedAt >= since);
    const msgs = inRange.flatMap((s) =>
      s.messages.filter((m) => m.createdAt >= since).map((m) => ({ t: m.createdAt, tokens: m.tokens || 0, model: s.model })),
    );
    const perDay = new Map<number, number>();
    for (const m of msgs) perDay.set(dayNum(m.t), (perDay.get(dayNum(m.t)) || 0) + 1);
    const dayNums = [...perDay.keys()].sort((a, b) => a - b);
    let longStreak = 0, run = 0, prev = -Infinity;
    for (const d of dayNums) {
      run = d === prev + 1 ? run + 1 : 1;
      longStreak = Math.max(longStreak, run);
      prev = d;
    }
    const set = new Set(dayNums);
    let curStreak = 0;
    if (set.has(0) || set.has(-1)) {
      let d = set.has(0) ? 0 : -1;
      while (set.has(d)) { curStreak += 1; d -= 1; }
    }
    const hours = new Array(24).fill(0);
    for (const m of msgs) hours[new Date(m.t).getHours()] += 1;
    const peak = hours.indexOf(Math.max(...hours));
    const peakHour = msgs.length ? `${((peak + 11) % 12) + 1} ${peak < 12 ? 'AM' : 'PM'}` : '—';
    const modelCount = new Map<string, { s: Set<string>; m: number }>();
    for (const s of inRange) {
      if (!s.model) continue;
      const e = modelCount.get(s.model) || { s: new Set<string>(), m: 0 };
      e.s.add(s.id);
      e.m += s.messages.length;
      modelCount.set(s.model, e);
    }
    const byModel = [...modelCount.entries()]
      .map(([name, v]) => ({ name, sessions: v.s.size, messages: v.m }))
      .sort((a, b) => b.messages - a.messages);
    // heatmap: last 24 weeks, rows Sun..Sat, last column = current week (offsets vs today)
    const COLS = 24;
    const weekday = new Date(now).getDay(); // 0 = Sunday
    const firstColStart = -weekday - 7 * (COLS - 1);
    const weeks: number[][] = Array.from({ length: 7 }, () => Array(COLS).fill(0));
    const weekStarts: number[] = [];
    let maxCount = 0;
    for (let c = 0; c < COLS; c++) {
      const colStart = firstColStart + c * 7;
      weekStarts.push(todaySod + colStart * DAY);
      for (let r = 0; r < 7; r++) {
        const off = colStart + r;
        const n = perDay.get(off) || 0;
        // only show days up to today
        weeks[r][c] = off <= 0 ? n : -1;
        maxCount = Math.max(maxCount, n);
      }
    }
    return {
      sessions: inRange.length,
      messages: msgs.length,
      tokens: msgs.reduce((a, m) => a + m.tokens, 0),
      activeDays: dayNums.length,
      curStreak, longStreak, peakHour,
      favModel: byModel[0]?.name || '—',
      weeks, weekStarts, maxCount, byModel,
    };
  }, [sessions, rangeMs]);
}

function fmtTokens(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
}

export function timeAgo(t: number) {
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function RecentsPanel({ sessions, onOpen, onNew, onAll }: {
  sessions: Session[]; onOpen: (id: string) => void; onNew: () => void; onAll: () => void;
}) {
  const top = sessions.slice(0, 5);
  const extra = sessions.length - top.length;
  return (
    <div className="flex w-full min-w-[240px] shrink-0 flex-col rounded-xl bg-[#eeeef0] p-4 sm:w-[300px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold">Recents</span>
        <button onClick={onNew} title="New session" className="rounded-md bg-black px-2.5 py-1 text-[12px] font-medium text-white hover:bg-black/80">New</button>
      </div>
      {top.map((s) => {
        const msgs = s.messages.length;
        const tokens = s.messages.reduce((a, m) => a + (m.tokens || 0), 0);
        return (
          <button
            key={s.id}
            onClick={() => onOpen(s.id)}
            title={s.title}
            className="mb-1 rounded-lg px-2 py-2 text-left hover:bg-black/[0.04]"
          >
            <div className="truncate text-[14px] font-medium">{s.title}</div>
            <div className="mt-0.5 truncate text-[12px] text-[#8a8a90]">
              {msgs} msgs · {fmtTokens(tokens)}{s.model ? ` · ${s.model}` : ''} · {timeAgo(s.updatedAt)}
            </div>
          </button>
        );
      })}
      {!sessions.length && (
        <div className="px-2 py-3 text-[13px] text-[#6e6e73]">No chats yet — hit New to start.</div>
      )}
      {extra > 0 && (
        <button onClick={onAll} className="mt-1 rounded-lg px-2 py-1.5 text-left text-[13px] text-[#6e6e73] hover:bg-black/[0.04]">
          +{extra} more in sidebar
        </button>
      )}
    </div>
  );
}

export function Heatmap({ stats }: { stats: Stats }) {
  const [tip, setTip] = useState<{ d: string; m: number; c: number; cols: number } | null>(null);
  const level = (n: number) => {
    if (n < 0) return 'transparent';
    if (n === 0 || stats.maxCount === 0) return LEVELS[0];
    const f = n / stats.maxCount;
    return LEVELS[Math.min(4, 1 + Math.floor(f * 3.99))];
  };
  return (
    <div className="relative">
      <div className="grid grid-flow-col grid-rows-7 gap-[5px]" style={{ gridAutoColumns: '15px' }}>
        {stats.weeks[0].map((_, c) =>
          stats.weeks.map((row, r) => {
            const v = row[c];
            const date = new Date(stats.weekStarts[c] + r * DAY);
            const label = `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} — ${v} messages`;
            const showTip = () => v >= 0 && setTip({ d: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), m: v, c, cols: stats.weeks[0].length });
            return (
              <div
                key={`${r}-${c}`}
                onMouseEnter={showTip}
                onMouseLeave={() => setTip(null)}
                onFocus={showTip}
                onBlur={() => setTip(null)}
                tabIndex={v >= 0 ? 0 : undefined}
                role="img"
                aria-label={label}
                className="rounded-[4px]"
                style={{ width: 15, height: 15, background: level(v), visibility: v < 0 ? 'hidden' : 'visible' }}
              />
            );
          }),
        )}
      </div>
      {tip && (
        <div
          className={`pointer-events-none absolute -top-12 z-10 max-w-[220px] whitespace-nowrap rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[12px] shadow-pop ${tip.c === 0 ? 'left-0' : tip.c === tip.cols - 1 ? 'right-0' : '-translate-x-1/2'}`}
          style={tip.c === 0 || tip.c === tip.cols - 1 ? undefined : { left: `${(tip.c / Math.max(tip.cols - 1, 1)) * 100}%` }}
        >
          <div className="font-medium">{tip.d}</div>
          <div className="text-[#6e6e73]">{tip.m} messages</div>
        </div>
      )}
    </div>
  );
}

export function OverviewCard({ sessions }: { sessions: Session[] }) {
  const [tab, setTab] = useState<'Overview' | 'Models'>('Overview');
  const [range, setRange] = useState<'7d' | '30d' | 'All'>('7d');
  const stats = useStats(sessions, range === 'All' ? null : range === '30d' ? 30 * DAY : 7 * DAY);
  const empty = stats.messages === 0 && stats.sessions === 0;
  const cells: [string, string][] = [
    ['Sessions', `${stats.sessions}`],
    ['Messages', stats.messages.toLocaleString()],
    ['Total tokens', fmtTokens(stats.tokens)],
    ['Active days', `${stats.activeDays}`],
    ['Current streak', stats.curStreak ? `${stats.curStreak}d` : '—'],
    ['Longest streak', stats.longStreak ? `${stats.longStreak}d` : '—'],
    ['Peak hour', stats.peakHour],
    ['Favorite model', stats.favModel],
  ];
  return (
    <div className="rounded-xl bg-[#eeeef0] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-3 text-[13px]">
          {(['Overview', 'Models'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={t === tab ? 'font-semibold text-black' : 'text-[#8a8a90] hover:text-black'}>{t}</button>
          ))}
        </div>
        <div className="flex gap-2.5 text-[13px]">
          {(['7d', '30d', 'All'] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)} className={r === range ? 'rounded-md bg-black/[0.06] px-1.5 font-semibold' : 'text-[#8a8a90] hover:text-black'}>{r}</button>
          ))}
        </div>
      </div>
      {tab === 'Overview' ? (
        empty ? (
          <div className="rounded-lg bg-[#e3e3e6] px-3 py-6 text-center text-[13px] text-[#6e6e73]">
            No activity yet — send a message to start your first session.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {cells.map(([k, v]) => (
                <div key={k} className="min-w-0 rounded-lg bg-[#e3e3e6] px-2.5 py-2">
                  <div className="truncate text-[11px] text-[#8a8a90]" title={k}>{k}</div>
                  <div className="truncate text-[15px] font-semibold tracking-tight" title={v}>{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 overflow-x-auto pb-1 thin-scroll"><Heatmap stats={stats} /></div>
            <div className="mt-2 text-[12px] text-[#8a8a90]">
              {fmtTokens(stats.tokens)} tokens across {stats.sessions} session{stats.sessions === 1 ? '' : 's'}.
            </div>
          </>
        )
      ) : (
        <div>
          {stats.byModel.map((m) => (
            <div key={m.name} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[14px] hover:bg-black/[0.04]">
              <span className="flex-1 truncate">{m.name}</span>
              <span className="text-[12px] text-[#8a8a90]">{m.sessions} sessions · {m.messages.toLocaleString()} msgs</span>
            </div>
          ))}
          {!stats.byModel.length && <div className="px-2 py-4 text-[13px] text-[#8a8a90]">No models used yet.</div>}
        </div>
      )}
    </div>
  );
}
