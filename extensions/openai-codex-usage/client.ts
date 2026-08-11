import { normalizePercent, type UsageLimit, type UsageSnapshot, type UsageWindow } from "./domain.js";

const PROVIDER_ID = "openai-codex";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const JWT_AUTH_CLAIM = "https://api.openai.com/auth";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ProviderAuthRegistry {
	getProviderAuth(provider: string): Promise<{ auth: { apiKey?: string } } | undefined>;
}

export interface UsageClient {
	load(registry: ProviderAuthRegistry, signal?: AbortSignal): Promise<UsageSnapshot>;
}

interface UsageClientOptions {
	fetch?: typeof fetch;
	timeoutMs?: number;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
	return value !== null && typeof value === "object" ? (value as UnknownRecord) : undefined;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function decodeAccountId(accessToken: string): string | undefined {
	try {
		const payload = accessToken.split(".")[1];
		if (!payload) return undefined;

		const decoded = record(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
		const auth = record(decoded?.[JWT_AUTH_CLAIM]);
		const accountId = auth?.chatgpt_account_id;
		return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
	} catch {
		return undefined;
	}
}

function parseWindow(value: unknown): UsageWindow | undefined {
	const source = record(value);
	if (!source) return undefined;

	return {
		usedPercent: normalizePercent(source.used_percent),
		durationSeconds: finiteNumber(source.limit_window_seconds),
		resetAfterSeconds: finiteNumber(source.reset_after_seconds),
		resetAt: finiteNumber(source.reset_at),
	};
}

function parseLimit(value: unknown): UsageLimit | undefined {
	const source = record(value);
	if (!source) return undefined;

	const windows = [parseWindow(source.primary_window), parseWindow(source.secondary_window)].filter(
		(window): window is UsageWindow => window !== undefined,
	);
	return {
		allowed: typeof source.allowed === "boolean" ? source.allowed : undefined,
		limitReached: source.limit_reached === true,
		windows,
	};
}

function parseResponse(value: unknown): UsageSnapshot {
	const source = record(value);
	if (!source) throw new Error("usage response was invalid");
	const credits = record(source.credits);
	const spendControl = record(source.spend_control);

	return {
		plan: typeof source.plan_type === "string" ? source.plan_type : undefined,
		usage: parseLimit(source.rate_limit),
		codeReview: parseLimit(source.code_review_rate_limit),
		credits: credits
			? {
				hasCredits: credits.has_credits === true,
				unlimited: credits.unlimited === true,
				overageLimitReached: credits.overage_limit_reached === true,
				balance:
					typeof credits.balance === "string" || typeof credits.balance === "number"
						? credits.balance
						: undefined,
			}
			: undefined,
		spendLimitReached: spendControl?.reached === true,
	};
}

export function createUsageClient(options: UsageClientOptions = {}): UsageClient {
	const fetchUsage = options.fetch ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	return {
		async load(registry, signal) {
			const auth = await registry.getProviderAuth(PROVIDER_ID);
			const accessToken = auth?.auth.apiKey;
			if (!accessToken) throw new Error("Sign in with /login openai-codex first.");

			const accountId = decodeAccountId(accessToken);
			if (!accountId) throw new Error("could not determine the ChatGPT account ID");

			const controller = new AbortController();
			const onAbort = () => controller.abort(signal?.reason);
			signal?.addEventListener("abort", onAbort, { once: true });
			if (signal?.aborted) onAbort();
			const timeout = setTimeout(() => controller.abort(new Error("usage request timed out")), timeoutMs);

			try {
				const response = await fetchUsage(USAGE_URL, {
					headers: {
						Accept: "application/json",
						Authorization: `Bearer ${accessToken}`,
						"ChatGPT-Account-Id": accountId,
					},
					signal: controller.signal,
				});
				if (!response.ok) {
					throw new Error(`usage request failed (${response.status} ${response.statusText})`);
				}
				return parseResponse(await response.json());
			} finally {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", onAbort);
			}
		},
	};
}
