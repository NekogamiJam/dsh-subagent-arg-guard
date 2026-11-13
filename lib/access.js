import { SUPPORTED_VERSIONS } from './guard.js';

// Execution policy is independent of model-argument repair. Do not alter tool
// definitions, cancel existing activations, or take over the subagents service.
export function createToolAccessPolicy({ version, allowSubagent = () => true, allowSubagentFork = () => true }) {
  if (!SUPPORTED_VERSIONS.includes(version)) throw new Error('unsupported tool access policy version');
  function reason(exec) {
    const flag = exec.name === 'subagent' ? allowSubagent : exec.name === 'subagent_fork' ? allowSubagentFork : undefined;
    if (flag === undefined) return undefined;
    let enabled = false;
    try { enabled = (typeof flag === 'function' ? flag() : flag) === true; } catch { /* no creation on a broken policy view */ }
    return enabled ? undefined : `${exec.name} is disabled in Subagent Arg Guard settings; no subagent was created by this call`;
  }
  return {
    guard(exec) {
      const denied = reason(exec);
      if (denied === undefined) return undefined;
      // rc.1 checkGuards returns string; rc.2 requires ToolGuardDenial.
      return version === '0.2.2-rc.1' ? denied : { reason: denied, info: { name: 'SubagentToolDisabled', code: 'SUBAGENT_TOOL_DISABLED' } };
    },
    async execute(exec, next) {
      // Recheck at dispatch admission: configuration may change after prepare.
      // A body already started is not interrupted by a later toggle.
      const denied = reason(exec);
      if (denied === undefined) return next();
      return { isError: true, content: [{ type: 'text', text: `Error: ${denied}` }],
        error: { message: denied, info: { name: 'SubagentToolDisabled', code: 'SUBAGENT_TOOL_DISABLED' } } };
    }
  };
}
