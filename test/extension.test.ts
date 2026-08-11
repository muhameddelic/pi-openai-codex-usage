import { describe, expect, it, vi } from "vitest";
import extension from "../extensions/openai-codex-usage/index.js";

describe("Pi extension entrypoint", () => {
	it("registers the usage command and lifecycle handlers", () => {
		const events = new Map<string, (...args: any[]) => unknown>();
		const pi = {
			registerCommand: vi.fn(),
			on: vi.fn((event: string, handler: (...args: any[]) => unknown) => events.set(event, handler)),
		};

		extension(pi as never);

		expect(pi.registerCommand).toHaveBeenCalledWith(
			"codex-usage",
			expect.objectContaining({
				description: expect.any(String),
				handler: expect.any(Function),
			}),
		);
		expect([...events.keys()]).toEqual([
			"session_start",
			"model_select",
			"agent_settled",
			"session_shutdown",
		]);
	});
});
