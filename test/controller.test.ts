import { describe, expect, it, vi } from "vitest";
import type { UsageSnapshot } from "../extensions/openai-codex-usage/domain.js";
import { createUsageController } from "../extensions/openai-codex-usage/controller.js";

const usage: UsageSnapshot = {
	plan: "plus",
	usage: {
		allowed: true,
		limitReached: false,
		windows: [{ usedPercent: 40, durationSeconds: 18_000, resetAfterSeconds: 3_600 }],
	},
	spendLimitReached: false,
};

function context() {
	return {
		modelRegistry: {},
		ui: {
			theme: {
				fg: (_color: string, text: string) => text,
				bold: (text: string) => text,
			},
			setStatus: vi.fn(),
			setWidget: vi.fn(),
			notify: vi.fn(),
		},
	};
}

describe("usage controller", () => {
	it("shows usage only while Codex is active and preserves the panel preference", async () => {
		const client = { load: vi.fn().mockResolvedValue(usage) };
		const controller = createUsageController(client, { refreshIntervalMs: 60_000 });
		const ctx = context();

		await controller.activate(ctx, true);
		await controller.setPanel(ctx, "show");
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("openai-codex-usage", expect.stringContaining("40%"));
		expect(ctx.ui.setWidget).toHaveBeenCalledWith(
			"openai-codex-usage-details",
			expect.any(Function),
			{ placement: "belowEditor" },
		);

		await controller.activate(ctx, false);
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("openai-codex-usage", undefined);
		expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("openai-codex-usage-details", undefined);

		await controller.activate(ctx, true);
		expect(ctx.ui.setWidget).toHaveBeenLastCalledWith(
			"openai-codex-usage-details",
			expect.any(Function),
			{ placement: "belowEditor" },
		);
		controller.shutdown(ctx);
	});

	it("refreshes on its interval only while active", async () => {
		vi.useFakeTimers();
		try {
			const client = { load: vi.fn().mockResolvedValue(usage) };
			const controller = createUsageController(client, { refreshIntervalMs: 1_000 });
			const ctx = context();

			await controller.activate(ctx, true);
			expect(client.load).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1_000);
			expect(client.load).toHaveBeenCalledTimes(2);

			await controller.activate(ctx, false);
			await vi.advanceTimersByTimeAsync(2_000);
			expect(client.load).toHaveBeenCalledTimes(2);
			controller.shutdown(ctx);
		} finally {
			vi.useRealTimers();
		}
	});

	it("deduplicates concurrent refreshes", async () => {
		let resolve!: (snapshot: UsageSnapshot) => void;
		const pending = new Promise<UsageSnapshot>((done) => {
			resolve = done;
		});
		const client = { load: vi.fn().mockReturnValue(pending) };
		const controller = createUsageController(client);
		const ctx = context();

		const first = controller.refresh(ctx);
		const second = controller.refresh(ctx);
		expect(client.load).toHaveBeenCalledTimes(1);
		resolve(usage);
		expect(await first).toBe(usage);
		expect(await second).toBe(usage);
		controller.shutdown(ctx);
	});
});
