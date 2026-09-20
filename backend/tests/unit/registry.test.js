'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../server.js');
const { TOOL_DEFS, SUBAGENTS, DEFAULT_CONFIG, allToolDefs, mcpToolDefs } = S;
const byName = (n) => TOOL_DEFS.find((t) => t.name === n);
const READ = TOOL_DEFS.filter((t) => t.readOnly).map((t) => t.name);
const WRITE = TOOL_DEFS.filter((t) => !t.readOnly).map((t) => t.name);

describe('TOOL_DEFS: shape invariants', () => {
  it('has at least 19 tools', () => {
    assert.ok(TOOL_DEFS.length >= 19, `got ${TOOL_DEFS.length}`);
  });
  it('tool names are unique', () => {
    const names = TOOL_DEFS.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
  });
  it('every name is a non-empty string', () => {
    for (const t of TOOL_DEFS) assert.ok(typeof t.name === 'string' && t.name.length > 0, JSON.stringify(t));
  });
  it('every description is a non-empty string', () => {
    for (const t of TOOL_DEFS) assert.ok(typeof t.description === 'string' && t.description.length > 0, t.name);
  });
  it('every readOnly is a boolean', () => {
    for (const t of TOOL_DEFS) assert.equal(typeof t.readOnly, 'boolean', t.name);
  });
  it('every modes is a non-empty array', () => {
    for (const t of TOOL_DEFS) assert.ok(Array.isArray(t.modes) && t.modes.length > 0, t.name);
  });
  it('every mode is chat or build only', () => {
    for (const t of TOOL_DEFS) for (const m of t.modes) assert.ok(m === 'chat' || m === 'build', `${t.name}:${m}`);
  });
  it('Agent tool is present', () => {
    assert.ok(byName('Agent'));
  });
  it('all four Task* tools are present', () => {
    for (const n of ['TaskCreate', 'TaskList', 'TaskUpdate', 'TaskOutput']) assert.ok(byName(n), n);
  });
  it('all four git_* tools are present', () => {
    for (const n of ['git_log', 'git_show', 'git_diff', 'git_status']) assert.ok(byName(n), n);
  });
  it('core read tools are present', () => {
    for (const n of ['file_read', 'glob', 'grep', 'web_fetch', 'web_search', 'todo_write', 'ask_user']) assert.ok(byName(n), n);
  });
  it('write tools file_write/file_edit/bash_exec are present', () => {
    for (const n of ['file_write', 'file_edit', 'bash_exec']) assert.ok(byName(n), n);
  });
});

describe('TOOL_DEFS: per-tool entry checks', () => {
  for (const t of TOOL_DEFS) {
    it(`${t.name} has a description mentioning use`, () => {
      assert.ok(t.description.length > 10, t.name);
    });
    it(`${t.name} modes subset of chat|build`, () => {
      assert.deepEqual([...t.modes].sort(), [...new Set(t.modes)].sort());
      for (const m of t.modes) assert.ok(['chat', 'build'].includes(m));
    });
  }
  for (const n of WRITE) {
    it(`write tool ${n} is build-only`, () => {
      assert.deepEqual(byName(n).modes, ['build']);
    });
    it(`write tool ${n} is readOnly:false`, () => {
      assert.equal(byName(n).readOnly, false);
    });
  }
  for (const n of READ) {
    it(`read tool ${n} is offered in both modes`, () => {
      assert.ok(byName(n).modes.includes('chat') && byName(n).modes.includes('build'));
    });
    it(`read tool ${n} is readOnly:true`, () => {
      assert.equal(byName(n).readOnly, true);
    });
  }
});

describe('SUBAGENTS', () => {
  it('explore, plan, general all exist', () => {
    assert.deepEqual(Object.keys(SUBAGENTS).sort(), ['explore', 'general', 'plan']);
  });
  it('every subagent has a non-empty brief', () => {
    for (const [k, v] of Object.entries(SUBAGENTS)) assert.ok(typeof v.brief === 'string' && v.brief.length > 20, k);
  });
  it('explore brief says read-only', () => {
    assert.ok(/read-only/i.test(SUBAGENTS.explore.brief));
  });
  it('plan brief says read-only', () => {
    assert.ok(/read-only/i.test(SUBAGENTS.plan.brief));
  });
  it('general.tools is null (inherits parent belt)', () => {
    assert.equal(SUBAGENTS.general.tools, null);
  });
  it('explore.tools is a non-empty array', () => {
    assert.ok(Array.isArray(SUBAGENTS.explore.tools) && SUBAGENTS.explore.tools.length > 0);
  });
  it('plan.tools is a non-empty array', () => {
    assert.ok(Array.isArray(SUBAGENTS.plan.tools) && SUBAGENTS.plan.tools.length > 0);
  });
  it('explore tools are all read-only per TOOL_DEFS', () => {
    for (const n of SUBAGENTS.explore.tools) assert.equal(byName(n).readOnly, true, n);
  });
  it('plan tools are all read-only per TOOL_DEFS', () => {
    for (const n of SUBAGENTS.plan.tools) assert.equal(byName(n).readOnly, true, n);
  });
  it('explore tools all exist in TOOL_DEFS', () => {
    for (const n of SUBAGENTS.explore.tools) assert.ok(byName(n), n);
  });
  it('plan tools all exist in TOOL_DEFS', () => {
    for (const n of SUBAGENTS.plan.tools) assert.ok(byName(n), n);
  });
  it('explore excludes every write tool', () => {
    for (const n of WRITE) assert.ok(!SUBAGENTS.explore.tools.includes(n), n);
  });
  it('plan excludes every write tool', () => {
    for (const n of WRITE) assert.ok(!SUBAGENTS.plan.tools.includes(n), n);
  });
  it('explore excludes Agent (no nested spawn)', () => {
    assert.ok(!SUBAGENTS.explore.tools.includes('Agent'));
  });
  it('plan excludes Agent (no nested spawn)', () => {
    assert.ok(!SUBAGENTS.plan.tools.includes('Agent'));
  });
  it('plan includes todo_write but explore does not', () => {
    assert.ok(SUBAGENTS.plan.tools.includes('todo_write'));
    assert.ok(!SUBAGENTS.explore.tools.includes('todo_write'));
  });
  it('both include file_read, glob, grep', () => {
    for (const n of ['file_read', 'glob', 'grep']) {
      assert.ok(SUBAGENTS.explore.tools.includes(n), `explore:${n}`);
      assert.ok(SUBAGENTS.plan.tools.includes(n), `plan:${n}`);
    }
  });
});

describe('DEFAULT_CONFIG', () => {
  it('has all nine required keys', () => {
    assert.deepEqual(Object.keys(DEFAULT_CONFIG).sort(), ['cloudEndpoint', 'cloudKey', 'customCommands', 'defaultModel', 'defaultReasoning', 'hooks', 'localEndpoint', 'mcpServers', 'toolPolicy'].sort());
  });
  it('localEndpoint is a string http URL', () => {
    assert.equal(typeof DEFAULT_CONFIG.localEndpoint, 'string');
    assert.ok(DEFAULT_CONFIG.localEndpoint.startsWith('http'));
  });
  it('cloudEndpoint is a string https URL', () => {
    assert.equal(typeof DEFAULT_CONFIG.cloudEndpoint, 'string');
    assert.ok(DEFAULT_CONFIG.cloudEndpoint.startsWith('https'));
  });
  it('cloudKey defaults to empty string', () => {
    assert.equal(DEFAULT_CONFIG.cloudKey, '');
  });
  it('defaultModel defaults to empty string', () => {
    assert.equal(DEFAULT_CONFIG.defaultModel, '');
  });
  it('defaultReasoning defaults to Medium string', () => {
    assert.equal(DEFAULT_CONFIG.defaultReasoning, 'Medium');
  });
  it('toolPolicy is a plain object', () => {
    assert.ok(DEFAULT_CONFIG.toolPolicy && typeof DEFAULT_CONFIG.toolPolicy === 'object' && !Array.isArray(DEFAULT_CONFIG.toolPolicy));
  });
  it('toolPolicy defaults to empty (no overrides)', () => {
    assert.deepEqual(DEFAULT_CONFIG.toolPolicy, {});
  });
  it('hooks is an array', () => {
    assert.ok(Array.isArray(DEFAULT_CONFIG.hooks));
  });
  it('hooks default to empty', () => {
    assert.deepEqual(DEFAULT_CONFIG.hooks, []);
  });
  it('mcpServers is a plain object', () => {
    assert.ok(DEFAULT_CONFIG.mcpServers && typeof DEFAULT_CONFIG.mcpServers === 'object' && !Array.isArray(DEFAULT_CONFIG.mcpServers));
  });
  it('mcpServers default to empty', () => {
    assert.deepEqual(DEFAULT_CONFIG.mcpServers, {});
  });
  it('customCommands is an array', () => {
    assert.ok(Array.isArray(DEFAULT_CONFIG.customCommands));
  });
  it('customCommands default to empty', () => {
    assert.deepEqual(DEFAULT_CONFIG.customCommands, []);
  });
});

describe('allToolDefs / mcpToolDefs', () => {
  it('mcpToolDefs is empty with no live servers', () => {
    assert.deepEqual(mcpToolDefs(), []);
  });
  it('allToolDefs length equals TOOL_DEFS length when no MCP servers', () => {
    assert.equal(allToolDefs().length, TOOL_DEFS.length);
  });
  it('allToolDefs returns a fresh array each call', () => {
    assert.notEqual(allToolDefs(), allToolDefs());
    assert.notEqual(allToolDefs(), TOOL_DEFS);
  });
  it('allToolDefs preserves TOOL_DEFS order (first + last)', () => {
    const all = allToolDefs();
    assert.equal(all[0].name, TOOL_DEFS[0].name);
    assert.equal(all[all.length - 1].name, TOOL_DEFS[TOOL_DEFS.length - 1].name);
  });
  it('allToolDefs entries carry name/description/readOnly/modes', () => {
    for (const t of allToolDefs()) {
      assert.ok(t.name && t.description && Array.isArray(t.modes) && typeof t.readOnly === 'boolean');
    }
  });
});
