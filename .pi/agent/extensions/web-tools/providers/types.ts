export type NormalizedSearchResult = import("../types.ts").NormalizedSearchResult;

export interface SearchProviderRequest {
	readonly query: import("../types.ts").SearchQuery;
	readonly maxResults: number;
	readonly depth: import("../types.ts").SearchDepth;
}

export type SearchProviderError =
	| { readonly _tag: "SearchProviderUnavailable"; readonly provider: import("../types.ts").SearchProviderName; readonly cause: unknown }
	| { readonly _tag: "SearchProviderStatusRejected"; readonly provider: import("../types.ts").SearchProviderName; readonly status: number }
	| { readonly _tag: "SearchProviderResponseTooLarge"; readonly provider: import("../types.ts").SearchProviderName; readonly maxBytes: number }
	| { readonly _tag: "SearchProviderProtocolInvalid"; readonly provider: import("../types.ts").SearchProviderName; readonly reason: string }
	| { readonly _tag: "SearchProviderReturnedError"; readonly provider: import("../types.ts").SearchProviderName; readonly safeMessage: string }
	| { readonly _tag: "SearchProviderNoRecognizedResults"; readonly provider: import("../types.ts").SearchProviderName }
	| { readonly _tag: "SearchProviderCancelled"; readonly provider: import("../types.ts").SearchProviderName; readonly cause?: unknown };

export interface SearchProvider {
	readonly name: import("../types.ts").SearchProviderName;

	search(
		input: SearchProviderRequest,
		options?: { readonly signal?: AbortSignal },
	): Promise<import("../result.ts").Result<readonly NormalizedSearchResult[], SearchProviderError>>;
}

export type SearchRequest = SearchProviderRequest;
