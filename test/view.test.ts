import { describe, expect, it } from "vitest";
import type { UsageSnapshot } from "../extensions/openai-codex-usage/domain.js";
import {
	formatUsageDetails,
	quotaRgb,
	renderStatus,
	renderWidgetLines,
} from "../extensions/openai-codex-usage/view.js";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function snapshot(usedPercent: number, resetAt = 1_700_003_720): UsageSnapshot {
	return {
		plan: "plus",
		usage: {
			allowed: true,
			limitReached: false,
			windows: [{ usedPercent, durationSeconds: 18_000, resetAt }],
		},
		credits: {
			hasCredits: false,
			unlimited: false,
			overageLimitReached: false,
			balance: "0",
		},
		spendLimitReached: false,
	};
}

describe("usage presentation", () => {
	it("moves quota color from green through yellow to red", () => {
		expect(quotaRgb(0)).toEqual([34, 197, 94]);
		expect(quotaRgb(50)).toEqual([234, 179, 8]);
		expect(quotaRgb(90)).toEqual([239, 68, 68]);
		expect(quotaRgb(100)).toEqual([239, 68, 68]);
	});

	it("shows a red footer bar and reset countdown once usage reaches ninety percent", () => {
		const belowThreshold = renderStatus(snapshot(89), theme, { nowMs: 1_700_000_000_000 });
		const atThreshold = renderStatus(snapshot(90), theme, { nowMs: 1_700_000_000_000 });

		expect(belowThreshold).not.toContain("↻");
		expect(atThreshold).toContain("\u001b[38;2;239;68;68m");
		expect(atThreshold).toContain("90%");
		expect(atThreshold).toContain("↻1h2m");
	});

	it("formats reset timestamps in the requested local timezone", () => {
		const resetAt = Date.parse("2024-01-15T15:30:00Z") / 1000;
		const details = formatUsageDetails(snapshot(40, resetAt), {
			nowMs: Date.parse("2024-01-15T14:30:00Z"),
			locale: "en-US",
			timeZone: "America/New_York",
		});
		const widget = renderWidgetLines(snapshot(90, resetAt), theme, 100, {
			nowMs: Date.parse("2024-01-15T14:30:00Z"),
			locale: "en-US",
			timeZone: "America/New_York",
		});

		expect(details).toContain("Jan 15, 2024, 10:30:00 AM EST");
		expect(widget.join("\n")).toContain("Jan 15, 2024, 10:30:00 AM EST");
	});
});
