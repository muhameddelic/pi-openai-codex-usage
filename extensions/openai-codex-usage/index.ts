import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createUsageClient } from "./client.js";
import { createUsageController } from "./controller.js";

const PROVIDER_ID = "openai-codex";
const PANEL_ACTIONS = new Set(["toggle", "show", "hide"] as const);

type PanelAction = "toggle" | "show" | "hide";

export default function (pi: ExtensionAPI) {
	const controller = createUsageController(createUsageClient());

	pi.registerCommand("codex-usage", {
		description: "Show usage or toggle the detailed Codex usage panel",
		getArgumentCompletions: (prefix) => {
			const actions = ["toggle", "show", "hide", "refresh"];
			const matches = actions
				.filter((action) => action.startsWith(prefix))
				.map((action) => ({ value: action, label: action }));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (PANEL_ACTIONS.has(action as PanelAction)) {
				await controller.setPanel(ctx, action as PanelAction);
				return;
			}
			if (action && action !== "refresh") {
				ctx.ui.notify("Usage: /codex-usage [toggle|show|hide|refresh]", "warning");
				return;
			}
			await controller.refresh(ctx, { notify: true });
		},
	});

	pi.on("session_start", (_event, ctx) => {
		void controller.activate(ctx, ctx.model?.provider === PROVIDER_ID);
	});

	pi.on("model_select", (event, ctx) => {
		void controller.activate(ctx, event.model.provider === PROVIDER_ID);
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.model?.provider === PROVIDER_ID) void controller.refresh(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		controller.shutdown(ctx);
	});
}
