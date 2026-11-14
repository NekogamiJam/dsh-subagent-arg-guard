import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRuntimeVersion, readFlag } from '../lib/runtime.js';
import { loadCore } from './core-loader.mjs';
import { loadEntry } from './entry-loader.mjs';
import { environment, base } from './guard.test.mjs';

for (const version of ['0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3']) {
  test(`runtime detection selects exact ${version}`, async () => {
    assert.deepEqual(await detectRuntimeVersion(async () => ({ getDshRuntimeVersion: () => version })), { version, supported: true, reason: 'supported' });
  });
  test(`actual production entry recovers on ${version}`, async () => {
    const core = await loadCore(version);
    const e = await environment({ core, version, actualEntry: true });
    const result = await e.invoke({ ...base, provider: '' });
    assert.equal(result.isError, false, result.error?.message);
    assert.equal(e.stats.starts.length, 1);
    assert.equal(e.stats.pre.length, 2);
  });
}
for (const version of ['0.2.2', '0.2.2-rc.4', '0.2.1', 'v0.2.2-rc.1', ' 0.2.2-rc.1 ', '', null]) {
  test(`unknown/untrusted runtime is inactive: ${JSON.stringify(version)}`, async () => {
    const e = await environment({ actualEntry: true, detectedVersion: version === null ? '' : version });
    const result = await e.invoke({ ...base, provider: '' });
    assert.equal(result.isError, true);
    assert.equal(e.stats.pre.length, 1);
    assert.equal(e.stats.starts.length, 0);
  });
}
test('runtime load failure / missing API / thrown API fails closed', async () => {
  for (const load of [async () => { throw Error('missing'); }, async () => ({}), async () => ({ getDshRuntimeVersion() { throw Error('broken'); } })]) {
    assert.equal((await detectRuntimeVersion(load)).supported, false);
  }
  const e = await environment({ actualEntry: true, versionFailure: true });
  assert.equal((await e.invoke({ ...base, provider: '' })).isError, true);
  assert.equal(e.stats.starts.length, 0);
});
test('native Config exposes six default-on volatile boolean switches', async () => {
  const entry = await loadEntry();
  assert.equal(entry.Config[Symbol.for('schemastery')], true);
  assert.deepEqual(Object.keys(entry.Config.dict), ['allowSubagent', 'allowSubagentFork', 'enabled', 'repairDisallowedRoutes', 'repairForks', 'logRepairs']);
  for (const field of Object.values(entry.Config.dict)) {
    assert.equal(field.type, 'boolean'); assert.equal(field.meta.default, true); assert.equal(field.meta.volatile, true);
  }
});
test('plain and volatile boolean values remain distinct from invalid values', () => {
  assert.equal(readFlag(false), false);
  assert.equal(readFlag({ get: () => false }), false);
  assert.equal(readFlag({ get: () => true }), true);
  assert.equal(readFlag(undefined), true);
  assert.equal(readFlag('false'), true);
  assert.equal(readFlag({ get() { throw Error('view disposed'); } }), false);
});
test('volatile enable switch is reread without rebuilding guard', async () => {
  let enabled = false;
  const e = await environment({ actualEntry: true, entryConfig: { enabled: { get: () => enabled } } });
  assert.equal((await e.invoke({ ...base, provider: '' })).isError, true);
  enabled = true;
  assert.equal((await e.invoke({ ...base, provider: '' })).isError, false);
  enabled = false;
  assert.equal((await e.invoke({ ...base, provider: '' })).isError, true);
  assert.equal(e.stats.starts.length, 1);
  for (const options of [
    { actualEntry: true, entryConfig: { enabled: { get() { throw Error('view disposed'); } } } },
    { guardConfig: { enabled() { throw Error('view disposed'); } } }
  ]) {
    const failedView = await environment(options);
    assert.equal((await failedView.invoke({ ...base, provider: '' })).isError, true);
    assert.equal((await failedView.invoke(base)).isError, false);
    assert.equal(failedView.stats.pre.length, 2);
    assert.equal(failedView.stats.starts.length, 1);
  }
});
test('turning off guard during original await prevents recovery', async () => {
  let enabled = true;
  const e = await environment({ guardConfig: { enabled: () => enabled }, dispatchHook: async (_exec, next) => { const result = await next(); enabled = false; return result; } });
  assert.equal((await e.invoke({ ...base, provider: '' })).isError, true);
  assert.equal(e.stats.starts.length, 0);
});
