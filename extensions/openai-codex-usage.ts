import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const PROVIDER_ID = "openai-codex";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const JWT_AUTH_CLAIM = "https://api.openai.com/auth";
const STATUS_ID = "openai-codex-usage";
const WIDGET_ID = "openai-codex-usage-details";

type UsageWindow = {
	used_percent?: number;
	limit_window_seconds?: number;
	reset_after_seconds?: number;
	reset_at?: number;
};

type RateLimit = {
	allowed?: boolean;
	limit_reached?: boolean;
	primary_window?: UsageWindow | null;
	secondary_window?: UsageWindow | null;
};

type UsageResponse = {
	plan_type?: string;
	rate_limit?: RateLimit | null;
	code_review_rate_limit?: RateLimit | null;
	credits?: {
		has_credits?: boolean;
		unlimited?: boolean;
		overage_limit_reached?: boolean;
		balance?: string | number;
	} | null;
	spend_control?: {
		reached?: boolean;
		individual_limit?: string | number | null;
	} | null;
};

function decodeAccountId(accessToken: string): string | undefined {
	try {
		const payload = accessToken.split(".")[1];
		if (!payload) return undefined;

		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
		const decoded = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as Record<string, unknown>;
		const auth = decoded[JWT_AUTH_CLAIM];
		if (!auth || typeof auth !== "object") return undefined;

		const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
		return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
	} catch {
		return undefined;
	}
}

function windowLabel(window: UsageWindow): string {
	const seconds = window.limit_window_seconds;
	if (!seconds || seconds <= 0) return "usage";
	if (seconds < 24 * 60 * 60) return `${Math.round(seconds / 3600)}h`;
	if (seconds < 14 * 24 * 60 * 60) return `${Math.round(seconds / 86400)}d`;
	return `${Math.round(seconds / (30 * 86400))}mo`;
}

function usedPercent(window: UsageWindow): number | undefined {
	const value = window.used_percent;
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return Math.max(0, Math.min(100, Math.round(value)));
}

function resetSeconds(window: UsageWindow): number | undefined {
	if (typeof window.reset_at === "number" && Number.isFinite(window.reset_at)) {
		return Math.max(0, Math.round(window.reset_at - Date.now() / 1000));
	}
	if (typeof window.reset_after_seconds === "number" && Number.isFinite(window.reset_after_seconds)) {
		return Math.max(0, Math.round(window.reset_after_seconds));
	}
	return undefined;
}

function formatDuration(totalSeconds: number): string {
	const minutes = Math.max(0, Math.ceil(totalSeconds / 60));
	if (minutes < 60) return `${minutes}m`;

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	if (hours < 24) return remainingMinutes > 0 ? `${hours}h${remainingMinutes}m` : `${hours}h`;

	const days = Math.floor(hours / 24);
	const remainingHours = hours % 24;
	return remainingHours > 0 ? `${days}d${remainingHours}h` : `${days}d`;
}

function windows(rateLimit: RateLimit | null | undefined): UsageWindow[] {
	if (!rateLimit) return [];
	return [rateLimit.primary_window, rateLimit.secondary_window].filter(
		(window): window is UsageWindow => window !== null && window !== undefined,
	);
}

function statusText(usage: UsageResponse, ctx: ExtensionContext): string {
	const rateWindows = windows(usage.rate_limit);
	if (rateWindows.length === 0) return ctx.ui.theme.fg("dim", "Codex: usage unavailable");

	const values = rateWindows
		.map((window) => {
			const percent = usedPercent(window);
			if (percent === undefined) return undefined;

			const filled = Math.round((percent / 100) * 6);
			const color = usage.rate_limit?.limit_reached || percent >= 100 ? "error" : percent >= 80 ? "warning" : "success";
			const bar = ctx.ui.theme.fg(color, "█".repeat(filled)) + ctx.ui.theme.fg("dim", "░".repeat(6 - filled));
			return `${windowLabel(window)} ${bar} ${percent}%`;
		})
		.filter((value): value is string => value !== undefined);

	if (values.length === 0) return ctx.ui.theme.fg("dim", "Codex: usage unavailable");
	return ctx.ui.theme.fg("dim", "Codex ") + values.join(ctx.ui.theme.fg("dim", " · "));
}

function windowDetail(name: string, window: UsageWindow): string {
	const percent = usedPercent(window);
	const reset = resetSeconds(window);
	const resetAt = typeof window.reset_at === "number" ? new Date(window.reset_at * 1000) : undefined;
	const parts = [`${name} (${windowLabel(window)}): ${percent === undefined ? "unknown" : `${percent}% used`}`];

	if (reset !== undefined) parts.push(`resets in ${formatDuration(reset)}`);
	if (resetAt && !Number.isNaN(resetAt.getTime())) parts.push(resetAt.toLocaleString());
	return parts.join(" · ");
}

function usageDetails(usage: UsageResponse): string {
	const lines = [`OpenAI Codex${usage.plan_type ? ` (${usage.plan_type})` : ""}`];
	const rateWindows = windows(usage.rate_limit);

	for (const [index, window] of rateWindows.entries()) {
		lines.push(windowDetail(index === 0 ? "Primary" : "Secondary", window));
	}

	const reviewWindows = windows(usage.code_review_rate_limit);
	for (const [index, window] of reviewWindows.entries()) {
		lines.push(windowDetail(index === 0 ? "Code review" : "Code review secondary", window));
	}

	if (usage.rate_limit?.limit_reached) lines.push("Usage limit reached");
	if (usage.credits?.unlimited) {
		lines.push("Credits: unlimited");
	} else if (usage.credits?.has_credits || usage.credits?.balance !== undefined) {
		lines.push(`Credits: ${usage.credits.balance ?? "available"}`);
	}
	if (usage.credits?.overage_limit_reached) lines.push("Overage limit reached");
	if (usage.spend_control?.reached) lines.push("Spend limit reached");
	if (rateWindows.length === 0 && reviewWindows.length === 0) lines.push("No usage windows returned");

	return lines.join("\n");
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.name === "AbortError") return "request timed out";
	return error instanceof Error ? error.message : String(error);
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let activeController: AbortController | undefined;
	let refreshPromise: Promise<UsageResponse | undefined> | undefined;
	let latestUsage: UsageResponse | undefined;
	let detailedVisible = false;
	let codexActive = false;
	let stopped = false;

	let lastError: string | undefined;

	const updateDetailedWidget = (ctx: ExtensionContext, usage?: UsageResponse) => {
		if (!codexActive || !detailedVisible) {
			ctx.ui.setWidget(WIDGET_ID, undefined);
			return;
		}

		if (!usage) {
			ctx.ui.setWidget(WIDGET_ID, [ctx.ui.theme.fg("warning", lastError ?? "Loading Codex usage…")], {
				placement: "belowEditor",
			});
			return;
		}

		ctx.ui.setWidget(
			WIDGET_ID,
			(_tui, theme) => ({
				invalidate() {},
				render(width: number): string[] {
					const rateWindows = windows(usage.rate_limit);
					const reviewWindows = windows(usage.code_review_rate_limit);
					const barWidth = Math.max(8, Math.min(24, width - 44));
					const lines: string[] = [];
					const state = usage.rate_limit?.limit_reached
						? theme.fg("error", "limit reached")
						: usage.rate_limit?.allowed === false
							? theme.fg("warning", "not allowed")
							: theme.fg("success", "available");
					const plan = usage.plan_type ? ` · ${usage.plan_type}` : "";
					lines.push(theme.fg("accent", theme.bold("OpenAI Codex")) + theme.fg("dim", plan + " · ") + state);

					const addWindow = (label: string, window: UsageWindow, limitReached = false) => {
						const percent = usedPercent(window) ?? 0;
						const filled = Math.round((percent / 100) * barWidth);
						const color = limitReached || percent >= 100 ? "error" : percent >= 80 ? "warning" : "success";
						const bar = theme.fg(color, "█".repeat(filled)) + theme.fg("dim", "░".repeat(barWidth - filled));
						const reset = resetSeconds(window);
						const resetText = reset === undefined ? "" : theme.fg("dim", ` · resets in ${formatDuration(reset)}`);
						lines.push(`${theme.fg("muted", label.padEnd(12))} ${bar} ${String(percent).padStart(3)}%${resetText}`);
					};

					for (const [index, window] of rateWindows.entries()) {
						addWindow(index === 0 ? `Primary ${windowLabel(window)}` : `Secondary ${windowLabel(window)}`, window, usage.rate_limit?.limit_reached);
					}
					for (const [index, window] of reviewWindows.entries()) {
						addWindow(index === 0 ? "Code review" : "Review 2", window, usage.code_review_rate_limit?.limit_reached);
					}

					const extras: string[] = [];
					if (usage.credits?.unlimited) extras.push("credits unlimited");
					else if (usage.credits?.balance !== undefined) extras.push(`credits ${usage.credits.balance}`);
					if (usage.credits?.overage_limit_reached) extras.push("overage limit reached");
					if (usage.spend_control?.reached) extras.push("spend limit reached");
					if (extras.length > 0) lines.push(theme.fg("dim", extras.join(" · ")));
					if (rateWindows.length === 0 && reviewWindows.length === 0) lines.push(theme.fg("warning", "No usage windows returned"));

					return lines.map((line) => truncateToWidth(line, width));
				},
			}),
			{ placement: "belowEditor" },
		);
	};

	const refresh = (ctx: ExtensionContext): Promise<UsageResponse | undefined> => {
		if (refreshPromise) return refreshPromise;

		refreshPromise = (async () => {
			try {
				const auth = await ctx.modelRegistry.getProviderAuth(PROVIDER_ID);
				const accessToken = auth?.auth.apiKey;
				if (!accessToken) {
					latestUsage = undefined;
					lastError = "Sign in with /login openai-codex first.";
					if (!stopped && codexActive) {
						ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("warning", "Codex: /login required"));
						updateDetailedWidget(ctx);
					}
					return undefined;
				}

				const accountId = decodeAccountId(accessToken);
				if (!accountId) throw new Error("could not determine the ChatGPT account ID");

				activeController = new AbortController();
				const timeout = setTimeout(() => activeController?.abort(), REQUEST_TIMEOUT_MS);
				let response: Response;
				try {
					response = await fetch(USAGE_URL, {
						headers: {
							Accept: "application/json",
							Authorization: `Bearer ${accessToken}`,
							"ChatGPT-Account-Id": accountId,
						},
						signal: activeController.signal,
					});
				} finally {
					clearTimeout(timeout);
					activeController = undefined;
				}

				if (!response.ok) {
					throw new Error(`usage request failed (${response.status} ${response.statusText})`);
				}

				const usage = (await response.json()) as UsageResponse;
				if (!usage || typeof usage !== "object") throw new Error("usage response was invalid");

				latestUsage = usage;
				lastError = undefined;
				if (!stopped && codexActive) {
					ctx.ui.setStatus(STATUS_ID, statusText(usage, ctx));
					updateDetailedWidget(ctx, usage);
				}
				return usage;
			} catch (error) {
				latestUsage = undefined;
				lastError = `Could not load Codex usage: ${errorMessage(error)}`;
				if (!stopped && codexActive) {
					ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("warning", "Codex: usage unavailable"));
					updateDetailedWidget(ctx);
				}
				return undefined;
			} finally {
				refreshPromise = undefined;
			}
		})();

		return refreshPromise;
	};

	const stopTimer = () => {
		if (timer) clearInterval(timer);
		timer = undefined;
	};

	const startTimer = (ctx: ExtensionContext) => {
		stopTimer();
		timer = setInterval(() => void refresh(ctx), REFRESH_INTERVAL_MS);
	};

	const clearUsageUI = (ctx: ExtensionContext) => {
		ctx.ui.setStatus(STATUS_ID, undefined);
		ctx.ui.setWidget(WIDGET_ID, undefined);
	};

	pi.registerCommand("codex-usage", {
		description: "Show usage or toggle the detailed Codex usage panel",
		getArgumentCompletions: (prefix) => {
			const actions = ["toggle", "show", "hide", "refresh"];
			const matches = actions.filter((action) => action.startsWith(prefix)).map((action) => ({ value: action, label: action }));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "toggle" || action === "show" || action === "hide") {
				detailedVisible = action === "toggle" ? !detailedVisible : action === "show";
				updateDetailedWidget(ctx, latestUsage);
				if (detailedVisible) await refresh(ctx);
				const message = detailedVisible && !codexActive
					? "Detailed Codex usage enabled; it will appear when an OpenAI Codex model is selected."
					: `Detailed Codex usage ${detailedVisible ? "shown" : "hidden"}.`;
				ctx.ui.notify(message, "info");
				return;
			}
			if (action && action !== "refresh") {
				ctx.ui.notify("Usage: /codex-usage [toggle|show|hide|refresh]", "warning");
				return;
			}

			const usage = await refresh(ctx);
			if (stopped) return;
			if (usage) {
				ctx.ui.notify(usageDetails(usage), "info");
			} else {
				ctx.ui.notify(lastError ?? "Codex usage is unavailable.", "warning");
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		stopped = false;
		codexActive = ctx.model?.provider === PROVIDER_ID;
		if (codexActive) {
			updateDetailedWidget(ctx, latestUsage);
			void refresh(ctx);
			startTimer(ctx);
		} else {
			stopTimer();
			clearUsageUI(ctx);
		}
	});

	pi.on("model_select", (event, ctx) => {
		codexActive = event.model.provider === PROVIDER_ID;
		if (codexActive) {
			updateDetailedWidget(ctx, latestUsage);
			void refresh(ctx);
			startTimer(ctx);
		} else {
			stopTimer();
			clearUsageUI(ctx);
		}
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.model?.provider === PROVIDER_ID) void refresh(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stopped = true;
		stopTimer();
		activeController?.abort();
		activeController = undefined;
		clearUsageUI(ctx);
	});
}
