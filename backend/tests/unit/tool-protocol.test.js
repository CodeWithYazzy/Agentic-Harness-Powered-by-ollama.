'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../server.js');
const { toolsPrompt, parseToolCalls, TOOL_DEFS } = S;
const fence = (obj) => '```tool\n' + JSON.stringify(obj) + '\n```';

describe('toolsPrompt: mode filtering', () => {
  it('chat prompt names the chat mode', () => {
    assert.ok(toolsPrompt('chat').includes('mode: chat'));
  });
  it('build prompt names the build mode', () => {
    assert.ok(toolsPrompt('build').includes('mode: build'));
  });
  it('chat prompt excludes file_write', () => {
    assert.ok(!toolsPrompt('chat').includes('file_write'));
  });
  it('chat prompt excludes file_edit', () => {
    assert.ok(!toolsPrompt('chat').includes('file_edit'));
  });
  it('chat prompt excludes bash_exec', () => {
    assert.ok(!toolsPrompt('chat').includes('bash_exec'));
  });
  it('build prompt includes file_write', () => {
    assert.ok(toolsPrompt('build').includes('file_write'));
  });
  it('build prompt includes file_edit', () => {
    assert.ok(toolsPrompt('build').includes('file_edit'));
  });
  it('build prompt includes bash_exec', () => {
    assert.ok(toolsPrompt('build').includes('bash_exec'));
  });
  it('chat prompt includes read-only file_read', () => {
    assert.ok(toolsPrompt('chat').includes('file_read'));
  });
  it('chat prompt includes git_log', () => {
    assert.ok(toolsPrompt('chat').includes('git_log'));
  });
  it('chat prompt includes Agent', () => {
    assert.ok(toolsPrompt('chat').includes('Agent'));
  });
  it('chat prompt includes TaskCreate', () => {
    assert.ok(toolsPrompt('chat').includes('TaskCreate'));
  });
  it('build prompt lists every TOOL_DEFS name', () => {
    const p = toolsPrompt('build');
    for (const t of TOOL_DEFS) assert.ok(p.includes(t.name), `missing ${t.name}`);
  });
  it('chat prompt lists every read-only tool', () => {
    const p = toolsPrompt('chat');
    for (const t of TOOL_DEFS.filter((t) => t.readOnly)) assert.ok(p.includes(t.name), `missing ${t.name}`);
  });
  it('chat prompt lists no write tool', () => {
    const p = toolsPrompt('chat');
    for (const t of TOOL_DEFS.filter((t) => !t.readOnly)) assert.ok(!p.includes(t.name), `leaked ${t.name}`);
  });
});

describe('toolsPrompt: only-filter + protocol text', () => {
  it('only-filter restricts chat prompt to the named tool', () => {
    const p = toolsPrompt('chat', ['git_log']);
    assert.ok(p.includes('- git_log:'));
    assert.ok(!p.includes('- git_status:'));
    assert.ok(!p.includes('- file_read:'));
  });
  it('only-filter with two names keeps both', () => {
    const p = toolsPrompt('build', ['git_log', 'git_status']);
    assert.ok(p.includes('- git_log:') && p.includes('- git_status:'));
    assert.ok(!p.includes('- file_read:'));
  });
  it('only-filter with unknown name yields no tool lines', () => {
    const p = toolsPrompt('chat', ['nope']);
    assert.ok(!p.includes('- nope:'));
  });
  it('only-filter respects mode too (write tool in chat only-filter stays out)', () => {
    assert.ok(!toolsPrompt('chat', ['file_write']).includes('file_write'));
  });
  it('only-filter allows write tool in build mode', () => {
    assert.ok(toolsPrompt('build', ['file_write']).includes('file_write'));
  });
  it('prompt contains a fenced ```tool example', () => {
    assert.ok(toolsPrompt('chat').includes('```tool'));
  });
  it('prompt contains the exact file_read example JSON', () => {
    assert.ok(toolsPrompt('chat').includes('{"name":"file_read","input":{"path":"package.json"}}'));
  });
  it('prompt contains the MUST-use-tools rule', () => {
    assert.ok(/MUST/.test(toolsPrompt('build')));
  });
  it('prompt tells model to batch independent calls', () => {
    assert.ok(toolsPrompt('chat').includes('Batch independent calls together'));
  });
  it('chat prompt carries the read-only warning', () => {
    assert.ok(toolsPrompt('chat').includes('chat mode is read-only'));
  });
});

describe('parseToolCalls: basic shapes', () => {
  it('parses a single tool fence', () => {
    assert.deepEqual(parseToolCalls(fence({ name: 'file_read', input: { path: 'a.js' } })), [{ name: 'file_read', input: { path: 'a.js' } }]);
  });
  it('parses two batched fences', () => {
    const t = fence({ name: 'git_log', input: {} }) + '\ntext\n' + fence({ name: 'git_status', input: {} });
    assert.deepEqual(parseToolCalls(t), [{ name: 'git_log', input: {} }, { name: 'git_status', input: {} }]);
  });
  it('parses three batched fences in order', () => {
    const t = [fence({ name: 'git_log', input: {} }), fence({ name: 'glob', input: { pattern: '*.js' } }), fence({ name: 'grep', input: { pattern: 'x' } })].join('\n');
    const out = parseToolCalls(t);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((c) => c.name), ['git_log', 'glob', 'grep']);
  });
  it('accepts ```json fences', () => {
    assert.deepEqual(parseToolCalls('```json\n{"name":"git_log","input":{"n":3}}\n```'), [{ name: 'git_log', input: { n: 3 } }]);
  });
  it('mixes tool and json fences', () => {
    const t = fence({ name: 'git_log', input: {} }) + '\n```json\n{"name":"git_status","input":{}}\n```';
    assert.equal(parseToolCalls(t).length, 2);
  });
  it('drops unknown tool names', () => {
    assert.deepEqual(parseToolCalls(fence({ name: 'nope', input: {} })), []);
  });
  it('keeps known call when mixed with unknown', () => {
    const t = fence({ name: 'nope', input: {} }) + '\n' + fence({ name: 'git_log', input: {} });
    assert.deepEqual(parseToolCalls(t), [{ name: 'git_log', input: {} }]);
  });
  it('skips malformed JSON blocks', () => {
    assert.deepEqual(parseToolCalls('```tool\n{not json}\n```'), []);
  });
  it('keeps valid call next to malformed block', () => {
    const t = '```tool\n{oops}\n```\n' + fence({ name: 'git_log', input: {} });
    assert.deepEqual(parseToolCalls(t), [{ name: 'git_log', input: {} }]);
  });
  it('prose without fences yields []', () => {
    assert.deepEqual(parseToolCalls('just some words, no fences here'), []);
  });
  it('empty string yields []', () => {
    assert.deepEqual(parseToolCalls(''), []);
  });
  it('null yields []', () => {
    assert.deepEqual(parseToolCalls(null), []);
  });
  it('undefined yields []', () => {
    assert.deepEqual(parseToolCalls(undefined), []);
  });
  it('non-string falsy (0) yields []', () => {
    assert.deepEqual(parseToolCalls(0), []);
  });
  it('plain triple-backtick fence without tag is ignored', () => {
    assert.deepEqual(parseToolCalls('```\n{"name":"file_read","input":{}}\n```'), []);
  });
  it('uppercase ```TOOL fence is ignored (regex is lowercase-only)', () => {
    assert.deepEqual(parseToolCalls('```TOOL\n{"name":"git_log","input":{}}\n```'), []);
  });
  it('block missing name field is dropped', () => {
    assert.deepEqual(parseToolCalls(fence({ input: {} })), []);
  });
  it('block with non-string name is dropped', () => {
    assert.deepEqual(parseToolCalls(fence({ name: 42, input: {} })), []);
  });
});

describe('parseToolCalls: input normalization', () => {
  it('string input becomes {_text}', () => {
    assert.deepEqual(parseToolCalls(fence({ name: 'file_read', input: 'hi' })), [{ name: 'file_read', input: { _text: 'hi' } }]);
  });
  it('top-level args merge into input', () => {
    assert.deepEqual(parseToolCalls(fence({ name: 'grep', pattern: 'x', path: 'y' })), [{ name: 'grep', input: { pattern: 'x', path: 'y' } }]);
  });
  it('object input merges with top-level args (input wins on clash)', () => {
    const out = parseToolCalls(fence({ name: 'grep', input: { pattern: 'in' }, pattern: 'top' }));
    assert.deepEqual(out, [{ name: 'grep', input: { pattern: 'in' } }]);
  });
  it('extra top-level keys merge alongside input object', () => {
    assert.deepEqual(parseToolCalls(fence({ name: 'file_read', input: { path: 'a' }, extra: 1 })), [{ name: 'file_read', input: { extra: 1, path: 'a' } }]);
  });
  it('missing input yields empty object', () => {
    assert.deepEqual(parseToolCalls(fence({ name: 'git_status' })), [{ name: 'git_status', input: {} }]);
  });
  it('null input yields rest-args only', () => {
    assert.deepEqual(parseToolCalls(fence({ name: 'git_status', input: null })), [{ name: 'git_status', input: {} }]);
  });
  it('numeric input is ignored (rest-args only)', () => {
    assert.deepEqual(parseToolCalls(fence({ name: 'git_log', input: 5 })), [{ name: 'git_log', input: {} }]);
  });
  it('name key never leaks into input', () => {
    const [{ input }] = parseToolCalls(fence({ name: 'git_log', input: {} }));
    assert.ok(!('name' in input));
  });
  it('string input keeps sibling top-level args too', () => {
    assert.deepEqual(parseToolCalls(fence({ name: 'file_read', input: 'hi', path: 'a.js' })), [{ name: 'file_read', input: { path: 'a.js', _text: 'hi' } }]);
  });
});

describe('parseToolCalls: cap + edge positions', () => {
  it('more than 8 calls are capped at 8', () => {
    let s = '';
    for (let i = 0; i < 10; i++) s += fence({ name: 'git_status', input: {} }) + '\n';
    assert.equal(parseToolCalls(s).length, 8);
  });
  it('exactly 8 calls all survive', () => {
    let s = '';
    for (let i = 0; i < 8; i++) s += fence({ name: 'git_status', input: {} }) + '\n';
    assert.equal(parseToolCalls(s).length, 8);
  });
  it('7 calls all survive', () => {
    let s = '';
    for (let i = 0; i < 7; i++) s += fence({ name: 'git_status', input: {} }) + '\n';
    assert.equal(parseToolCalls(s).length, 7);
  });
  it('fence surrounded by prose still parses', () => {
    assert.equal(parseToolCalls('hello\n' + fence({ name: 'git_log', input: {} }) + '\nbye').length, 1);
  });
  it('whitespace between fence tag and JSON is tolerated', () => {
    assert.deepEqual(parseToolCalls('```tool   \n{"name":"git_log","input":{}}\n```'), [{ name: 'git_log', input: {} }]);
  });
  it('capped output preserves first-8 order', () => {
    let s = '';
    for (let i = 0; i < 10; i++) s += fence({ name: i % 2 ? 'git_log' : 'git_status', input: { i } }) + '\n';
    const out = parseToolCalls(s);
    assert.equal(out[0].input.i, 0);
    assert.equal(out[7].input.i, 7);
  });
  it('json fence with unknown tool is dropped', () => {
    assert.deepEqual(parseToolCalls('```json\n{"name":"hack","input":{}}\n```'), []);
  });
});
