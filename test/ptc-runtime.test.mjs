import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, base, baseForVersion } from './guard.test.mjs';
import { loadCore } from './core-loader.mjs';
for (const version of ['0.2.2-rc.2', '0.2.2-rc.3', '0.2.2-rc.4', '0.2.2-rc.5', '0.2.3-alpha.1', '0.2.3-alpha.2']) {
const malformed = { ...baseForVersion(version), provider: version.startsWith('0.2.3-alpha.') ? 'allowed' : '' };
const core = await loadCore(version);

for (const exceed of [false, true]) test(`${version} real PTC binding counts repaired call once; excess=${exceed}`, async () => {
  let first;
  const runtime = {
    language: 'typescript', retainsState: false,
    resolve(spec) { return { ...spec, timeoutMs: 60000 }; },
    release() {},
    async run(spec) {
      const functions = spec.bindings[0].functions;
      first = await functions.subagent(malformed);
      if (exceed) {
        try { await functions.subagent(malformed); }
        catch (error) { return { logs: [], output: [], error: { kind: 'abort', message: error.message } }; }
        throw Error('expected the second binding attempt to be rejected');
      }
      return { logs: [], output: [], value: first };
    }
  };
  const e = await environment({ core, version, ptc: true, services: {
    ptcRuntime: runtime, workingDirectory: { ensure: async () => base.cwd }
  } });
  const batch = await e.executor.execute({ calls: [{ id: 'outer', name: 'run_code', arguments: JSON.stringify({ code: 'host-substrate-test', description: 'Exercise repaired subagent budget' }) }], agent: e.parent, signal: e.controller.signal, log: { turn: 1, step: 1 } });
  const result = batch.results[0].result;
  if (version.startsWith('0.2.3-alpha.')) assert.ok(first);
  else assert.equal(first.name, 'agent-1');
  assert.equal(e.stats.starts.length, 1); // Retry does not submit a second binding.
  assert.equal(e.stats.repairs.filter(x => x.phase === 'attempt').length, 1);
  assert.equal(e.stats.logs.filter(x => x.type === 'tool/ptc-dispatch-start').length, 1);
  assert.equal(e.stats.logs.filter(x => x.type === 'tool/ptc-dispatch').length, 1);
  assert.equal(e.stats.logs.filter(x => x.type === 'tool/call').length, 1);
  assert.equal(e.stats.logs.filter(x => x.type === 'tool/result').length, 1);
  assert.equal(result.isError, exceed, result.error?.message);
  if (exceed) {
    assert.equal(result.error.info.code, 'CODE_RUN_FAILED');
    assert.match(result.error.message, /call 2 was not dispatched/);
  } else if (!version.startsWith('0.2.3-alpha.')) {
    assert.equal(result.value.result.name, 'agent-1');
  }
});
}
