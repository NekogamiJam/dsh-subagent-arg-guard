import { captureCurrentPipeline, createGuard, validateKnownArguments } from './guard.js';

export const name = 'subagent-arg-guard';
export const inject = ['tools'];

export function apply(ctx) {
  const guard = createGuard({
    validate: validateKnownArguments,
    pipelineFor: exec => captureCurrentPipeline(ctx, exec),
    report: event => {
      // Never log prompts, cwd, API keys or complete arguments.
      const suffix = event.phase === 'attempt' ? `; removed=${event.fields.join(',')}` : `; isError=${event.isError}`;
      ctx.logger.info(`[subagent-arg-guard] ${event.phase}: ${event.tool} (${event.callId}); ${event.reason}${suffix}`);
    }
  });
  ctx.on('tools/execute', guard);
}
