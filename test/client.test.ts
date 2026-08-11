import { describe, expect, it, vi } from "vitest";
import { createUsageClient } from "../extensions/openai-codex-usage/client.js";

function accessToken(accountId = "account-123"): string {
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none" })}.${encode({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })}.signature`;
}

describe("OpenAI usage client", () => {
	it("loads and normalizes subscription usage using Pi's resolved OAuth token", async () => {
		const token = accessToken();
		const registry = {
			getProviderAuth: vi.fn().mockResolvedValue({ auth: { apiKey: token } }),
		};
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					plan_type: "plus",
					rate_limit: {
						allowed: true,
						limit_reached: false,
						primary_window: {
							used_percent: 39.4,
							limit_window_seconds: 604_800,
							reset_at: 1_700_003_600,
						},
						secondary_window: null,
					},
					code_review_rate_limit: null,
					credits: {
						has_credits: false,
						unlimited: false,
						overage_limit_reached: false,
						balance: "0",
					},
					spend_control: { reached: false },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);

		const snapshot = await createUsageClient({ fetch }).load(registry);

		expect(snapshot).toEqual({
			plan: "plus",
			usage: {
				allowed: true,
				limitReached: false,
				windows: [{ usedPercent: 39, durationSeconds: 604_800, resetAt: 1_700_003_600 }],
			},
			codeReview: undefined,
			credits: {
				hasCredits: false,
				unlimited: false,
				overageLimitReached: false,
				balance: "0",
			},
			spendLimitReached: false,
		});
		expect(registry.getProviderAuth).toHaveBeenCalledWith("openai-codex");
		expect(fetch).toHaveBeenCalledWith(
			"https://chatgpt.com/backend-api/wham/usage",
			expect.objectContaining({
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${token}`,
					"ChatGPT-Account-Id": "account-123",
				},
			}),
		);
	});
});
