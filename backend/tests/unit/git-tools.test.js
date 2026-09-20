'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../server.js');
const { sanitizeGitArgs, parseLog } = S;

describe('sanitizeGitArgs: tool mapping', () => {
  it('git_status maps to status --short --branch', () => {
    assert.deepEqual(sanitizeGitArgs('git_status', {}), ['status', '--short', '--branch']);
  });
  it('git_status ignores extra input fields', () => {
    assert.deepEqual(sanitizeGitArgs('git_status', { n: 99, ref: 'abc', path: 'x.js' }), ['status', '--short', '--branch']);
  });
  it('git_log maps to log with pretty format and iso date', () => {
    assert.deepEqual(sanitizeGitArgs('git_log', { n: 5 }), ['log', '-5', '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%D', '--date=iso']);
  });
  it('git_log honors n=2', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: 2 })[1], '-2');
  });
  it('git_log honors count alias when n missing', () => {
    assert.equal(sanitizeGitArgs('git_log', { count: 7 })[1], '-7');
  });
  it('git_log falls back to count when n is 0 (falsy)', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: 0, count: 7 })[1], '-7');
  });
  it('git_log ignores ref input (always log form)', () => {
    assert.equal(sanitizeGitArgs('git_log', { ref: 'deadbee', n: 2 })[1], '-2');
  });
  it('git_show without path uses --stat --patch --find-renames form', () => {
    assert.deepEqual(sanitizeGitArgs('git_show', { ref: 'HEAD' }), ['show', '--stat', '--patch', '--find-renames', 'HEAD']);
  });
  it('git_show with path uses --stat --oneline form with -- separator', () => {
    assert.deepEqual(sanitizeGitArgs('git_show', { ref: 'abc1234', path: 'a.js' }), ['show', '--stat', '--oneline', 'abc1234', '--', 'a.js']);
  });
  it('git_show defaults missing ref to HEAD', () => {
    assert.equal(sanitizeGitArgs('git_show', {})[4], 'HEAD');
  });
  it('git_diff without path ends with bare -- separator', () => {
    assert.deepEqual(sanitizeGitArgs('git_diff', {}), ['diff', 'HEAD', '--stat', '--patch', '--find-renames', '--']);
  });
  it('git_diff with path appends the path after --', () => {
    const a = sanitizeGitArgs('git_diff', { path: 'x.js' });
    assert.deepEqual(a, ['diff', 'HEAD', '--stat', '--patch', '--find-renames', '--', 'x.js']);
  });
  it('git_diff accepts file alias for path', () => {
    assert.deepEqual(sanitizeGitArgs('git_diff', { file: 'y.ts' }), ['diff', 'HEAD', '--stat', '--patch', '--find-renames', '--', 'y.ts']);
  });
  it('git_branch maps to branch -vv', () => {
    assert.deepEqual(sanitizeGitArgs('git_branch', {}), ['branch', '-vv']);
  });
  it('git_rev_parse maps to rev-parse --abbrev-ref HEAD', () => {
    assert.deepEqual(sanitizeGitArgs('git_rev_parse', {}), ['rev-parse', '--abbrev-ref', 'HEAD']);
  });
  it('git_blame with path returns blame line-porcelain form', () => {
    assert.deepEqual(sanitizeGitArgs('git_blame', { path: 'f.js', ref: 'HEAD' }), ['blame', '--line-porcelain', '-L', '1,50', 'HEAD', '--', 'f.js']);
  });
  it('git_blame -L window scales with n (n=3 -> 1,30)', () => {
    assert.equal(sanitizeGitArgs('git_blame', { path: 'f.js', n: 3 })[3], '1,30');
  });
  it('git_blame -L window clamps with n=50 (1,500)', () => {
    assert.equal(sanitizeGitArgs('git_blame', { path: 'f.js', n: 50 })[3], '1,500');
  });
  it('git_blame returns null without path', () => {
    assert.equal(sanitizeGitArgs('git_blame', {}), null);
  });
  it('git_blame returns null with empty-string path', () => {
    assert.equal(sanitizeGitArgs('git_blame', { path: '' }), null);
  });
  it('git_grep returns grep -n -I -e form with trailing --', () => {
    assert.deepEqual(sanitizeGitArgs('git_grep', { query: 'foo' }), ['grep', '-n', '-I', '-e', 'foo', '--']);
  });
  it('git_grep keeps -e flag position before query', () => {
    const a = sanitizeGitArgs('git_grep', { query: 'bar' });
    assert.equal(a[a.indexOf('-e') + 1], 'bar');
  });
  it('git_grep returns null for empty query', () => {
    assert.equal(sanitizeGitArgs('git_grep', { query: '' }), null);
  });
  it('git_grep returns null when query missing', () => {
    assert.equal(sanitizeGitArgs('git_grep', {}), null);
  });
  it('git_grep caps query at 200 chars', () => {
    assert.equal(sanitizeGitArgs('git_grep', { query: 'q'.repeat(300) })[4].length, 200);
  });
  it('git_grep keeps query under cap intact', () => {
    assert.equal(sanitizeGitArgs('git_grep', { query: 'hello world' })[4], 'hello world');
  });
  it('unknown tool returns null', () => {
    assert.equal(sanitizeGitArgs('nope', {}), null);
  });
  it('empty tool name returns null', () => {
    assert.equal(sanitizeGitArgs('', {}), null);
  });
  it('git_push (non-allowlisted) returns null', () => {
    assert.equal(sanitizeGitArgs('git_push', {}), null);
  });
  it('git_checkout (non-allowlisted) returns null', () => {
    assert.equal(sanitizeGitArgs('git_checkout', { ref: 'main' }), null);
  });
  it('case-sensitive: GIT_LOG returns null', () => {
    assert.equal(sanitizeGitArgs('GIT_LOG', {}), null);
  });
});

describe('sanitizeGitArgs: n/count clamping', () => {
  it('n=0 falls back to default 5', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: 0 })[1], '-5');
  });
  it('negative n clamps to 1', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: -5 })[1], '-1');
  });
  it('n=-1 clamps to 1', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: -1 })[1], '-1');
  });
  it('huge n clamps to 50', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: 999 })[1], '-50');
  });
  it('n=51 clamps to 50', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: 51 })[1], '-50');
  });
  it('n=50 stays 50', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: 50 })[1], '-50');
  });
  it('n=1 stays 1', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: 1 })[1], '-1');
  });
  it('NaN n falls back to 5', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: NaN })[1], '-5');
  });
  it('non-numeric string n falls back to 5', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: 'abc' })[1], '-5');
  });
  it('numeric string n parses ("10" -> -10)', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: '10' })[1], '-10');
  });
  it('float string n truncates via parseInt ("7.9" -> -7)', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: '7.9' })[1], '-7');
  });
  it('null n falls back to 5', () => {
    assert.equal(sanitizeGitArgs('git_log', { n: null })[1], '-5');
  });
  it('undefined n falls back to 5', () => {
    assert.equal(sanitizeGitArgs('git_log', {})[1], '-5');
  });
  it('count alias clamps huge values too', () => {
    assert.equal(sanitizeGitArgs('git_log', { count: 1000 })[1], '-50');
  });
  it('count alias clamps negatives too', () => {
    assert.equal(sanitizeGitArgs('git_log', { count: -3 })[1], '-1');
  });
});

describe('sanitizeGitArgs: ref sanitization', () => {
  const refOf = (ref) => sanitizeGitArgs('git_show', { ref })[4];
  it('spaces are stripped from ref', () => {
    assert.equal(refOf('a b'), 'ab');
  });
  it('semicolons are stripped from ref', () => {
    assert.equal(refOf('a;b'), 'ab');
  });
  it('shell substitution $(...) is stripped from ref', () => {
    assert.equal(refOf('a$(b)'), 'ab');
  });
  it('backticks are stripped from ref', () => {
    assert.equal(refOf('a`b`'), 'ab');
  });
  it('pipes and ampersands are stripped from ref', () => {
    assert.equal(refOf('a|b&c'), 'abc');
  });
  it('leading -- is stripped (--help -> help)', () => {
    assert.equal(refOf('--help'), 'help');
  });
  it('multiple leading dashes are stripped (---x -> x)', () => {
    assert.equal(refOf('---x'), 'x');
  });
  it('empty ref falls back to HEAD', () => {
    assert.equal(refOf(''), 'HEAD');
  });
  it('whitespace-only ref falls back to HEAD (chars stripped -> empty)', () => {
    assert.equal(refOf('   '), 'HEAD');
  });
  it('fully-stripped ref (;$&) falls back to HEAD', () => {
    assert.equal(refOf(';$&'), 'HEAD');
  });
  it('ref capped at 120 chars', () => {
    assert.equal(refOf('a'.repeat(200)).length, 120);
  });
  it('ref under cap untouched', () => {
    assert.equal(refOf('v1.0.0'), 'v1.0.0');
  });
  it('slashes survive (origin/main)', () => {
    assert.equal(refOf('origin/main'), 'origin/main');
  });
  it('tilde survives (HEAD~3)', () => {
    assert.equal(refOf('HEAD~3'), 'HEAD~3');
  });
  it('caret survives (HEAD^)', () => {
    assert.equal(refOf('HEAD^'), 'HEAD^');
  });
  it('colon survives (abc:def)', () => {
    assert.equal(refOf('abc:def'), 'abc:def');
  });
  it('at-sign survives, braces stripped (HEAD@{1} -> HEAD@1)', () => {
    assert.equal(refOf('HEAD@{1}'), 'HEAD@1');
  });
  it('dots survive (v1.0.0)', () => {
    assert.equal(refOf('v1.0.0'), 'v1.0.0');
  });
  it('commit alias input maps to ref', () => {
    assert.equal(sanitizeGitArgs('git_show', { commit: 'abc1234' })[4], 'abc1234');
  });
  it('git_blame uses sanitized ref too', () => {
    assert.equal(sanitizeGitArgs('git_blame', { path: 'f.js', ref: '--x' })[4], 'x');
  });
});

describe('sanitizeGitArgs: fpath handling', () => {
  const fpathOf = (p) => sanitizeGitArgs('git_show', { ref: 'HEAD', path: p })[5];
  it('.. sequences are stripped from path', () => {
    assert.ok(!fpathOf('../../etc/passwd').includes('..'));
  });
  it('dotdot-stripped traversal still yields a path arg', () => {
    assert.equal(fpathOf('../../etc/passwd'), '//etc/passwd');
  });
  it('single dots in filename survive (a.js)', () => {
    assert.equal(fpathOf('a.js'), 'a.js');
  });
  it('path capped at 500 chars', () => {
    assert.equal(fpathOf('x'.repeat(600)).length, 500);
  });
  it('short path untouched', () => {
    assert.equal(fpathOf('src/index.ts'), 'src/index.ts');
  });
  it('file alias feeds fpath', () => {
    assert.equal(sanitizeGitArgs('git_show', { ref: 'HEAD', file: 'q.md' })[5], 'q.md');
  });
  it('git_diff strips .. from path', () => {
    const a = sanitizeGitArgs('git_diff', { path: '../x.js' });
    assert.ok(!a[a.length - 1].includes('..'));
  });
});

describe('parseLog', () => {
  it('parses a normal line into all six fields', () => {
    const [c] = parseLog('aaa1111\x1faaa1111\x1fBob\x1f2024-01-01\x1fFix bug\x1f (HEAD -> main)');
    assert.deepEqual(c, { hash: 'aaa1111', short: 'aaa1111', author: 'Bob', date: '2024-01-01', subject: 'Fix bug', refs: ' (HEAD -> main)' });
  });
  it('empty output yields empty array', () => {
    assert.deepEqual(parseLog(''), []);
  });
  it('blank lines are skipped', () => {
    const rows = parseLog('a\x1fb\x1fc\x1fd\x1fe\x1f\n\nc\x1fd\x1fe\x1ff\x1fg\x1fh\n');
    assert.equal(rows.length, 2);
  });
  it('missing refs field defaults to empty string', () => {
    const [c] = parseLog('h\x1fs\x1fa\x1fd\x1fsubj');
    assert.equal(c.refs, '');
    assert.equal(c.subject, 'subj');
  });
  it('multiple lines each become one commit', () => {
    const rows = parseLog('h1\x1fs1\x1fa\x1fd\x1fs1\x1f\nh2\x1fs2\x1fa\x1fd\x1fs2\x1f\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].hash, 'h1');
    assert.equal(rows[1].hash, 'h2');
  });
  it('subject containing spaces is preserved whole', () => {
    const [c] = parseLog('h\x1fs\x1fa\x1fd\x1fAdd new feature X (fixes #42)\x1f');
    assert.equal(c.subject, 'Add new feature X (fixes #42)');
  });
  it('trailing newline does not create a phantom commit', () => {
    assert.equal(parseLog('h\x1fs\x1fa\x1fd\x1fs\x1fr\n').length, 1);
  });
  it('output of only newlines yields empty array', () => {
    assert.deepEqual(parseLog('\n\n\n'), []);
  });
  it('refs decorations preserved verbatim', () => {
    const [c] = parseLog('h\x1fs\x1fa\x1fd\x1fs\x1fHEAD -> main, tag: v2');
    assert.equal(c.refs, 'HEAD -> main, tag: v2');
  });
  it('unicode subjects survive', () => {
    const [c] = parseLog('h\x1fs\x1fa\x1fd\x1fÜnïcödé ✓\x1f');
    assert.equal(c.subject, 'Ünïcödé ✓');
  });
});
