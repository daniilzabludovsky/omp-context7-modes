import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getAgentDir, setAgentDir } from "@oh-my-pi/pi-utils";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";

test("real OMP loader and runner preserve mode behavior and persisted state", async () => {
	const original = getAgentDir();
	const directory = mkdtempSync(join(tmpdir(), "omp-context7-native-"));
	setAgentDir(directory);
	const auth = await AuthStorage.create(join(directory, "auth.db"));
	const runners: ExtensionRunner[] = [];
	try {
		const registry = new ModelRegistry(auth, join(directory, "models.yml"), {
			ignoreLocalModelConfig: true, cacheDbPath: join(directory, "models.db"),
		});
		async function createRunner() {
			const loaded = await loadExtensions([fileURLToPath(new URL("../index.ts", import.meta.url))], directory);
			expect(loaded.errors).toEqual([]);
			const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, directory, SessionManager.inMemory(directory), registry);
			runners.push(runner);
			return runner;
		}
		const runner = await createRunner();
		const base = ["Base policy", "Jevstice policy"];
		async function prompt(text: string, policy = base) {
			return (await runner.emitBeforeAgentStart(text, undefined, policy))?.systemPrompt ?? policy;
		}
		async function mode(value: string) {
			const command = runner.getCommand("ctx7-mode");
			if (!command) throw new Error("Mode command was not loaded by OMP");
			await command.handler(value, runner.createCommandContext());
		}
		expect(await prompt("ordinary request")).toEqual(base);
		const active = await prompt("Use CTX7");
		expect(active.slice(0, 2)).toEqual(base);
		expect(active.filter(part => part.startsWith("[omp-context7-modes]"))).toHaveLength(1);
		expect(await prompt("ctx7", active)).toEqual(active);
		expect(await prompt("ordinary request")).toEqual(base);
		await mode("off");
		expect(await prompt("context7")).toEqual(base);
		await mode("automatic");
		expect((await prompt("ordinary request")).filter(part => part.startsWith("[omp-context7-modes]"))).toHaveLength(1);
		const reloaded = await createRunner();
		const persisted = await reloaded.emitBeforeAgentStart("ordinary request", undefined, base);
		expect(persisted?.systemPrompt?.filter(part => part.startsWith("[omp-context7-modes]"))).toHaveLength(1);
	} finally {
		for (const runner of runners) { runner.clearManagedTimers(); runner.disposeFileFallbacks(); }
		await auth.close();
		setAgentDir(original);
		rmSync(directory, { recursive: true, force: true });
	}
}, 30_000);
