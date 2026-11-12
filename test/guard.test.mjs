import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './core-loader.mjs';
import { createGuard, captureCurrentPipeline, MODEL_FIELDS, supportedTool, validateKnownArguments, supportedParameters } from '../lib/guard.js';

import { loadEntry } from './entry-loader.mjs';
const core = await loadCore();
// Synthetic Windows path (including a space): passed through only, never accessed on disk.
export const base = { description: 'Check delegated task', prompt: 'Keep exact task\nwith unicode 中文.', cwd: 'C:\\work space' };

export async function environment(options = {}) {
  const api = options.core ?? core;
  const version = options.version ?? '0.2.2-rc.1';
  const handlers = new Map();
  const registry = new Map();
  const stats = { pre: [], post: [], results: [], repairs: [], starts: [], logs: [], preflight: [] };
  const controller = new AbortController();
  const parent = { options: { provider: 'parent-provider', model: 'parent-model', reasoningEffort: 'high' }, session: {
    id: Symbol('session'), append(type, data) { stats.logs.push({ type, data }); return { seq: stats.logs.length }; }
  } };
  let selected;
  const provider = { name: 'spawn', inheritsParentContext: !!options.fork, capabilities: { agentOptions: true, depthLimit: true } };
  const ctx = {
    logger: { info() {}, warn() {} },
    on(name, fn) { const array = handlers.get(name) ?? []; array.push(fn); handlers.set(name, array); },
    effect(fn) { return fn(); },
    inject(_needs, fn) { return fn(ctx); },
    get(name) { if (options.services && Object.hasOwn(options.services, name)) return options.services[name]; return name === 'llm' ? { async resolveCallConfig(route, signal) { stats.preflight.push(route); signal.throwIfAborted(); if (options.preflightError) throw options.preflightError; } } : undefined; },
    sessionProjections: { async register() { return { stateOf: () => options.policy === null ? null : (options.policy ?? [{ provider: 'allowed', model: 'valid' }]) }; } },
    systemPrompt: { section() {}, context() {}, getSectionOrder() { return 0; }, getContextOrder() { return 0; } },
    events: { dispatch(_kind, [_target, name]) { return handlers.get(name) ?? []; } },
    async waterfall(_target, name, ...args) {
      const terminal = args.pop();
      let index = 0;
      const next = () => index < (handlers.get(name)?.length ?? 0) ? handlers.get(name)[index++](...args, next) : terminal();
      return next();
    },
    tools: {
      register(def) { registry.set(def.name, def); return () => registry.delete(def.name); },
      executable(name, _agent, set) { return set ? set.view(_agent).get(name) : registry.get(name); },
      get(name) { return registry.get(name); },
      schemas() { return [...registry.values()].map(def => api.tools.projectToolSchema(def)); },
      selectExecutor() { if (!selected) throw Error('executor unavailable'); return selected; },
      checkGuards(exec) { return options.guard?.(exec); }
    },
    subagents: {
      getProvider(name) { return name === provider.name ? provider : undefined; },
      resolveMaxDepth() { return undefined; },
      async startActivation(spec) {
        stats.starts.push(spec);
        if (options.startError) throw options.startError;
        if (options.onStart) await options.onStart(spec, controller);
        return version === '0.2.2-rc.1' ? { childId: 'child-1' } : { name: spec.name ?? 'agent-1' };
      }
    }
  };
  parent.ctx = ctx;
  ctx.on('tools/pre-execute', async (exec, next) => { stats.pre.push(exec); return options.pre ? options.pre(exec, next, stats) : next(); });
  ctx.on('tools/post-execute', async (exec, result, next) => { stats.post.push({ exec, result }); return options.post ? options.post(exec, result, next) : next(); });
  ctx.on('tools/result', (exec, result) => stats.results.push({ exec, result }));
  await api.subagent.apply(ctx, { provider: 'spawn', toolName: options.fork ? 'subagent_fork' : 'subagent', modelSelection: options.modelSelection !== false, maxDepth: 'provider-managed', ...(options.nativeDefaults ? { agentOptions: options.nativeDefaults } : {}) });
  selected = options.ptc ? new api.ptc.PtcExecutor(ctx, { maxParallelSubCalls: 10, maxSubCallsPerMinute: 1 }) : new api.native.NativeToolExecutor(ctx);
  if (options.defaultsPlugin) {
    // Faithful installed plugin contract: explicit agentOptions win; fork skipped by default.
    const start = ctx.subagents.startActivation.bind(ctx.subagents);
    ctx.subagents.startActivation = spec => start(spec.request.agentOptions !== undefined || options.fork ? spec : {
      ...spec, request: { ...spec.request, agentOptions: { provider: 'pool-provider', model: 'pool-model', reasoningEffort: 'medium' } }
    });
  }
  if (options.realDefaultsPlugin) core.defaults.apply(ctx, {
    models: [{ provider: 'pool-a', model: 'model-a', reasoningEffort: 'medium' }, { provider: 'pool-b', model: 'model-b', reasoningEffort: 'low' }],
    strategy: 'round-robin', failoverEnabled: false, injectRouteContext: false,
    applyToForkChildren: !!options.applyPoolToFork
  });
  const guard = createGuard({
    pipelineFor: exec => captureCurrentPipeline(ctx, exec, version),
    validate: validateKnownArguments,
    version,
    ...options.guardConfig,
    report: event => { stats.repairs.push(event); if (options.report) options.report(event); }
  });
  if (options.actualEntry) await (await loadEntry({ version: options.detectedVersion ?? version, fail: !!options.versionFailure })).apply(ctx, options.entryConfig ?? {});
  else ctx.on('tools/execute', guard);
  if (options.dispatchHook) ctx.on('tools/execute', (exec, next) => options.dispatchHook(exec, next, env));
  const name = options.fork ? 'subagent_fork' : 'subagent';
  const initialDef = registry.get(name);
  assert.equal(supportedTool(initialDef, version), true, JSON.stringify({ parameters: initialDef.parameters, output: initialDef.output.schema }));
  const env = {
    ctx, stats, parent, controller, registry, initialDef, version, api,
    get executor() { return selected; },
    set executor(value) { selected = value; },
    async invoke(args, extra = {}) {
      const input = { callId: 'same-call', rootCallId: 'root', name, arguments: args, agent: parent, signal: controller.signal, ...extra };
      const pipe = selected.pipeline;
      const prepared = await pipe.prepare(input);
      const outcome = prepared.kind === 'dispatch' ? await pipe.dispatch(prepared.exec) : prepared;
      return pipe.complete(outcome.exec ?? prepared.exec, outcome);
    }
  };
  return env;
}

export function assertRepair(e, result, expected = undefined) {
  assert.equal(result.isError, false, result.error?.message);
  assert.equal(e.version === '0.2.2-rc.1' ? result.value.subagentId : result.value.name, e.version === '0.2.2-rc.1' ? 'child-1' : 'agent-1');
  assert.equal(e.stats.starts.length, 1);
  assert.equal(e.stats.pre.length, 2);
  assert.equal(e.stats.post.length, 1);
  assert.equal(e.stats.results.length, 1);
  assert.equal(e.stats.repairs.filter(x => x.phase === 'attempt').length, 1);
  const [original, repaired] = e.stats.pre;
  for (const field of MODEL_FIELDS) assert.equal(Object.hasOwn(repaired.arguments, field), false);
  assert.notEqual(original.token, repaired.token);
  assert.equal(repaired.agent, original.agent);
  assert.equal(repaired.parent, original.parent);
  assert.equal(repaired.toolSet, original.toolSet);
  assert.equal(repaired.schema, original.schema);
  assert.equal(repaired.callId, original.callId);
  assert.equal(repaired.rootCallId, original.rootCallId);
  assert.equal(repaired.signal, original.signal);
  assert.equal(e.stats.post[0].exec, original); // Original request + corrected outcome audit semantics.
  const request = e.version === '0.2.2-rc.1' ? e.stats.starts[0].request : e.stats.starts[0];
  assert.equal(request.prompt[0].text, base.prompt);
  assert.equal(request.cwd, base.cwd);
  if (expected) assert.deepEqual({ ...request.agentOptions }, expected);
}

for (const [label, fields] of [
  ['empty pair', { provider: '', model: '' }],
  ['empty model', { provider: 'allowed', model: '' }],
  ['null fields', { provider: null, model: null }],
  ['non-string fields', { provider: 7, model: {} }],
  ['provider only', { provider: 'allowed' }],
  ['model only', { model: 'valid' }],
  ['empty effort', { reasoning_effort: '' }],
  ['null effort', { reasoning_effort: null }],
  ['route rejected', { provider: 'bad', model: 'invented', reasoning_effort: 'high' }]
]) {
  test(`vanilla restores inheritance: ${label}`, async () => {
    const e = await environment(); const result = await e.invoke({ ...base, ...fields });
    assertRepair(e, result); assert.equal(Object.hasOwn(e.stats.starts[0].request, 'agentOptions'), false);
    assert.deepEqual(e.parent.options, { provider: 'parent-provider', model: 'parent-model', reasoningEffort: 'high' });
  });
}

test('no recorded policy has exact native suffix, then inherits normally', async () => {
  const e = await environment({ policy: null }); assertRepair(e, await e.invoke({ ...base, provider: 'bad', model: 'model' }));
});
test('existing default-model plugin contract is used, including its effort', async () => {
  const e = await environment({ defaultsPlugin: true });
  assertRepair(e, await e.invoke({ ...base, provider: '', model: '', reasoning_effort: 'high' }), { provider: 'pool-provider', model: 'pool-model', reasoningEffort: 'medium' });
});
test('native configured defaults are not replaced by defaults-plugin contract', async () => {
  const defaults = { provider: 'native', model: 'configured', reasoningEffort: 'low' };
  const e = await environment({ nativeDefaults: defaults, defaultsPlugin: true });
  assertRepair(e, await e.invoke({ ...base, provider: 'bad', model: 'route' }), defaults);
});
test('fork skips defaults pool as before', async () => {
  const e = await environment({ fork: true, defaultsPlugin: true });
  assertRepair(e, await e.invoke({ ...base, provider: '', model: '' }));
  assert.equal(e.stats.starts[0].request.agentOptions, undefined);
});
test('valid explicit route/effort remains explicit', async () => {
  const e = await environment({ defaultsPlugin: true });
  const result = await e.invoke({ ...base, provider: 'allowed', model: 'valid', reasoning_effort: 'low' });
  assert.equal(result.isError, false); assert.equal(e.stats.repairs.length, 0); assert.equal(e.stats.pre.length, 1);
  assert.deepEqual({ ...e.stats.starts[0].request.agentOptions }, { provider: 'allowed', model: 'valid', reasoningEffort: 'low' });
});
test('omitted triple stays omitted', async () => {
  const e = await environment(); const result = await e.invoke(base);
  assert.equal(result.isError, false); assert.equal(e.stats.repairs.length, 0); assert.equal(e.stats.pre.length, 1);
});
for (const [label, args] of [
  ['wrong prompt type', { ...base, prompt: 42, provider: null }],
  ['missing description', { prompt: base.prompt, provider: '' }],
  ['wrong cwd type', { ...base, cwd: [], model: '' }],
  ['unrelated unknown key', { ...base, extra: true, provider: '' }]
]) test(`unrelated validation not repaired: ${label}`, async () => {
  const e = await environment(); const result = await e.invoke(args);
  assert.equal(result.isError, true); assert.equal(e.stats.repairs.length, 0); assert.equal(e.stats.starts.length, 0);
});
test('schema-hidden route properties: only model properties may be removed', async () => {
  const e = await environment({ modelSelection: false }); assertRepair(e, await e.invoke({ ...base, provider: null, model: '' }));
});
for (const message of ['NO_ADAPTER', 'HTTP 429 rate limit', 'HTTP 401 unauthorized', 'unsupported reasoning effort', 'request timeout']) {
  test(`preflight/API failure is not retried: ${message}`, async () => {
    const e = await environment({ preflightError: new Error(message) });
    const result = await e.invoke({ ...base, provider: 'allowed', model: 'valid' });
    assert.equal(result.isError, true); assert.equal(e.stats.repairs.length, 0); assert.equal(e.stats.starts.length, 0);
  });
}
test('repaired start fails: return real failure without second retry', async () => {
  const e = await environment({ startError: new Error('depth limit exceeded') });
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.error.message, 'depth limit exceeded'); assert.equal(e.stats.starts.length, 1); assert.equal(e.stats.pre.length, 2);
});
test('successful child followed by output error is never retried', async () => {
  const e = await environment({ onStart() { e.initialDef.output.schema.properties.kind.const = 'other'; } });
  const result = await e.invoke({ ...base, provider: 'allowed', model: 'valid' });
  assert.equal(result.isError, true); assert.equal(e.stats.starts.length, 1); assert.equal(e.stats.repairs.length, 0);
});
test('post policy rejection after repair does not create a second child', async () => {
  const e = await environment({ post: async () => ({ kind: 'block', feedback: [{ type: 'text', text: 'policy denied result' }] }) });
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.isError, true); assert.equal(e.stats.starts.length, 1); assert.equal(e.stats.results.length, 1);
});
test('guard evaluates corrected args and may deny them', async () => {
  const e = await environment({ guard: exec => !Object.hasOwn(exec.arguments, 'provider') ? 'corrected args forbidden' : undefined });
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.error.message, 'corrected args forbidden'); assert.equal(e.stats.starts.length, 0); assert.equal(e.stats.pre.length, 2);
});
test('pre-execute deny is not interpreted as native argument failure', async () => {
  const e = await environment({ pre: async () => ({ kind: 'deny', reason: 'permission denied' }) });
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.isError, true); assert.equal(e.stats.repairs.length, 0); assert.equal(e.stats.starts.length, 0);
});
test('already-aborted call never starts a repair', async () => {
  const e = await environment(); e.controller.abort(); const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.error.info.code, 'ABORTED_BEFORE_DISPATCH'); assert.equal(e.stats.repairs.length, 0);
});
test('abort while corrected pre-execute awaits is preserved', async () => {
  const e = await environment({ pre: async (exec, next, stats) => { if (stats.pre.length === 2) e.controller.abort(); return next(); } });
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.error.info.code, 'ABORTED_BEFORE_DISPATCH'); assert.equal(e.stats.starts.length, 0);
});
test('abort after child starts never retries again', async () => {
  const e = await environment({ onStart: async (_spec, controller) => controller.abort() });
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.error.info.code, 'ABORTED'); assert.equal(e.stats.starts.length, 1); assert.equal(e.stats.pre.length, 2);
});
test('PTC nested call preserves parent proof, step admission and schema', async () => {
  const e = await environment({ ptc: true });
  const parent = Symbol('run-code-token');
  const snapshot = new Map(e.registry);
  const toolSet = { view: () => new Map([...snapshot].filter(([name, def]) => e.registry.get(name) === def)) };
  const schema = { name: 'subagent' };
  assertRepair(e, await e.invoke({ ...base, provider: '', model: '' }, { parent, toolSet, schema }));
});
test('PTC direct call remains forbidden (no transport bypass)', async () => {
  const e = await environment({ ptc: true }); const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.error.info.code, 'UNKNOWN_TOOL'); assert.equal(e.stats.starts.length, 0); assert.equal(e.stats.repairs.length, 0);
});
for (const phase of ['pre', 'dispatch']) for (const change of ['definition', 'executor', 'pipeline']) {
  test(`fail closed on ${change} replacement during retry ${phase}`, async () => {
    let replacementCalls = 0;
    function mutate(e) {
      if (change === 'definition') e.registry.set('subagent', { ...e.initialDef, execute: async () => { replacementCalls++; return { kind: 'activation', subagentId: 'wrong' }; } });
      if (change === 'executor') e.executor = new core.native.NativeToolExecutor(e.ctx);
      if (change === 'pipeline') e.executor.pipeline = new core.pipeline.ToolExecutionPipeline(e.ctx);
    }
    const e = await environment({
      pre: async (exec, next, stats) => { if (phase === 'pre' && stats.pre.length === 2) { await Promise.resolve(); mutate(e); } return next(); },
      dispatchHook: async (exec, next, env) => { if (phase === 'dispatch' && !Object.hasOwn(exec.arguments, 'provider')) { await Promise.resolve(); mutate(env); } return next(); }
    });
    const result = await e.invoke({ ...base, provider: '', model: '' });
    assert.equal(result.isError, true); assert.equal(replacementCalls, 0); assert.equal(e.stats.starts.length, 0);
  });
}
test('unknown executor retains original error', async () => {
  const e = await environment(); const originalPipe = e.executor.pipeline;
  e.executor = { pipeline: originalPipe };
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.isError, true); assert.equal(e.stats.repairs.length, 0);
});
test('same callId in independent sessions can repair concurrently', async () => {
  const a = await environment(); const b = await environment();
  const results = await Promise.all([a.invoke({ ...base, provider: '' }), b.invoke({ ...base, provider: '' })]);
  assertRepair(a, results[0]); assertRepair(b, results[1]);
});
test('retry deferred contexts survive outer normalization exactly once', async () => {
  const e = await environment({ dispatchHook: async (exec, next) => {
    if (!Object.hasOwn(exec.arguments, 'provider')) exec.deferContext({ content: [{ type: 'text', text: 'child context' }] });
    return next();
  } });
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.isError, false); assert.equal(result.additionalContexts.length, 1);
});
test('complete native batch creates one durable call/result pair, not nested batches', async () => {
  const e = await environment();
  const batch = await e.executor.execute({ calls: [{ id: 'call-1', name: 'subagent', arguments: JSON.stringify({ ...base, provider: '', model: '' }) }], agent: e.parent, signal: e.controller.signal, log: { turn: 1, step: 1 } });
  assert.equal(batch.results[0].result.isError, false);
  assert.deepEqual(e.stats.logs.map(x => x.type), ['tool/call', 'tool/result']);
  assert.equal(e.stats.starts.length, 1); assert.equal(e.stats.post.length, 1); assert.equal(e.stats.results.length, 1);
});
test('actual defaults 2.2.0 plugin preserves pool round-robin after recovery', async () => {
  const e = await environment({ realDefaultsPlugin: true });
  for (let i = 0; i < 2; i++) assert.equal((await e.invoke({ ...base, provider: '', model: '' })).isError, false);
  assert.deepEqual(e.stats.starts.map(spec => ({ ...spec.request.agentOptions })), [
    { provider: 'pool-a', model: 'model-a', reasoningEffort: 'medium' },
    { provider: 'pool-b', model: 'model-b', reasoningEffort: 'low' }
  ]);
  assert.equal(e.stats.repairs.filter(x => x.phase === 'attempt').length, 2);
});
for (const applyPoolToFork of [false, true]) test(`actual defaults plugin fork opt-in=${applyPoolToFork}`, async () => {
  const e = await environment({ realDefaultsPlugin: true, fork: true, applyPoolToFork });
  assertRepair(e, await e.invoke({ ...base, provider: '', model: '' }));
  assert.equal(e.stats.starts[0].request.agentOptions?.provider, applyPoolToFork ? 'pool-a' : undefined);
});
test('actual defaults plugin does not override valid explicit route or native defaults', async () => {
  const e = await environment({ realDefaultsPlugin: true });
  assert.equal((await e.invoke({ ...base, provider: 'allowed', model: 'valid' })).isError, false);
  assert.equal(e.stats.starts[0].request.agentOptions.provider, 'allowed');
  const nativeDefaults = { provider: 'native', model: 'native-model' };
  const n = await environment({ realDefaultsPlugin: true, nativeDefaults });
  assertRepair(n, await n.invoke({ ...base, provider: '', model: '' }), nativeDefaults);
});

test('diagnostic failure cannot change a successful repair', async () => {
  const e = await environment({ report() { throw Error('logger unavailable'); } });
  assertRepair(e, await e.invoke({ ...base, provider: '', model: '' }));
});

test('actual host-integrated plugin entry works in vanilla host', async () => {
  const e = await environment({ actualEntry: true });
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.isError, false); assert.equal(e.stats.starts.length, 1);
  assert.equal(e.stats.starts[0].request.agentOptions, undefined);
  assert.equal(e.stats.post.length, 1); assert.equal(e.stats.results.length, 1);
});
test('another listener reinjecting bad model fields cannot cause a second repair', async () => {
  const e = await environment({ dispatchHook: async (exec, next) => {
    if (!Object.hasOwn(exec.arguments, 'provider')) exec.arguments = Object.freeze({ ...exec.arguments, provider: '', model: '' });
    return next();
  } });
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.isError, true); assert.equal(e.stats.pre.length, 2);
  assert.equal(e.stats.repairs.filter(x => x.phase === 'attempt').length, 1); assert.equal(e.stats.starts.length, 0);
});
test('content text resembling a native route error does not trigger repair', async () => {
  const e = await environment({ dispatchHook: async () => ({ isError: true, error: { message: 'HTTP 429' }, content: [{ type: 'text', text: 'Error: child LLM `provider` must be non-empty' }] }) });
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.error.message, 'HTTP 429'); assert.equal(e.stats.repairs.length, 0);
});
test('typed request error with native-looking message does not trigger repair', async () => {
  const e = await environment({ dispatchHook: async () => ({ isError: true, error: { message: 'child LLM `provider` must be non-empty', info: { name: 'RequestError', code: 'TIMEOUT' } }, content: [] }) });
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.error.info.code, 'TIMEOUT'); assert.equal(e.stats.repairs.length, 0);
});
for (const phase of ['pre', 'dispatch']) test(`retry ${phase} exception is preserved without second dispatch`, async () => {
  const e = await environment({
    pre: async (exec, next, stats) => { if (phase === 'pre' && stats.pre.length === 2) throw Error('pre exception'); return next(); },
    dispatchHook: async (exec, next) => { if (phase === 'dispatch' && !Object.hasOwn(exec.arguments, 'provider')) throw Error('dispatch exception'); return next(); }
  });
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.error.message, `${phase} exception`); assert.equal(e.stats.starts.length, 0);
  assert.equal(e.stats.post.length, 1); assert.equal(e.stats.results.length, 1);
});
test('dropping PTC parent proof during retry cannot execute child', async () => {
  const e = await environment({ ptc: true, dispatchHook: async (exec, next) => {
    if (!Object.hasOwn(exec.arguments, 'provider')) delete exec.parent;
    return next();
  } });
  const result = await e.invoke({ ...base, provider: '', model: '' }, { parent: Symbol('transport') });
  assert.equal(result.isError, true); assert.equal(e.stats.starts.length, 0);
});
test('a replacement signal does not mask original caller cancellation', async () => {
  const e = await environment({ dispatchHook: async (exec, next) => {
    if (!Object.hasOwn(exec.arguments, 'provider')) { exec.signal = new AbortController().signal; e.controller.abort(); }
    return next();
  } });
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.error.info.code, 'ABORTED_BEFORE_DISPATCH'); assert.equal(e.stats.starts.length, 0);
});
test('restricted validator matches real core diagnostics for relevant cases', async () => {
  const e = await environment(); const schema = e.initialDef.parameters;
  for (const args of [base, { ...base, provider: null }, { ...base, provider: 0, model: {} }, { ...base, reasoning_effort: [] }, { ...base, prompt: false }, { cwd: base.cwd }]) {
    assert.deepEqual([...validateKnownArguments(schema, args)], [...core.tools.validateJsonSchemaValue(schema, args, '')]);
  }
});
for (const mutation of [
  schema => { schema.properties.prompt.minLength = 1; },
  schema => { schema.oneOf = []; },
  schema => { schema.properties.provider.enum = ['allowed']; },
  schema => { schema.properties.cwd.type = 'array'; },
  schema => { schema.required.push('provider'); }
]) test('unverified/new tool parameter constraints fail closed', async () => {
  const e = await environment(); mutation(e.initialDef.parameters);
  const result = await e.invoke({ ...base, provider: '', model: '' });
  assert.equal(result.isError, true); assert.equal(e.stats.repairs.length, 0); assert.equal(e.stats.starts.length, 0);
});
test('enum constraints on non-model fields block mixed-invalid recovery', async () => {
  const schema = { type: 'object', properties: { provider: { type: 'string' }, agent_preset: { type: 'string', enum: ['safe'] } }, required: [] };
  assert.equal(supportedParameters(schema), true);
  assert.equal(validateKnownArguments(schema, { provider: null, agent_preset: 'wrong' }).length, 2);
  assert.equal(supportedParameters({ ...schema, properties: { agent_preset: { type: 'string', enum: [] } } }), false);
  assert.equal(supportedParameters({ ...schema, properties: { agent_preset: { type: 'string', enum: ['x', 'x'] } } }), false);
});
