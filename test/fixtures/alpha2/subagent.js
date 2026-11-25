import z from "@deepseek-ai/schemastery";
import { ToolArgsError, ToolContextUnavailableError, defineTool } from "@deepseek-ai/dsh-tools";
import { SubagentError, assertSubagentMaxDepth, delegationDepthOf, parentAgentOptionsForDelegation } from "@deepseek-ai/dsh-subagent";
import { brandString } from "@deepseek-ai/dsh-brand";
z.object({
	provider: z.string().min(1).required(),
	model: z.string().min(1).required()
});
/**
* Whether an optional string tool argument carries a value. Some models send
* `""` for optional fields they leave unset.
* @param value - Parsed argument value.
* @returns Whether the value is present and non-empty.
*/
function hasText(value) {
	return value !== void 0 && value !== "";
}
/**
* Read model-facing route fields from tool arguments, treating an empty string as an omitted field.
* @param args - Parsed tool arguments carrying the route fields.
* @returns The non-empty route fields.
*/
function delegationModelRequest(args) {
	return {
		...hasText(args.provider) ? { provider: args.provider } : {},
		...hasText(args.model) ? { model: args.model } : {},
		...hasText(args.reasoning_effort) ? { reasoning_effort: args.reasoning_effort } : {}
	};
}
/**
* Whether a call explicitly selects any child LLM value.
* @param request - Route fields read by {@link delegationModelRequest}.
* @returns Whether at least one route or effort field is present.
*/
function hasDelegationModelRequest(request) {
	return request.provider !== void 0 || request.model !== void 0 || request.reasoning_effort !== void 0;
}
/** Model-facing pointer to route discovery, appended to route-selection rejections. */
const ROUTE_DISCOVERY_HINT = " Call `list_subagent_models` to see the routes you may select.";
/**
* Validate explicit selection against the current Host setting and merge it over child defaults.
* Explicit selection requires both provider and model; an omitted effort then
* uses the selected model's default, even when the route is unchanged.
* @param configured - Tool-instance child defaults.
* @param request - Route fields read by {@link delegationModelRequest}.
* @param enabled - Whether this tool instance permits model-facing selection.
* @param policy - Current Host allowlist; omission permits only the current parent route.
* @param parentOptions - Current parent route used when the Host setting is disabled or absent.
* @param routeDiscoveryVisible - Whether the caller can call `list_subagent_models`; rejections then point to it.
* @returns Child Agent options, preserving omission when no layer contributes one.
* @throws {SubagentError} `MODEL_SELECTION_DISABLED` when this tool instance
*   forbids selection, or `MODEL_ROUTE_NOT_ALLOWED` when the allowlist excludes the route.
* @throws {ToolArgsError} when `provider` and `model` are not supplied together.
*/
function requestedAgentOptions(configured, request, enabled, policy, parentOptions, routeDiscoveryVisible) {
	if (!hasDelegationModelRequest(request)) return configured;
	if (!enabled) throw new SubagentError("child model selection is disabled for this tool instance", "MODEL_SELECTION_DISABLED");
	const hint = routeDiscoveryVisible ? ROUTE_DISCOVERY_HINT : "";
	if (request.provider === void 0 || request.model === void 0) throw new ToolArgsError([(request.reasoning_effort === void 0 ? "child LLM `provider` and `model` must be supplied together." : "child LLM `reasoning_effort` requires both `provider` and `model`; supply both or omit all three fields.") + hint]);
	assertAllowedModelSelection(policy, parentOptions, {
		provider: request.provider,
		model: request.model
	}, routeDiscoveryVisible);
	return {
		...configured,
		provider: request.provider,
		model: request.model,
		reasoningEffort: request.reasoning_effort === void 0 ? void 0 : brandString(request.reasoning_effort)
	};
}
/**
* Enforce Host authorization for a complete, explicitly selected child route.
* @param policy - Current Host allowlist; omission permits only the current parent route.
* @param parentOptions - Current parent route used when the Host setting is disabled or absent.
* @param route - Validated provider/model pair from the tool call.
* @param routeDiscoveryVisible - Whether the caller can call `list_subagent_models`; the rejection then points to it.
* @throws {SubagentError} `MODEL_ROUTE_NOT_ALLOWED` when the allowlist excludes the route.
*/
function assertAllowedModelSelection(policy, parentOptions, route, routeDiscoveryVisible) {
	const { provider, model } = route;
	if (policy === void 0 ? provider === parentOptions.provider && model === parentOptions.model : policy.routes.some((route) => route.provider === provider && route.model === model)) return;
	throw new SubagentError(`child LLM route "${provider}/${model}" is not allowed by the current subagent model selection setting` + (policy === void 0 ? "; while subagent model selection is disabled, explicit selection is limited to the parent route" : "") + "." + (routeDiscoveryVisible ? ROUTE_DISCOVERY_HINT : ""), "MODEL_ROUTE_NOT_ALLOWED");
}
/**
* Whether configured Agent options require route validation before delegation.
* @param options - Tool-instance child defaults.
* @returns Whether configured provider, model, or effort values must be resolved.
*/
function hasConfiguredLlmSelection(options) {
	return options?.provider !== void 0 || options?.model !== void 0 || options?.reasoningEffort !== void 0;
}
/**
* Resolve an effective child route through its live adapter before the child is
* created. The LLM runtime owns provider lookup, exact-model metadata, effort
* validation, and adapter defaults.
* @param llm - Live LLM runtime.
* @param parentOptions - Current parent values whose compatible fields the child inherits.
* @param requested - Per-child options after request/config merging.
* @param signal - Tool-call cancellation signal.
* @param inheritParentReasoningEffort - Whether an omitted effort may inherit from the parent route; false for explicit model selection.
*/
async function preflightChildLlmRoute(llm, parentOptions, requested, signal, inheritParentReasoningEffort = true) {
	const provider = requested?.provider ?? parentOptions.provider;
	const model = requested?.model ?? parentOptions.model;
	if (provider === void 0 || model === void 0) throw new ToolContextUnavailableError("cannot select child LLM values without an effective provider and model");
	const routeChanged = provider !== parentOptions.provider || model !== parentOptions.model;
	const reasoningEffort = requested?.reasoningEffort ?? (inheritParentReasoningEffort && !routeChanged ? parentOptions.reasoningEffort : void 0);
	await llm.resolveCallConfig({
		provider,
		model,
		...reasoningEffort === void 0 ? {} : { reasoningEffort }
	}, signal);
}
//#endregion
//#region lib/types/list-models.js
/** Model-facing discovery of LLM routes available to child Agents. */
/** Resolve one registered provider with a model-correctable diagnostic. */
function registeredProvider(llm, policy, providerId) {
	const providers = llm.listProviders();
	const provider = providers.find((candidate) => candidate.id === providerId);
	if (provider !== void 0) return provider;
	throw new SubagentError(`LLM provider "${providerId}" is not registered; available providers: ${providers.filter((candidate) => policy.routes.some((route) => route.provider === candidate.id)).map((candidate) => candidate.id).join(", ") || "(none)"}`, "LLM_PROVIDER_NOT_FOUND");
}
/** Render one advertised or resolved model. */
function modelLine(provider, model) {
	return `${provider}/${model.id} — ${model.name}${model.description === void 0 ? "" : `: ${model.description}`}`;
}
/** Read the requested provider, allowed models, or exact-model efforts. */
async function listSubagentModels(ctx, request, exec) {
	if (exec.agent === void 0) throw new ToolContextUnavailableError("list_subagent_models requires a calling agent");
	const routes = ctx.get("subagentModelSelection")?.allowedRoutes();
	let policy = routes === void 0 ? void 0 : { routes };
	const selectionEnabled = policy !== void 0;
	if (policy === void 0) {
		const { provider, model } = parentAgentOptionsForDelegation(exec.agent);
		if (provider === void 0 || model === void 0) throw new ToolContextUnavailableError("cannot discover child LLM routes without a parent provider and model");
		policy = { routes: [{
			provider,
			model
		}] };
	}
	const { signal } = exec;
	const llm = ctx.get("llm");
	if (llm === void 0) throw new ToolContextUnavailableError("cannot discover child LLM routes because the `llm` service is unavailable");
	if (request.model !== void 0 && request.provider === void 0) throw new ToolArgsError(["`model` requires `provider`"]);
	if (request.provider === void 0) {
		const providers = llm.listProviders().filter((provider) => policy.routes.some((route) => route.provider === provider.id));
		return providers.length === 0 ? "(no LLM providers)" : providers.map((provider) => `${provider.id} — ${provider.name}`).join("\n");
	}
	const allowedRoutes = policy.routes.filter((route) => route.provider === request.provider);
	const [firstRoute] = allowedRoutes;
	if (firstRoute === void 0) throw new SubagentError(`LLM provider "${request.provider}" is not allowed by the current subagent model selection setting`, "MODEL_ROUTE_NOT_ALLOWED");
	const provider = registeredProvider(llm, policy, request.provider);
	if (request.model === void 0) {
		const models = selectionEnabled ? (await llm.listModels(provider.id)).filter((model) => allowedRoutes.some((route) => route.model === model.id)) : [await llm.resolveModelInfo(provider.id, firstRoute.model, signal)];
		signal.throwIfAborted();
		return models.length === 0 ? `(no advertised models for ${provider.id})` : models.map((model) => modelLine(provider.id, model)).join("\n");
	}
	if (!allowedRoutes.some((route) => route.model === request.model)) throw new SubagentError(`child LLM route "${provider.id}/${request.model}" is not allowed by the current subagent model selection setting`, "MODEL_ROUTE_NOT_ALLOWED");
	const model = await llm.resolveModelInfo(provider.id, request.model, signal);
	const efforts = model.reasoning?.efforts.map((effort) => `${effort.id}${model.reasoning?.defaultEffort === effort.id ? " (default)" : ""} — ${effort.name}` + (effort.description === void 0 ? "" : `: ${effort.description}`)).join("\n") || "(no advertised reasoning efforts)";
	return `${modelLine(provider.id, model)}\nReasoning efforts:\n${efforts}`;
}
/**
* Register discovery of the child models the Host setting authorizes.
* @param ctx - Context carrying the tool registry, LLM service, and optional Host model-selection setting.
*/
function registerListSubagentModels(ctx) {
	ctx.tools.register(defineTool({
		name: "list_subagent_models",
		description: "Inspect the routes available for explicit subagent model selection. No arguments: authorized providers. `provider`: that provider's authorized models. `provider` + `model`: that model and its reasoning efforts.",
		parameters: {
			provider: {
				type: "string",
				description: "Provider id from the no-argument listing."
			},
			model: {
				type: "string",
				description: "Exact model id; requires provider."
			}
		},
		output: {
			schema: { type: "string" },
			render: (_args, result) => [{
				type: "text",
				text: result
			}]
		},
		isConcurrencySafe: () => true,
		execute(args, exec) {
			return listSubagentModels(ctx, {
				...hasText(args.provider) ? { provider: args.provider } : {},
				...hasText(args.model) ? { model: args.model } : {}
			}, exec);
		}
	}));
}
//#endregion
//#region lib/types/preset-selection.js
/** Deployment-owned preset choices for one delegation tool. */
/** Validates configured choices and resolves model input against the allowlist. */
var SubagentPresetSelection = class {
	config;
	constructor(config) {
		this.config = config;
		const { agentPreset, allowedAgentPresets } = config;
		if (allowedAgentPresets === void 0) return;
		if (new Set(allowedAgentPresets).size !== allowedAgentPresets.length) throw new Error("tool-subagent: allowedAgentPresets contains duplicate preset ids");
		if (agentPreset !== void 0 && !allowedAgentPresets.includes(agentPreset)) throw new Error("tool-subagent: agentPreset must be included in allowedAgentPresets");
	}
	/** Whether this tool requires the preset service and an independently composing provider. */
	get configured() {
		return this.config.agentPreset !== void 0 || this.config.allowedAgentPresets !== void 0;
	}
	/** Preset ids advertised in the model parameter. */
	get choices() {
		return this.config.allowedAgentPresets;
	}
	/** Model-visible selection and default guidance. */
	get description() {
		return `Agent preset for this child. ${this.config.agentPreset === void 0 ? "Omit to inherit the parent agent's current preset." : `Omit to use ${this.config.agentPreset}.`}`;
	}
	/**
	* Reject independent selection for providers that inherit conversation history or lack support.
	* @param provider - Currently registered delegation provider.
	*/
	assertProvider(provider) {
		if (this.configured && (!provider.capabilities.agentPreset || provider.inheritsParentContext)) throw new Error(`tool-subagent: provider "${provider.name}" does not support independent agent preset selection`);
	}
	/**
	* Validate model input and apply the deployment default.
	* @param request - Model-supplied tool arguments.
	* @returns Selected preset id, or omission to inherit the parent.
	* @throws {SubagentError} `PRESET_SELECTION_DISABLED` when this tool exposes no
	*   preset choice, or `PRESET_NOT_ALLOWED` when the id is outside the allowlist.
	*/
	resolve(request) {
		const id = request.agent_preset;
		if (id === void 0) return this.config.agentPreset;
		if (this.choices === void 0) throw new SubagentError("agent_preset selection is disabled for this tool instance", "PRESET_SELECTION_DISABLED");
		if (typeof id !== "string" || !this.choices.includes(id)) throw new SubagentError(`agent_preset must be one of: ${this.choices.join(", ")}`, "PRESET_NOT_ALLOWED");
		return id;
	}
};
//#endregion
//#region lib/types/index.js
/**
* Model-facing delegation through one configured `ctx.subagents` provider.
* Provider lifecycle controls tool registration and context-sensitive schema
* wording. Every delegation starts a managed activation and returns its child
* id; the subagent runtime owns result delivery and resource cleanup.
* @module @deepseek-ai/dsh-tool-subagent
*/
const name = "tool-subagent";
const inject = [
	"tools",
	"subagents",
	"systemPrompt"
];
const delegationTools = /* @__PURE__ */ new Set();
const Config = z.object({
	provider: z.string().required(),
	toolName: z.string().default("subagent"),
	modelSelection: z.boolean().default(false),
	modelDiscovery: z.boolean().default(false),
	agentOptions: z.object({
		provider: z.string(),
		model: z.string(),
		reasoningEffort: z.string().min(1),
		maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
	}).default(void 0),
	agentPreset: z.string().min(1),
	allowedAgentPresets: z.array(z.string().min(1)).min(1).default(void 0),
	maxDepth: z.union([z.natural().max(Number.MAX_SAFE_INTEGER), z.const("provider-managed")])
});
/**
* Model-facing wording from the provider's conversation-history descriptor
* ({@link SubagentProvider.inheritsParentContext}).
* A fresh child needs a standalone prompt; a forked child already sees the
* conversation's completed turns — telling the model to restate everything
* (or, worse, that the child "does not see this conversation") would be false
* for a fork.
* @param inheritsConversation - whether the child's conversation is seeded
*   with the parent's completed turns; this says nothing about tool, service,
*   scope, or authority inheritance.
* @returns the tool `description` and the `prompt` parameter description.
*/
function providerWording(inheritsConversation) {
	if (inheritsConversation) return {
		description: "Delegate a task to a subagent that inherits this conversation: a child agent seeded with all completed turns so far (it does not see the current in-flight turn). Use this when the subtask builds on this conversation's context — a follow-up analysis, a review, a continuation — without consuming this conversation's context for the work itself. You receive its result, not its intermediate steps.",
		promptDescription: "The task for the subagent. It already sees this conversation's completed turns, so build on them freely and state only what is new."
	};
	return {
		description: "Delegate a self-contained task to a subagent (a separate agent that works in its own context) to offload focused, independent work — research, a scoped implementation, an analysis — so it does not consume this conversation's context. The subagent returns its result, not its intermediate steps.",
		promptDescription: "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs."
	};
}
/**
* Install one delegation-tool composition.
* The owning composition shares its registrations across Agents; child startup resolves the selected preset.
* @param ctx - Context that owns the registrations.
* @param config - delegation-tool configuration.
*/
function apply(ctx, config) {
	for (const field of ["persona", "toolFilter"]) if (Object.hasOwn(config, field)) throw new Error(`tool-subagent: ${field} is no longer supported; configure persona and tool plugins in an Agent Preset and select it with agentPreset (spawn only)`);
	const presets = new SubagentPresetSelection(config);
	if (presets.configured && ctx.get("agentPresets") === void 0) throw new Error("tool-subagent: agent preset selection requires the agent-presets service");
	if (config.maxDepth !== "provider-managed") assertSubagentMaxDepth(config.maxDepth);
	const toolName = config.toolName ?? "subagent";
	const modelSelectionEnabled = config.modelSelection === true;
	const assertSubagentProviderConfiguration = (subagentProvider) => {
		presets.assertProvider(subagentProvider);
		if (ctx.subagents.resolveMaxDepth(config.maxDepth) !== void 0 && !subagentProvider.capabilities.depthLimit) throw new Error(`tool-subagent: provider "${subagentProvider.name}" cannot enforce maxDepth (no depthLimit capability) — set maxDepth: 'provider-managed' to leave the recursion budget to the provider`);
		if (config.agentOptions !== void 0 && !subagentProvider.capabilities.agentOptions) throw new Error(`tool-subagent: provider "${subagentProvider.name}" does not support child agentOptions`);
		if (modelSelectionEnabled && !subagentProvider.capabilities.agentOptions) throw new Error(`tool-subagent: provider "${subagentProvider.name}" does not support child model selection`);
	};
	ctx.on("subagent/provider-added", (subagentProvider) => {
		if (subagentProvider.name === config.provider) assertSubagentProviderConfiguration(subagentProvider);
	});
	const initialProvider = ctx.subagents.getProvider(config.provider);
	if (initialProvider !== void 0) assertSubagentProviderConfiguration(initialProvider);
	if (config.modelDiscovery === true) registerListSubagentModels(ctx);
	let mounted;
	const mount = (subagentProvider) => {
		assertSubagentProviderConfiguration(subagentProvider);
		const wording = providerWording(subagentProvider.inheritsParentContext);
		const providerRouteDefaults = subagentProvider.agentRouteDefaults;
		const defaultRoute = providerRouteDefaults !== void 0 || hasConfiguredLlmSelection(config.agentOptions) ? "the default model configured for this tool" : "your current model and reasoning effort";
		const providerSource = config.modelDiscovery === true ? " Use a provider id listed by `list_subagent_models`." : "";
		const definition = defineTool({
			name: toolName,
			description: wording.description + " This tool starts an independently managed subagent and immediately returns its name. If you are still online when it finishes, the runtime automatically delivers its completion notice. The notice includes the final answer unless the child sent you a message just before finishing." + (subagentProvider.prepareContinuable !== void 0 ? " Use `send_message` to steer it while running or continue its conversation after it finishes." : " This backend does not accept follow-up messages.") + (modelSelectionEnabled && subagentProvider.inheritsParentContext ? " Changing the route can prevent provider-side reuse of the inherited conversation prefix." : ""),
			parameters: {
				description: {
					type: "string",
					required: true,
					description: "A short (3-5 word) description of the delegated task, for display. Use the language of the user's current request."
				},
				name: {
					type: "string",
					description: "Optional short name for the subagent, unique among the subagents you create: lower-case letters, digits, and hyphens, starting with a letter, at most 32 characters; lead is reserved for the root agent. Omitted names default to agent-1, agent-2, and so on."
				},
				prompt: {
					type: "string",
					required: true,
					description: wording.promptDescription
				},
				...presets.choices === void 0 ? {} : { agent_preset: {
					type: "string",
					enum: [...presets.choices],
					description: presets.description
				} },
				...modelSelectionEnabled ? {
					provider: {
						type: "string",
						description: `LLM provider id for the subagent; requires \`model\`. Set only when the task needs a different model; omit \`provider\`, \`model\`, and \`reasoning_effort\` to run the subagent on ${defaultRoute}.${providerSource}`
					},
					model: {
						type: "string",
						description: "Model id within that provider; requires `provider`."
					},
					reasoning_effort: {
						type: "string",
						description: "Reasoning effort id; requires `provider` and `model`. Omit to use that model's default effort."
					}
				} : {}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						kind: {
							type: "string",
							required: true,
							const: "activation"
						},
						name: {
							type: "string",
							required: true
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: `started subagent ${value.name}`
				}],
				presentationMeta: (_args, value) => ({
					kind: value.kind,
					name: value.name
				})
			},
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				const parent = exec.agent;
				if (!parent) throw new ToolContextUnavailableError("subagent tool requires a calling agent (exec.agent was undefined)");
				const agentPreset = presets.resolve(args);
				const modelRequest = delegationModelRequest(args);
				const routes = modelSelectionEnabled && hasDelegationModelRequest(modelRequest) ? ctx.get("subagentModelSelection")?.allowedRoutes() : void 0;
				const modelSelectionPolicy = routes === void 0 ? void 0 : { routes };
				const parentOptions = parentAgentOptionsForDelegation(parent);
				const requiresRoutePreflight = hasDelegationModelRequest(modelRequest) || hasConfiguredLlmSelection(config.agentOptions);
				const requestedChildAgentOptions = requestedAgentOptions(requiresRoutePreflight && providerRouteDefaults !== void 0 ? {
					...providerRouteDefaults,
					...config.agentOptions
				} : config.agentOptions, modelRequest, modelSelectionEnabled, modelSelectionPolicy, parentOptions, ctx.tools.get("list_subagent_models", parent, exec.toolSet) !== void 0);
				if (requiresRoutePreflight) {
					const llm = ctx.get("llm");
					if (llm === void 0) throw new ToolContextUnavailableError("cannot resolve the selected child LLM route because the `llm` service is unavailable");
					const inheritParentReasoningEffort = providerRouteDefaults === void 0 && !hasDelegationModelRequest(modelRequest);
					await preflightChildLlmRoute(llm, parentOptions, requestedChildAgentOptions, exec.signal, inheritParentReasoningEffort);
					if (ctx.subagents.getProvider(config.provider) !== subagentProvider) throw new SubagentError(`subagent provider "${config.provider}" changed while resolving the child LLM route; retry the delegation`, "PROVIDER_CHANGED");
				}
				exec.signal.throwIfAborted();
				const maxDepth = ctx.subagents.resolveMaxDepth(config.maxDepth);
				const request = {
					prompt: [{
						type: "text",
						text: args.prompt
					}],
					parent,
					...agentPreset === void 0 ? {} : { agentPreset },
					...requestedChildAgentOptions !== void 0 ? { agentOptions: requestedChildAgentOptions } : {},
					...maxDepth !== void 0 ? { maxDepth } : {}
				};
				return {
					kind: "activation",
					name: (await ctx.subagents.startActivation({
						provider: config.provider,
						label: args.description,
						...args.name === void 0 ? {} : { name: args.name },
						...request,
						signal: exec.signal,
						delivery: "parent"
					})).name
				};
			}
		});
		mounted = {
			subagentProvider,
			definition,
			disposeTool: ctx.effect(() => {
				const unregister = ctx.tools.register(definition);
				delegationTools.add(definition);
				return () => {
					delegationTools.delete(definition);
					unregister();
				};
			})
		};
	};
	ctx.on("subagent/provider-added", (subagentProvider) => {
		if (subagentProvider.name === config.provider && mounted === void 0) mount(subagentProvider);
	});
	ctx.on("subagent/provider-removed", (name) => {
		if (name !== config.provider || mounted === void 0) return;
		mounted.disposeTool();
		mounted = void 0;
	});
	const present = ctx.subagents.getProvider(config.provider);
	if (present !== void 0) mount(present);
	else ctx.logger.info(`subagent provider "${config.provider}" not registered yet; the "${config.toolName ?? "subagent"}" tool will register when it appears`);
	ctx.systemPrompt.section({
		name: `tool:${toolName}`,
		order: ctx.systemPrompt.getSectionOrder("TOOL_SUBAGENT"),
		retirement: `The ${toolName} tool is no longer available. Its instructions no longer apply.`,
		text: (context) => {
			if (mounted === void 0) return "";
			const visible = [...delegationTools].filter((tool) => ctx.tools.get(tool.name, context.scope) === tool).map((tool) => tool.name).sort();
			if (visible[0] !== toolName) return "";
			return `Start independent delegations with ${visible.map((name) => `\`${name}\``).join(" or ")} together in one assistant message and continue useful work while they run. The concurrency limit of all the subagents is ${ctx.subagents.maxActiveSubagents}. When only waiting for their results remains, end your turn instead of sleeping or polling; the next result starts a new turn. Collect the subagent results required to complete the task before giving the user a final answer.\n\nBash, formatters, code generators, and scripts can overwrite concurrent edits without conflict detection; coordinate their changes explicitly. The agent integrating the work must review the final diff and run relevant tests.`;
		}
	});
	ctx.systemPrompt.context({
		name: `tool:${toolName}:depth`,
		order: ctx.systemPrompt.getContextOrder("SUBAGENT_DELEGATION"),
		text: (context) => {
			if (context.agent === void 0 || mounted === void 0 || ctx.tools.get(toolName, context.scope) !== mounted.definition) return "";
			const maxDepth = ctx.subagents.resolveMaxDepth(config.maxDepth);
			if (maxDepth === void 0) return "";
			const depth = delegationDepthOf(context.agent);
			if (depth < maxDepth) return "";
			return `Delegation depth for \`${toolName}\`: current ${depth}, maximum ${maxDepth}, remaining levels 0. Do not call \`${toolName}\` at this depth; carry out the work directly.`;
		}
	});
}
//#endregion
export { Config, apply, inject, name };
