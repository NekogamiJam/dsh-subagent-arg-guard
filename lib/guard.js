// Conservative, dependency-injected core. Never selects or invents an LLM route.
export const MODEL_FIELDS = Object.freeze(['provider', 'model', 'reasoning_effort']);
const NATIVE_TOOLS = new Set(['subagent', 'subagent_fork']);
export const SUPPORTED_VERSIONS = Object.freeze(['0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3', '0.2.2-rc.4', '0.2.2-rc.5', '0.2.3-alpha.1', '0.2.3-alpha.2']);
const ALPHA_VERSIONS = new Set(['0.2.3-alpha.1', '0.2.3-alpha.2']);
const ALPHA_ROUTE_DISCOVERY_HINT = ' Call `list_subagent_models` to see the routes you may select.';
const RC1 = '0.2.2-rc.1';
const RC1_NO_POLICY_SUFFIX = '; without a recorded model-selection policy, explicit selection (including reasoning_effort) is limited to the parent route';
const NO_POLICY_SUFFIX = '; without a recorded model-selection policy, explicit selection is limited to the parent route';
const EFFORT_PAIR_ERROR = 'child LLM `reasoning_effort` requires both `provider` and `model`; supply both or omit all three fields';
const PAIR_ERROR = 'child LLM `provider` and `model` must be supplied together';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, field) => Object.hasOwn(value, field);
const hasText = value => typeof value === 'string' && value.trim() !== '';

function alphaMessageBody(message) {
  if (message.endsWith(ALPHA_ROUTE_DISCOVERY_HINT)) return message.slice(0, -ALPHA_ROUTE_DISCOVERY_HINT.length);
  return message;
}

// Deliberately tiny schema subset: current official delegation parameters are
// strings, optional string enum, and required names. Unknown keywords disable repair.
export function supportedParameters(p) {
  if (p?.type !== 'object' || !record(p.properties) || !Array.isArray(p.required) ||
      ![undefined, false].includes(p.additionalProperties)) return false;
  if (Object.keys(p).some(key => !['type', 'properties', 'required', 'additionalProperties'].includes(key))) return false;
  if (!p.required.every(key => typeof key === 'string' && own(p.properties, key))) return false;
  return Object.entries(p.properties).every(([field, schema]) => record(schema) && schema.type === 'string' &&
    Object.keys(schema).every(key => ['type', 'description', 'enum'].includes(key)) &&
    (schema.enum === undefined || (!MODEL_FIELDS.includes(field) && Array.isArray(schema.enum) && schema.enum.length > 0 && new Set(schema.enum).size === schema.enum.length && schema.enum.every(value => typeof value === 'string'))));
}

export function validateKnownArguments(schema, args) {
  if (!supportedParameters(schema)) return ['unsupported delegation parameter schema'];
  if (!record(args)) return ['"value" must be an object'];
  const errors = [];
  for (const key of schema.required) if (!own(args, key) || args[key] === undefined) errors.push(`missing required property "${key}"`);
  for (const [key, property] of Object.entries(schema.properties)) {
    if (!own(args, key) || args[key] === undefined) continue;
    if (typeof args[key] !== 'string') errors.push(`"${key}" must be a string`);
    else if (property.enum && !property.enum.includes(args[key])) errors.push(`"${key}" is not an allowed enum value`);
  }
  if (schema.additionalProperties === false) for (const key of Object.keys(args)) {
    if (!own(schema.properties, key)) errors.push(`"${key}" is not a declared property (additionalProperties: false)`);
  }
  return errors;
}

export function stripModelFields(args) {
  const clean = { ...args };
  for (const field of MODEL_FIELDS) delete clean[field];
  return clean;
}

// Contract check, NOT authentication of an arbitrary third-party plugin.
// The deployment's trusted registry supplies definitions; hot replacements fail closed.
export function supportedTool(tool, version = '0.2.2-rc.1') {
  if (!SUPPORTED_VERSIONS.includes(version) || !tool || !NATIVE_TOOLS.has(tool.name) || tool.finalizeContent || tool.projectContent) return false;
  if (version === RC1 ? tool.output?.presentationMeta !== undefined : typeof tool.output?.presentationMeta !== 'function') return false;
  const p = tool.parameters;
  const out = tool.output?.schema;
  const identity = version === RC1 ? 'subagentId' : 'name';
  return supportedParameters(p) &&
    p.required?.includes('description') && p.required?.includes('prompt') &&
    p.properties?.description?.type === 'string' && p.properties?.prompt?.type === 'string' &&
    !MODEL_FIELDS.some(field => p.required.includes(field)) &&
    out?.type === 'object' && out.additionalProperties === false &&
    Object.keys(out.properties ?? {}).length === 2 &&
    out.properties?.kind?.const === 'activation' && out.properties?.[identity]?.type === 'string' &&
    out.required?.length === 2 && out.required.includes('kind') && out.required.includes(identity);
}

export function recoveryReason(result, args, tool, validate, version = '0.2.2-rc.1') {
  if (!SUPPORTED_VERSIONS.includes(version)) return undefined;
  if (result?.isError !== true || !record(args) || !MODEL_FIELDS.some(field => own(args, field))) return undefined;
  const message = result.error?.message;
  if (typeof message !== 'string') return undefined;
  const clean = stripModelFields(args);
  if (Object.keys(clean).some(field => !own(tool.parameters.properties, field))) return undefined;
  // Unrelated prompt/cwd/preset/unknown-property problems must remain errors.
  const repairedViolations = validate(tool.parameters, clean, '');
  if (repairedViolations.length !== 0) return undefined;
  const violations = validate(tool.parameters, args, '');
  const info = result.error.info;
  if (info !== undefined) {
    if (info?.name === 'ToolArgsError' && info?.code === 'INVALID_ARGS') {
      if (violations.length > 0) {
        if (message !== `invalid arguments: ${violations.join('; ')}`) return undefined;
        if (!violations.every(v => /^"(?:provider|model|reasoning_effort)" (?:must be a string|is not a declared property \(additionalProperties: false\))$/.test(v))) return undefined;
        return 'invalid-model-field-type';
      }
      if (!ALPHA_VERSIONS.has(version)) return undefined;
      if (!message.startsWith('invalid arguments: ')) return undefined;
      const body = alphaMessageBody(message.slice('invalid arguments: '.length));
      if (message !== `invalid arguments: ${body}` && message !== `invalid arguments: ${body}${ALPHA_ROUTE_DISCOVERY_HINT}`) return undefined;
      if (body === 'child LLM `provider` and `model` must be supplied together.' &&
          hasText(args.provider) !== hasText(args.model)) return 'incomplete-provider-model-pair';
      if (body === 'child LLM `reasoning_effort` requires both `provider` and `model`; supply both or omit all three fields.' &&
          hasText(args.reasoning_effort) && (!hasText(args.provider) || !hasText(args.model))) return 'effort-requires-provider-model';
      return undefined;
    }
    if (!ALPHA_VERSIONS.has(version) || info?.name !== 'SubagentError' || violations.length !== 0) return undefined;
    if (info.code === 'MODEL_SELECTION_DISABLED' &&
        message === 'child model selection is disabled for this tool instance' &&
        MODEL_FIELDS.every(field => !own(tool.parameters.properties, field))) return 'model-selection-disabled';
    if (info.code === 'MODEL_ROUTE_NOT_ALLOWED') {
      const body = alphaMessageBody(message);
      const match = /^child LLM route "([^"\r\n]+)" is not allowed by the current subagent model selection setting(?:; while subagent model selection is disabled, explicit selection is limited to the parent route)?\.$/.exec(body);
      if (!match || !match[1].includes('/') || !hasText(args.provider) || !hasText(args.model)) return undefined;
      if (match[1] !== `${args.provider}/${args.model}`) return undefined;
      return 'route-not-allowed';
    }
    return undefined;
  }
  // Native 0.2.2 model-selection errors are plain Error, not request/API error classes.
  if (violations.length !== 0) return undefined;
  if (message === 'child model selection is disabled for this tool instance' &&
      MODEL_FIELDS.every(field => !own(tool.parameters.properties, field))) return 'model-selection-disabled';
  for (const field of MODEL_FIELDS) {
    if (message === `child LLM \`${field}\` must be non-empty` && typeof args[field] === 'string' && !args[field].trim()) return 'empty-model-field';
  }
  if (message === PAIR_ERROR && ((args.provider === undefined) !== (args.model === undefined))) return 'incomplete-provider-model-pair';
  if (version !== RC1 && message === EFFORT_PAIR_ERROR && args.reasoning_effort !== undefined &&
      (args.provider === undefined || args.model === undefined)) return 'effort-requires-provider-model';
  const suffix = version === RC1 ? RC1_NO_POLICY_SUFFIX : NO_POLICY_SUFFIX;
  const base = message.endsWith(suffix) ? message.slice(0, -suffix.length) : message;
  const match = /^child LLM route "([^"\r\n]+)" is not allowed for this Session$/.exec(base);
  if (!match || !match[1].includes('/')) return undefined;
  if (args.provider !== undefined && args.model !== undefined && match[1] !== `${args.provider}/${args.model}`) return undefined;
  return 'route-not-allowed';
}

/**
 * Re-run only prepare + dispatch; the owning scheduler alone completes/logs.
 * pipelineFor MUST capture/lock the original executor definition and transport.
 */
export function createGuard({ pipelineFor, validate, report = () => {}, version = '0.2.2-rc.1', enabled = true, repairForks = true, repairDisallowedRoutes = true }) {
  const on = value => { try { return (typeof value === 'function' ? value() : value) === true; } catch { return false; } };
  // Execution object identity, not callId: distinct sessions may reuse call IDs.
  const inFlight = new WeakSet();
  const notify = event => { try { report(event); } catch { /* diagnostics cannot alter a tool result */ } };
  return async function guard(exec, next) {
    if (!on(enabled) || !SUPPORTED_VERSIONS.includes(version) || !NATIVE_TOOLS.has(exec.name) ||
        (!on(repairForks) && exec.name === 'subagent_fork') || inFlight.has(exec)) return next();
    // Capture BEFORE the first await; a hot replacement is never our retry target.
    const captured = pipelineFor(exec);
    const original = await next();
    if (!captured || exec.signal.aborted || !on(enabled) || (!on(repairForks) && exec.name === 'subagent_fork')) return original;
    const { tool, pipeline, current } = captured;
    if (!supportedTool(tool, version) || !current()) return original;
    const reason = recoveryReason(original, exec.arguments, tool, validate, version);
    if (!reason || (!on(repairDisallowedRoutes) && reason === 'route-not-allowed')) return original;
    inFlight.add(exec);
    try {
      if (exec.signal.aborted || !current()) return original;
      const fields = MODEL_FIELDS.filter(field => own(exec.arguments, field));
      notify({ phase: 'attempt', tool: exec.name, callId: String(exec.callId), reason, fields });
      // New token, same parent proof, same step admission and cancellation.
      const input = {
        callId: exec.callId, rootCallId: exec.rootCallId, name: exec.name,
        arguments: stripModelFields(exec.arguments), signal: exec.signal,
        ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
        ...(exec.toolSet !== undefined ? { toolSet: exec.toolSet } : {}),
        ...(exec.schema !== undefined ? { schema: exec.schema } : {}),
        ...(exec.parent !== undefined ? { parent: exec.parent } : {})
      };
      const prepared = await pipeline.prepare(input);
      // prepare handles cancellation and denials itself; do not mask them.
      let outcome = prepared;
      if (prepared.kind === 'dispatch') {
        inFlight.add(prepared.exec);
        try { outcome = await pipeline.dispatch(prepared.exec); }
        finally { inFlight.delete(prepared.exec); }
      }
      const result = outcome.result;
      notify({ phase: 'settled', tool: exec.name, callId: String(exec.callId), reason, isError: result.isError });
      return result;
    } finally {
      inFlight.delete(exec);
    }
  };
}

/** Audited 0.2.2 rc.1–rc.5 and statically audited 0.2.3 alpha.1–alpha.2 Native/PTC adapter. No global mutation of executor state. */
export function captureCurrentPipeline(ctx, exec, version = '0.2.2-rc.1') {
  try {
    const executor = ctx.tools.selectExecutor(exec.agent);
    if (!['NativeToolExecutor', 'PtcExecutor'].includes(executor?.constructor?.name)) return undefined;
    const source = executor.pipeline;
    const Pipeline = source?.constructor;
    if (Pipeline?.name !== 'ToolExecutionPipeline' || !source.ctx ||
        !['resolveExecution', 'prepare', 'dispatch'].every(method => typeof source[method] === 'function')) return undefined;
    const tool = source.resolveExecution(exec.name, exec.agent, exec.parent !== undefined, exec.toolSet);
    if (!supportedTool(tool, version)) return undefined;
    const current = () => {
      try {
        return ctx.tools.selectExecutor(exec.agent) === executor && executor.pipeline === source &&
          source.resolveExecution(exec.name, exec.agent, exec.parent !== undefined, exec.toolSet) === tool;
      } catch { return false; }
    };
    // Resolve through the ORIGINAL transport each time, including after awaits.
    // New pipeline only isolates retry state. No default-source/PTC bypass.
    const pipeline = new Pipeline(source.ctx, {
      get(name, agent, toolSet) {
        if (name !== exec.name || agent !== exec.agent || toolSet !== exec.toolSet || !current()) return undefined;
        return tool;
      },
      reject(name, nested) {
        if (name !== exec.name || nested !== (exec.parent !== undefined) || !current()) return new Error('subagent retry execution context changed');
        return undefined;
      }
    });
    return { tool, pipeline, current };
  } catch {
    // Unsupported executor or missing stage contract -> original result.
    return undefined;
  }
}
