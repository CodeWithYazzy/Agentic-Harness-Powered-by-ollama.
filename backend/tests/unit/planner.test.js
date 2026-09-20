'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../server.js');
const { planFor, resolveCommitRef, slashToGit } = S;
const C2 = [{ hash: 'aaa1111bbb2222', short: 'aaa1111' }, { hash: 'bbb2222ccc3333', short: 'bbb2222' }, { hash: 'ccc3333ddd4444', short: 'ccc3333' }];
const C5 = [...C2, { hash: 'dddddddddd0000', short: 'ddd4444' }, { hash: 'eeeeeeeeee1111', short: 'eee5555' }];

describe('planFor: command kind', () => {
  it("slash prefix routes to command ('/log 5')", () => {
    assert.deepEqual(planFor('/log 5', []), { kind: 'command', text: '/log 5' });
  });
  it("slash status routes to command", () => {
    assert.deepEqual(planFor('/status', []), { kind: 'command', text: '/status' });
  });
  it("slash commit routes to command", () => {
    assert.deepEqual(planFor('/commit', []), { kind: 'command', text: '/commit' });
  });
  it("'git status' routes to command (not git_status)", () => {
    assert.deepEqual(planFor('git status', []), { kind: 'command', text: 'git status' });
  });
  it("'git diff' routes to command", () => {
    assert.deepEqual(planFor('git diff', []), { kind: 'command', text: 'git diff' });
  });
  it("'git show HEAD' routes to command", () => {
    assert.deepEqual(planFor('git show HEAD', []), { kind: 'command', text: 'git show HEAD' });
  });
  it("'git log' routes to command (starts with git-space)", () => {
    assert.deepEqual(planFor('git log', []), { kind: 'command', text: 'git log' });
  });
  it('command preserves original text casing', () => {
    assert.equal(planFor('/LOG 5', []).text, '/LOG 5');
  });
  it("bare '/git' routes to command", () => {
    assert.deepEqual(planFor('/git', []), { kind: 'command', text: '/git' });
  });
});

describe('slashToGit: /git catalogue (H1 regression)', () => {
  it("bare '/git' maps to status --short --branch", () => {
    assert.deepEqual(slashToGit('/git'), ['status', '--short', '--branch']);
  });
  it("bare 'git' maps to status", () => {
    assert.deepEqual(slashToGit('git'), ['status', '--short', '--branch']);
  });
  it("'/git log 5' maps like /log", () => {
    assert.deepEqual(slashToGit('/git log 5')[0], 'log');
  });
  it("'/git status' maps to status", () => {
    assert.deepEqual(slashToGit('/git status'), ['status', '--short', '--branch']);
  });
  it("'/git diff' maps to diff stat", () => {
    assert.equal(slashToGit('/git diff')[0], 'diff');
  });
  it("'/git branch' maps to branch -vv", () => {
    assert.deepEqual(slashToGit('/git branch'), ['branch', '-vv']);
  });
  it("'/git show HEAD' maps to show", () => {
    assert.equal(slashToGit('/git show HEAD')[0], 'show');
  });
  it("'/git push' (not allowlisted) returns null", () => {
    assert.equal(slashToGit('/git push'), null);
  });
  it("'/commit' still maps to last-commit log", () => {
    assert.deepEqual(slashToGit('/commit'), ['log', '-1', '--stat']);
  });
});

describe('planFor: git_log kind', () => {
  it("'show last 3 commits' extracts n=3", () => {
    assert.deepEqual(planFor('show last 3 commits', []), { kind: 'git_log', n: 3 });
  });
  it("'show last 10 commits' extracts n=10", () => {
    assert.deepEqual(planFor('show last 10 commits', []), { kind: 'git_log', n: 10 });
  });
  it("'show last 1 commit' extracts n=1", () => {
    assert.deepEqual(planFor('show last 1 commit', []), { kind: 'git_log', n: 1 });
  });
  it("'last 3 commits please' extracts n=3", () => {
    assert.deepEqual(planFor('last 3 commits please', []), { kind: 'git_log', n: 3 });
  });
  it("'recent commits' defaults to n=5", () => {
    assert.deepEqual(planFor('recent commits', []), { kind: 'git_log', n: 5 });
  });
  it("'latest commits' defaults to n=5", () => {
    assert.deepEqual(planFor('latest commits', []), { kind: 'git_log', n: 5 });
  });
  it("'commit history' defaults to n=5", () => {
    assert.deepEqual(planFor('commit history', []), { kind: 'git_log', n: 5 });
  });
  it("'show git log' defaults to n=5", () => {
    assert.deepEqual(planFor('show git log', []), { kind: 'git_log', n: 5 });
  });
  it("'show last commits' (no number) defaults to n=5", () => {
    assert.deepEqual(planFor('show last commits', []), { kind: 'git_log', n: 5 });
  });
  it('huge N clamps to 20 (last 999 commits)', () => {
    assert.deepEqual(planFor('show last 999 commits', []), { kind: 'git_log', n: 20 });
  });
  it('zero N falls back to 2 (last 0 commits)', () => {
    assert.deepEqual(planFor('show last 0 commits', []), { kind: 'git_log', n: 2 });
  });
  it("'show 7 commits' (no last/recent) is git_show_ref, not git_log", () => {
    assert.deepEqual(planFor('show 7 commits', []), { kind: 'git_show_ref' });
  });
});

describe('planFor: git_show_ref kind', () => {
  it("'tell me about the last commit' (singular, no number) inspects", () => {
    assert.deepEqual(planFor('tell me about the last commit', []), { kind: 'git_show_ref' });
  });
  it("'show the first commit' inspects", () => {
    assert.deepEqual(planFor('show the first commit', []), { kind: 'git_show_ref' });
  });
  it("'show the second commit' inspects", () => {
    assert.deepEqual(planFor('show the second commit', []), { kind: 'git_show_ref' });
  });
  it("'show the third commit' inspects", () => {
    assert.deepEqual(planFor('show the third commit', []), { kind: 'git_show_ref' });
  });
  it("'show the fourth commit' inspects", () => {
    assert.deepEqual(planFor('show the fourth commit', []), { kind: 'git_show_ref' });
  });
  it("'show the fifth commit' inspects", () => {
    assert.deepEqual(planFor('show the fifth commit', []), { kind: 'git_show_ref' });
  });
  it("'show the last commit' inspects", () => {
    assert.deepEqual(planFor('show the last commit', []), { kind: 'git_show_ref' });
  });
  it("'show the 4th commit' inspects", () => {
    assert.deepEqual(planFor('show the 4th commit', []), { kind: 'git_show_ref' });
  });
  it("'explain the second commit' inspects", () => {
    assert.deepEqual(planFor('explain the second commit', []), { kind: 'git_show_ref' });
  });
  it("'describe the last commit' inspects", () => {
    assert.deepEqual(planFor('describe the last commit', []), { kind: 'git_show_ref' });
  });
  it("'inspect the third commit' inspects", () => {
    assert.deepEqual(planFor('inspect the third commit', []), { kind: 'git_show_ref' });
  });
  it("'that one' with commits context inspects", () => {
    assert.deepEqual(planFor('that one', C2), { kind: 'git_show_ref' });
  });
  it("'it' with commits context inspects", () => {
    assert.deepEqual(planFor('it', C2), { kind: 'git_show_ref' });
  });
  it("'the second' with commits context inspects", () => {
    assert.deepEqual(planFor('the second', C2), { kind: 'git_show_ref' });
  });
  it("'that one' without commits context is chat", () => {
    assert.deepEqual(planFor('that one', []), { kind: 'chat' });
  });
  it("'it' without commits context is chat", () => {
    assert.deepEqual(planFor('it', []), { kind: 'chat' });
  });
  it("'the second' without commits context is chat", () => {
    assert.deepEqual(planFor('the second', []), { kind: 'chat' });
  });
  it("'files changed in it' inspects (files-changed)", () => {
    assert.deepEqual(planFor('files changed in it', C2), { kind: 'git_show_ref' });
  });
  it("'what files were changed' inspects", () => {
    assert.deepEqual(planFor('what files were changed', []), { kind: 'git_show_ref' });
  });
  it("'file list' inspects", () => {
    assert.deepEqual(planFor('file list', []), { kind: 'git_show_ref' });
  });
});

describe('planFor: list_dir kind (directory questions)', () => {
  it("'what is in my current directory' lists", () => {
    assert.deepEqual(planFor("what is in my current directory", []), { kind: 'list_dir' });
  });
  it("'what\\'s in this folder' lists", () => {
    assert.deepEqual(planFor("what's in this folder", []), { kind: 'list_dir' });
  });
  it("'show me the directory' lists", () => {
    assert.deepEqual(planFor('show me the directory', []), { kind: 'list_dir' });
  });
  it("'list files here' lists", () => {
    assert.deepEqual(planFor('list files here', []), { kind: 'list_dir' });
  });
  it("bare 'ls' lists", () => {
    assert.deepEqual(planFor('ls', []), { kind: 'list_dir' });
  });
  it("'file list' still inspects commits (git_show_ref wins)", () => {
    assert.deepEqual(planFor('file list', []), { kind: 'git_show_ref' });
  });
  it("'what files were changed' still inspects commits", () => {
    assert.deepEqual(planFor('what files were changed', []), { kind: 'git_show_ref' });
  });
  it("'list branches' is still git_status", () => {
    assert.deepEqual(planFor('list branches', []), { kind: 'git_status' });
  });
  it("'show changes' is still git_diff", () => {
    assert.deepEqual(planFor('show changes', []), { kind: 'git_diff' });
  });
  it("'List the project structure' stays out (tool loop handles it)", () => {
    assert.deepEqual(planFor('List the project structure', []).kind, 'chat');
  });
});

describe('planFor: git_diff / git_status kind', () => {
  it("'show my diff please' is git_diff", () => {
    assert.deepEqual(planFor('show my diff please', []), { kind: 'git_diff' });
  });
  it("'uncommitted changes?' is git_diff", () => {
    assert.deepEqual(planFor('uncommitted changes?', []), { kind: 'git_diff' });
  });
  it("'what changed in working tree' is git_diff", () => {
    assert.deepEqual(planFor('what changed in working tree', []), { kind: 'git_diff' });
  });
  it("'show changes' is git_diff", () => {
    assert.deepEqual(planFor('show changes', []), { kind: 'git_diff' });
  });
  it("'what branch am i on' is git_status", () => {
    assert.deepEqual(planFor('what branch am i on', []), { kind: 'git_status' });
  });
  it("'list branches' is git_status", () => {
    assert.deepEqual(planFor('list branches', []), { kind: 'git_status' });
  });
  it("'status please' is git_status", () => {
    assert.deepEqual(planFor('status please', []), { kind: 'git_status' });
  });
});

describe('planFor: chat regressions', () => {
  it("'explain git status command' is chat, not git_status", () => {
    assert.deepEqual(planFor('explain git status command', []), { kind: 'chat' });
  });
  it("'explain the status command' is chat", () => {
    assert.deepEqual(planFor('explain the status command', []), { kind: 'chat' });
  });
  it("'what does git status command do' is chat", () => {
    assert.deepEqual(planFor('what does git status command do', []), { kind: 'chat' });
  });
  it("'how do I check status' is chat (how-to question)", () => {
    assert.deepEqual(planFor('how do I check status', []), { kind: 'chat' });
  });
  it("'what is a branch' is chat (what-is question)", () => {
    assert.deepEqual(planFor('what is a branch', []), { kind: 'chat' });
  });
  it("bare 'hello' is chat", () => {
    assert.deepEqual(planFor('hello', []), { kind: 'chat' });
  });
  it("'read the docs' (no file) is chat", () => {
    assert.deepEqual(planFor('read the docs', []), { kind: 'chat' });
  });
  it("'show /tmp/x' (no extension) is chat", () => {
    assert.deepEqual(planFor('show /tmp/x', []), { kind: 'chat' });
  });
  it('empty string is chat', () => {
    assert.deepEqual(planFor('', []), { kind: 'chat' });
  });
});

describe('planFor: read_file extraction + extensions', () => {
  it('extracts package.json', () => {
    assert.deepEqual(planFor('read package.json and explain', []), { kind: 'read_file', file: 'package.json' });
  });
  it('extracts src/index.ts', () => {
    assert.deepEqual(planFor('open src/index.ts look at bug', []), { kind: 'read_file', file: 'src/index.ts' });
  });
  it('extracts .java file', () => {
    assert.deepEqual(planFor('read src/App.java please explain', []), { kind: 'read_file', file: 'src/App.java' });
  });
  it('extracts .json file', () => {
    assert.deepEqual(planFor('open data.json and explain', []), { kind: 'read_file', file: 'data.json' });
  });
  it('extracts .md file', () => {
    assert.deepEqual(planFor('open README.md and explain', []), { kind: 'read_file', file: 'README.md' });
  });
  it('extracts .yaml file', () => {
    assert.deepEqual(planFor('look at config.yaml explain', []), { kind: 'read_file', file: 'config.yaml' });
  });
  it('extracts .cpp file', () => {
    assert.deepEqual(planFor('fix bug in app.cpp please show', []), { kind: 'read_file', file: 'app.cpp' });
  });
  it('extracts .c file', () => {
    assert.deepEqual(planFor('fix bug in app.c please show', []), { kind: 'read_file', file: 'app.c' });
  });
  it('extracts .go file', () => {
    assert.deepEqual(planFor('read main.go and explain', []), { kind: 'read_file', file: 'main.go' });
  });
  it('extracts .rs file', () => {
    assert.deepEqual(planFor('open lib.rs look at bug', []), { kind: 'read_file', file: 'lib.rs' });
  });
  it('extracts .h file', () => {
    assert.deepEqual(planFor('read header.h explain', []), { kind: 'read_file', file: 'header.h' });
  });
  it('extracts .toml file', () => {
    assert.deepEqual(planFor('open config.toml and explain', []), { kind: 'read_file', file: 'config.toml' });
  });
  it('extracts .py file', () => {
    assert.deepEqual(planFor('explain script.py bug', []), { kind: 'read_file', file: 'script.py' });
  });
});

describe('resolveCommitRef', () => {
  it('full 13-hex hash resolves to matching commit', () => {
    assert.deepEqual(resolveCommitRef('show aaa1111bbb2222 please', C2), C2[0]);
  });
  it('short 7-hex hash resolves via startsWith', () => {
    assert.deepEqual(resolveCommitRef('show bbb2222', C2), C2[1]);
  });
  it('40-hex hash resolves to matching commit', () => {
    const h = 'a'.repeat(40);
    assert.deepEqual(resolveCommitRef('show ' + h, [{ hash: h }]), { hash: h });
  });
  it('uppercase hash works (text is lowercased first)', () => {
    assert.deepEqual(resolveCommitRef('show ABC1234DEF', [{ hash: 'abc1234def9999' }]), { hash: 'abc1234def9999' });
  });
  it('#-prefixed hash works', () => {
    assert.deepEqual(resolveCommitRef('show #abc1234def', [{ hash: 'abc1234def9999' }]), { hash: 'abc1234def9999' });
  });
  it('6-hex string does not trigger hash branch', () => {
    assert.equal(resolveCommitRef('show abc123 please', [{ hash: 'x' }]), null);
  });
  it("'first' resolves to index 0", () => {
    assert.deepEqual(resolveCommitRef('show the first commit', C2), C2[0]);
  });
  it("'second' resolves to index 1", () => {
    assert.deepEqual(resolveCommitRef('show the second commit', C2), C2[1]);
  });
  it("'third' resolves to index 2", () => {
    assert.deepEqual(resolveCommitRef('show the third commit', C2), C2[2]);
  });
  it("'last' resolves to final commit", () => {
    assert.deepEqual(resolveCommitRef('show the last commit', C2), C2[2]);
  });
  it("'4th' resolves to index 3", () => {
    assert.deepEqual(resolveCommitRef('show the 4th commit', C5), C5[3]);
  });
  it("'5th' resolves to index 4", () => {
    assert.deepEqual(resolveCommitRef('the 5th one', C5), C5[4]);
  });
  it("'2nd' resolves to index 1", () => {
    assert.deepEqual(resolveCommitRef('the 2nd one', C2), C2[1]);
  });
  it("'3rd' resolves to index 2", () => {
    assert.deepEqual(resolveCommitRef('the 3rd one', C2), C2[2]);
  });
  it("'1st' resolves to index 0", () => {
    assert.deepEqual(resolveCommitRef('the 1st one', C2), C2[0]);
  });
  it("'fourth' resolves to index 3", () => {
    assert.deepEqual(resolveCommitRef('the fourth commit', C5), C5[3]);
  });
  it("'fifth' resolves to index 4", () => {
    assert.deepEqual(resolveCommitRef('the fifth commit', C5), C5[4]);
  });
  it('ordinal beyond list length returns null (third of two)', () => {
    assert.equal(resolveCommitRef('the third commit', C2.slice(0, 2)), null);
  });
  it('empty commits returns null even for hash text', () => {
    assert.equal(resolveCommitRef('show abcdef1234567', []), null);
  });
  it('undefined commits returns null', () => {
    assert.equal(resolveCommitRef('show abc1234def', undefined), null);
  });
  it('hash beats ordinal when both present', () => {
    assert.deepEqual(resolveCommitRef('show the first commit aaa1111bbb2222', C2), C2[0]);
  });
  it('hash beats ordinal even when hash belongs to another commit', () => {
    const r = resolveCommitRef('show the last commit bbb2222ccc3333', C2);
    assert.deepEqual(r, C2[1]);
  });
  it('unknown hash returns {hash} shell object', () => {
    assert.deepEqual(resolveCommitRef('show deadbee12345', C2), { hash: 'deadbee12345' });
  });
  it('plain text with no ref returns null', () => {
    assert.equal(resolveCommitRef('hello world', C2), null);
  });
});
