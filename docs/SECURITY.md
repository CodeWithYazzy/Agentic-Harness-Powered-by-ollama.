# Security policy & threat model

> This project is **not** audited as "completely secure". The notes below are the
> honest, verified threat model as of the Phase-1 remediation. Do not use this
> to claim the app is safe — use it to operate it safely.

## Trust boundary

- The bridge binds **`127.0.0.1` only** and grants CORS to `http://localhost:*`
  / `http://127.0.0.1:*`. Any **local** process (or any browser tab that can
  reach localhost) can call the API: git, confined files, Ollama proxy, agent
  runs. `https://evil.com` JS gets **no** CORS grant (tested), but DNS-rebinding,
  local malware, and other users on a shared host are **out of scope**.
- There is **no authentication token** on the bridge. Treat it like a local
  daemon (same posture as `ollama serve` itself): single-user machine only.

## Remote-code-execution features (by design — gate them!)

| Feature | Location | Control |
|---|---|---|
| `bash_exec` tool | build mode | tool policy (`ask` default); best-effort destructive-pattern denylist only |
| `file_write` / `file_edit` | build mode | tool policy (`ask` default); confined to the open directory |
| `hooks` (`Pre/PostToolUse`, `Stop`) | config | arbitrary `powershell.exe -Command` from config file |
| `mcpServers` | config | arbitrary `spawn(command, args, env)` from config file |
| Endpoints | config | restricted to `http(s)://` on save (SSRF guard), but any host is allowed |

Rules: never copy someone else's `config.json` blindly; `always allow` on a
write tool persists; `deny` blocks even the instant fast paths; PreToolUse hooks
can veto any call. The cloud API key is stored **plaintext** in
`~/.ollama-desktop/config.json` (owner-only permissions applied best-effort).

## Data & prompt safety

- Tool results (files, diffs, web pages) are **untrusted data**: the tool prompt
  instructs the model never to follow instructions inside them, and stored
  `__COMMITS__`/`__TOOL__` markers are stripped before transcripts reach the model.
  This mitigates, not eliminates, prompt injection — review destructive approvals.
- Markdown rendering never uses `dangerouslySetInnerHTML`, and only
  `http(s)`/`mailto` links become clickable (`javascript:`/`data:` render inert).
- File tools canonicalize paths (`realpath`) and enforce separator-aware
  containment; symlinks escaping the repo are rejected (TOCTOU races on local
  swap-between-check-and-use are a known residual risk, low exploitability).
- `web_fetch` is capped (2 MB, text-ish content-types only); `grep` skips
  null-byte binaries and caps scans at 10 MB.

## Residual risks (accepted, documented — not fixed)

- `web_fetch` follows HTTP redirects (server-side, model-supplied URL). A
  malicious page/model could redirect to an internal/metadata IP. Bounded by
  the 2 MB cap and text-type gate, but there is no private-IP blocklist.
- No rate limiting on the bridge. Localhost-only, but a runaway tab/script
  with localhost access can hammer git/Ollama through it.
- `express.json` accepts 25 MB bodies (individual sessions capped at 5 MB).
- `0600` on `config.json` is best-effort (Windows ACLs vary); the key remains
  plaintext at rest by design (documented above).
- Tool-result prompt injection is mitigated (untrusted-data rule + marker
  stripping), not eliminated — always review `bash_exec`/`file_write` approvals.
- Fast-path reads (`git_log`, `git_show`, …) honor `deny` + hook vetoes but do
  not prompt for `ask` (stays instant by design; use `deny` to block).

## Reporting issues

Open a GitHub issue with `[security]` prefix; include the bridge log lines and
tool name, but **redact** `config.json` (it contains your API key).
