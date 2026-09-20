# Contributing

## Setup

```bat
npm run install:all
npm test              :: root gate: backend unit + frontend suite
```

## Ground rules

1. **Small, verifiable steps.** One concern per change; update `CHANGELOG.md`.
2. **Never hide failures.** A failing test is investigated and fixed, or the
   behavior change is justified in the test itself — never muted.
3. **Preserve compatibility** unless a change is justified and tested
   (tool names, SSE event shapes, and config keys are public protocol).
4. **No secrets in commits.** `config.json` holds a plaintext API key and lives
   outside the repo (`~/.ollama-desktop/`) — keep it that way. Never paste keys
   into tests, fixtures, or screenshots.
5. **Docs with behavior changes.** `../README.md` / `SECURITY.md` / `TESTING.md`
   must match the code you ship.

## Test gates (see TESTING.md for the full matrix)

```bat
npm test                                   :: everywhere-green gate
npm --prefix backend run test:loop         :: agent runtime (mock Ollama)
npm --prefix backend run test:integration  :: needs git for some files
npm --prefix frontend run typecheck
```

## Release checklist (maintainer)

- [ ] `npm test` green; git/Ollama suites green on a dev machine
- [ ] `CHANGELOG.md` up to date; version bumped in all three `package.json`
- [ ] `LICENSE` holder filled in (currently `<COPYRIGHT HOLDER>`)
- [ ] No credentials in history (`git log -p | grep -i sk-` empty)
- [ ] `frontend/dist`, `node_modules`, `coverage` untracked (`git status` clean)
- [ ] Tag, GitHub release notes, attach `start.bat`-built bundle if shipping one
