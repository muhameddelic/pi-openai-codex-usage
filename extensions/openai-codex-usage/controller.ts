import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { UsageClient } from "./client.js";
import type { UsageSnapshot } from "./domain.js";
import { formatUsageDetails, renderStatus, renderWidgetLines } from "./view.js";

const STATUS_ID = "openai-codex-usage";
const WIDGET_ID = "openai-codex-usage-details";
const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

type UsageContext = Pick<ExtensionContext, "modelRegistry" | "ui">;
type PanelMode = "toggle" | "show" | "hide";

export interface UsageController {
	activate(ctx: UsageContext, active: boolean): Promise<void>;
	refresh(ctx: UsageContext, options?: { notify?: boolean }): Promise<UsageSnapshot | undefined>;
	setPanel(ctx: UsageContext, mode: PanelMode): Promise<void>;
	shutdown(ctx: UsageContext): void;
}

interface UsageControllerOptions {
	refreshIntervalMs?: number;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.name === "AbortError") return "request timed out";
	return error instanceof Error ? error.message : String(error);
}

export function createUsageController(
	client: UsageClient,
	options: UsageControllerOptions = {},
): UsageController {
	const refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
	let timer: ReturnType<typeof setInterval> | undefined;
	let activeController: AbortController | undefined;
	let inFlight: Promise<UsageSnapshot | undefined> | undefined;
	let latestUsage: UsageSnapshot | undefined;
	let lastError: string | undefined;
	let panelVisible = false;
	let active = false;
	let stopped = false;

	const stopTimer = () => {
		if (timer) clearInterval(timer);
		timer = undefined;
	};

	const clearUsageUI = (ctx: UsageContext) => {
		ctx.ui.setStatus(STATUS_ID, undefined);
		ctx.ui.setWidget(WIDGET_ID, undefined);
	};

	const updatePanel = (ctx: UsageContext, usage = latestUsage) => {
		if (!active || !panelVisible) {
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
					return renderWidgetLines(usage, theme, width);
				},
			}),
			{ placement: "belowEditor" },
		);
	};

	const startTimer = (ctx: UsageContext) => {
		stopTimer();
		timer = setInterval(() => void controller.refresh(ctx), refreshIntervalMs);
	};

	const load = (ctx: UsageContext): Promise<UsageSnapshot | undefined> => {
		if (inFlight) return inFlight;

		inFlight = (async () => {
			activeController = new AbortController();
			try {
				const usage = await client.load(ctx.modelRegistry, activeController.signal);
				latestUsage = usage;
				lastError = undefined;
				if (!stopped && active) {
					ctx.ui.setStatus(STATUS_ID, renderStatus(usage, ctx.ui.theme));
					updatePanel(ctx, usage);
				}
				return usage;
			} catch (error) {
				latestUsage = undefined;
				lastError = `Could not load Codex usage: ${errorMessage(error)}`;
				if (!stopped && active) {
					ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("warning", "Codex: usage unavailable"));
					updatePanel(ctx);
				}
				return undefined;
			} finally {
				activeController = undefined;
				inFlight = undefined;
			}
		})();

		return inFlight;
	};

	const controller: UsageController = {
		async activate(ctx, nextActive) {
			stopped = false;
			active = nextActive;
			if (!active) {
				stopTimer();
				clearUsageUI(ctx);
				return;
			}

			updatePanel(ctx);
			startTimer(ctx);
			await controller.refresh(ctx);
		},

		async refresh(ctx, refreshOptions = {}) {
			const usage = await load(ctx);
			if (stopped || !refreshOptions.notify) return usage;
			if (usage) {
				ctx.ui.notify(formatUsageDetails(usage), "info");
			} else {
				ctx.ui.notify(lastError ?? "Codex usage is unavailable.", "warning");
			}
			return usage;
		},

		async setPanel(ctx, mode) {
			panelVisible = mode === "toggle" ? !panelVisible : mode === "show";
			updatePanel(ctx);
			if (panelVisible) await controller.refresh(ctx);
			const message = panelVisible && !active
				? "Detailed Codex usage enabled; it will appear when an OpenAI Codex model is selected."
				: `Detailed Codex usage ${panelVisible ? "shown" : "hidden"}.`;
			ctx.ui.notify(message, "info");
		},

		shutdown(ctx) {
			stopped = true;
			active = false;
			stopTimer();
			activeController?.abort();
			activeController = undefined;
			clearUsageUI(ctx);
		},
	};

	return controller;
}
