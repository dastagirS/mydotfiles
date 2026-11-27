import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	envApiKeyAuth,
	formatUserAgent,
	type Model,
	type ModelsStoreEntry,
	type Provider,
	type RefreshModelsContext,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { builtinProviders, getBuiltinModelDataGeneratedAt } from "@earendil-works/pi-ai/providers/all";

// One provider per OpenCode Go account, each with its own key, sharing pi's built-in opencode-go
// catalog and request code.
const ACCOUNTS = [
	{ id: "opencode-go-nilpointerr", name: "OpenCode Go (nilpointerr)", envVar: "OPENCODE_GO_NILPOINTERR_KEY" },
	{ id: "opencode-go-dastagir", name: "OpenCode Go (dastagir)", envVar: "OPENCODE_GO_DASTAGIR_KEY" },
] as const;

const BASE_PROVIDER_ID = "opencode-go";
const BASE_APIS: readonly string[] = [
	"anthropic-messages",
	"google-generative-ai",
	"openai-completions",
	"openai-responses",
];
// Same source, interval, and timeout pi uses for its own catalog overlay (remote-catalog-provider.js).
// pi refreshes the built-in opencode-go overlay only while that provider has a key, so the aliases
// fetch their own copy.
const CATALOG_URL = `https://pi.dev/api/models/providers/${BASE_PROVIDER_ID}?types=chat`;
const CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const CATALOG_TIMEOUT_MS = 4_000;
const CATALOG_MODEL_COUNT_MAX = 500;

type Account = (typeof ACCOUNTS)[number];
type CatalogEntry = { id?: unknown; type?: unknown; api?: unknown };

function isNewerThanBuiltin(lastModified: number | undefined): boolean {
	const generatedAt = getBuiltinModelDataGeneratedAt();
	return generatedAt === undefined || (lastModified !== undefined && lastModified > generatedAt);
}

function parseCatalog(value: unknown, providerId: string): Model<Api>[] {
	const entries: unknown[] | undefined = Array.isArray(value)
		? value
		: typeof value === "object" && value !== null && "models" in value && Array.isArray(value.models)
			? value.models
			: typeof value === "object" && value !== null
				? Object.values(value)
				: undefined;
	if (!entries) throw new Error(`Invalid ${BASE_PROVIDER_ID} model catalog`);
	return entries
		.filter((entry): entry is CatalogEntry => typeof entry === "object" && entry !== null)
		.filter((entry) => typeof entry.id === "string")
		.filter((entry) => entry.type === undefined || entry.type === "chat")
		// A model whose API the base provider cannot dispatch would only fail at request time.
		.filter((entry) => typeof entry.api === "string" && BASE_APIS.includes(entry.api))
		.slice(0, CATALOG_MODEL_COUNT_MAX)
		.map((entry) => ({ ...(entry as Model<Api>), provider: providerId }));
}

function mergeById(baseline: readonly Model<Api>[], overlay: readonly Model<Api>[]): Model<Api>[] {
	const merged = new Map<string, Model<Api>>();
	for (const model of [...baseline, ...overlay]) merged.set(model.id, model);
	return [...merged.values()];
}

function relabelEvent(event: AssistantMessageEvent, providerId: string): void {
	if (event.type === "done") event.message.provider = providerId;
	else if (event.type === "error") event.error.provider = providerId;
	else event.partial.provider = providerId;
}

// Requests go out labelled "opencode-go" because pi-ai special-cases that exact provider id
// (reasoning_content field naming in openai-completions.js). Replies are relabelled so sessions,
// costs, and thinking replay stay attributed to the account that produced them.
function relabelStream(
	source: AssistantMessageEventStream,
	model: Model<Api>,
	providerId: string,
): AssistantMessageEventStream {
	const target = createAssistantMessageEventStream();
	void (async () => {
		try {
			for await (const event of source) {
				relabelEvent(event, providerId);
				target.push(event);
			}
			target.end();
		} catch (error) {
			// Without a terminal event the agent loop would wait on result() forever.
			const failure: AssistantMessage = {
				role: "assistant",
				content: [],
				api: model.api,
				provider: providerId,
				model: model.id,
				// Fresh object per error: pi may accrue cost into the usage it receives.
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "error",
				errorMessage: error instanceof Error ? error.message : String(error),
				timestamp: Date.now(),
			};
			target.push({ type: "error", reason: "error", error: failure });
		}
	})();
	return target;
}

// Assistant turns from this account must match the base provider id, or pi-ai treats them as
// another model's output and drops their thinking on replay.
function toBaseTranscript(context: TranscriptContext, providerId: string): TranscriptContext {
	return {
		...context,
		messages: context.messages.map((message) =>
			message.role === "assistant" && message.provider === providerId
				? { ...message, provider: BASE_PROVIDER_ID }
				: message,
		),
	};
}

async function fetchCatalog(context: RefreshModelsContext, stored: ModelsStoreEntry | undefined, providerId: string) {
	// Revalidate only when a cached body backs the validator, so a 304 never empties the overlay.
	const validator = stored && stored.models.length > 0 ? stored.etag : undefined;
	const response = await fetch(CATALOG_URL, {
		headers: {
			accept: "application/json",
			"User-Agent": formatUserAgent({ userAgent: "detailed", version: VERSION }),
			...(validator ? { "if-none-match": validator } : {}),
		},
		signal: AbortSignal.any([context.signal, AbortSignal.timeout(CATALOG_TIMEOUT_MS)]),
	});
	const checkedAt = Date.now();
	if (response.status === 304 && stored) return { entry: { ...stored, checkedAt }, changed: false };
	if (!response.ok) {
		// Keep the cached body and validator; checkedAt still moves so a failing endpoint is not hammered.
		await context.publish({ persist: { ...(stored ?? { models: [] }), checkedAt } });
		throw new Error(`${BASE_PROVIDER_ID} catalog request failed: HTTP ${response.status}`);
	}
	const lastModified = Date.parse(response.headers.get("last-modified") ?? "");
	return {
		entry: {
			models: parseCatalog(await response.json(), providerId),
			lastModified: Number.isNaN(lastModified) ? 0 : lastModified,
			etag: response.headers.get("etag") ?? undefined,
			checkedAt,
		},
		changed: true,
	};
}

function createAccountProvider(account: Account, base: Provider): Provider {
	const baseline = base.getModels().map((model) => ({ ...model, provider: account.id }));
	let models: Model<Api>[] = baseline;
	const setOverlay = (overlay: readonly Model<Api>[]) => {
		models = mergeById(baseline, overlay);
	};
	return {
		id: account.id,
		name: account.name,
		baseUrl: base.baseUrl,
		headers: base.headers,
		auth: { apiKey: envApiKeyAuth(account.name, [account.envVar]) },
		getModels: () => models,
		refreshModelsAuth: "configured",
		refreshModels: async (context) => {
			const stored = context.stored;
			const restored = stored && isNewerThanBuiltin(stored.lastModified)
				? stored.models.filter((model): model is Model<Api> => model.provider === account.id)
				: [];
			if (!(await context.publish({ update: () => setOverlay(restored) }))) return;
			if (!context.allowNetwork || context.signal.aborted) return;
			const fresh = stored?.checkedAt !== undefined
				&& stored.lastModified !== undefined
				&& Date.now() - stored.checkedAt < CATALOG_REFRESH_INTERVAL_MS;
			if (fresh && !context.force) return;
			const { entry, changed } = await fetchCatalog(context, stored, account.id);
			if (context.signal.aborted) return;
			const overlay = isNewerThanBuiltin(entry.lastModified) ? entry.models : [];
			await context.publish(changed ? { persist: entry, update: () => setOverlay(overlay) } : { persist: entry });
		},
		stream: (model, context, options) =>
			relabelStream(
				base.stream({ ...model, provider: BASE_PROVIDER_ID }, toBaseTranscript(context, account.id), options),
				model,
				account.id,
			),
		streamSimple: (model, context, options) =>
			relabelStream(
				base.streamSimple({ ...model, provider: BASE_PROVIDER_ID }, toBaseTranscript(context, account.id), options),
				model,
				account.id,
			),
	};
}

export default function opencodeGoAccounts(pi: ExtensionAPI): void {
	const base = builtinProviders().find((provider) => provider.id === BASE_PROVIDER_ID);
	if (!base) throw new Error(`pi no longer ships a built-in "${BASE_PROVIDER_ID}" provider`);
	for (const account of ACCOUNTS) pi.registerProvider(createAccountProvider(account, base));
}
