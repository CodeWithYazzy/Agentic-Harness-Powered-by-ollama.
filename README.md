# YK-Harness (Ollama agentic harness)

> Full instructions: `USER_GUIDE.md`. Extra docs (security, testing,
> contributing, changelog) live in `docs/`.

Local-first AI coding assistant: a Node.js bridge (`backend/`) exposes allow-listed
operations (Ollama proxy, git, confined file access, tool-loop agent runner) to a
React UI (`frontend/`). All inference runs against your own Ollama daemon or your
own Ollama API key — no other backend is involved.

## Prerequisites

- Node.js 20+
- [Ollama](https://ollama.com) running locally (`ollama serve`) **or** an Ollama API key
- Git (only needed for the git tools / opening a repo)

## Install & run

```bat
npm run install:all   :: install backend + frontend deps
npm run build         :: build the frontend into frontend/dist
npm start             :: serve API + UI on http://127.0.0.1:47911
```

Development (Vite dev server with `/api` proxy to the bridge):

```bat
npm run dev:backend    :: bridge on :47911
npm run dev:frontend   :: UI on :47912
```

Or double-click `start.bat` (builds, waits for bridge health, opens the UI).

## Test

```bat
cd backend
npm test                 :: unit suites (no Ollama/git needed)
npm run test:loop        :: agent-loop runtime suite (self-contained mock Ollama)
npm run test:mcp         :: MCP stdio lifecycle (spawns node fake server)
npm run test:integration :: all integration suites (git/filesystem/security need a git binary)
cd ..\frontend
npx vitest run           :: UI suite
```

Suites requiring a real `git` binary or Ollama daemon
(`tests/integration/{git,filesystem,security}.test.js`, `tests/e2e/`,
`tests/provider/{mock-provider,live}.test.js`) are marked as such in their headers.

## Configuration

Stored in `~/.ollama-desktop/config.json` (override dir with `OLLAMA_DESKTOP_DATA`).
`sessions.json` and `memory.json` live next to it. `PORT` overrides the bridge port.

| Key | Meaning |
|---|---|
| `localEndpoint` | Ollama daemon URL (http(s) only) |
| `cloudEndpoint` | Ollama API URL (http(s) only) |
| `cloudKey` | API key, stored plaintext — see SECURITY.md |
| `defaultModel` / `defaultReasoning` | `Low`/`Medium`/`High` (anything else keeps current) |
| `toolPolicy` | per-tool `allow`/`ask`/`deny` (read-only defaults `allow`, writes default `ask`) |
| `hooks` | `PreToolUse`/`PostToolUse`/`Stop` PowerShell commands (max 20) |
| `mcpServers` | stdio MCP servers `{command, args, env}` (max 10) |
| `customCommands` | extra `/slash` commands (max 20) |

Modes: **chat** (read-only tools) vs **build** (adds `file_write`, `file_edit`,
`bash_exec`, each gated by the tool policy). See `docs/SECURITY.md` before enabling
writes, hooks, or MCP servers — they are remote-code-execution features by design.

## License

MIT — see `LICENSE` (fill in the copyright holder before release).
Contributions under the same terms; see `docs/CONTRIBUTING.md`.
