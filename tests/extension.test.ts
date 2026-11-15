import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionAPI, RegisteredCommand } from "@oh-my-pi/pi-coding-agent";
import { getAgentDir, setAgentDir } from "@oh-my-pi/pi-utils";
import context7Modes from "../index";

const originalAgentDir = getAgentDir();
let directory: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "omp-context7-test-"));
	setAgentDir(directory);
});

afterEach(() => {
	setAgentDir(originalAgentDir);
	rmSync(directory, { recursive: true, force: true });
});

function load() {
	let command: Omit<RegisteredCommand, "name">;
	let hook: (event: BeforeAgentStartEvent) => BeforeAgentStartEventResult | void;
	const notifications: { message: string; type?: string }[] = [];
	const events: string[] = [];
	const api = {
		registerCommand(name: string, options: Omit<RegisteredCommand, "name">) {
			expect(name).toBe("ctx7-mode");
			command = options;
		},
		on(name: string, handler: typeof hook) {
			events.push(name);
			hook = handler;
		},
	};
	context7Modes(api as unknown as ExtensionAPI);
	return {
		events,
		notifications,
		async command(args = "") {
			await command.handler(args, {
				ui: { notify: (message: string, type?: string) => notifications.push({ message, type }) },
			} as unknown as Parameters<RegisteredCommand["handler"]>[1]);
			return notifications.at(-1)!;
		},
		prompt(prompt: string, systemPrompt = ["Existing policy", "Jevstice policy"]) {
			return hook({ type: "before_agent_start", reason: "prompt", prompt, systemPrompt });
		},
	};
}

describe("prompt activation", () => {
	test.each(["context7", "Use CTX7 for React", "(Context7)", "ctx7-docs", "ctx7's API"])("regexed activates on %s", prompt => {
		expect(load().prompt(prompt)?.systemPrompt).toHaveLength(3);
	});

	test.each(["ordinary request", "mycontext7", "context77", "_ctx7", "ctx7_suffix", "ctx7x", ""])("regexed stays inactive on %s", prompt => {
		expect(load().prompt(prompt)).toBeUndefined();
	});

	test("a triggered turn does not activate subsequent unrelated prompts", () => {
		const extension = load();
		expect(extension.prompt("ctx7")?.systemPrompt).toHaveLength(3);
		expect(extension.prompt("Now list local files")).toBeUndefined();
	});

	test("automatic injects decision guidance without requiring a trigger", async () => {
		const extension = load();
		await extension.command("automatic");
		expect(extension.prompt("Explain React configuration")?.systemPrompt).toHaveLength(3);
		expect(extension.prompt("List local files")?.systemPrompt).toHaveLength(3);
	});

	test("off never injects, including explicit triggers", async () => {
		const extension = load();
		await extension.command("off");
		for (const prompt of ["ctx7", "CONTEXT7", "Explain React", ""]) {
			expect(extension.prompt(prompt)).toBeUndefined();
		}
	});

	test("preserves other policy, avoids mutation and duplicate instructions", () => {
		const extension = load();
		const policy = ["Base policy", "Jevstice policy"];
		const result = extension.prompt("ctx7", policy)!.systemPrompt!;
		expect(policy).toEqual(["Base policy", "Jevstice policy"]);
		expect(result.slice(0, 2)).toEqual(policy);
		expect(extension.prompt("ctx7 again", result)).toBeUndefined();
		expect(extension.events).toEqual(["before_agent_start"]);
	});
});

describe("mode command and persistence", () => {
	test("reports the default without writing settings", async () => {
		expect(await load().command()).toEqual({ message: "Context7 mode: regexed", type: "info" });
		expect(readdirSync(directory)).toEqual([]);
	});

	test.each(["off", "automatic", "regexed"])("persists %s across extension reload", async mode => {
		const first = load();
		expect((await first.command(` ${mode} `)).type).toBe("info");
		expect(JSON.parse(readFileSync(join(directory, "context7-modes.json"), "utf8"))).toEqual({ mode });
		const reloaded = load();
		expect((await reloaded.command()).message).toBe(`Context7 mode: ${mode}`);
		const result = reloaded.prompt("ordinary request");
		expect(Boolean(result)).toBe(mode === "automatic");
		expect(Boolean(reloaded.prompt("ctx7"))).toBe(mode !== "off");
	});

	test("rejects invalid command arguments without changing saved mode", async () => {
		const extension = load();
		await extension.command("off");
		for (const args of ["invalid", "automatic extra", "OFF"]) {
			expect((await extension.command(args)).type).toBe("warning");
		}
		expect((await load().command()).message).toBe("Context7 mode: off");
	});

	test.each(["not json", "null", "{}", '{"mode":"invalid"}', '{"mode":7}'])("invalid saved data uses regexed: %s", content => {
		writeFileSync(join(directory, "context7-modes.json"), content);
		const extension = load();
		expect(extension.prompt("ordinary request")).toBeUndefined();
		expect(extension.prompt("ctx7")?.systemPrompt).toHaveLength(3);
	});

	test("write failure reports error, retains mode and cleans temporary files", async () => {
		mkdirSync(join(directory, "context7-modes.json"));
		const extension = load();
		expect((await extension.command("automatic")).type).toBe("error");
		expect((await extension.command()).message).toBe("Context7 mode: regexed");
		expect(extension.prompt("ordinary request")).toBeUndefined();
		expect(readdirSync(directory)).toEqual(["context7-modes.json"]);
	});
});
