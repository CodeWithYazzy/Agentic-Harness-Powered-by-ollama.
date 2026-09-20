import type { ProviderScope } from './types';

// Provider abstraction: UI -> AgentClient -> Provider -> Ollama.
// UI never calls Ollama directly.
export interface GenerateOpts {
  model: string;
  prompt: string;
  system?: string;
  think?: string;
  onToken: (t: string) => void;
  signal?: AbortSignal;
}

abstract class AIProvider {
  abstract scope: ProviderScope;
  abstract listModels(): Promise<{ name: string; size?: number; modified_at?: string; details?: Record<string, unknown> }[]>;
  abstract health(): Promise<{ ok: boolean; endpoint?: string; count?: number; error?: string }>;
  abstract generate(o: GenerateOpts): Promise<{ eval_count?: number }>;
}

function readSSE(res: Response, onEvent: (o: Record<string, unknown>) => void, signal?: AbortSignal) {
  return pumpSSE(res, onEvent, signal);
}

// Single SSE pump shared by generate/pull/agent-run streams: parses `data:`
// JSON frames until the body ends. Intentional Stop surfaces as AbortError so
// callers can tell it apart from real failures.
function pumpSSE(res: Response, onEvent: (o: Record<string, unknown>) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (!res.body) { reject(new Error('no stream')); return; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', failed);
    // intentional Stop must surface as AbortError so callers can tell it
    // apart from real failures (no more "Request failed" on Stop)
    const failed = () => {
      if (settled) return;
      settled = true;
      try { reader.cancel(); } catch { /* ignore */ }
      cleanup();
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', failed, { once: true });
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() || '';
          for (const p of parts) {
            const line = p.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* ignore */ }
          }
          if (signal?.aborted) break;
        }
        if (!settled) { settled = true; cleanup(); resolve(); }
      } catch (e) { if (!settled) { settled = true; cleanup(); reject(e); } }
    })();
  });
}

export class OllamaLocalProvider extends AIProvider {
  scope: ProviderScope = 'local';
  async health() {
    const r = await fetch('/api/ollama/health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'local' }) });
    return r.json();
  }
  async listModels() {
    const r = await fetch('/api/ollama/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'local' }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'local discovery failed');
    return j.models;
  }
  async generate(o: GenerateOpts) {
    const res = await fetch('/api/ollama/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: o.model, prompt: o.prompt, system: o.system, think: o.think, scope: 'local' }),
      signal: o.signal,
    });
    if (!res.ok || !res.body) throw new Error(`bridge error ${res.status}`);
    let eval_count: number | undefined;
    await readSSE(res, (e) => {
      if (typeof e.token === 'string') o.onToken(e.token as string);
      if (e.done) eval_count = e.eval_count as number;
      if (e.error) throw new Error(String(e.error));
    }, o.signal);
    return { eval_count };
  }
}

export class OllamaCloudProvider extends AIProvider {
  scope: ProviderScope = 'cloud';
  async health() {
    const r = await fetch('/api/ollama/health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'cloud' }) });
    return r.json();
  }
  async listModels() {
    const r = await fetch('/api/ollama/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'cloud' }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'cloud discovery failed — check key in Settings');
    return j.models;
  }
  async generate(o: GenerateOpts) {
    const res = await fetch('/api/ollama/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: o.model, prompt: o.prompt, system: o.system, think: o.think, scope: 'cloud' }),
      signal: o.signal,
    });
    if (!res.ok || !res.body) throw new Error(`bridge error ${res.status}`);
    let eval_count: number | undefined;
    await readSSE(res, (e) => {
      if (typeof e.token === 'string') o.onToken(e.token as string);
      if (e.done) eval_count = e.eval_count as number;
      if (e.error) throw new Error(String(e.error));
    }, o.signal);
    return { eval_count };
  }
}

export const providers: Record<ProviderScope, AIProvider> = {
  local: new OllamaLocalProvider(),
  cloud: new OllamaCloudProvider(),
};

// ---- Git / files / repo through the controlled bridge ----
export async function apiDrives() {
  const r = await fetch('/api/fs/drives');
  return r.json().catch(() => ({ ok: false, drives: [] }));
}
export async function apiLsDir(dirPath: string) {
  const r = await fetch('/api/fs/ls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: dirPath }) });
  return r.json().catch(() => ({ ok: false }));
}
export async function apiHomedir() {
  const r = await fetch('/api/homedir');
  return r.json().catch(() => ({ ok: false }));
}
export async function apiFsBrowse() {
  const r = await fetch('/api/fs/browse', { method: 'POST' });
  return r.json().catch(() => ({ ok: false }));
}
export async function apiGit(repo: string, tool: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/git', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo, tool, input }) });
  return r.json();
}
export async function apiRepoInfo(repo: string) {
  const r = await fetch('/api/repo/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo }) });
  return r.json();
}
export async function apiRepoOpen(repo: string) {
  const r = await fetch('/api/repo/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo }) });
  return r.json().catch(() => ({ ok: false }));
}
export async function apiFileRead(repo: string, file: string) {
  const r = await fetch('/api/files/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo, file }) });
  return r.json();
}

// ---- Models desk ----
export async function apiOllamaShow(scope: ProviderScope, name: string) {
  const r = await fetch('/api/ollama/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, name }) });
  return r.json();
}
export async function apiOllamaPs() {
  const r = await fetch('/api/ollama/ps', { method: 'POST' });
  return r.json().catch(() => ({ ok: false }));
}
export async function apiHost() {
  const r = await fetch('/api/host');
  return r.json().catch(() => ({ ok: false }));
}
export async function apiLibrary(): Promise<{ ok: boolean; names: string[] }> {
  const r = await fetch('/api/ollama/library');
  return r.json().catch(() => ({ ok: false, names: [] }));
}
export async function apiOllamaDelete(name: string) {
  const r = await fetch('/api/ollama/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  return r.json().catch(() => ({ ok: false }));
}
export function pullModelStream(name: string, onEvent: (e: Record<string, unknown>) => void, signal?: AbortSignal): Promise<void> {
  return fetch('/api/ollama/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }), signal })
    .then((res) => {
      if (!res.body) throw new Error('no stream');
      return pumpSSE(res, onEvent, signal);
    });
}

// ---- Background agent runs (Phase 2c) ----
export async function apiAgentRunsStart(body: Record<string, unknown>) {
  const r = await fetch('/api/agent/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false }));
}
export async function apiAgentRuns() {
  const r = await fetch('/api/agent/runs');
  return r.json().catch(() => ({ ok: false, runs: [] }));
}
export async function apiAgentRun(id: string) {
  const r = await fetch(`/api/agent/runs/${id}`);
  return r.json().catch(() => ({ ok: false }));
}
export async function apiAgentStopRun(id: string) {
  const r = await fetch(`/api/agent/runs/${id}/stop`, { method: 'POST' });
  return r.json().catch(() => ({ ok: false }));
}
export async function apiAgentCompact(body: Record<string, unknown>) {
  const r = await fetch('/api/agent/compact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false }));
}
export async function apiMemory(repo: string) {
  const r = await fetch(`/api/memory?repo=${encodeURIComponent(repo)}`);
  return r.json().catch(() => ({ ok: false, notes: [] }));
}
export async function apiMemoryClear(repo: string) {
  const r = await fetch('/api/memory/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo }) });
  return r.json().catch(() => ({ ok: false }));
}

// Agent streaming run: emits status/tool/token/done/error events.
export function runAgentStream(body: Record<string, unknown>, onEvent: (e: Record<string, unknown>) => void, signal?: AbortSignal): Promise<void> {
  return fetch('/api/agent/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
    .then((res) => {
      if (!res.ok || !res.body) throw new Error(`bridge error ${res.status}`);
      return pumpSSE(res, onEvent, signal);
    });
}
