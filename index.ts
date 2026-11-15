import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { getAgentDir } from "@oh-my-pi/pi-utils";

const MODES = ["off", "automatic", "regexed"] as const;
type Mode = (typeof MODES)[number];
const TRIGGER = /\b(?:context7|ctx7)\b/i;
const MARKER = "[omp-context7-modes]";
const PLAYBOOK = `${MARKER}
For third-party library documentation, APIs, configuration or migrations:
- Detect installed versions from project manifests/lockfiles before lookup.
- Use \`ctx7 library\` to resolve the library, then \`ctx7 docs\` with a focused query. Check command help if needed; prefer version-matched official documentation and disclose version mismatches.
- Cite documentation source URLs for claims. Never send secrets, credentials, .env contents or private source to Context7; query only public library names, versions and minimal generic questions.
- If ctx7 is unavailable or lookup fails, use official documentation or local references, disclose the limitation and uncertainty, and continue without blocking unrelated work. Never invent documentation.`;

function isMode(value: unknown): value is Mode {
	return MODES.some(mode => mode === value);
}

export default function context7Modes(omp: ExtensionAPI): void {
	const settingsPath = join(getAgentDir(), "context7-modes.json");
	let mode: Mode = "regexed";
	try {
		const saved: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
		if (saved && typeof saved === "object" && "mode" in saved && isMode(saved.mode)) {
			mode = saved.mode;
		}
	} catch {
		// Missing, unreadable or invalid settings use the explicit-trigger default.
	}

	omp.registerCommand("ctx7-mode", {
		description: "Show or set Context7 mode: off, automatic, regexed (default)",
		getArgumentCompletions: prefix => MODES.filter(value => value.startsWith(prefix))
			.map(value => ({ value, label: value })),
		handler: async (args, ctx) => {
			const requested = args.trim();
			if (!requested) {
				ctx.ui.notify(`Context7 mode: ${mode}`, "info");
				return;
			}
			if (!isMode(requested)) {
				ctx.ui.notify("Usage: /ctx7-mode [off|automatic|regexed]", "warning");
				return;
			}
			const temporaryPath = `${settingsPath}.${randomUUID()}.tmp`;
			try {
				mkdirSync(dirname(settingsPath), { recursive: true });
				writeFileSync(temporaryPath, `${JSON.stringify({ mode: requested })}\n`, { mode: 0o600, flag: "wx" });
				renameSync(temporaryPath, settingsPath);
				mode = requested;
				ctx.ui.notify(`Context7 mode: ${mode} (saved)`, "info");
			} catch {
				ctx.ui.notify(`Could not save Context7 mode; still ${mode}. Check permissions for ${settingsPath}.`, "error");
			} finally {
				try { rmSync(temporaryPath, { force: true }); } catch { /* Best-effort temporary file cleanup. */ }
			}
		},
	});

	omp.on("before_agent_start", event => {
		if (mode === "off" || (mode === "regexed" && !TRIGGER.test(event.prompt))) return;
		if (event.systemPrompt.some(part => part.startsWith(MARKER))) return;
		const guidance = mode === "automatic"
			? "Decide whether Context7 would help the current request; use it only when relevant."
			: "The current user prompt explicitly mentions Context7/ctx7; use it when a documentation lookup would help.";
		return { systemPrompt: [...event.systemPrompt, `${PLAYBOOK}\n${guidance}`] };
	});
}
