import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './core-loader.mjs';
import { environment, assertRepair, base } from './guard.test.mjs';
import { supportedTool } from '../lib/guard.js';

const version = '0.2.2-rc.3';
const core = await loadCore(version);
const rc3 = options => environment({ core, version, actualEntry: false, ...options });

test('rc3 official native tool shape is recognized and empty model triple is repaired', async () => {
  const e = await rc3();
  assert.equal(supportedTool(e.initialDef, version), true);
  assert.equal(e.initialDef.output.schema.properties.name.type, 'string');
  assert.equal(typeof e.initialDef.output.presentationMeta, 'function');
  assert.equal(Object.hasOwn(e.initialDef.output.schema.properties, 'subagentId'), false);
  const result = await e.invoke({ ...base, provider: '', model: '', reasoning_effort: '' });
  assertRepair(e, result);
  assert.equal(result.meta.name, 'agent-1');
});

test('rc3 explicit child name survives recovery and presentation metadata', async () => {
  const e = await rc3();
  const result = await e.invoke({ ...base, name: 'release-check', provider: '' });
  assert.equal(result.isError, false, result.error?.message);
  assert.equal(result.value.name, 'release-check');
  assert.equal(result.meta.name, 'release-check');
  assert.equal(e.stats.starts.length, 1);
  assert.equal(e.stats.pre.length, 2);
  assert.equal(e.stats.pre[1].arguments.name, 'release-check');
});

test('rc3 exact route error with no recorded policy restores inheritance', async () => {
  const e = await rc3({ policy: null });
  assertRepair(e, await e.invoke({ ...base, provider: 'unlisted', model: 'not-real' }));
  assert.equal(e.stats.preflight.length, 0);
});

for (const [label, fields] of [
  ['effort only', { reasoning_effort: 'high' }],
  ['provider plus effort', { provider: 'allowed', reasoning_effort: 'high' }],
  ['model plus effort', { model: 'valid', reasoning_effort: 'high' }]
]) test(`rc3 effort pair rule is recovered: ${label}`, async () => {
  const e = await rc3();
  assertRepair(e, await e.invoke({ ...base, ...fields }));
  assert.equal(e.stats.starts[0].agentOptions, undefined);
});

test('rc3 non-model name validation is not repaired', async () => {
  const e = await rc3();
  const result = await e.invoke({ ...base, name: 7, provider: '' });
  assert.equal(result.isError, true);
  assert.equal(e.stats.repairs.length, 0);
  assert.equal(e.stats.starts.length, 0);
});

test('rc3 valid explicit route, effort and name remain untouched', async () => {
  const e = await rc3();
  const result = await e.invoke({ ...base, name: 'named-ok', provider: 'allowed', model: 'valid', reasoning_effort: 'low' });
  assert.equal(result.isError, false, result.error?.message);
  assert.equal(e.stats.repairs.length, 0);
  assert.equal(e.stats.pre.length, 1);
  assert.equal(e.stats.starts[0].name, 'named-ok');
  assert.deepEqual({ ...e.stats.starts[0].agentOptions }, { provider: 'allowed', model: 'valid', reasoningEffort: 'low' });
  assert.equal(result.meta.name, 'named-ok');
});

test('rc3 tool output compatibility is shared with rc2, not rc1', async () => {
  const rc1Core = await loadCore('0.2.2-rc.1');
  const rc2Core = await loadCore('0.2.2-rc.2');
  const one = await environment({ core: rc1Core, version: '0.2.2-rc.1' });
  const two = await environment({ core: rc2Core, version: '0.2.2-rc.2' });
  const three = await rc3();
  assert.equal(supportedTool(one.initialDef, version), false);
  assert.equal(supportedTool(two.initialDef, version), true);
  assert.equal(supportedTool(three.initialDef, '0.2.2-rc.2'), true);
  assert.equal(supportedTool(three.initialDef, '0.2.2-rc.1'), false);
});
