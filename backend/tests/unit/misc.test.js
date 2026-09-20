'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../server.js');
const { sanitizeMcp, hooksFor, mcpResolve, ORDINALS } = S;

describe('sanitizeMcp', () => {
  it('keeps a valid server with command/args/env', () => {
    assert.deepEqual(sanitizeMcp({ fs: { command: 'npx', args: ['-y', 'x'], env: { A: 'b' } } }), {
      fs: { command: 'npx', args: ['-y', 'x'], env: { A: 'b' } },
    });
  });
  it('rejects names with spaces', () => {
    assert.deepEqual(sanitizeMcp({ 'bad name!': { command: 'x' } }), {});
  });
  it('rejects names with leading dash', () => {
    assert.deepEqual(sanitizeMcp({ '-bad': { command: 'x' } }), {});
  });
  it('rejects empty names', () => {
    assert.deepEqual(sanitizeMcp({ '': { command: 'x' } }), {});
  });
  it('accepts dashes and underscores inside names', () => {
    const out = sanitizeMcp({ 'my-server_1': { command: 'x' } });
    assert.ok(out['my-server_1']);
  });
  it('accepts uppercase names (case-insensitive regex)', () => {
    assert.ok(sanitizeMcp({ MyServer: { command: 'x' } }).MyServer);
  });
  it('rejects 42-char names (max 41)', () => {
    assert.deepEqual(sanitizeMcp({ ['n'.repeat(42)]: { command: 'x' } }), {});
  });
  it('accepts 41-char names', () => {
    assert.ok(sanitizeMcp({ ['n'.repeat(41)]: { command: 'x' } })['n'.repeat(41)]);
  });
  it('caps servers at 10 (11th dropped)', () => {
    const big = {};
    for (let i = 0; i < 15; i++) big['s' + i] = { command: 'c' + i };
    const out = sanitizeMcp(big);
    assert.equal(Object.keys(out).length, 10);
    assert.ok(!out.s10, '11th server must be dropped');
    assert.ok(out.s9, '10th server kept');
  });
  it('exactly 10 servers all survive', () => {
    const big = {};
    for (let i = 0; i < 10; i++) big['s' + i] = { command: 'c' };
    assert.equal(Object.keys(sanitizeMcp(big)).length, 10);
  });
  it('drops entries with missing command', () => {
    assert.deepEqual(sanitizeMcp({ ok: { args: [] } }), {});
  });
  it('drops entries with null server value', () => {
    assert.deepEqual(sanitizeMcp({ ok: null }), {});
  });
  it('drops entries with non-string command', () => {
    assert.deepEqual(sanitizeMcp({ ok: { command: 42 } }), {});
  });
  it('drops entries with whitespace-only command', () => {
    assert.deepEqual(sanitizeMcp({ ok: { command: '   ' } }), {});
  });
  it('trims command whitespace', () => {
    assert.equal(sanitizeMcp({ s: { command: '  npx  ' } }).s.command, 'npx');
  });
  it('caps command at 500 chars', () => {
    assert.equal(sanitizeMcp({ s: { command: 'c'.repeat(600) } }).s.command.length, 500);
  });
  it('coerces numeric/bool args to strings', () => {
    assert.deepEqual(sanitizeMcp({ s: { command: 'c', args: [1, 'x'] } }).s.args, ['1', 'x']);
  });
  it('coerces null arg to "null" string', () => {
    assert.deepEqual(sanitizeMcp({ s: { command: 'c', args: [null] } }).s.args, ['null']);
  });
  it('caps args at 20', () => {
    const args = Array.from({ length: 30 }, (_, i) => 'a' + i);
    assert.equal(sanitizeMcp({ s: { command: 'c', args } }).s.args.length, 20);
  });
  it('non-array args become []', () => {
    assert.deepEqual(sanitizeMcp({ s: { command: 'c', args: 'nope' } }).s.args, []);
  });
  it('missing args become []', () => {
    assert.deepEqual(sanitizeMcp({ s: { command: 'c' } }).s.args, []);
  });
  it('coerces numeric env values to strings', () => {
    assert.deepEqual(sanitizeMcp({ s: { command: 'c', env: { K: 5 } } }).s.env, { K: '5' });
  });
  it('coerces null env value to empty string', () => {
    assert.deepEqual(sanitizeMcp({ s: { command: 'c', env: { N: null } } }).s.env, { N: '' });
  });
  it('caps env at 20 entries', () => {
    const env = {};
    for (let i = 0; i < 30; i++) env['K' + i] = 'v';
    assert.equal(Object.keys(sanitizeMcp({ s: { command: 'c', env } }).s.env).length, 20);
  });
  it('non-object env becomes {}', () => {
    assert.deepEqual(sanitizeMcp({ s: { command: 'c', env: 'nope' } }).s.env, {});
  });
  it('missing env becomes {}', () => {
    assert.deepEqual(sanitizeMcp({ s: { command: 'c' } }).s.env, {});
  });
  it('env keys capped at 80 chars', () => {
    const out = sanitizeMcp({ s: { command: 'c', env: { ['k'.repeat(100)]: 'v' } } }).s.env;
    assert.equal(Object.keys(out)[0].length, 80);
  });
  it('env values capped at 2000 chars', () => {
    const out = sanitizeMcp({ s: { command: 'c', env: { K: 'v'.repeat(3000) } } }).s.env;
    assert.equal(out.K.length, 2000);
  });
  it('null input yields {}', () => {
    assert.deepEqual(sanitizeMcp(null), {});
  });
  it('undefined input yields {}', () => {
    assert.deepEqual(sanitizeMcp(undefined), {});
  });
  it('output entries carry only command/args/env (no passthrough)', () => {
    const out = sanitizeMcp({ s: { command: 'c', extra: 'drop-me' } }).s;
    assert.deepEqual(Object.keys(out).sort(), ['args', 'command', 'env']);
  });
});

describe('hooksFor', () => {
  const H = (match, event = 'PreToolUse') => ({ event, match, command: 'echo hi' });
  it('exact tool match passes', () => {
    assert.equal(hooksFor({ hooks: [H('file_read')] }, 'PreToolUse', 'file_read').length, 1);
  });
  it('exact match rejects other tools', () => {
    assert.deepEqual(hooksFor({ hooks: [H('file_read')] }, 'PreToolUse', 'grep'), []);
  });
  it("'*' wildcard matches any tool", () => {
    assert.equal(hooksFor({ hooks: [H('*')] }, 'PreToolUse', 'anything').length, 1);
  });
  it('wrong event is filtered out', () => {
    assert.deepEqual(hooksFor({ hooks: [H('*')] }, 'PostToolUse', 'file_read'), []);
  });
  it('PostToolUse exact match passes', () => {
    assert.equal(hooksFor({ hooks: [H('grep', 'PostToolUse')] }, 'PostToolUse', 'grep').length, 1);
  });
  it('Stop event with wildcard passes', () => {
    assert.equal(hooksFor({ hooks: [H('*', 'Stop')] }, 'Stop', '*').length, 1);
  });
  it('Stop hook does not fire for PreToolUse', () => {
    assert.deepEqual(hooksFor({ hooks: [H('*', 'Stop')] }, 'PreToolUse', 'x'), []);
  });
  it('multiple hooks filter to event+match only', () => {
    const cfg = { hooks: [H('a'), H('b'), H('*'), H('a', 'PostToolUse')] };
    const out = hooksFor(cfg, 'PreToolUse', 'a');
    assert.equal(out.length, 2);
  });
  it('empty hooks array yields []', () => {
    assert.deepEqual(hooksFor({ hooks: [] }, 'PreToolUse', 'x'), []);
  });
  it('missing hooks key yields []', () => {
    assert.deepEqual(hooksFor({}, 'Stop', '*'), []);
  });
  it('null cfg yields []', () => {
    assert.deepEqual(hooksFor(null, 'PreToolUse', 'x'), []);
  });
  it('undefined cfg yields []', () => {
    assert.deepEqual(hooksFor(undefined, 'PreToolUse', 'x'), []);
  });
  it('returns the hook objects themselves', () => {
    const h = H('file_read');
    assert.deepEqual(hooksFor({ hooks: [h] }, 'PreToolUse', 'file_read'), [h]);
  });
  it('partial-name match does not count (exact equality)', () => {
    assert.deepEqual(hooksFor({ hooks: [H('file')] }, 'PreToolUse', 'file_read'), []);
  });
});

describe('mcpResolve (empty live registry: honest null-cases)', () => {
  it('non-mcp__ name returns null', () => {
    assert.equal(mcpResolve('file_read'), null);
  });
  it('empty string returns null', () => {
    assert.equal(mcpResolve(''), null);
  });
  it('mcp__unknown with no live servers returns null', () => {
    assert.equal(mcpResolve('mcp__ghost__tool'), null);
  });
  it('bare mcp__ prefix with no server returns null', () => {
    assert.equal(mcpResolve('mcp__'), null);
  });
  it('mcp__<server> without tool separator returns null', () => {
    assert.equal(mcpResolve('mcp__onlyserver'), null);
  });
  it('uppercase MCP__ prefix returns null (case-sensitive)', () => {
    assert.equal(mcpResolve('MCP__x__y'), null);
  });
  it('prefix logic review: resolution requires a live running server entry (none here)', () => {
    // mcpResolve iterates the live mcpServers map; the unit context starts
    // zero servers, so every name must resolve null. Prefix parsing itself
    // (mcp__<server>__<tool>) cannot be exercised without spawning stdio
    // servers, which unit tests must not do.
    assert.equal(S.mcpServers.size, 0);
    assert.equal(mcpResolve('mcp__a__b'), null);
  });
});

describe('ORDINALS', () => {
  it('first maps to 0', () => {
    assert.equal(ORDINALS.first, 0);
  });
  it('second maps to 1', () => {
    assert.equal(ORDINALS.second, 1);
  });
  it('third maps to 2', () => {
    assert.equal(ORDINALS.third, 2);
  });
  it('fourth maps to 3', () => {
    assert.equal(ORDINALS.fourth, 3);
  });
  it('fifth maps to 4', () => {
    assert.equal(ORDINALS.fifth, 4);
  });
  it("'1st' maps to 0", () => {
    assert.equal(ORDINALS['1st'], 0);
  });
  it("'2nd' maps to 1", () => {
    assert.equal(ORDINALS['2nd'], 1);
  });
  it("'3rd' maps to 2", () => {
    assert.equal(ORDINALS['3rd'], 2);
  });
  it("'4th' maps to 3", () => {
    assert.equal(ORDINALS['4th'], 3);
  });
  it("'5th' maps to 4", () => {
    assert.equal(ORDINALS['5th'], 4);
  });
  it('last maps to -1 (sentinel for final commit)', () => {
    assert.equal(ORDINALS.last, -1);
  });
  it('has exactly 11 keys', () => {
    assert.equal(Object.keys(ORDINALS).length, 11);
  });
  it('word and numeric forms agree (first==1st etc)', () => {
    assert.equal(ORDINALS.first, ORDINALS['1st']);
    assert.equal(ORDINALS.second, ORDINALS['2nd']);
    assert.equal(ORDINALS.third, ORDINALS['3rd']);
    assert.equal(ORDINALS.fourth, ORDINALS['4th']);
    assert.equal(ORDINALS.fifth, ORDINALS['5th']);
  });
});
