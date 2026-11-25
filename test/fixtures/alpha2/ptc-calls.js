import { HarnessError, createUserMessage, resolveImageAttachmentAccess } from "@deepseek-ai/dsh-llm";
import { RUN_CODE_NAME as RUN_CODE_NAME$1, TOOL_ABORTED, ToolArgsError, ToolContextUnavailableError, defineTool, parameterSchemaSpecToJsonSchema, projectToolSchema } from "@deepseek-ai/dsh-tools";
import { toolErrorMessage } from "@deepseek-ai/dsh-tools/pipeline";
import { isDeepStrictEqual } from "node:util";
import { symbols } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import { extractTextContent } from "@deepseek-ai/dsh-llm/message";
import { PtcImage, PtcInspectableValue } from "@deepseek-ai/dsh-ptc-runtime";
import { ESCALATION_TARGETS, approveEscalation, validateEscalationArgs } from "@deepseek-ai/dsh-sandbox";
import { deepFreeze, snapshotJsonValue } from "@deepseek-ai/dsh-util-values";
import { scopeTarget } from "@deepseek-ai/dsh-scope";
import z from "@deepseek-ai/schemastery";
//#region lib/types/errors.js
/** Program execution failures reported by PTC. @module */
/**
* Host-only abort reason for an exhausted tool-call allowance; the excess call is never dispatched.
* The executor recognizes this class at settlement and reports CODE_RUN_FAILED to the model.
*/
var ToolCallLimitExceededError = class extends Error {
	/**
	* Describe the rejected call and how to correct the program.
	* @param limit - Timeout-derived maximum tool-call attempts for one program.
	* @param callNumber - One-based attempt rejected without invoking the tool.
	* @param callsPerMinute - Attempts granted per minute of program timeout.
	* @param toolName - Program tool name.
	*/
	constructor(limit, callNumber, callsPerMinute, toolName) {
		super(`${toolName} exceeded its limit of ${limit} tool calls (${callsPerMinute} per minute of its timeout); call ${callNumber} was not dispatched. The ${toolName} program may contain an infinite loop. Check loop termination or split the work into smaller ${toolName} calls.`);
		this.name = "ToolCallLimitExceededError";
	}
};
/**
* Thrown by `run_code` when the program run itself failed — a program
* exception, a budget expiry, a runtime-local abort, or substrate death — or
* could not start. Caller cancellation uses the shared `AbortError` /
* `ABORTED` tool outcome. Extends {@link HarnessError} with a code from
* {@link CODE_RUN_ERROR_CODES}; the registry's execution pipeline converts it
* into a structured `isError` result with the failure kind. Captured text and
* images accompany the original diagnostic; outer result replacements remain
* authoritative.
*/
var CodeRunFailedError = class extends HarnessError {
	code;
	constructor(message, code = "CODE_RUN_FAILED", options) {
		super(message, code, options);
		this.name = "CodeRunFailedError";
		this.code = code;
	}
};
/** A host reset is unsupported or failed; cleanup failures require an explicit retry. */
var CodeResetFailedError = class extends HarnessError {
	constructor(message) {
		super(message, "CODE_RESET_FAILED");
		this.name = "CodeResetFailedError";
	}
};
//#endregion
//#region lib/types/program-images.js
/**
* Program images for tool values that reference their result images through
* `{ type: 'image', attachment }` entries, such as admitted MCP image blocks.
* @module
*/
/**
* Replace each image entry whose attachment is one of the finalized result images.
* Entries naming another attachment, such as an image a policy removed, stay JSON.
* @param value - Canonical tool value; it is not modified.
* @param images - Image blocks of the finalized result content.
* @param image - Creates the program value for one finalized reference, or returns undefined when the program cannot read it.
* @returns The substituted value, or undefined unless every finalized image was substituted.
*/
function substituteProgramImages(value, images, image) {
	const refs = new Map(images.map((block) => [String(block.attachment.attachmentId), block.attachment]));
	const substituted = /* @__PURE__ */ new Set();
	const unreadable = /* @__PURE__ */ new Set();
	const result = mapImageEntries(value, (attachmentId) => {
		const ref = refs.get(attachmentId);
		if (ref === void 0) return void 0;
		const programImage = image(ref);
		if (programImage === void 0) unreadable.add(attachmentId);
		else substituted.add(attachmentId);
		return programImage;
	});
	return unreadable.size === 0 && substituted.size === refs.size ? result : void 0;
}
function mapImageEntries(value, replace) {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) {
		const items = value.map((item) => mapImageEntries(item, replace));
		return items.some((item, index) => item !== value[index]) ? items : value;
	}
	const attachment = value.attachment;
	if (value.type === "image" && attachment !== null && typeof attachment === "object" && !Array.isArray(attachment) && typeof attachment.attachmentId === "string") {
		const replaced = replace(attachment.attachmentId);
		if (replaced !== void 0) return replaced;
	}
	const entries = Object.entries(value);
	const mapped = entries.map(([key, item]) => [key, mapImageEntries(item, replace)]);
	return mapped.some(([, item], index) => item !== entries[index]?.[1]) ? Object.fromEntries(mapped) : value;
}
//#endregion
//#region lib/types/ptc.js
/**
* Shared program transport. Programs call their admitted tools through nested
* executions scheduled under the native concurrency contract; each sub-dispatch
* is logged for reconstruction, while only the outer curated result enters model
* history.
* @module
*/
/** Keep tool-call rules here; the runtime owns evaluation syntax and state retention. */
function runCodeFlavor(language, outputInstruction, execution = {
	programDescription: "the program to execute",
	codeDescription: `The ${language} program to execute, following this tool's execution instructions.`
}) {
	return {
		description: `Execute a ${language} program against the available tools. Takes two required arguments: \`code\`, ${execution.programDescription}, and \`description\`, a short summary of what the program does. Call tools as \`await tools.name(args)\` per the declarations in the system prompt. ` + outputInstruction,
		codeDescription: execution.codeDescription
	};
}
const TYPESCRIPT_OUTPUT_INSTRUCTION = "Show selected text and images with inspect(...values).";
const TYPESCRIPT_FLAVOR = runCodeFlavor("TypeScript", TYPESCRIPT_OUTPUT_INSTRUCTION);
const TYPESCRIPT_FUNCTION_FLAVOR = runCodeFlavor("TypeScript", TYPESCRIPT_OUTPUT_INSTRUCTION, {
	programDescription: "the BODY of an async function (erasable syntax only; top-level `await` and `return` work)",
	codeDescription: "The program: the body of an async TypeScript function."
});
/**
* Read the active runtime, rejecting missing providers and unsupported languages.
* @param ctx - executor context containing the runtime provider.
* @returns the mounted TypeScript provider.
*/
function requirePtcRuntime(ctx) {
	const runtime = ctx.get("ptcRuntime");
	if (runtime === void 0) throw new ToolContextUnavailableError("dsh-tools: mode \"ptc\" requires a PTC runtime — load a ctx.ptcRuntime implementation (e.g. @deepseek-ai/dsh-ptc-runtime-node) or load @deepseek-ai/dsh-tool-executor-native");
	return requireRuntimeLanguage(runtime);
}
/**
* Reject providers whose source language the executor cannot present.
* @param runtime - Mounted or explicitly supplied provider.
* @returns The supported provider.
* @throws ToolContextUnavailableError for a language other than TypeScript.
*/
function requireRuntimeLanguage(runtime) {
	if (runtime.language !== "typescript") throw new ToolContextUnavailableError(`dsh-tools: unsupported PTC runtime language ${JSON.stringify(runtime.language)}; use a TypeScript provider (language: "typescript")`);
	return runtime;
}
/** The shared UI-label description for the static spec and program-format-aware parameters getter. */
const RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION = "Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: \"Count TODO markers across packages\"; \"Read failing test and its fixture\"; \"Rename config key in every cordis.yml\".";
const RUN_CODE_CONTROLS = {
	timeoutMs: {
		type: "number",
		description: "Positive elapsed-time budget in milliseconds, capped by the deployment maximum."
	},
	sandbox_permissions: {
		type: "string",
		enum: [...ESCALATION_TARGETS],
		description: "Wider sandbox mode for this complete program execution; requires justification and approval."
	},
	justification: {
		type: "string",
		description: "Reason this complete program needs wider access, shown to the user for approval. Use the language of the user’s current request."
	}
};
function controlParameters(runtime) {
	return {
		...runtime.timeout === void 0 ? {} : { timeoutMs: {
			...RUN_CODE_CONTROLS.timeoutMs,
			description: `Positive elapsed-time budget in milliseconds, including nested tool and approval waits. Default ${runtime.timeout.defaultMs}; capped at ${runtime.timeout.maxMs}. Zero does not disable the deadline.`
		} },
		...runtime.sandboxMode === void 0 ? {} : {
			sandbox_permissions: RUN_CODE_CONTROLS.sandbox_permissions,
			justification: RUN_CODE_CONTROLS.justification
		}
	};
}
function escalationGuidance(mode) {
	return mode === void 0 ? "" : " A sandbox escalation approves this complete program for one execution only. Nested tools retain their own policies and approvals. Request wider access only after evidence of a denial. Earlier effects may already have completed: inspect them before explicitly retrying. Programs are never replayed automatically.";
}
/** Match schema text to the runtime program syntax. */
function resolveFlavor(runtime) {
	return runtime.programFormat === "function-body" ? TYPESCRIPT_FUNCTION_FLAVOR : TYPESCRIPT_FLAVOR;
}
/**
* Snapshot one binding call's argument as lossless JSON, then snapshot that
* detached value again so dispatch and logging stay independent without
* reintroducing structured-clone's platform-specific nesting limit.
*/
function jsonNormalizeArgs(value) {
	let snapshot;
	try {
		snapshot = snapshotJsonValue(value);
	} catch (error) {
		throw new Error(`tool arguments must be lossless JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (snapshot === void 0) throw new Error("tool arguments must be lossless JSON (call the tool with an arguments object, e.g. `{}`)");
	const logged = snapshotJsonValue(snapshot);
	/* v8 ignore next -- snapshot is already a detached lossless JSON value. */
	if (logged === void 0) throw new Error("tool arguments could not be detached for durable logging");
	return {
		dispatched: snapshot,
		logged
	};
}
/** Whether a rejection is the caller's cancellation rather than a failure of its own. */
function isCancellation(error, signal) {
	return signal.aborted && (error === signal.reason || error instanceof Error && error.name === "AbortError");
}
/** Render captured text, selected images, and the applied file policy in emission order. */
function renderRunOutput(value, guidance, output = value.logs.map((text) => ({
	type: "text",
	text
})), toolName) {
	const content = [];
	const appendText = (text) => {
		if (text.length > 0) content.push({
			type: "text",
			text
		});
	};
	const remaining = [];
	for (const block of output) if (block.type === "text") remaining.push(block.text);
	else {
		appendText(remaining.join(""));
		remaining.length = 0;
		content.push(block);
	}
	appendText(remaining.join(""));
	const details = [];
	if (value.outputTruncated) details.push("Program completed. Output was truncated; read current state for missing information without repeating completed actions.");
	if (value.sandbox?.enforcement === "partial") details.push("File sandbox enforcement is partial on this host.");
	if (value.sandbox?.denied) details.push(`The ${value.sandbox.mode} file sandbox denied an operation.${guidance}`);
	appendText(details.filter((text) => text.length > 0).join("\n"));
	return content.length > 0 ? content : [{
		type: "text",
		text: `(${toolName} completed with no output)`
	}];
}
/** Unowned programs do not require Session directory state. */
async function resolveWorkingDirectory(ctx, exec) {
	if (exec.agent === void 0) return void 0;
	const directories = ctx.get("workingDirectory");
	if (directories === void 0) throw new ToolContextUnavailableError("dsh-tools: run_code with an Agent requires workingDirectory");
	return directories.ensure(exec.agent, exec.signal);
}
/** Resolve standing authority for a runtime that enforces file policy. */
function resolveSandboxPolicy(ctx, exec) {
	const policy = ctx.get("sandboxPolicy");
	if (policy === void 0) throw new ToolContextUnavailableError("dsh-tools: confined PTC runtime requires sandboxPolicy");
	return policy.resolve(exec.agent === void 0 ? {} : { session: exec.agent.session });
}
/**
* Build a program transport using the shared nested-call scheduler.
* @param ctx - executor context owning policy listeners and active program cleanup.
* @param executor - shared invocation pipeline for nested calls.
* @param config - validated timeout-based tool-call allowance and concurrency limits.
* @param calls - Executor-owned cancellation and reset coordination.
* @param options - Fixed runtime and tools for a registered program tool; omission selects PTC's visible registry and current runtime.
* @returns the transport definition with runtime-dependent schema text.
*/
function createRunCodeTransport(ctx, executor, config, calls, options) {
	const { maxSubCallsPerMinute, maxParallelSubCalls: maxParallel } = config;
	const toolName = options?.name ?? RUN_CODE_NAME$1;
	const getRuntime = options === void 0 ? () => requirePtcRuntime(ctx) : () => requireRuntimeLanguage(options.runtime);
	const tools = ctx.tools;
	const logger = ctx.logger;
	/** A failed log-content listener preserves the settled content and cannot fail the dispatch. */
	async function shapeDispatchLog(dispatch) {
		try {
			return await ctx.waterfall(scopeTarget(tools, dispatch.agent), "tools/ptc-dispatch-log", dispatch, () => Promise.resolve(dispatch.content));
		} catch (error) {
			logger.warn(`tools: ptc-dispatch-log listener failed for ${dispatch.name}: ${toolErrorMessage(error)}; logging the original settled content`);
			return dispatch.content;
		}
	}
	const inspections = /* @__PURE__ */ new WeakMap();
	const readableImage = (ref) => {
		const attachments = ctx.get("attachments");
		const fs = ctx.get("fs");
		const access = attachments === void 0 || fs === void 0 ? void 0 : resolveImageAttachmentAccess(attachments, (path) => fs.processPathFromHostPath(path), ref);
		return access === void 0 ? void 0 : new PtcImage(access.readonlyPath, ref);
	};
	const programImage = (ref) => {
		const image = readableImage(ref);
		if (image === void 0) throw new Error("Image storage must expose a readable path in the program filesystem");
		return image;
	};
	const stateOwners = /* @__PURE__ */ new WeakMap();
	const definition = defineTool({
		name: toolName,
		description: TYPESCRIPT_FLAVOR.description,
		parameters: {
			code: {
				type: "string",
				required: true,
				description: TYPESCRIPT_FLAVOR.codeDescription
			},
			description: {
				type: "string",
				required: true,
				description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
			},
			...RUN_CODE_CONTROLS
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					logs: {
						type: "array",
						required: true,
						items: { type: "string" }
					},
					outputTruncated: { type: "boolean" },
					sandbox: {
						type: "object",
						additionalProperties: false,
						properties: {
							mode: {
								type: "string",
								required: true,
								enum: [
									"read-only",
									"workspace-write",
									"danger-full-access"
								]
							},
							denied: {
								type: "boolean",
								required: true
							},
							enforcement: {
								type: "string",
								enum: ["full", "partial"]
							}
						}
					}
				}
			},
			render: (_args, value) => renderRunOutput(value, escalationGuidance(options === void 0 ? ctx.get("ptcRuntime")?.sandboxMode : options.runtime.sandboxMode), void 0, toolName)
		},
		async execute(args, exec) {
			if (args.description.trim().length === 0) throw new ToolArgsError(["invalid description: expected a non-empty string"]);
			const runtime = getRuntime();
			const run = async (callSignal) => {
				if (runtime.sandboxMode === void 0 && (args.sandbox_permissions !== void 0 || args.justification !== void 0)) throw new ToolArgsError(["sandbox_permissions and justification are not available for this PTC runtime"]);
				validateEscalationArgs(args.sandbox_permissions, args.justification);
				if (args.timeoutMs !== void 0 && runtime.timeout === void 0) throw new ToolArgsError(["timeoutMs is not available for this PTC runtime"]);
				if (args.timeoutMs !== void 0 && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) throw new ToolArgsError(["invalid timeoutMs: expected a positive finite number"]);
				const standingPolicy = runtime.sandboxMode === void 0 ? void 0 : resolveSandboxPolicy(ctx, exec);
				let policy = standingPolicy;
				if (args.sandbox_permissions !== void 0 && args.justification !== void 0) {
					const confined = standingPolicy;
					const approvedMode = await approveEscalation({
						requestedMode: args.sandbox_permissions,
						justification: args.justification,
						effectiveMode: confined.mode,
						subject: "program"
					}, {
						approver: ctx.get("approval"),
						agent: exec.agent,
						callId: exec.callId,
						toolName,
						signal: callSignal
					});
					policy = {
						...confined,
						mode: approvedMode
					};
				}
				const cwd = await resolveWorkingDirectory(ctx, {
					...exec,
					signal: callSignal
				});
				callSignal.throwIfAborted();
				const runController = new AbortController();
				const onOuterAbort = () => {
					runController.abort(callSignal.reason);
				};
				callSignal.addEventListener("abort", onOuterAbort, { once: true });
				let toolCallAttempts = 0;
				let maxSubCalls;
				const pendingQueue = [];
				const inFlight = /* @__PURE__ */ new Set();
				/** Tracked settle-event side work (log-content listener + append), drained at run settlement. */
				const logWork = /* @__PURE__ */ new Set();
				const commitQueue = [];
				let exclusiveActive = false;
				let driving = false;
				let driverRun = Promise.resolve();
				let wake;
				const wakeup = () => {
					const release = wake;
					wake = void 0;
					release?.();
				};
				/**
				* The single ordered lane. Each pass commits the head-of-line settled
				* dispatch (ordered post-execute), then starts the next queued entry if
				* its slot is free (ordered pre-execute), and otherwise sleeps until a
				* body settles or a new submission arrives. One run reaching the
				* empty-queues/empty-pool state is quiescence.
				*/
				const drive = () => {
					if (driving) return driverRun;
					driving = true;
					driverRun = (async () => {
						try {
							for (;;) {
								const signal = new Promise((resolve) => {
									wake = resolve;
								});
								const commitHead = commitQueue[0];
								if (commitHead !== void 0 && commitHead.settled) {
									commitQueue.shift();
									await commitHead.commit();
									if (commitHead.mode === "exclusive") exclusiveActive = false;
									continue;
								}
								const head = pendingQueue[0];
								if (head !== void 0) {
									if (runController.signal.aborted) {
										pendingQueue.shift();
										head.abandon();
										continue;
									}
									const mode = head.classify();
									if (!exclusiveActive && (mode === "exclusive" ? inFlight.size === 0 : inFlight.size < maxParallel)) {
										if (mode === "exclusive") exclusiveActive = true;
										head.mode = mode;
										pendingQueue.shift();
										commitQueue.push(head);
										await head.start();
										const flight = head.flight.finally(() => {
											inFlight.delete(flight);
											wakeup();
										});
										inFlight.add(flight);
										continue;
									}
								}
								if (pendingQueue.length === 0 && commitQueue.length === 0 && inFlight.size === 0) return;
								await signal;
							}
						} finally {
							driving = false;
							wake = void 0;
						}
					})();
					return driverRun;
				};
				/** Every dispatch settled AND committed; nothing can start (the run is aborted at call time). */
				const drainDispatches = async () => {
					await drive();
					while (logWork.size > 0) await Promise.allSettled([...logWork]);
				};
				const runOver = () => runController.signal.aborted;
				const binding = (schema) => async (rawArgs) => {
					const { name } = schema;
					const usesProgramImage = name === "read_image" || name === "cua";
					if (runOver()) throw new Error(`${toolName} run is over (${String(runController.signal.reason)}); ${name} not dispatched`);
					const n = ++toolCallAttempts;
					if (n > maxSubCalls) {
						const error = new ToolCallLimitExceededError(maxSubCalls, n, maxSubCallsPerMinute, toolName);
						runController.abort(error);
						throw error;
					}
					const normalized = jsonNormalizeArgs(rawArgs);
					const subCallId = brandString(`${String(exec.callId)}:ptc:${n}`);
					const input = {
						callId: subCallId,
						rootCallId: exec.rootCallId,
						name,
						schema,
						arguments: normalized.dispatched,
						...exec.agent ? { agent: exec.agent } : {},
						...exec.toolSet !== void 0 ? { toolSet: exec.toolSet } : {},
						parent: exec.token,
						signal: runController.signal
					};
					const outcome = await new Promise((resolve, reject) => {
						let parked;
						const settle = (result, imageRemoved, programValue) => {
							resolve(result.isError ? {
								isError: true,
								message: result.error.message
							} : {
								isError: false,
								value: programValue ?? result.value,
								content: result.content,
								imageRemoved
							});
							const agent = exec.agent;
							if (agent === void 0) return;
							const task = (async () => {
								const logged = await shapeDispatchLog({
									exec,
									agent,
									subCallId,
									name,
									isError: result.isError,
									content: result.content
								});
								agent.session.append("tool/ptc-dispatch", {
									rootCallId: exec.rootCallId,
									parentCallId: exec.callId,
									subCallId,
									name,
									arguments: normalized.logged,
									isError: result.isError,
									...result.error?.info === void 0 ? {} : { error: result.error.info },
									content: logged,
									...result.meta === void 0 ? {} : { meta: result.meta }
								});
							})().finally(() => {
								logWork.delete(task);
							});
							logWork.add(task);
						};
						pendingQueue.push({
							flight: Promise.resolve(),
							settled: false,
							classify: () => executor.executionMode(input).kind,
							abandon: () => {
								reject(/* @__PURE__ */ new Error(`${toolName} run is over (${String(runController.signal.reason)}); ${name} tool call abandoned`));
							},
							async start() {
								exec.agent?.session.append("tool/ptc-dispatch-start", {
									rootCallId: exec.rootCallId,
									parentCallId: exec.callId,
									subCallId,
									name,
									arguments: normalized.logged
								});
								const prepared = await executor.prepare(input);
								if (prepared.kind === "dispatch") {
									this.flight = executor.dispatch(prepared.exec).then((dispatchOutcome) => {
										parked = {
											kind: dispatchOutcome.kind,
											exec: prepared.exec,
											result: dispatchOutcome.result
										};
										this.settled = true;
									});
									return;
								}
								parked = {
									kind: prepared.kind,
									exec: prepared.exec,
									result: prepared.result
								};
								this.settled = true;
							},
							async commit() {
								/* v8 ignore next -- commit() runs only after `settled` flipped, which set parked. */
								if (parked === void 0) return;
								const result = await executor.complete(parked.exec, parked);
								const images = result.content.filter((block) => block.type === "image");
								let programValue;
								if (!usesProgramImage && !result.isError && images.length > 0) try {
									programValue = substituteProgramImages(result.value, images, readableImage);
								} catch (error) {
									logger.warn(`tools: ${name} result images stay in model context: ${toolErrorMessage(error)}`);
								}
								if (!usesProgramImage && !result.isError && images.length > 0 && programValue === void 0) exec.deferContext(createUserMessage({
									content: result.content,
									source: { kind: "ptc-mode" }
								}));
								for (const context of result.additionalContexts ?? []) exec.deferContext(context);
								if (result.concludesTurn) exec.concludeTurn();
								settle(result, parked.result.content.some((block) => block.type === "image") && images.length === 0, programValue);
								while (logWork.size > maxParallel) await Promise.race(logWork);
							}
						});
						wakeup();
						drive();
					});
					if (runOver()) throw new Error(`${toolName} run is over (${String(runController.signal.reason)}); ${name} result discarded`);
					if (outcome.isError) throw new Error(outcome.message);
					if (usesProgramImage) {
						const images = outcome.content.filter((block) => block.type === "image");
						const first = images[0];
						if (first !== void 0 && images.length === 1) return programImage(first.attachment);
						if (outcome.imageRemoved) throw new Error("Image output was removed by a tool output policy.\n" + extractTextContent(outcome.content, { separator: "\n" }));
						if (name === "read_image" || images.length > 1) throw new Error("Image-producing tools must return exactly one image");
					}
					if (outcome.value !== null && typeof outcome.value === "object" && outcome.content.every((block) => block.type === "text")) return new PtcInspectableValue(outcome.value, outcome.content.map((block) => block.text).join("\n"));
					return outcome.value;
				};
				const functions = Object.create(null);
				const schemas = options === void 0 ? tools.schemas(exec.agent, exec.toolSet) : options.tools.map((definition) => projectToolSchema(definition, true));
				for (const schema of schemas) Object.defineProperty(functions, schema.name, {
					enumerable: true,
					value: binding(deepFreeze(schema))
				});
				try {
					let result;
					try {
						if (exec.agent !== void 0) {
							const agent = exec.agent;
							let runtimes = stateOwners.get(agent);
							if (runtimes === void 0) stateOwners.set(agent, runtimes = /* @__PURE__ */ new WeakSet());
							let provider = runtime;
							for (;;) {
								const original = provider[symbols.original];
								if (original === void 0) break;
								provider = original;
							}
							if (!runtimes.has(provider)) {
								agent.ctx.effect(() => () => runtime.release(agent), "PTC retained environment");
								runtimes.add(provider);
							}
						}
						const spec = runtime.resolve({
							program: args.code,
							discardCompletion: true,
							...exec.agent === void 0 || policy?.mode !== standingPolicy?.mode ? {} : { stateOwner: exec.agent },
							bindings: [{
								global: "tools",
								functions,
								errorClass: {
									name: "ToolCallError",
									memberNameProperty: "toolName"
								}
							}],
							signal: runController.signal,
							...cwd !== void 0 ? { cwd } : {},
							...policy !== void 0 ? { sandboxPolicy: policy } : {},
							...args.timeoutMs !== void 0 ? { timeoutMs: args.timeoutMs } : {}
						});
						maxSubCalls = spec.timeoutMs === null ? Infinity : Math.floor(spec.timeoutMs / 6e4 * maxSubCallsPerMinute);
						result = await runtime.run(spec);
					} catch (error) {
						if (error instanceof HarnessError || isCancellation(error, callSignal)) throw error;
						throw new CodeRunFailedError(`code run failed: ${toolErrorMessage(error)}`, "CODE_RUN_FAILED", { cause: error });
					} finally {
						runController.abort(`${toolName} settled`);
						await drainDispatches();
					}
					const logs = result.output.flatMap((block) => block.type === "text" ? [block.text] : []);
					const hasImages = result.output.some((block) => block.type === "image");
					if (result.error) {
						const limitError = runController.signal.reason instanceof ToolCallLimitExceededError ? runController.signal.reason : void 0;
						let failure;
						if (result.error.kind === "abort" && exec.signal.aborted && limitError === void 0) {
							failure = new HarnessError((runtime.retainsState ? `tool call aborted: ${result.error.message}` : "tool call aborted") + (result.outputTruncated ? "\nOutput was truncated." : ""), TOOL_ABORTED);
							failure.name = "AbortError";
						} else {
							const logsText = logs.length > 0 && !hasImages ? `\nCaptured output:\n${logs.join("")}` : "";
							const sandboxText = result.sandbox === void 0 ? "" : `${logsText.endsWith("\n") ? "" : "\n"}File sandbox: ${result.sandbox.mode}${result.sandbox.enforcement === void 0 ? "" : `; enforcement: ${result.sandbox.enforcement}`}${result.sandbox.denied ? "; operation denied" : ""}.`;
							const failureText = limitError === void 0 || limitError.message === result.error.message ? result.error.message : `${limitError.message}\n${result.error.message}`;
							const truncation = result.outputTruncated ? "\nOutput was truncated." : "";
							failure = new CodeRunFailedError(`code run failed (${result.error.kind}): ${failureText}${logsText}${sandboxText}${result.sandbox?.denied ? escalationGuidance(runtime.sandboxMode) : ""}${truncation}`);
						}
						if (hasImages) inspections.set(exec, {
							failure: {
								error: {
									message: failure.message,
									info: {
										name: failure.name,
										code: failure.code
									}
								},
								content: [{
									type: "text",
									text: `Error: ${failure.message}`
								}]
							},
							output: result.output
						});
						throw failure;
					}
					const value = {
						logs,
						...result.outputTruncated ? { outputTruncated: true } : {},
						...result.sandbox === void 0 ? {} : { sandbox: result.sandbox }
					};
					if (hasImages) inspections.set(exec, {
						value,
						output: result.output
					});
					return value;
				} finally {
					callSignal.removeEventListener("abort", onOuterAbort);
				}
			};
			return exec.agent === void 0 || runtime.sandboxMode === void 0 && !runtime.retainsState ? run(exec.signal) : calls.run(exec.agent.session.id, exec.signal, () => runtime.sandboxMode === void 0 ? void 0 : resolveSandboxPolicy(ctx, exec).mode, run);
		},
		projectContent(exec, result) {
			const selected = inspections.get(exec);
			inspections.delete(exec);
			if (selected === void 0) return void 0;
			if (result.isError) {
				if (!isDeepStrictEqual(selected.failure, {
					error: result.error,
					content: result.content
				})) return void 0;
				return [...result.content, ...renderRunOutput({ logs: [] }, "", selected.output, toolName)];
			}
			if (selected.value === void 0 || !isDeepStrictEqual(selected.value, result.value)) return void 0;
			return renderRunOutput(selected.value, escalationGuidance(options === void 0 ? ctx.get("ptcRuntime")?.sandboxMode : options.runtime.sandboxMode), selected.output, toolName);
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.description,
			kind: "execute",
			rawInput: args.code
		})
	});
	Object.defineProperty(definition, "description", {
		enumerable: true,
		get: () => {
			const runtime = getRuntime();
			const instructions = runtime.executionInstructions;
			return (options?.description ?? resolveFlavor(runtime).description) + (instructions ? ` ${instructions}` : "") + " Each program starts in the Session's current directory. Running programs keep their initial directory." + escalationGuidance(runtime.sandboxMode);
		}
	});
	Object.defineProperty(definition, "parameters", {
		enumerable: true,
		get: () => {
			const runtime = getRuntime();
			return parameterSchemaSpecToJsonSchema({
				code: {
					type: "string",
					required: true,
					description: resolveFlavor(runtime).codeDescription
				},
				description: {
					type: "string",
					required: true,
					description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
				},
				...controlParameters(runtime)
			});
		}
	});
	return definition;
}
//#endregion
//#region lib/types/config.js
/** Configuration shared by plugin mounting and direct executor construction. @module */
/** Validated timeout-based call allowance and concurrency; parallelism of one makes subcalls serial. */
const Config = z.object({
	maxSubCallsPerMinute: z.natural().min(1).default(1024),
	maxParallelSubCalls: z.natural().min(1).default(10)
});
//#endregion
//#region lib/types/ptc-calls.js
/** Serializes recovery with complete calls, including their nested-tool cleanup. */
var PtcCalls = class {
	calls = /* @__PURE__ */ new Map();
	resets = /* @__PURE__ */ new Map();
	disposed = false;
	/**
	* Observe policy changes for the owning executor.
	* @param ctx - Executor lifecycle and Session events.
	*/
	constructor(ctx) {
		ctx.on("session/event", (session, event) => {
			if (event.type !== "sandbox/mode") return;
			for (const call of this.calls.get(session.id) ?? []) if (call.mode !== void 0 && call.mode !== event.data.mode) call.controller.abort(/* @__PURE__ */ new Error("sandbox mode changed"));
		}, { global: true });
		ctx.effect(() => async () => {
			this.disposed = true;
			const calls = [...this.calls.values()].flatMap((calls) => [...calls]);
			for (const call of calls) call.controller.abort(/* @__PURE__ */ new Error("PTC tool executor disposed"));
			await Promise.allSettled([...calls.map((call) => call.done), ...[...this.resets.values()].map((reset) => reset.done)]);
		}, "PTC calls");
	}
	/**
	* Await canceled predecessors before resolving authority and admitting a call.
	* @param sessionId - Calling Session.
	* @param signal - Caller cancellation.
	* @param mode - Current standing mode, if supported, read after preceding cleanup.
	* @param run - Complete call, including nested-tool cleanup.
	* @returns The call result.
	*/
	async run(sessionId, signal, mode, run) {
		for (;;) {
			const reset = this.resets.get(sessionId);
			if (reset !== void 0) {
				try {
					await reset.done;
				} catch (error) {
					throw new CodeRunFailedError(`Program environment unavailable: ${toolErrorMessage(error)}. Ask the host to reset it before running more code.`);
				}
				continue;
			}
			const pending = [...this.calls.get(sessionId) ?? []].filter((call) => call.signal.aborted);
			if (pending.length === 0) break;
			await Promise.all(pending.map((call) => call.done));
		}
		signal.throwIfAborted();
		if (this.disposed) throw new CodeRunFailedError("PTC tool executor disposed", "CODE_RUN_UNAVAILABLE");
		const controller = new AbortController();
		const done = Promise.withResolvers();
		const currentSignal = AbortSignal.any([signal, controller.signal]);
		const call = {
			mode: mode(),
			controller,
			signal: currentSignal,
			done: done.promise
		};
		let calls = this.calls.get(sessionId);
		if (calls === void 0) this.calls.set(sessionId, calls = /* @__PURE__ */ new Set());
		calls.add(call);
		try {
			return await run(currentSignal);
		} finally {
			calls.delete(call);
			if (calls.size === 0) this.calls.delete(sessionId);
			done.resolve(void 0);
		}
	}
	/**
	* Cancel calls and release their environment independently of program cooperation.
	* A failed release blocks new calls until a later reset succeeds.
	* @param sessionId - Calling Session.
	* @param release - Host operation that terminates and cleans the owned environment.
	* @param notify - Queue the state-loss notice after cleanup and before admitting new calls.
	* @returns Completion after release and all canceled calls settle; concurrent resets share it.
	*/
	reset(sessionId, release, notify) {
		if (this.disposed) return Promise.reject(/* @__PURE__ */ new Error("PTC tool executor disposed"));
		const previous = this.resets.get(sessionId);
		if (previous !== void 0 && !previous.settled) return previous.done;
		const done = Promise.withResolvers();
		const reset = {
			done: done.promise,
			settled: false
		};
		this.resets.set(sessionId, reset);
		const calls = [...this.calls.get(sessionId) ?? []];
		for (const call of calls) call.controller.abort(/* @__PURE__ */ new Error("PTC environment reset"));
		Promise.allSettled([Promise.resolve().then(release), ...calls.map((call) => call.done)]).then((results) => {
			const failure = results.find((result) => result.status === "rejected");
			if (failure !== void 0) throw failure.reason;
			notify?.();
		}).then(() => {
			reset.settled = true;
			this.resets.delete(sessionId);
			done.resolve(void 0);
		}, (error) => {
			reset.settled = true;
			done.reject(error);
		});
		return reset.done;
	}
};
//#endregion
export { requireRuntimeLanguage as a, requirePtcRuntime as i, Config as n, CodeResetFailedError as o, createRunCodeTransport as r, CodeRunFailedError as s, PtcCalls as t };
