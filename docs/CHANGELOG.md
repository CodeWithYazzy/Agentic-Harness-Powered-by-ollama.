# Changelog

## Tool reliability + start.bat (2026-09-20, live-diagnosed)

- Diagnosed "model says no access": happens with no directory open (tools
  fail, small models ramble). Fixes, all verified live with qwen3.5:4b:
  new deterministic `list_dir` fast path for directory questions; no-repo
  runs now restrict the loop to repo-free tools (web/todo/ask/tasks) plus an
  explicit open-a-directory guidance note; strict tool retry also covers
  directory-shaped questions when a repo is open.
- `start.bat` rewritten in English: 6 verified steps, dual winget variants
  (`--id X -e --source winget` and short form) shown only for missing items.
- USER_GUIDE in English; Ollama command reference (`signin`, not `/login`).
- No machine-specific hardcoded paths found in source (dynamic: `os.homedir`,
  drive enumeration, `%~dp0`); only a generic test-only Chrome default path.

## Phases 6+7+8 — 2026-09-20

### Phase 6 — security review
- Sweep: no `eval`/`new Function`/`exec` anywhere; all subprocess use is
  `execFile` (no shell) except the intentional PowerShell surfaces
  (`bash_exec`, hooks) and MCP `spawn` — all documented as RCE-by-design.
- No raw-HTML sinks in the UI (`Markdown` builds React nodes; only
  `http(s)`/`mailto` links become anchors). Static allowlisted URLs only.
- API key stays masked (`***`) in GET, password input, and doctor output;
  never written to logs (new `log()` helper takes no bodies/inputs/secrets).
- Residual risks recorded in `SECURITY.md`: redirect-following in `web_fetch`,
  no rate limiting, 25 MB body cap, best-effort `0600`, prompt-injection
  mitigation limits, fast-path `ask` semantics. The project is **not** claimed
  secure — the threat model is explicit instead.

### Phase 7 — testing strategy
- New `TESTING.md`: tier table, commands, determinism conventions (mock-queue
  drain rule), current status, regression net.
- Missing scripts added: `frontend: test/typecheck`, root `test/test:backend/
  typecheck`. Root `npm test` verified end-to-end (backend unit + frontend 317).

### Phase 8 — release prep
- `LICENSE`: **MIT** per your choice (fill in `<COPYRIGHT HOLDER>` before
  release — flagged in README + release checklist).
- `CONTRIBUTING.md` (workflow rules + maintainer release checklist),
  `.env.example` (PORT / OLLAMA_DESKTOP_DATA / E2E_CHROME; no dotenv loader
  bundled — documented), README license section, `.env` added to `.gitignore`.
- **Nothing published or pushed.** Awaiting your explicit approval for any
  external release action; remaining pre-release step is running the
  git/Ollama/Chrome suites on a dev machine.

## Phases 2+3+4+5 — 2026-09-20

### Phase 2 — agent engine (verified with self-contained mock Ollama)
New `tests/provider/agent-loop.test.js` (12 tests, all passing): tool executes +
summary streams, batched multi-call round, failed tool recorded without killing
the run, model-500 decision fallback, 4-round cap (decision count asserted, no
infinite loop), client abort (bridge survives), `Agent` subagent delegation with
findings, malformed fast-fail with no approval card, unknown-tool drop, 400 on
missing model. Plus `completeOnce` hang-timeout unit test. Two harness bugs found
and fixed along the way: mock-queue stealing by detached memory fetches (drain
protocol, same as the existing mock-provider suite) and two tests that only
passed via that stealing (queues corrected to match the real call sequence).

### Phase 3 — tool reliability matrix (`exec-tools.test.js`, 86 tests)
Per-tool: `file_read` slicing/directory/1 MB cap/missing; `file_write`
round-trip/500 KB cap/escape; `file_edit` exact/ambiguous/missing;
`glob` hits + honest `(no matches)`; `grep` bad-regex/empty/include filter;
`web_search` fast-fail; `bash_exec` live success + failure-shape (win32-gated).
Git-backed tools (`git_*`) reviewed but unrunnable here (no `git` binary) —
their `execGit` error/timeout paths are covered via `gitErrMsg` unit paths and
the `/api/git` contract tests.

### Phase 4 — commands
Backend `slashToGit` unit-covered (incl. `/git`); frontend `App-flows` +5:
`/git` without repo → guidance toast, with repo → agent passthrough,
`/search <q>` expansion, build-mode `/run` payload, custom `/rr` prompt+extra.
Pre-existing unknown-slash toast test kept.

### Phase 5 — code quality
- Removed verified-unused code: `motion.ts` `motion` + `prefersReducedMotion`,
  `Composer.tsx` unread `scope`, `Overlays.tsx` unused `AnimatePresence`,
  two test-file `within` imports (found via `tsc --noUnusedLocals`; enforced
  flags left off to avoid churning the build config).
- Mixed tool-name casing (`git_log` vs `TaskCreate` vs `Agent`) reviewed and
  **kept**: model-facing protocol, renaming breaks compatibility.
- Minimal timestamped `log()` helper (never logs bodies/inputs/secrets);
  boot + EADDRINUSE + MCP autostart failures use it. No monolith split (same
  justification as before: unverifiable without the git suites).

### Test totals (actual, this environment)
- Backend unit **610/610** · agent-loop **12/12** · integration runnable
  **191/191** (config 78, sessions 41, misc-api 69, mcp 3) · frontend
  **317/317** (`tsc -b` clean, `vite build` ok; 4 pre-existing React `act()`
  warnings, also present at baseline).
- Still needs your machine (no git/Ollama/Chrome here): `git`/`filesystem`/
  `security`/`e2e`/`mock-provider`/`live` suites.

## Full-audit remediation, round 2 — 2026-09-20

### Agent engine & permissions
- Fast paths (`git_log`/`git_show`/`git_diff`/`git_status`/`/cmd`/`read_file`) now
  enforce `deny` policy + PreToolUse hook vetoes via `fastPathGate()` (Arch-2);
  `ask` on instant reads stays instant (documented). Git args unified on
  `sanitizeGitArgs()`; `/git <sub>` maps to the matching gate tool.
- `validateToolInput()` (H2): centralized pre-approval validation so malformed
  calls fail fast instead of popping approval cards; verified live (no card).
- `completeOnce.lastError` (M5): `{kind: timeout|http|network|badshape}` instead
  of indistinguishable null. Loop budgets now named exported constants (M6):
  `TOOL_LOOP_ROUNDS=4`, `TOOL_CALL_CAP=8`, `SUBAGENT_ATTEMPTS=5`,
  `SUBAGENT_TOOL_ROUNDS=3`.
- `mcpRequest` rejects pendings on spawn `error` too (M7, was exit-only).
- `always allow` approvals now persist for live MCP tools (was built-ins only).

### Tools & data
- `execGit` propagates `code`/`signal`/`timedOut`; messages via `gitErrMsg()`;
  `/api/git` returns `timedOut`+`code` (H4).
- `web_fetch`: 2 MB streaming cap, content-length pre-check, text-ish
  content-type gate (H5). `grep`: null-byte binary sniff + 10 MB scan cap (H7).
- Sessions: shape validation (id 1–200 chars, messages array ≤1000 with
  string role+content, 5 MB cap → 413) (H8).
- Memory keys normalized (`memKey`) with verbatim legacy fallback + migration
  on save and dual delete on clear (a first cut regressed foreign-separator
  keys; caught by `misc-api` suite and fixed with fallback + test).
- `stripInternalMarkers()` (H9): model-bound transcripts (compact + loop
  history) and the `/export` download no longer carry `__COMMITS__`/`__TOOL__`
  protocol. Tool prompt gains the untrusted-data rule (S8 mitigation).
- Pull failures include Ollama's message (bounded); keycheck probes the
  configured default model instead of hardcoded `gpt-oss:20b`.
- Config: `defaultReasoning` closed set (`Low`/`Medium`/`High`, keeps current
  otherwise); endpoints must be `http(s)` on save (SSRF guard); config file
  gets best-effort `0600` after save (S5).

### Frontend
- `api.ts`: one shared `pumpSSE()` for generate/pull/agent streams (dedupe).
- `Markdown`: only `http(s)`/`mailto` links become anchors; `javascript:`/
  `data:` render inert (S9, confirmed by inspection, tested).
- Build-gate no longer triggers on questions (trailing `?`) (L8, tested).
- `FREE_CLOUD_MODELS` marked as a snapshot to re-check vs ollama.com (L7).

### Docs & hygiene
- `../README.md` rewritten to match the real project (was Electron-installer
  fiction); new `SECURITY.md` threat model (S1–S10, RCE-by-design table);
  `start.bat` fails fast with a 30s bridge-health wait (M9).
- `backend/tests/e2e/helpers.js` vs `tests/helpers.js` reviewed: different
  layers (browser e2e vs HTTP suites), not duplication — kept.

### Tests this round (actual results)
- Backend unit **592/592**; new provider suite `agent-loop.test.js` **6/6**
  (tool executes, fallback, deny-keeps-disk-clean, malformed fast-fail with no
  approval card, unknown-tool drop, 400-no-model); `integration/mcp` **3/3**.
- Integration runnable here **191/191** (config 78, sessions 41, misc-api 69,
  mcp 3). Frontend **312/312**, `tsc -b` clean, `vite build` ok.
- Still unrunnable in this environment (no `git` binary, no Ollama, no Chrome):
  `git`/`filesystem`/`security`/`e2e`/`mock-provider`/`live` suites.
- Deliberately not done: `server.js` module split (can't verify without the
  git suites — phased plan stands), `sanitizeGitArgs` dash-strip kept as
  option-injection defense (commented), full JSON-Schema typing (centralized
  validation + tests instead).

## Phase 1 fixes — 2026-09-20 (audit remediation, no rewrites)

### Security
- `backend/server.js` `confine()` — fixed sibling-prefix bypass (`abs.startsWith(root)`
  without separator) and removed `..`-substring mangling. Resolution now relies on
  `path.resolve` + `realpath` + separator-aware containment. The two inline copies
  (`POST /api/files/read`, `read_file` fast path) now call the single helper.
- `backend/server.js` `execTool(bash_exec)` — denylist extended (best effort only;
  real containment remains build-mode + ask-policy): `Remove-Item -Recurse`, `rd /s`,
  `-EncodedCommand`/`FromBase64String`, `curl|wget … | sh|bash|powershell`,
  `Invoke-Expression`/`iex(`, `git clean -fdx`, `git reset --hard`.
- `POST /api/config` — `toolPolicy` arrays now rejected (kept prior); arrays silently
  passed through before and violated the config shape.
- `resolveRoute()` — whitespace-only `cloudKey` now counts as empty (routes to the
  free local path instead of failing auth on the paid path).
- `GET /api/tools` — `Agent` now reports its strictest gate (`ask`, for General
  subagents) instead of `allow`, so the permissions screen never understates gating.
- Background runs (`POST /api/agent/runs`) — returns `429` when 20 runs are all still
  `running` instead of growing the registry without bound.
- Unknown `/api/*` routes now always return JSON `404 {ok:false}` via explicit
  middleware (previously depended on `frontend/dist` existing; otherwise Express HTML).

### Reliability
- `parseToolCalls()` — replaced non-greedy brace regex (truncated any tool argument
  containing `}`, e.g. `file_write` code content) with a JSON-string-aware
  brace-matching parser. `balancedJsonEnd` + `confine` + `slashToGit` exported for tests.
- `slashToGit()` — bare `/git` (and `git`, `/git <subcommand>`) now maps to the
  allowlisted git invocations; previously the advertised `/git` command returned
  "Unsupported command in this workspace."
- `thinkFor()` — trims whitespace (`'high '` → `'high'`, was `true`).
- `frontend/src/App.tsx` — `git_show` tool label uses the actual ref
  (`Showed commit <hash>`) instead of the hardcoded "second commit".

### Hygiene / testability
- New root `.gitignore` (`node_modules/`, `dist/`, `coverage/`, logs, editor files).
  `backend/dist/server.bundle.js` build artifact left on disk but now ignored.
- `backend/package.json` — added `test`, `test:integration`, `test:all` scripts
  (`node --test …`; previously no test command existed).
- `sanitizeGitArgs` leading-dash stripping reviewed and **kept**: it is the
  option-injection defense for `execFile`, not a bug.

### Tests (all passing, none fabricated)
- Backend unit: **552/552** (`node --test tests/unit/*.test.js`) — includes new
  `tests/unit/exec-tools.test.js` (28 tests: nested-JSON parsing, bash denylist,
  confine bypass, executor validation) and 10 new `slashToGit` tests.
- Backend integration: `config` **76/76**, `sessions`+`misc-api` **106/106**.
  4 existing tests updated to the fixed behavior with justification in-test:
  `toolPolicy` array, whitespace key, `thinkFor('high ')`, `Agent` policy label,
  `subdir-dotdot` resolution (+ new sibling-prefix test).
- Frontend: `tsc -b` clean, vitest **308/308**.
- Live smoke: unknown `/api/*` → `404 {"ok":false,"error":"unknown api endpoint"}`.
- **Not runnable in this environment** (no `git` binary, no Ollama daemon):
  `filesystem`, `git`, `security`, `e2e`, `provider/live` suites. The new
  `security.test.js` assertions (dotdot resolution, sibling confinement) are
  verified by the unit-level `confine()` tests above, not by live run.

### Remaining / next (needs your approval)
- `bash_exec`/hooks/MCP are RCE-by-design power features: threat-model docs +
  Settings UI warnings still to do (denylist is only a speed bump).
- Prompt-injection boundary (untrusted tool output → model prompt) untested.
- `server.js` module split only after loop tests land (Phase 2).
- Release docs: real install/run/test README, LICENSE, CONTRIBUTING.
