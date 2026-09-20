import type { CommitInfo, ModelInfo, Session } from './types';

// Command catalogue (every entry is real: local action or agent expansion).
export const COMMANDS = [
  { cmd: '/help', desc: 'Show available commands' },
  { cmd: '/models', desc: 'List discovered models' },
  { cmd: '/files', desc: 'List the project structure' },
  { cmd: '/search', desc: 'Search the codebase: /search <query>' },
  { cmd: '/run', desc: 'Run a shell command (build mode): /run <cmd>' },
  { cmd: '/test', desc: 'Run the test suite (build mode)' },
  { cmd: '/review', desc: 'Review uncommitted changes' },
  { cmd: '/commit', desc: 'Draft a commit message' },
  { cmd: '/plan', desc: 'Plan mode: implementation plan, no code' },
  { cmd: '/pr', desc: 'Start a PR workflow' },
  { cmd: '/init', desc: 'Explain this project' },
  { cmd: '/agents', desc: 'List subagents (Explore/Plan/General)' },
  { cmd: '/memory', desc: 'Show project memory' },
  { cmd: '/git', desc: 'Git status summary' },
  { cmd: '/status', desc: 'Directory + Ollama status' },
  { cmd: '/diff', desc: 'Show working-tree diff' },
  { cmd: '/log', desc: 'Show commit history' },
  { cmd: '/branch', desc: 'List branches' },
  { cmd: '/compact', desc: 'Summarize + trim this session' },
  { cmd: '/cost', desc: 'Session usage stats' },
  { cmd: '/doctor', desc: 'Diagnose bridge + models' },
  { cmd: '/export', desc: 'Download transcript as JSON' },
  { cmd: '/hooks', desc: 'Open hooks settings' },
  { cmd: '/mcp', desc: 'Open MCP settings' },
  { cmd: '/permissions', desc: 'Open tool permissions' },
  { cmd: '/settings', desc: 'Open settings' },
];

export type { CommitInfo, ModelInfo, Session };
