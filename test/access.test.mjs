import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, base } from './guard.test.mjs';
import { loadCore } from './core-loader.mjs';
import { createToolAccessPolicy } from '../lib/access.js';

for (const version of ['0.2.2-rc.1', '0.2.2-rc.2']) {
  const core = await loadCore(version);
  for (const fork of [false, true]) {
    const field = fork ? 'allowSubagentFork' : 'allowSubagent';
    const other = fork ? 'allowSubagent' : 'allowSubagentFork';
    const name = fork ? 'subagent_fork' : 'subagent';
    const env = (extra = {}) => environment({ core, version, fork, actualEntry: true, ...extra });
    test(`${version} ${name}: disabled blocks valid and malformed calls before native body`, async () => {
      for (const args of [base, { ...base, provider: '' }]) {
        const e = await env({ entryConfig: { [field]: false } });
        const result = await e.invoke(args);
        assert.equal(result.isError, true); assert.match(result.error.message, /disabled in Subagent Arg Guard settings/);
        assert.equal(e.stats.starts.length, 0); assert.equal(e.stats.preflight.length, 0);
        assert.equal(e.stats.pre.length, 1); assert.equal(e.stats.post.length, 1); assert.equal(e.stats.results.length, 1);
      }
    });
    test(`${version} ${name}: independent default-on flag; repair-off does not enable disabled tool`, async () => {
      const permitted = await env({ entryConfig: { [other]: false, enabled: false } });
      assert.equal((await permitted.invoke(base)).isError, false);
      const denied = await env({ entryConfig: { [field]: false, enabled: false } });
      assert.equal((await denied.invoke(base)).isError, true); assert.equal(denied.stats.starts.length, 0);
      const repair = await env({ entryConfig: { [other]: false } });
      assert.equal((await repair.invoke({ ...base, provider: '' })).isError, false);
    });
    test(`${version} ${name}: volatile off/on applies to subsequent calls without restarting`, async () => {
      let allow = true;
      const e = await env({ entryConfig: { [field]: { get: () => allow } } });
      assert.equal((await e.invoke(base)).isError, false);
      allow = false;
      assert.equal((await e.invoke(base)).isError, true);
      allow = true;
      assert.equal((await e.invoke(base)).isError, false);
      assert.equal(e.stats.starts.length, 2);
    });
    test(`${version} ${name}: disable between prepare and dispatch is enforced`, async () => {
      let allow = true;
      const e = await env({ entryConfig: { [field]: { get: () => allow } } });
      const p = e.executor.pipeline;
      const prepared = await p.prepare({ callId: 'pending', name, arguments: base, agent: e.parent, signal: e.controller.signal });
      assert.equal(prepared.kind, 'dispatch'); allow = false;
      const dispatched = await p.dispatch(prepared.exec);
      const result = await p.complete(prepared.exec, dispatched);
      assert.equal(result.isError, true); assert.equal(result.error.info.code, 'SUBAGENT_TOOL_DISABLED');
      assert.equal(e.stats.starts.length, 0);
    });
    test(`${version} ${name}: disabling during repaired prepare denies retry`, async () => {
      let allow = true;
      const e = await env({ entryConfig: { [field]: { get: () => allow } }, pre: (exec, next, stats) => { if (stats.pre.length === 2) allow = false; return next(); } });
      const result = await e.invoke({ ...base, provider: '' });
      assert.equal(result.isError, true); assert.match(result.error.message, /disabled/);
      assert.equal(e.stats.starts.length, 0); assert.equal(e.stats.pre.length, 2);
      assert.equal(e.stats.post.length, 1); assert.equal(e.stats.results.length, 1);
    });
    test(`${version} ${name}: disabling does not cancel a body already started`, async () => {
      let allow = true, entered, release;
      const started = new Promise(resolve => { entered = resolve; });
      const pending = new Promise(resolve => { release = resolve; });
      const e = await env({ entryConfig: { [field]: { get: () => allow } }, onStart: async () => { entered(); await pending; } });
      const first = e.invoke(base);
      await started; allow = false;
      assert.equal((await e.invoke(base)).isError, true);
      assert.equal(e.controller.signal.aborted, false);
      release(); assert.equal((await first).isError, false);
      assert.equal(e.stats.starts.length, 1);
    });
    test(`${version} ${name}: broken policy view denies without throwing`, async () => {
      const e = await env({ entryConfig: { [field]: { get() { throw Error('disposed'); } } } });
      assert.equal((await e.invoke(base)).isError, true); assert.equal(e.stats.starts.length, 0);
    });
    test(`${version} ${name}: real PTC binding cannot create when disabled`, async () => {
      let innerError;
      const runtime = { language: 'typescript', retainsState: false, resolve: spec => ({ ...spec, timeoutMs: 60000 }), release() {},
        async run(spec) {
          try { await spec.bindings[0].functions[name]({ ...base, provider: '' }); }
          catch (error) { innerError = error; return { logs: [], error: { kind: 'error', message: error.message } }; }
          return { logs: [], value: 'unexpected-success' };
        } };
      const e = await env({ ptc: true, entryConfig: { [field]: false }, services: { ptcRuntime: runtime, workingDirectory: { ensure: async () => base.cwd } } });
      const batch = await e.executor.execute({ calls: [{ id: 'outer', name: 'run_code', arguments: JSON.stringify({ code: 'disabled-tool-test', description: 'Exercise tool policy' }) }], agent: e.parent, signal: e.controller.signal, log: { turn: 1, step: 1 } });
      assert.equal(batch.results[0].result.isError, true);
      assert.match(innerError?.message ?? '', /disabled in Subagent Arg Guard settings/);
      assert.equal(e.stats.starts.length, 0);
    });
  }
  test(`${version}: access policy ignores unrelated tools and keeps denial contract`, async () => {
    const p = createToolAccessPolicy({ version, allowSubagent: false, allowSubagentFork: false });
    const denied = p.guard({ name: 'subagent' });
    assert.equal(typeof denied, version === '0.2.2-rc.1' ? 'string' : 'object');
    assert.equal(p.guard({ name: 'send_message' }), undefined);
    assert.equal(await p.execute({ name: 'interrupt_agent' }, async () => 'unchanged'), 'unchanged');
  });
}
