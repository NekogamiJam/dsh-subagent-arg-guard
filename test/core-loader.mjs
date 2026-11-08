import vm from 'node:vm';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Core source is unmodified 0.2.2-rc.1. Only external host/services are isolated.
export async function loadCore() {
  const context = vm.createContext({ console, AbortController, AbortSignal, setTimeout, clearTimeout, structuredClone, Symbol, Error });
  const modules = new Map();
  const chain = new Proxy(function(value) { return value; }, { get: () => chain, apply: (_fn, _this, args) => (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) ? Object.assign(chain, {}) : chain });
  // Config schemas need fluent builders, and Config(config) in PTC returns config.
  const schemaNode = new Proxy(function(value) { return value; }, { get: () => () => schemaNode });
  const z = new Proxy({}, { get: () => () => schemaNode });
  class HarnessError extends Error {
    constructor(message, code, options) { super(message, options); this.code = code; }
  }
  const deepFreeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const v of Object.values(value)) deepFreeze(v);
      Object.freeze(value);
    }
    return value;
  };
  const isJsonValue = value => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(isJsonValue);
    if (value && typeof value === 'object') return Object.values(value).every(isJsonValue);
    return false;
  };
  const externals = {
    '@deepseek-ai/dsh-llm': { HarnessError, ReasoningEffortId: value => value, createToolResultMessage: value => value, createUserMessage: value => value },
    '@deepseek-ai/dsh-util-values': { deepFreeze, snapshotJsonValue: value => isJsonValue(value) ? structuredClone(value) : undefined, isJsonValue, assertNever: value => { throw new Error(`unexpected ${value}`); } },
    '@deepseek-ai/dsh-scope': { scopeTarget: (_tools, agent) => agent, scopeOf: () => undefined, scopeChainOf: () => [], AnonymousEntries: class {}, NamedEntries: class {}, ScopedLayers: class {} },
    '@deepseek-ai/cordis': { Service: class {}, symbols: {} },
    '@deepseek-ai/schemastery': { default: z },
    'zod': { z },
    '@deepseek-ai/dsh-brand': { brandString: value => value },
    '@deepseek-ai/dsh-sandbox': { ESCALATION_TARGETS: [], approveEscalation: () => { throw Error('approval not configured in test'); }, validateEscalationArgs: () => [] },
    '@deepseek-ai/dsh-subagent': { assertSubagentMaxDepth: () => {}, delegationDepthOf: () => 0, parentAgentOptionsForDelegation: parent => parent.options }
  };
  const paths = {
    '@deepseek-ai/dsh-tools': 'tools.js', '@deepseek-ai/dsh-tools/pipeline': 'pipeline.js',
    native: 'native.js', ptc: 'ptc.js', subagent: 'subagent.js', defaults: 'default-model.js'
  };
  async function getModule(specifier) {
    if (modules.has(specifier)) return modules.get(specifier);
    if (externals[specifier]) {
      const values = externals[specifier];
      const mod = new vm.SyntheticModule(Object.keys(values), function() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
      modules.set(specifier, mod);
      return mod;
    }
    const filename = paths[specifier] ?? specifier.replace(/^\.\//, '');
    const url = new URL(`./fixtures/${filename}`, import.meta.url);
    const source = await fs.readFile(url, 'utf8');
    const mod = new vm.SourceTextModule(source, { context, identifier: fileURLToPath(url) });
    modules.set(specifier, mod);
    return mod;
  }
  async function evaluate(name) {
    const mod = await getModule(name);
    if (mod.status === 'unlinked') await mod.link(spec => getModule(spec));
    if (mod.status !== 'evaluated') await mod.evaluate();
    return mod.namespace;
  }
  return {
    tools: await evaluate('@deepseek-ai/dsh-tools'),
    pipeline: await evaluate('@deepseek-ai/dsh-tools/pipeline'),
    native: await evaluate('native'), ptc: await evaluate('ptc'), subagent: await evaluate('subagent'),
    defaults: await evaluate('defaults'),
    HarnessError  };
}
