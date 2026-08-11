import { describe, expect, it } from "vitest";
import {
	formatDuration,
	normalizePercent,
	resetSeconds,
	windowLabel,
} from "../extensions/openai-codex-usage/domain.js";

describe("usage domain", () => {
	it("normalizes quota percentages to whole values between zero and one hundred", () => {
		expect(normalizePercent(39.4)).toBe(39);
		expect(normalizePercent(-4)).toBe(0);
		expect(normalizePercent(120)).toBe(100);
		expect(normalizePercent(Number.NaN)).toBeUndefined();
	});

	it("uses the absolute reset time in preference to a fallback duration", () => {
		expect(
			resetSeconds(
				{ resetAt: 1_700_003_600, resetAfterSeconds: 99 },
				1_700_000_000_000,
			),
		).toBe(3600);
		expect(resetSeconds({ resetAfterSeconds: 99 }, 1_700_000_000_000)).toBe(99);
		expect(resetSeconds({}, 1_700_000_000_000)).toBeUndefined();
	});

	it("labels quota windows and reset durations compactly", () => {
		expect(windowLabel({ durationSeconds: 18_000 })).toBe("5h");
		expect(windowLabel({ durationSeconds: 604_800 })).toBe("7d");
		expect(windowLabel({ durationSeconds: 2_592_000 })).toBe("1mo");
		expect(windowLabel({})).toBe("usage");
		expect(formatDuration(59)).toBe("1m");
		expect(formatDuration(3_720)).toBe("1h2m");
		expect(formatDuration(180_000)).toBe("2d2h");
	});
});
