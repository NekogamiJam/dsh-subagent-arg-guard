import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './core-loader.mjs';
import { environment, assertRepair, base } from './guard.test.mjs';
import { supportedTool } from '../lib/guard.js';
const core = await loadCore('0.2.2-rc.2');
const rc2 = options => environment({ core, version: '0.2.2-rc.2', ...options });

for (const [label, fields] of [
  ['empty triple', { provider: '', model: '', reasoning_effort: '' }],
  ['null route', { provider: null, model: null }],
  ['wrong types', { provider: 3, model: {} }],
  ['provider only', { provider: 'allowed' }],
  ['model only', { model: 'valid' }],
  ['effort only', { reasoning_effort: 'high' }],
  ['effort plus provider', { provider: 'allowed', reasoning_effort: 'high' }],
  ['effort plus model', { model: 'valid', reasoning_effort: 'high' }],
  ['empty effort', { reasoning_effort: '' }],
  ['unauthorized route', { provider: 'bad', model: 'invented' }]
]) test(`rc2 vanilla repair: ${label}`, async () => {
  const e = await rc2(); const result = await e.invoke({ ...base, ...fields });
  assertRepair(e, result);
  assert.equal(e.stats.starts[0].agentOptions, undefined);
  assert.equal(result.meta.kind, 'activation'); assert.equal(result.meta.name, 'agent-1');
});

test('rc2 exact no-policy suffix restores inherited route', async () => {
  const e = await rc2({ policy: null }); assertRepair(e, await e.invoke({ ...base, provider: 'bad', model: 'invented' }));
});
test('rc2 supplied name survives recovery and presentation metadata', async () => {
  const e = await rc2(); const result = await e.invoke({ ...base, name: 'audit-2', provider: '' });
  assert.equal(result.isError, false); assert.equal(result.value.name, 'audit-2');
  assert.equal(result.meta.name, 'audit-2'); assert.equal(e.stats.starts[0].name, 'audit-2');
  assert.equal(e.stats.starts.length, 1); assert.equal(e.stats.post.length, 1); assert.equal(e.stats.results.length, 1);
  assert.equal(e.stats.pre[1].arguments.name, 'audit-2');
});
test('rc2 non-model name type error cannot be repaired', async () => {
  const e = await rc2(); const result = await e.invoke({ ...base, name: 7, provider: '' });
  assert.equal(result.isError, true); assert.equal(e.stats.starts.length, 0); assert.equal(e.stats.repairs.length, 0);
});
test('rc2 runtime name rejection remains a real backend failure after one repair', async () => {
  const e = await rc2({ startError: new Error('invalid subagent name') });
  const result = await e.invoke({ ...base, name: 'INVALID', provider: '' });
  assert.equal(result.error.message, 'invalid subagent name'); assert.equal(e.stats.starts.length, 1);
  assert.equal(e.stats.repairs.filter(x => x.phase === 'attempt').length, 1);
});
test('rc2 omission preserves defaults, explicit unchanged parent route uses model effort default', async () => {
  const e = await rc2({ policy: null });
  let result = await e.invoke(base); assert.equal(result.isError, false); assert.equal(e.stats.starts[0].agentOptions, undefined);
  result = await e.invoke({ ...base, provider: 'parent-provider', model: 'parent-model' });
  assert.equal(result.isError, false); assert.equal(e.stats.preflight[0].reasoningEffort, undefined);
  assert.equal(e.stats.starts[1].agentOptions.reasoningEffort, undefined); assert.equal(e.stats.repairs.length, 0);
});
test('rc2 valid explicit route and effort are unchanged', async () => {
  const e = await rc2(); const result = await e.invoke({ ...base, provider: 'allowed', model: 'valid', reasoning_effort: 'low' });
  assert.equal(result.isError, false); assert.equal(e.stats.repairs.length, 0);
  assert.deepEqual({ ...e.stats.starts[0].agentOptions }, { provider: 'allowed', model: 'valid', reasoningEffort: 'low' });
});
test('rc2 native configured defaults survive repair', async () => {
  const nativeDefaults = { provider: 'native', model: 'native-model', reasoningEffort: 'medium' };
  const e = await rc2({ nativeDefaults }); assertRepair(e, await e.invoke({ ...base, provider: '' }), nativeDefaults);
});
test('rc2 model selection disabled remains recoverable without inventing route', async () => {
  const e = await rc2({ modelSelection: false }); assertRepair(e, await e.invoke({ ...base, provider: null }));
});
test('rc2 fork repairs preserve fork backend contract', async () => {
  const e = await rc2({ fork: true }); assertRepair(e, await e.invoke({ ...base, provider: '' }));
  assert.equal(e.stats.starts[0].agentOptions, undefined);
});
test('rc2 guard denial stays structured and is never swallowed', async () => {
  const e = await rc2({ guard: exec => !Object.hasOwn(exec.arguments, 'provider') ? { reason: 'clean route denied', info: { name: 'PolicyError', code: 'POLICY_DENIED' } } : undefined });
  const result = await e.invoke({ ...base, provider: '' });
  assert.equal(result.error.message, 'clean route denied'); assert.equal(result.error.info.code, 'POLICY_DENIED');
  assert.equal(e.stats.starts.length, 0); assert.equal(e.stats.pre.length, 2);
});
test('rc2 PTC nested admission preserves metadata and parent proof', async () => {
  const e = await rc2({ ptc: true }); const parent = Symbol('run-code'); const snapshot = new Map(e.registry);
  const toolSet = { view: () => snapshot }; const schema = { name: 'subagent' };
  assertRepair(e, await e.invoke({ ...base, reasoning_effort: 'high' }, { parent, toolSet, schema }));
});
test('rc2 PTC direct call remains forbidden', async () => {
  const e = await rc2({ ptc: true }); const result = await e.invoke({ ...base, provider: '' });
  assert.equal(result.error.info.code, 'UNKNOWN_TOOL'); assert.equal(e.stats.repairs.length, 0);
});
for (const phase of ['pre', 'dispatch']) for (const change of ['definition', 'executor', 'pipeline']) {
  test(`rc2 hot ${change} replacement during ${phase} fails closed`, async () => {
    let replacementCalls = 0;
    const mutate = e => {
      if (change === 'definition') e.registry.set('subagent', { ...e.initialDef, execute: async () => { replacementCalls++; return { kind: 'activation', name: 'wrong' }; } });
      if (change === 'executor') e.executor = new core.native.NativeToolExecutor(e.ctx);
      if (change === 'pipeline') e.executor.pipeline = new core.pipeline.ToolExecutionPipeline(e.ctx);
    };
    const e = await rc2({
      pre: async (exec, next, stats) => { if (phase === 'pre' && stats.pre.length === 2) { await Promise.resolve(); mutate(e); } return next(); },
      dispatchHook: async (exec, next, env) => { if (phase === 'dispatch' && !Object.hasOwn(exec.arguments, 'provider')) { await Promise.resolve(); mutate(env); } return next(); }
    });
    assert.equal((await e.invoke({ ...base, provider: '' })).isError, true);
    assert.equal(replacementCalls, 0); assert.equal(e.stats.starts.length, 0);
  });
}
for (const version of ['0.2.2-rc.1', '0.2.2-rc.2']) {
  const env = options => environment({ ...options, version, core: version === '0.2.2-rc.1' ? undefined : core });
  test(`${version}: optional disallowed-route recovery switch`, async () => {
    const e = await env({ guardConfig: { repairDisallowedRoutes: false } });
    assert.equal((await e.invoke({ ...base, provider: 'bad', model: 'invented' })).isError, true);
    assert.equal(e.stats.repairs.length, 0); assert.equal(e.stats.starts.length, 0);
    const fresh = await env({ guardConfig: { repairDisallowedRoutes: false } });
    assertRepair(fresh, await fresh.invoke({ ...base, provider: '' }));
  });
  test(`${version}: optional fork recovery switch`, async () => {
    const e = await env({ fork: true, guardConfig: { repairForks: false } });
    assert.equal((await e.invoke({ ...base, provider: '' })).isError, true); assert.equal(e.stats.repairs.length, 0);
  });
}
test('version-specific output contracts cannot be interchanged', async () => {
  const one = await environment(); const two = await rc2();
  assert.equal(supportedTool(one.initialDef, '0.2.2-rc.2'), false);
  assert.equal(supportedTool(two.initialDef, '0.2.2-rc.1'), false);
  assert.equal(supportedTool(two.initialDef, '0.2.2-rc.3'), false);
});
test('rc2 cancellation during retry pre-execute keeps no child', async () => {
  const e = await rc2({ pre: async (_exec, next, stats) => { if (stats.pre.length === 2) e.controller.abort(); return next(); } });
  const result = await e.invoke({ ...base, reasoning_effort: 'high' });
  assert.equal(result.error.info.code, 'ABORTED_BEFORE_DISPATCH'); assert.equal(e.stats.starts.length, 0);
});
test('rc2 output presentation error after child creation is not a recovery trigger', async () => {
  const e = await rc2(); e.initialDef.output.presentationMeta = () => { throw Error('bad projection'); };
  const result = await e.invoke({ ...base, provider: 'allowed', model: 'valid' });
  assert.equal(result.isError, true); assert.equal(e.stats.starts.length, 1); assert.equal(e.stats.repairs.length, 0);
});
test('rc2 reinjected bad route is attempted once only', async () => {
  const e = await rc2({ dispatchHook: async (exec, next) => {
    if (!Object.hasOwn(exec.arguments, 'provider')) exec.arguments = Object.freeze({ ...exec.arguments, provider: '' });
    return next();
  } });
  assert.equal((await e.invoke({ ...base, provider: '' })).isError, true);
  assert.equal(e.stats.pre.length, 2); assert.equal(e.stats.starts.length, 0);
  assert.equal(e.stats.repairs.filter(x => x.phase === 'attempt').length, 1);
});
