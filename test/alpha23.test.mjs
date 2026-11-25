import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, baseForVersion, assertRepair } from './guard.test.mjs';
import { loadCore } from './core-loader.mjs';
import { recoveryReason, validateKnownArguments } from '../lib/guard.js';

// Alpha.1 and alpha.2 share byte-identical guard-facing packages; the static audit
// verifies both npm releases. These are fixture tests, not a real DSH alpha host.
for (const version of ['0.2.3-alpha.1', '0.2.3-alpha.2']) {
  const core = await loadCore(version);
  const args = baseForVersion(version);
  const host = (options = {}) => environment({ core, version, ...options });

  test(`${version}: guard adapter recovers typed provider/model pairing errors once`, async () => {
    const e = await host();
    const result = await e.invoke({ ...args, provider: 'allowed' });
    assertRepair(e, result);
    assert.equal(e.stats.repairs[0].reason, 'incomplete-provider-model-pair');
  });

  test(`${version}: guard adapter recovers typed reasoning_effort pairing errors once`, async () => {
    const e = await host();
    const result = await e.invoke({ ...args, reasoning_effort: 'high' });
    assertRepair(e, result);
    assert.equal(e.stats.repairs[0].reason, 'effort-requires-provider-model');
  });

  test(`${version}: alpha ToolArgsError with an invalid model-field type is repaired once`, async () => {
    const e = await host();
    const result = await e.invoke({ ...args, provider: 7 });
    assertRepair(e, result);
    assert.equal(e.stats.repairs[0].reason, 'invalid-model-field-type');
  });

  for (const fork of [false, true]) test(`${version}: typed route rejection recovers through ${fork ? 'subagent_fork' : 'subagent'}`, async () => {
    const e = await host({ fork });
    const result = await e.invoke({ ...args, provider: 'unlisted', model: 'not-real' });
    assertRepair(e, result);
    assert.equal(e.stats.repairs[0].reason, 'route-not-allowed');
  });

  test(`${version}: valid explicit parent route, effort, and child name are untouched`, async () => {
    const e = await host();
    const result = await e.invoke({
      ...args, name: 'alpha-selection',
      provider: e.parent.options.provider,
      model: e.parent.options.model,
      reasoning_effort: 'low'
    });
    assert.equal(result.isError, false, result.error?.message);
    assert.equal(e.stats.repairs.length, 0);
    assert.equal(e.stats.pre.length, 1);
    assert.equal(e.stats.starts.length, 1);
    assert.equal(e.stats.starts[0].name, 'alpha-selection');
  });

  test(`${version}: optional route-discovery hints stay narrowly matched`, async () => {
    const e = await host();
    const routeArgs = { ...args, provider: 'unlisted', model: 'not-real' };
    const hint = ' Call `list_subagent_models` to see the routes you may select.';
    for (const policy of [
      '',
      '; while subagent model selection is disabled, explicit selection is limited to the parent route'
    ]) {
      const result = {
        isError: true,
        error: {
          message: `child LLM route "unlisted/not-real" is not allowed by the current subagent model selection setting${policy}.${hint}`,
          info: { name: 'SubagentError', code: 'MODEL_ROUTE_NOT_ALLOWED' }
        }
      };
      assert.equal(recoveryReason(result, routeArgs, e.initialDef, validateKnownArguments, version), 'route-not-allowed');
    }
    const mismatchedRoute = {
      isError: true,
      error: {
        message: `child LLM route "other/model" is not allowed by the current subagent model selection setting.${hint}`,
        info: { name: 'SubagentError', code: 'MODEL_ROUTE_NOT_ALLOWED' }
      }
    };
    assert.equal(recoveryReason(mismatchedRoute, routeArgs, e.initialDef, validateKnownArguments, version), undefined);
  });

  test(`${version}: alpha blank model fields are omitted by the host and do not cause a repair`, async () => {
    const e = await host();
    const result = await e.invoke({ ...args, provider: '', model: '', reasoning_effort: '' });
    assert.equal(result.isError, false, result.error?.message);
    assert.equal(e.stats.starts.length, 1);
    assert.equal(e.stats.pre.length, 1);
    assert.equal(e.stats.repairs.length, 0);
  });

  test(`${version}: invalid non-model arguments and mismatched typed errors remain failures`, async () => {
    const e = await host();
    const result = await e.invoke({ ...args, name: 7, provider: 'allowed' });
    assert.equal(result.isError, true);
    assert.equal(e.stats.repairs.length, 0);
    assert.equal(e.stats.starts.length, 0);

    const typedErrorWithNativeLookingMessage = {
      isError: true,
      error: {
        message: 'child LLM route "unlisted/not-real" is not allowed by the current subagent model selection setting.',
        info: { name: 'SubagentError', code: 'INVALID_AGENT_NAME' }
      }
    };
    assert.equal(recoveryReason(typedErrorWithNativeLookingMessage,
      { ...args, provider: 'unlisted', model: 'not-real' }, e.initialDef, validateKnownArguments, version), undefined);
  });

  test(`${version}: disabled model-selection schema rejects injected route fields narrowly`, async () => {
    const e = await host({ modelSelection: false });
    assert.equal(Object.hasOwn(e.initialDef.parameters.properties, 'provider'), false);
    const result = await e.invoke({ ...args, provider: 'allowed', model: 'valid' });
    assertRepair(e, result);
    assert.equal(e.stats.repairs[0].reason, 'model-selection-disabled');
  });

  test(`${version}: typed effort-pair error accepts only the exact optional discovery hint`, async () => {
    const e = await host();
    const selected = { ...args, reasoning_effort: 'high' };
    const hint = ' Call `list_subagent_models` to see the routes you may select.';
    const result = {
      isError: true,
      error: {
        message: 'invalid arguments: child LLM `reasoning_effort` requires both `provider` and `model`; supply both or omit all three fields.' + hint,
        info: { name: 'ToolArgsError', code: 'INVALID_ARGS' }
      }
    };
    assert.equal(recoveryReason(result, selected, e.initialDef, validateKnownArguments, version), 'effort-requires-provider-model');
    result.error.message += hint;
    assert.equal(recoveryReason(result, selected, e.initialDef, validateKnownArguments, version), undefined);
  });
}
