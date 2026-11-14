import z from '@deepseek-ai/schemastery';
import { captureCurrentPipeline, createGuard, validateKnownArguments } from './guard.js';
import { detectRuntimeVersion, readFlag } from './runtime.js';
import { createToolAccessPolicy } from './access.js';

export const name = 'subagent-arg-guard';
export const inject = ['tools'];
export const Config = z.object({
  allowSubagent: z.boolean().default(true).extra('volatile', true).description('允许 subagent 工具创建子代理（独立于参数补救）'),
  allowSubagentFork: z.boolean().default(true).extra('volatile', true).description('允许 subagent_fork 工具创建子代理（独立于参数补救）'),
  enabled: z.boolean().default(true).extra('volatile', true).description('启用选模参数补救'),
  repairDisallowedRoutes: z.boolean().default(true).extra('volatile', true).description('Session 不允许的显式路由改走原默认路径'),
  repairForks: z.boolean().default(true).extra('volatile', true).description('也补救 subagent_fork（不改变 fork 默认模型规则）'),
  logRepairs: z.boolean().default(true).extra('volatile', true).description('记录补救原因及字段名（不记录任务或模型值）')
}).default({});

export async function apply(ctx, config = {}) {
  const runtime = await detectRuntimeVersion();
  if (!runtime.supported) {
    ctx.logger.warn(`[subagent-arg-guard] inactive: ${runtime.reason}${runtime.version ? ` (${runtime.version})` : ''}; only 0.2.2-rc.1 / 0.2.2-rc.2 / 0.2.2-rc.3 are audited`);
    return;
  }
  ctx.logger.info(`[subagent-arg-guard] runtime=${runtime.version}; audited adapter enabled`);
  const guard = createGuard({
    version: runtime.version,
    enabled: () => readFlag(config.enabled),
    repairForks: () => readFlag(config.repairForks),
    repairDisallowedRoutes: () => readFlag(config.repairDisallowedRoutes),
    validate: validateKnownArguments,
    pipelineFor: exec => captureCurrentPipeline(ctx, exec, runtime.version),
    report: event => {
      if (!readFlag(config.logRepairs)) return;
      // Never log prompts, cwd, API keys, model values or complete arguments.
      const suffix = event.phase === 'attempt' ? `; removed=${event.fields.join(',')}` : `; isError=${event.isError}`;
      ctx.logger.info(`[subagent-arg-guard] ${event.phase}: ${event.tool} (${event.callId}); ${event.reason}${suffix}`);
    }
  });
  const access = createToolAccessPolicy({
    version: runtime.version,
    allowSubagent: () => readFlag(config.allowSubagent),
    allowSubagentFork: () => readFlag(config.allowSubagentFork)
  });
  ctx.tools.guard(access.guard);
  ctx.on('tools/execute', (exec, next) => access.execute(exec, () => guard(exec, next)));
}
