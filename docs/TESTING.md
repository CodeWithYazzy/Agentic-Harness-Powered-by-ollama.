# Testing strategy

Four tiers, cheapest first. Everything below runs with **no installs beyond
`npm run install:all`** (Node 20+ only).

| Tier | Command | Needs | Covers |
|---|---|---|---|
| Backend unit | `npm --prefix backend test` | nothing | tool protocol, registry, routing, planner, git-arg sanitizing, executors, validation, gates, completion errors, approvals |
| Agent loop | `npm --prefix backend run test:loop` | nothing (self-contained mock Ollama) | multi-call batches, failure recording, model-error fallback, 4-round cap, client abort, subagent delegation, deny enforcement, malformed fast-fail, 400s |
| MCP lifecycle | `npm --prefix backend run test:mcp` | nothing (spawns node fake server) | stdio start/list/stop, tool surfacing |
| Backend integration | `npm --prefix backend run test:integration` | `git` binary for git/filesystem/security files | config, sessions, misc-api, mcp run anywhere; `git.test.js`, `filesystem.test.js`, `security.test.js` need git |
| Provider (mock) | `node --test tests/provider/mock-provider.test.js` (from `backend/`) | `git` binary | full runtime against the scripted Ollama double |
| Provider (live) | `tests/provider/live.test.js` | running Ollama + `git` | real-daemon smoke (manual) |
| Frontend | `npm --prefix frontend test` | nothing | components, store, streams, shortcuts, commands, app flows |
| Typecheck | `npm --prefix frontend run typecheck` | nothing | `tsc -b` (also runs in `build`) |
| E2E | `tests/e2e/*.test.js` | Chrome + `git` + built frontend | browser flows, screenshots |

`npm test` (root) = backend unit + frontend suite — the everywhere-green gate.

## Conventions that keep the suites deterministic

- Backend HTTP suites fork their own server on unique ports with a fresh temp
  `OLLAMA_DESKTOP_DATA` (see `backend/tests/helpers.js`) — never touch
  `~/.ollama-desktop` or production `:47911`.
- Tests that script the mock Ollama must account for the **detached
  memory-extraction fetch** after tool-using runs: drain it (see `drainMem()` in
  `tests/provider/agent-loop.test.js`) or it steals the next test's queue entry.
  The same trap once made two tests pass only via queue stealing — queues must
  match the real call sequence (decision, [retry,] summary).
- Failing tests are investigated, not muted: 9 pre-existing tests were updated
  only where the *intended behavior* changed, each with an in-test justification.

## Current status (this environment: no git, no Ollama, no Chrome)

- Backend unit **610/610** · agent-loop **12/12** · config 78 · sessions 41 ·
  misc-api 69 · mcp 3 · frontend **317/317**, `tsc` clean, `vite build` ok.
- Not runnable here: `git`/`filesystem`/`security`/`mock-provider`/`live`/`e2e`.
  Run the full set on a dev machine before release: from `backend/`,
  `node --test tests/unit/*.test.js tests/integration/*.test.js tests/provider/agent-loop.test.js tests/provider/mock-provider.test.js`.
- Frontend shows 4 pre-existing React `act(…)` warnings (baseline behavior, not failures).

## Failure tests to keep green (regression net)

`agent-loop.test.js`: denied write never touches disk · malformed call ⇒ no
approval card · 4-round cap · abort survival. `exec-tools.test.js`: bash
denylist · confine sibling bypass · oversized/escaping writes. `security.test.js`
(requires git): traversal/junction/symlink, CORS, shell-metachar injection,
error-envelope, perf budgets. `sessions.test.js`: shape/size caps.
