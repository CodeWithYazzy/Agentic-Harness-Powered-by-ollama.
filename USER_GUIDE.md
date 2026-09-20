# YK-Harness — User Guide

> Every claim below was checked against the actual code and, where marked
> **[verified-live]**, against a real run on 2026-09-20 (Windows, Node v24.19.0,
> Ollama 0.34.2). Anything not verifiable here is marked **UNVERIFIED**.

## 1. What is YK-Harness?

**Purpose.** YK-Harness is a local-first AI coding assistant: a desktop-quality
web app that lets you chat with Large Language Models about your own code,
with the model able to read files, run git commands, search the web, execute
shell commands, and edit files — all through tools you approve.

**Main features.**

- Chat with local Ollama models or Ollama cloud models from one UI.
- Agentic tool loop: the model calls tools (file read, grep, git, shell…)
  and answers from real results instead of guessing.
- Chat mode (read-only) vs Build mode (writes, gated by approvals).
- 26 slash commands, custom slash commands, subagents (Explore/Plan/General).
- Tool permission policies (`allow`/`ask`/`deny`), Pre/Post/Stop hooks.
- MCP (Model Context Protocol) stdio servers, surfaced as tools.
- Background runs, sessions with persistence + compaction, per-directory memory.
- Git status/log/diff/showblame helpers, repo picker, model manager.

**How the agent works.** Your message goes to `POST /api/agent/run`. The bridge
classifies it (fast paths for git log/show/diff/status and file reads, tool
loop otherwise). The tool loop asks the model (non-streaming) which tools to
call, checks policy/approvals/hooks, executes, feeds results back (max 4
rounds), then streams the final answer as tokens over SSE. **[verified-live]**:
a real run returned `status → token("OK") → done` with `eval_count`.

**Supported operating systems.** Windows is verified (this guide's runs).
`bash_exec` and hooks run via `powershell.exe`, and startup uses `start.bat`,
so those features are Windows-first; POSIX behavior is **UNVERIFIED**.

**Local-first architecture.** UI (React/Vite) → local bridge
(Express on `127.0.0.1:47911`) → your Ollama daemon or Ollama cloud with
*your* key. Local-scope requests touch only your `localEndpoint`
(code-verified: no cloud uplink on the local path).

## 2. System Requirements

| Requirement | Detail | Status |
|---|---|---|
| OS | Windows 10/11 (64-bit) | verified here |
| Node.js | 20+ recommended; **verified on v24.19.0** (`node --version`) | verified |
| npm | ships with Node (**verified 11.17.0**) | verified |
| Ollama | daemon (`ollama serve`) OR cloud key; **verified 0.34.2** | verified |
| Models | at least one pulled model or keyless `:cloud` sign-in or API key | verified (`ollama list` showed 4 models) |
| Git | required **only** for git tools/repo features; absent here | verified-absent |
| Browser | any modern browser for the UI; Chrome needed **only** for e2e tests (present at the default path here) | verified |
| Internet | needed for cloud models, web tools, library list; **not** needed for local-model chat | code-verified |
| RAM/CPU/GPU/storage | model-dependent (a 7.6 GB model lives on this machine); keep free RAM above the model size; the app's Models view shows host memory via `/api/host` | guidance, exact minima **UNVERIFIED** |

Dependencies (installed by `npm run install:all`, no manual picks): backend
`express ^4.19.2`, `cors ^2.8.5` (verified in `backend/package.json`);
frontend React 18 + Vite + Vitest (verified in `frontend/package.json`).
Native modules: none.

**If something is missing (Windows — winget IDs verified live):**
`start.bat` checks everything itself, but to install manually, run only what
is missing — each item shows two equivalent variants (either works):

```bat
winget install --id OpenJS.NodeJS.LTS -e --source winget
winget install OpenJS.NodeJS.LTS

winget install --id Ollama.Ollama -e --source winget
winget install Ollama.Ollama

winget install --id Git.Git -e --source winget
winget install Git.Git
```

**Useful Ollama commands** (all verified via `ollama --help`; note there is
no `/login` command — sign-in is called `signin`):

```bat
ollama serve      :: start the server (keep it running)
ollama list       :: show installed models
ollama pull qwen3.5:4b   :: small fast model (best for first run)
ollama ps         :: models currently loaded in RAM
ollama run qwen3.5:4b    :: chat directly in the terminal
ollama rm <name>  :: remove a model to free space
ollama signin     :: log in to ollama.com for free cloud models
ollama signout    :: log out
```

## 3. Before Installation

Checklist:

- [ ] Node 20+ installed (`node --version`).
- [ ] A project folder in mind (any directory; git repo optional but
  recommended for git tools).
- [ ] Ports **47911** (bridge) and **47912** (Vite dev) free.
- [ ] Decide: local Ollama (`ollama serve` + pulled model) and/or cloud key.
- [ ] Environment variables (all optional): `PORT` (default `47911`),
  `OLLAMA_DESKTOP_DATA` (default `~/.ollama-desktop`), `E2E_CHROME`
  (tests only). The frontend reads **no** env vars.
- [ ] Secrets: you need **no** secret for local use. A cloud key is entered
  once in Settings; it is stored **plaintext** in
  `~/.ollama-desktop/config.json` (best-effort owner-only permissions).
- [ ] Security warnings: build-mode tools, hooks, and MCP servers are
  **remote-code execution by design** (see §9). Single-user machine only;
  never expose the bridge beyond loopback.
- [ ] Permissions: read/write your own project dirs; writing outside the open
  directory is blocked by the bridge.
- [ ] Must NOT be shared publicly: `config.json` (API key), `sessions.json`
  (chat history), `memory.json` (project facts). All live under the data dir.

## 4. Installation and Setup

Run from the project root (`.../Agentic Harness - Powered by ollama`).
All commands verified present in `package.json` files.

```bat
:: 1. Dependencies (backend + frontend)
npm run install:all

:: 2. Ollama daemon (separate terminal; keep it running)
ollama serve

:: 3. Pull at least one model (example: small, fast)
ollama pull qwen3.5:4b
ollama list
```

`ollama list` here showed `gpt-oss:120b-cloud`, `gemma4:12b`,
`qwen2.5-coder:7b`, `qwen3.5:4b` **[verified-live]**.

```bat
:: 4. Build the frontend bundle
npm run build

:: 5. (Optional) environment overrides
set PORT=47911
set OLLAMA_DESKTOP_DATA=%USERPROFILE%\.ollama-desktop
```

No `.env` loader is bundled (see `.env.example`); export variables in your
shell. Cloud-key path (no key needed for local): open Settings in the UI and
paste the key, or pick a `:cloud`-suffixed model after a free
`ollama signin`. Keyless-vs-key routing details: **UNVERIFIED** live beyond
code reading — follow the in-app Settings guidance.

## 5. Pre-Run Checklist

- [ ] `node --version` ≥ 20; `node_modules` present in `backend/` and `frontend/`.
- [ ] `frontend/dist/index.html` exists (run `npm run build` if unsure).
- [ ] `ollama serve` reachable; `ollama list` shows your model.
- [ ] `http://127.0.0.1:47911` free (busy port ⇒ `port 47911 is busy` + exit 1).
- [ ] Project folder path ready (git repo if you want git tools).
- [ ] Cloud key only if using API-tier models; never commit `config.json`.
- [ ] Backend tests green if you changed code: `npm --prefix backend test`.

## 6. How to Run

**Production (recommended).**

```bat
npm start
:: serves API + UI at http://127.0.0.1:47911/
```

Verified: `/` returns `200 text/html`; `/api/tools` returns 19 tools;
`/api/config` returns the 9 config keys; unknown `/api/*` returns 404 JSON
**[verified-live]**.

**`start.bat`.** Double-click: it does everything itself — (1) Node.js check
(prints both install variants if missing), (2) Ollama check, (3) installs
only missing `node_modules`, (4) builds a missing `dist`, (5) starts
`ollama serve` if down plus model guidance (`pull`/`signin`/`ps`/`rm`),
(6) bridge start + health wait + browser open. Any step that fails stops the
script. Verified end-to-end on 2026-09-20 (all 6 steps through "bridge is up
and working").

**Development.**

```bat
npm run dev:backend     :: bridge on :47911
npm run dev:frontend    :: Vite UI on :47912 (/api proxied to the bridge)
```

Dev-server live serving is **UNVERIFIED** (code-reviewed: `vite.config.ts`
proxy target `http://127.0.0.1:47911`).

**Backend only:** `cd backend && node server.js` (or `npm run dev`).
**Expected startup output [verified-live]:**

```text
2026-09-20T14:40:37.581Z [info] bridge on http://127.0.0.1:48311
```

(port reflects `PORT`). **Health check [verified-live]:**

```bat
curl http://127.0.0.1:47911/api/health
:: {"ok":true,"time":"2026-09-20T14:41:09.952Z"}
```

**Stop:** `Ctrl+C` in the bridge window (or close it); close the browser tab.
To cancel one run, use the in-chat Stop button (aborts the stream and the
upstream Ollama fetch — mock-tested; single-run live abort covered by tests).

## 7. First-Time User Tutorial

*(UI flow below is code-verified; live browser walkthrough is **UNVERIFIED**
— no browser automation was run here.)*

1. **Open** `http://127.0.0.1:47911/`. If you see `frontend not built`,
   run `npm run build`.
2. **Pick a directory** (repo picker, home default). Git features need a repo;
   without one the app toasts `Open a directory first`.
3. **Configure the model**: Models view lists local/cloud models with tiers
   and a Refresh button (pulling/deleting is done via the Ollama CLI, e.g.
   `ollama pull <name>` / `ollama rm <name>`), or change endpoints in
   Settings. With no model selected the app auto-picks a local model, else
   toasts `No models found — start Ollama…`.
4. **Start a session**: `+ New`; one empty draft is reused, never stacked.
5. **Send a basic request**: type + `Ctrl+Enter` (remappable; defaults
   `Ctrl+K` palette, `Ctrl+Enter` send, `Ctrl+Shift+P` models).
6. **Use tools**: ask about files/commits; the model calls tools first, then
   answers. Up to 8 calls per round, 4 rounds max.
7. **Approve/deny**: write tools pop an approval card; `always allow` persists
   per tool (including MCP tools). Denials are recorded, the run continues.
8. **File tools**: open files from chat links or the file modal (confined to
   the open directory; escapes get `path escapes directory`).
9. **Commands**: `/help` lists all 26; `/search <q>` needs a query;
   `/run <cmd>` and `/test` need Build mode; `/git /log /status /diff /branch
   /show /commit` need a directory; unknown ones toast
   `Unknown command "…" — try /help`.
10. **MCP tools**: add a server in Settings (command + args + env), start it,
    call as `mcp__server__tool` in Build mode (approval-gated).
11. **Stop/cancel**: Stop button per session; switching sessions kills other
    streams; deleting a session kills its stream first.
12. **Errors**: no Ollama ⇒ `Ollama is unavailable. Start Ollama…`; bad key ⇒
    `Your API key was rejected…`; spent credits ⇒ quota toast with Settings
    shortcut; second send while thinking ⇒ `Still thinking here…`.

## 8. Feature Usage Guide

- **Agent engine**: fast paths (git/file intents, instant, `deny`+hook gated)
  vs tool loop (multi-step, approval-gated). History sent is capped (20
  inbound, 12 000 chars of prior turns in-loop).
- **Tool calling**: fenced ```tool JSON; unknown names dropped; malformed
  calls fail fast with `error: <reason>` and never pop approvals.
- **Permissions**: Settings → Tool permissions; defaults read-only `allow`,
  writes `ask`; `deny` also blocks fast paths.
- **Hooks**: Settings list (max 20): `{event: PreToolUse|PostToolUse|Stop,
  match: tool|'*', command}`. Env: `YK_TOOL`, `YK_INPUT_JSON`,
  (`YK_OUTPUT_JSON`, `YK_OK` post-use), `YK_MODEL` on stop. ⚠️ Renamed from
  `YOYO_*` — old hook scripts must be updated (breaking change).
- **Background runs**: send with background option; sidebar lists up to 20
  (21st concurrent run gets `too many running background runs`).
- **Sessions**: synced to the bridge (≤50, ≤1000 msgs, ≤5 MB each); rename,
  duplicate, delete (with Undo toast), rewind, resend, regenerate, export
  (markers stripped).
- **Memory**: auto-learned per-directory facts (≤30 notes, ≤160 chars);
  `/memory` views; clear from the directory picker.
- **Commands**: full list via `/help` (26 entries, all lowercase, unique).
- **Git tools**: log (1–50, pretty format), show (stat+patch, sanitized ref),
  diff vs HEAD, status, branch, blame, grep — all allow-listed argv, no shell.
- **Web tools**: fetch (2 MB cap, text types only, truncation marked) and
  best-effort web search (may report `no results (search may be blocked…)`).
- **Subagents**: `Agent` tool, Explore (read-only recon) / Plan (read-only
  plan) / General (build-only, approval-gated); depth-1, parallel ≤3 merged.
- **MCP integration**: stdio JSON-RPC autostart at boot; failures stay
  queryable in `/api/mcp`; calls time out (15 s init/list, 60 s tools).

## 9. Security Guide

Read `docs/SECURITY.md` (threat model). Essentials:

- `bash_exec`, `file_write`/`file_edit`, hooks, MCP servers = **RCE by
  design**. The destructive-command denylist is a speed bump only
  (blocks `rm -rf /`, `Remove-Item -Recurse`, encoded commands, pipe-to-shell,
  `git clean -fdx`/`reset --hard`, …) — real containment is Build-mode-only +
  your per-approval review.
- API key: plaintext in `config.json`, masked as `***` in API/UI/logs.
- Localhost only: any local process/tab with localhost access can drive the
  bridge. Never proxy it publicly; no auth token exists.
- Prompt injection: tool results are untrusted (model instructed not to obey
  them; markers stripped) — mitigated, not eliminated. Review every write/shell
  approval, especially with web content in context.
- `web_fetch` follows redirects (no private-IP blocklist); sessions cap
  request bodies (5 MB vs 25 MB global).

## 10. Troubleshooting

| Symptom | Cause / fix (verified strings) |
|---|---|
| `Ollama is unavailable…` | start `ollama serve`; check Settings endpoints |
| `Your API key was rejected…` | re-paste key in Settings |
| Quota toast | credits spent (free vs key tier shown) or keyless `:cloud` needs `ollama signin` |
| `port 47911 is busy…` + exit 1 | another bridge running; stop it or set `PORT` |
| `frontend not built` | run `npm run build` |
| `Open a directory first` | repo-requiring command/file tool with no directory |
| `No models found…` | pull a model or add a key |
| `Still thinking here…` | stop the run first or switch sessions |
| `Unsupported command…` | non-allowlisted git subcommand |
| `path escapes directory` | file outside the open directory (blocked correctly) |
| Tool `error: …` in chat | read the message: validation/timeout/deny reason included |
| MCP `error`/`stopped` | check command path in Settings; `/api/mcp` shows stderr tail |
| Git tools failing | Git not installed (this machine) or not a repo (`/api/repo/open` reports `isGit`) |
| `npm run build` fails | run `npm run install:all` first; paste the `tsc` error |
| Full `start.bat` flow | steps individually verified; end-to-end double-click **UNVERIFIED** |
| POSIX/macOS specifics | **UNVERIFIED** (PowerShell/`start.bat` are Windows-first) |

## 11. Configuration Reference

Env vars (the only three the code reads):

| Var | Default | Valid values | Required? |
|---|---|---|---|
| `PORT` | `47911` | TCP port | no |
| `OLLAMA_DESKTOP_DATA` | `~/.ollama-desktop` | writable dir | no |
| `E2E_CHROME` | `C:\Program Files\Google\Chrome\…\chrome.exe` | path | tests only |

`config.json` keys (all 9 verified via `/api/config`): `localEndpoint`
(`http://localhost:11434`), `cloudEndpoint` (`https://ollama.com`),
`cloudKey` (`''`), `defaultModel` (`''`), `defaultReasoning` (`Medium`;
closed set `Low`/`Medium`/`High`, anything else keeps current),
`toolPolicy` (`{}` of `allow`/`ask`/`deny`; arrays rejected),
`hooks` (≤20, events `PreToolUse`/`PostToolUse`/`Stop`, match ≤80 chars,
command ≤2000 chars, 10 s timeout), `mcpServers` (≤10 stdio servers,
name `[a-z0-9][a-z0-9_-]{0,40}`, command ≤500 chars, args ≤20, env ≤20),
`customCommands` (≤20, name lowercased, prompt ≤2000 chars). Endpoints must be
`http(s)` on save (others keep current).

Model config: pick in Models view or set `defaultModel`; reasoning
Low (no thinking) / Medium (default) / High, sent only to thinking-capable
models (probed via `/api/show` capabilities, 1 h cache). Keycheck probes with
a 1-token generate on the configured default model (fallback `gpt-oss:20b`).

## 12. Testing and Verification

```bat
npm test                                   :: root gate (backend unit + frontend)
cd backend && npm test                      :: unit only
cd backend && npm run test:loop             :: agent runtime, mock Ollama
cd backend && npm run test:mcp              :: MCP stdio lifecycle
cd backend && npm run test:integration      :: needs git for 3 files
cd frontend && npm test && npm run typecheck
```

**Actual results (this machine):** backend unit 610/610 · loop 12/12 ·
config 78 · sessions 41 · misc-api 69 · mcp 3 · frontend 317/317 · `tsc`
clean · `vite build` ok · live Ollama run (`qwen3.5:4b`) returned
`token("OK")` + `done`. Health: `{"ok":true,"time":"…"}`.

Needs Git: `git`/`filesystem`/`security` integration, `mock-provider`,
`live`. Needs Ollama: `live`, keycheck/model-error paths live. Needs Chrome:
all `e2e`. The suites above that ran are **verified**; the rest are
**UNVERIFIED** here (see `docs/TESTING.md`).

## 13. Known Limitations

- Windows-first (PowerShell subprocesses, `start.bat`); POSIX **UNVERIFIED**.
- Model-dependent quality: small models may fumble the tool protocol (one
  strict retry, then plain-chat fallback); 8 calls/round, 4 rounds max.
- Security posture as §9 (single-user, loopback, RCE-by-design features).
- No integrations beyond Ollama API + DuckDuckGo scrape + stdio MCP; no
  user accounts, teams, remote hosting, TLS, or rate limiting.
- `FREE_CLOUD_MODELS` tier list is a hardcoded snapshot (re-check vs
  ollama.com pricing); `web_search` breaks if DDG markup changes.

## 14. Quick Start

```bat
npm run install:all
ollama serve
ollama pull qwen3.5:4b
npm run build
npm start
```

Open `http://127.0.0.1:47911/` → pick a folder → pick `qwen3.5:4b` → ask
`Explain what this directory does`. Try `/help`, `/log` (in a repo),
`/search TODO`. To stop: `Ctrl+C` the bridge window, close the tab.

## 15. Uninstallation

1. Stop: `Ctrl+C` the bridge (or close its window / kill the `node server.js`
   process); close browser tabs; stop background Ollama with `ollama stop`
   if desired (generic Ollama command — behavior **UNVERIFIED** here).
2. Dependencies: delete `backend\node_modules`, `frontend\node_modules`,
   `frontend\dist` (all gitignored regenerables).
3. Configuration/data: delete `%USERPROFILE%\.ollama-desktop`
   (or your `OLLAMA_DESKTOP_DATA`) — contains key, chats, memory.
4. Ollama/models: use Ollama's own uninstaller (**UNVERIFIED** steps).
5. Verify: project folder contains no secrets (`findstr /s /i "sk-" config.json`
   has nothing to scan — config lived outside the repo).
