export interface UsageWindow {
	usedPercent?: number;
	durationSeconds?: number;
	resetAfterSeconds?: number;
	resetAt?: number;
}

export interface UsageLimit {
	allowed?: boolean;
	limitReached: boolean;
	windows: UsageWindow[];
}

export interface UsageSnapshot {
	plan?: string;
	usage?: UsageLimit;
	codeReview?: UsageLimit;
	credits?: {
		hasCredits: boolean;
		unlimited: boolean;
		overageLimitReached: boolean;
		balance?: string | number;
	};
	spendLimitReached: boolean;
}

export function normalizePercent(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return Math.max(0, Math.min(100, Math.round(value)));
}

export function resetSeconds(window: UsageWindow, nowMs = Date.now()): number | undefined {
	if (typeof window.resetAt === "number" && Number.isFinite(window.resetAt)) {
		return Math.max(0, Math.round(window.resetAt - nowMs / 1000));
	}
	if (typeof window.resetAfterSeconds === "number" && Number.isFinite(window.resetAfterSeconds)) {
		return Math.max(0, Math.round(window.resetAfterSeconds));
	}
	return undefined;
}

export function windowLabel(window: UsageWindow): string {
	const seconds = window.durationSeconds;
	if (!seconds || seconds <= 0) return "usage";
	if (seconds < 24 * 60 * 60) return `${Math.round(seconds / 3600)}h`;
	if (seconds < 14 * 24 * 60 * 60) return `${Math.round(seconds / 86400)}d`;
	return `${Math.round(seconds / (30 * 86400))}mo`;
}

export function formatDuration(totalSeconds: number): string {
	const minutes = Math.max(0, Math.ceil(totalSeconds / 60));
	if (minutes < 60) return `${minutes}m`;

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	if (hours < 24) return remainingMinutes > 0 ? `${hours}h${remainingMinutes}m` : `${hours}h`;

	const days = Math.floor(hours / 24);
	const remainingHours = hours % 24;
	return remainingHours > 0 ? `${days}d${remainingHours}h` : `${days}d`;
}
