'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../server.js');
const { resolveRoute, thinkFor, policyFor, globToRegExp, TOOL_DEFS } = S;
const KEYED = { localEndpoint: 'http://localhost:11434', cloudEndpoint: 'https://ollama.com', cloudKey: 'sk-live' };
const FREE = { localEndpoint: 'http://localhost:11434', cloudEndpoint: 'https://ollama.com', cloudKey: '' };
const ro = (n) => TOOL_DEFS.find((t) => t.name === n);
const Agent = () => ro('Agent');

describe('resolveRoute', () => {
  it('keyed cloud routes to cloudEndpoint with key and bare model', () => {
    assert.deepEqual(resolveRoute('cloud', 'llama3', KEYED), { base: 'https://ollama.com', key: 'sk-live', model: 'llama3', viaLocal: false });
  });
  it('keyless cloud routes to localEndpoint without key', () => {
    const r = resolveRoute('cloud', 'llama3', FREE);
    assert.equal(r.base, 'http://localhost:11434');
    assert.equal(r.key, '');
    assert.equal(r.viaLocal, true);
  });
  it('keyless cloud appends :cloud suffix', () => {
    assert.equal(resolveRoute('cloud', 'llama3', FREE).model, 'llama3:cloud');
  });
  it('keyless cloud leaves already-suffixed :cloud model untouched', () => {
    assert.equal(resolveRoute('cloud', 'm:cloud', FREE).model, 'm:cloud');
  });
  it('keyless cloud leaves already-suffixed -cloud model untouched', () => {
    assert.equal(resolveRoute('cloud', 'm-cloud', FREE).model, 'm-cloud');
  });
  it('keyed cloud strips :cloud suffix to bare name', () => {
    assert.equal(resolveRoute('cloud', 'm:cloud', KEYED).model, 'm');
  });
  it('keyed cloud strips -cloud suffix to bare name', () => {
    assert.equal(resolveRoute('cloud', 'm-cloud', KEYED).model, 'm');
  });
  it('keyed cloud keeps plain model as-is', () => {
    assert.equal(resolveRoute('cloud', 'gpt-oss:20b', KEYED).model, 'gpt-oss:20b');
  });
  it('local scope passes model through with key set', () => {
    assert.deepEqual(resolveRoute('local', 'llama3', KEYED), { base: 'http://localhost:11434', key: '', model: 'llama3', viaLocal: false });
  });
  it('local scope passes model through without key', () => {
    assert.deepEqual(resolveRoute('local', 'llama3', FREE), { base: 'http://localhost:11434', key: '', model: 'llama3', viaLocal: false });
  });
  it('local scope never sets viaLocal even keyless', () => {
    assert.equal(resolveRoute('local', 'x', FREE).viaLocal, false);
  });
  it('local scope never appends :cloud', () => {
    assert.equal(resolveRoute('local', 'llama3', FREE).model, 'llama3');
  });
  it('undefined scope behaves like local (local base, no key)', () => {
    const r = resolveRoute(undefined, 'm', KEYED);
    assert.equal(r.base, 'http://localhost:11434');
    assert.equal(r.key, '');
    assert.equal(r.viaLocal, false);
  });
  it('unknown scope string behaves like local', () => {
    assert.equal(resolveRoute('mars', 'm', KEYED).base, 'http://localhost:11434');
  });
  it('viaLocal is a real boolean true', () => {
    assert.equal(resolveRoute('cloud', 'm', FREE).viaLocal, true);
  });
  it('viaLocal is a real boolean false when keyed', () => {
    assert.equal(resolveRoute('cloud', 'm', KEYED).viaLocal, false);
  });
  it('non-string model passes through untouched (keyless)', () => {
    assert.equal(resolveRoute('cloud', 42, FREE).model, 42);
  });
  it('non-string model passes through untouched (keyed)', () => {
    assert.equal(resolveRoute('cloud', 42, KEYED).model, 42);
  });
  it('whitespace-only key counts as empty (keyless free path)', () => {
    const r = resolveRoute('cloud', 'm', { localEndpoint: 'L', cloudEndpoint: 'C', cloudKey: ' ' });
    assert.equal(r.base, 'L');
    assert.equal(r.viaLocal, true);
  });
  it('keyless mid-string :cloud still gets suffix appended', () => {
    assert.equal(resolveRoute('cloud', 'a:cloud/b', FREE).model, 'a:cloud/b:cloud');
  });
  it('keyed cloud passes key value through verbatim', () => {
    assert.equal(resolveRoute('cloud', 'm', KEYED).key, 'sk-live');
  });
  it('base values come from cfg, not hardcoded', () => {
    const r = resolveRoute('cloud', 'm', { localEndpoint: 'L9', cloudEndpoint: 'C9', cloudKey: 'K9' });
    assert.equal(r.base, 'C9');
    assert.equal(resolveRoute('local', 'm', { localEndpoint: 'L9', cloudEndpoint: 'C9', cloudKey: '' }).base, 'L9');
  });
});

describe('thinkFor', () => {
  it("Low -> false", () => {
    assert.equal(thinkFor('Low'), false);
  });
  it("'low' lowercase -> false", () => {
    assert.equal(thinkFor('low'), false);
  });
  it("'LOW' uppercase -> false", () => {
    assert.equal(thinkFor('LOW'), false);
  });
  it("Medium -> true", () => {
    assert.equal(thinkFor('Medium'), true);
  });
  it("'medium' lowercase -> true", () => {
    assert.equal(thinkFor('medium'), true);
  });
  it("'MEDIUM' uppercase -> true", () => {
    assert.equal(thinkFor('MEDIUM'), true);
  });
  it("High -> 'high'", () => {
    assert.equal(thinkFor('High'), 'high');
  });
  it("'HIGH' uppercase -> 'high'", () => {
    assert.equal(thinkFor('HIGH'), 'high');
  });
  it("'high' lowercase -> 'high'", () => {
    assert.equal(thinkFor('high'), 'high');
  });
  it('undefined defaults to true', () => {
    assert.equal(thinkFor(undefined), true);
  });
  it('null defaults to true', () => {
    assert.equal(thinkFor(null), true);
  });
  it("empty string defaults to true (falls back to 'Medium')", () => {
    assert.equal(thinkFor(''), true);
  });
  it('garbage string defaults to true', () => {
    assert.equal(thinkFor('garbage'), true);
  });
  it("'Medium-ish' (near miss) defaults to true", () => {
    assert.equal(thinkFor('Medium-ish'), true);
  });
  it("'high ' with trailing space trims to High -> 'high'", () => {
    assert.equal(thinkFor('high '), 'high');
  });
  it('false input defaults to true (falsy -> Medium)', () => {
    assert.equal(thinkFor(false), true);
  });
  it('Low returns boolean false, not a falsy string', () => {
    assert.equal(typeof thinkFor('Low'), 'boolean');
  });
  it('High returns the string high, not boolean true', () => {
    assert.equal(typeof thinkFor('High'), 'string');
  });
});

describe('policyFor', () => {
  it('read-only tool defaults to allow', () => {
    assert.equal(policyFor(ro('file_read'), { toolPolicy: {} }), 'allow');
  });
  it('git_log defaults to allow', () => {
    assert.equal(policyFor(ro('git_log'), { toolPolicy: {} }), 'allow');
  });
  it('write tool defaults to ask', () => {
    assert.equal(policyFor(ro('file_write'), { toolPolicy: {} }), 'ask');
  });
  it('bash_exec defaults to ask', () => {
    assert.equal(policyFor(ro('bash_exec'), { toolPolicy: {} }), 'ask');
  });
  it("saved 'allow' wins for a write tool", () => {
    assert.equal(policyFor(ro('file_write'), { toolPolicy: { file_write: 'allow' } }), 'allow');
  });
  it("saved 'deny' wins for a read tool", () => {
    assert.equal(policyFor(ro('file_read'), { toolPolicy: { file_read: 'deny' } }), 'deny');
  });
  it("saved 'ask' wins for a read tool", () => {
    assert.equal(policyFor(ro('file_read'), { toolPolicy: { file_read: 'ask' } }), 'ask');
  });
  it("saved 'deny' wins for a write tool", () => {
    assert.equal(policyFor(ro('bash_exec'), { toolPolicy: { bash_exec: 'deny' } }), 'deny');
  });
  it('invalid saved value is ignored (write -> ask)', () => {
    assert.equal(policyFor(ro('file_write'), { toolPolicy: { file_write: 'sometimes' } }), 'ask');
  });
  it('invalid saved value is ignored (read -> allow)', () => {
    assert.equal(policyFor(ro('grep'), { toolPolicy: { grep: 'yes' } }), 'allow');
  });
  it("uppercase 'ALLOW' is invalid -> default applies", () => {
    assert.equal(policyFor(ro('file_write'), { toolPolicy: { file_write: 'ALLOW' } }), 'ask');
  });
  it('empty-string saved value is ignored', () => {
    assert.equal(policyFor(ro('file_write'), { toolPolicy: { file_write: '' } }), 'ask');
  });
  it('null saved value is ignored', () => {
    assert.equal(policyFor(ro('file_write'), { toolPolicy: { file_write: null } }), 'ask');
  });
  it('Agent+General asks (gate even though Agent is read-only)', () => {
    assert.equal(policyFor(Agent(), { toolPolicy: {} }, { agent: 'General' }), 'ask');
  });
  it('Agent+general lowercase asks', () => {
    assert.equal(policyFor(Agent(), { toolPolicy: {} }, { agent: 'general' }), 'ask');
  });
  it('Agent+GENERAL uppercase asks', () => {
    assert.equal(policyFor(Agent(), { toolPolicy: {} }, { agent: 'GENERAL' }), 'ask');
  });
  it('Agent+Explore allows (plain read-only default)', () => {
    assert.equal(policyFor(Agent(), { toolPolicy: {} }, { agent: 'Explore' }), 'allow');
  });
  it('Agent+Plan allows', () => {
    assert.equal(policyFor(Agent(), { toolPolicy: {} }, { agent: 'Plan' }), 'allow');
  });
  it('Agent with no input allows', () => {
    assert.equal(policyFor(Agent(), { toolPolicy: {} }), 'allow');
  });
  it('Agent with empty agent string allows', () => {
    assert.equal(policyFor(Agent(), { toolPolicy: {} }, { agent: '' }), 'allow');
  });
  it("saved 'deny' beats Agent+General gate", () => {
    assert.equal(policyFor(Agent(), { toolPolicy: { Agent: 'deny' } }, { agent: 'General' }), 'deny');
  });
  it("saved 'allow' beats Agent+General gate", () => {
    assert.equal(policyFor(Agent(), { toolPolicy: { Agent: 'allow' } }, { agent: 'General' }), 'allow');
  });
  it('missing toolPolicy key falls back to defaults', () => {
    assert.equal(policyFor(ro('file_read'), {}), 'allow');
    assert.equal(policyFor(ro('file_write'), {}), 'ask');
  });
});

describe('globToRegExp', () => {
  it('** matches a bare filename', () => {
    assert.ok(globToRegExp('**').test('abc'));
  });
  it('* matches within a segment (a.js)', () => {
    assert.ok(globToRegExp('*.js').test('a.js'));
  });
  it('* does not cross slashes', () => {
    assert.ok(!globToRegExp('*.js').test('a/b.js'));
  });
  it('? matches exactly one non-slash char', () => {
    assert.ok(globToRegExp('a?c').test('abc'));
  });
  it('? does not match empty', () => {
    assert.ok(!globToRegExp('a?c').test('ac'));
  });
  it('? does not match a slash', () => {
    assert.ok(!globToRegExp('a?c').test('a/c'));
  });
  it('**/ prefix matches nested paths', () => {
    assert.ok(globToRegExp('src/**/*.ts').test('src/a/b.ts'));
  });
  it('**/ prefix matches bare **/*.js nested', () => {
    assert.ok(globToRegExp('**/*.js').test('x/y.js'));
  });
  it('src/*.ts matches direct child', () => {
    assert.ok(globToRegExp('src/*.ts').test('src/a.ts'));
  });
  it('src/*.ts does not match nested child', () => {
    assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  });
  it('matching is case-insensitive', () => {
    assert.ok(globToRegExp('ABC.js').test('abc.js'));
  });
  it('case-insensitive non-match still fails', () => {
    assert.ok(!globToRegExp('ABC.js').test('abd.js'));
  });
  it('literal dots are escaped (a.c != axc)', () => {
    assert.ok(globToRegExp('a.c').test('a.c'));
    assert.ok(!globToRegExp('a.c').test('axc'));
  });
  it('plus is escaped literally', () => {
    assert.ok(globToRegExp('a+b.js').test('a+b.js'));
    assert.ok(!globToRegExp('a+b.js').test('aab.js'));
  });
  it('parens are escaped literally', () => {
    assert.ok(globToRegExp('a+b(c).js').test('a+b(c).js'));
  });
  it('character classes are escaped (literal brackets)', () => {
    assert.ok(globToRegExp('a[bc]').test('a[bc]'));
    assert.ok(!globToRegExp('a[bc]').test('ab'));
  });
  it('dollar is escaped literally', () => {
    assert.ok(globToRegExp('a$b').test('a$b'));
  });
  it('pipe is escaped literally', () => {
    assert.ok(globToRegExp('a|b').test('a|b'));
    assert.ok(!globToRegExp('a|b').test('a'));
  });
  it('caret is escaped literally', () => {
    assert.ok(globToRegExp('^a').test('^a'));
    assert.ok(!globToRegExp('^a').test('a'));
  });
  it('pattern is anchored (no prefix match)', () => {
    assert.ok(!globToRegExp('a.js').test('xa.js'));
  });
  it('pattern is anchored (no suffix match)', () => {
    assert.ok(!globToRegExp('a.js').test('a.jsb'));
  });
  it('exact match without wildcards', () => {
    assert.ok(globToRegExp('src/app.ts').test('src/app.ts'));
  });
  it('exact pattern rejects other paths', () => {
    assert.ok(!globToRegExp('src/app.ts').test('src/app2.ts'));
  });
  it('returns a RegExp instance', () => {
    assert.ok(globToRegExp('*.js') instanceof RegExp);
  });
  // FIXED (was BUG-CURRENT): placeholder-first rewrite keeps the (.*/)? group
  // intact, so ** spans directories and **/ is optional.
  it('FIXED: ** spans directories', () => {
    assert.ok(globToRegExp('**').test('a/b'));
  });
  it('FIXED: src/**/*.ts matches direct child src/a.ts', () => {
    assert.ok(globToRegExp('src/**/*.ts').test('src/a.ts'));
  });
  it('FIXED: **/*.js matches top-level a.js', () => {
    assert.ok(globToRegExp('**/*.js').test('a.js'));
    assert.ok(globToRegExp('**/*.js').test('sub/a.js'));
    assert.ok(globToRegExp('**/*.js').test('sub/deep/a.js'));
  });
});
