// Registry of in-flight generation streams, keyed by session id.
// Lets + New / deletes kill orphaned streams so an old run and a new
// run never continue side-by-side by accident.
const ctrls = new Map<string, AbortController>();

export function trackStream(sid: string, c: AbortController) {
  // never stack two controllers on one session — kill the stale one
  try { ctrls.get(sid)?.abort(); } catch { /* ignore */ }
  ctrls.set(sid, c);
}
export function untrackStream(sid: string) {
  ctrls.delete(sid);
}
export function abortStream(sid: string) {
  const c = ctrls.get(sid);
  ctrls.delete(sid);
  try { c?.abort(); } catch { /* ignore */ }
}
export function abortAllStreams() {
  for (const c of ctrls.values()) {
    try { c.abort(); } catch { /* ignore */ }
  }
  ctrls.clear();
}
