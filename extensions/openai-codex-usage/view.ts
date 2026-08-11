import { truncateToWidth } from "@earendil-works/pi-tui";
import {
	formatDuration,
	resetSeconds,
	type UsageLimit,
	type UsageSnapshot,
	type UsageWindow,
	windowLabel,
} from "./domain.js";

type ThemeColor = "accent" | "dim" | "error" | "muted" | "success" | "warning";

export interface UsageTheme {
	fg(color: ThemeColor, text: string): string;
	bold(text: string): string;
}

export interface TimeFormatOptions {
	nowMs?: number;
	locale?: string;
	timeZone?: string;
}

function interpolate(start: number, end: number, amount: number): number {
	return Math.round(start + (end - start) * amount);
}

export function quotaRgb(percent: number): [number, number, number] {
	const clamped = Math.max(0, Math.min(100, percent));
	const green: [number, number, number] = [34, 197, 94];
	const yellow: [number, number, number] = [234, 179, 8];
	const red: [number, number, number] = [239, 68, 68];

	if (clamped >= 90) return red;

	let start: [number, number, number];
	let end: [number, number, number];
	let amount: number;
	if (clamped <= 50) {
		start = green;
		end = yellow;
		amount = clamped / 50;
	} else {
		start = yellow;
		end = red;
		amount = (clamped - 50) / 40;
	}

	return [
		interpolate(start[0], end[0], amount),
		interpolate(start[1], end[1], amount),
		interpolate(start[2], end[2], amount),
	];
}

function quotaColor(text: string, percent: number): string {
	const [red, green, blue] = quotaRgb(percent);
	return `\u001b[38;2;${red};${green};${blue}m${text}\u001b[39m`;
}

function quotaBar(percent: number, width: number, empty: (text: string) => string): string {
	const filled = Math.round((percent / 100) * width);
	return quotaColor("█".repeat(filled), percent) + empty("░".repeat(width - filled));
}

function now(options: TimeFormatOptions): number {
	return options.nowMs ?? Date.now();
}

function resetEpochSeconds(window: UsageWindow, options: TimeFormatOptions): number | undefined {
	if (typeof window.resetAt === "number" && Number.isFinite(window.resetAt)) return window.resetAt;
	if (typeof window.resetAfterSeconds === "number" && Number.isFinite(window.resetAfterSeconds)) {
		return now(options) / 1000 + window.resetAfterSeconds;
	}
	return undefined;
}

function formatResetTime(window: UsageWindow, options: TimeFormatOptions): string | undefined {
	const resetAt = resetEpochSeconds(window, options);
	if (resetAt === undefined) return undefined;
	const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	return new Intl.DateTimeFormat(options.locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
		timeZoneName: "short",
		timeZone,
	}).format(new Date(resetAt * 1000));
}

function windowDetail(name: string, window: UsageWindow, options: TimeFormatOptions): string {
	const reset = resetSeconds(window, now(options));
	const resetAt = formatResetTime(window, options);
	const percent = window.usedPercent;
	const parts = [`${name} (${windowLabel(window)}): ${percent === undefined ? "unknown" : `${percent}% used`}`];

	if (resetAt) parts.push(`resets ${resetAt}`);
	if (reset !== undefined) parts.push(`in ${formatDuration(reset)}`);
	return parts.join(" · ");
}

function limitWindows(limit: UsageLimit | undefined): UsageWindow[] {
	return limit?.windows ?? [];
}

export function renderStatus(
	snapshot: UsageSnapshot,
	theme: UsageTheme,
	options: TimeFormatOptions = {},
): string {
	const windows = limitWindows(snapshot.usage);
	if (windows.length === 0) return theme.fg("dim", "Codex: usage unavailable");

	const values = windows
		.map((window) => {
			const percent = window.usedPercent;
			if (percent === undefined) return undefined;

			const bar = quotaBar(percent, 6, (text) => theme.fg("dim", text));
			const reset = percent >= 90 ? resetSeconds(window, now(options)) : undefined;
			const resetText = reset === undefined ? "" : theme.fg("warning", ` ↻${formatDuration(reset)}`);
			return `${windowLabel(window)} ${bar} ${quotaColor(`${percent}%`, percent)}${resetText}`;
		})
		.filter((value): value is string => value !== undefined);

	if (values.length === 0) return theme.fg("dim", "Codex: usage unavailable");
	return theme.fg("dim", "Codex ") + values.join(theme.fg("dim", " · "));
}

export function formatUsageDetails(
	snapshot: UsageSnapshot,
	options: TimeFormatOptions = {},
): string {
	const lines = [`OpenAI Codex${snapshot.plan ? ` (${snapshot.plan})` : ""}`];
	const usageWindows = limitWindows(snapshot.usage);
	for (const [index, window] of usageWindows.entries()) {
		lines.push(windowDetail(index === 0 ? "Primary" : "Secondary", window, options));
	}

	const reviewWindows = limitWindows(snapshot.codeReview);
	for (const [index, window] of reviewWindows.entries()) {
		lines.push(windowDetail(index === 0 ? "Code review" : "Code review secondary", window, options));
	}

	if (snapshot.usage?.limitReached) lines.push("Usage limit reached");
	if (snapshot.credits?.unlimited) {
		lines.push("Credits: unlimited");
	} else if (snapshot.credits?.hasCredits || snapshot.credits?.balance !== undefined) {
		lines.push(`Credits: ${snapshot.credits.balance ?? "available"}`);
	}
	if (snapshot.credits?.overageLimitReached) lines.push("Overage limit reached");
	if (snapshot.spendLimitReached) lines.push("Spend limit reached");
	if (usageWindows.length === 0 && reviewWindows.length === 0) lines.push("No usage windows returned");
	return lines.join("\n");
}

export function renderWidgetLines(
	snapshot: UsageSnapshot,
	theme: UsageTheme,
	width: number,
	options: TimeFormatOptions = {},
): string[] {
	const usageWindows = limitWindows(snapshot.usage);
	const reviewWindows = limitWindows(snapshot.codeReview);
	const barWidth = Math.max(8, Math.min(24, width - 44));
	const lines: string[] = [];
	const state = snapshot.usage?.limitReached
		? theme.fg("error", "limit reached")
		: snapshot.usage?.allowed === false
			? theme.fg("warning", "not allowed")
			: theme.fg("success", "available");
	const plan = snapshot.plan ? ` · ${snapshot.plan}` : "";
	lines.push(theme.fg("accent", theme.bold("OpenAI Codex")) + theme.fg("dim", `${plan} · `) + state);

	const addWindow = (label: string, window: UsageWindow, limitReached = false) => {
		const percent = window.usedPercent ?? 0;
		const filled = Math.round((percent / 100) * barWidth);
		const bar = limitReached
			? theme.fg("error", "█".repeat(filled)) + theme.fg("dim", "░".repeat(barWidth - filled))
			: quotaBar(percent, barWidth, (text) => theme.fg("dim", text));
		const reset = resetSeconds(window, now(options));
		const resetAt = percent >= 90 ? formatResetTime(window, options) : undefined;
		const resetText = resetAt
			? theme.fg("warning", ` · resets ${resetAt}`)
			: reset === undefined
				? ""
				: theme.fg("dim", ` · resets in ${formatDuration(reset)}`);
		lines.push(
			`${theme.fg("muted", label.padEnd(12))} ${bar} ${quotaColor(`${String(percent).padStart(3)}%`, percent)}${resetText}`,
		);
	};

	for (const [index, window] of usageWindows.entries()) {
		addWindow(
			index === 0 ? `Primary ${windowLabel(window)}` : `Secondary ${windowLabel(window)}`,
			window,
			snapshot.usage?.limitReached,
		);
	}
	for (const [index, window] of reviewWindows.entries()) {
		addWindow(index === 0 ? "Code review" : "Review 2", window, snapshot.codeReview?.limitReached);
	}

	const extras: string[] = [];
	if (snapshot.credits?.unlimited) extras.push("credits unlimited");
	else if (snapshot.credits?.balance !== undefined) extras.push(`credits ${snapshot.credits.balance}`);
	if (snapshot.credits?.overageLimitReached) extras.push("overage limit reached");
	if (snapshot.spendLimitReached) extras.push("spend limit reached");
	if (extras.length > 0) lines.push(theme.fg("dim", extras.join(" · ")));
	if (usageWindows.length === 0 && reviewWindows.length === 0) {
		lines.push(theme.fg("warning", "No usage windows returned"));
	}

	return lines.map((line) => truncateToWidth(line, width));
}
