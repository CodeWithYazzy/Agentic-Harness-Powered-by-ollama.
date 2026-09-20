// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { COMMANDS } from './commands';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const EXPECTED = [
  '/help', '/models', '/files', '/search', '/run', '/test', '/review',
  '/commit', '/plan', '/pr', '/init', '/agents', '/memory', '/git',
  '/status', '/diff', '/log', '/branch', '/compact', '/cost', '/doctor',
  '/export', '/hooks', '/mcp', '/permissions', '/settings',
];

describe('commands catalogue', () => {
  it('has 26 entries', () => {
    expect(COMMANDS).toHaveLength(26);
  });
  it('every entry has a non-empty cmd string', () => {
    for (const c of COMMANDS) expect(c.cmd.length).toBeGreaterThan(0);
  });
  it('every entry has a non-empty desc string', () => {
    for (const c of COMMANDS) expect(c.desc.trim().length).toBeGreaterThan(0);
  });
  it('every cmd starts with /', () => {
    for (const c of COMMANDS) expect(c.cmd.startsWith('/')).toBe(true);
  });
  it('has no duplicate cmds', () => {
    const cmds = COMMANDS.map((c) => c.cmd);
    expect(new Set(cmds).size).toBe(cmds.length);
  });
  it('has no duplicate descs used as accidental copy-paste', () => {
    const descs = COMMANDS.map((c) => c.desc);
    expect(new Set(descs).size).toBe(descs.length);
  });
  it('cmds are all lowercase', () => {
    for (const c of COMMANDS) expect(c.cmd).toBe(c.cmd.toLowerCase());
  });
  it.each(EXPECTED)('contains %s', (cmd) => {
    expect(COMMANDS.some((c) => c.cmd === cmd)).toBe(true);
  });
  it('has no unexpected extra commands beyond the 26', () => {
    const set = new Set(EXPECTED);
    for (const c of COMMANDS) expect(set.has(c.cmd)).toBe(true);
  });
  it('/help describes commands', () => {
    expect(COMMANDS.find((c) => c.cmd === '/help')!.desc).toMatch(/command/i);
  });
  it('/search desc mentions a query arg', () => {
    expect(COMMANDS.find((c) => c.cmd === '/search')!.desc).toMatch(/query|</);
  });
  it('/run desc mentions build mode or a command arg', () => {
    expect(COMMANDS.find((c) => c.cmd === '/run')!.desc).toMatch(/build|<cmd>|command/i);
  });
});
