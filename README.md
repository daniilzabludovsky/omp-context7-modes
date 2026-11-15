# OMP Context7 Modes

A small [Oh My Pi](https://github.com/can1357/oh-my-pi) plugin that controls when Context7 lookup instructions enter the system prompt. One extension, one command, no runtime dependencies beyond OMP's host packages.

It **does not** install Context7, provide a documentation tool, make network requests, or enforce tool usage. The model follows a compact lookup playbook using the `ctx7` CLI when available.

## Requirements

- OMP with the `before_agent_start` extension API and `systemPrompt: string[]` result contract. Development targets OMP **18.20.2**; older API shapes are not supported.
- A working [Context7](https://github.com/upstash/context7) CLI exposing `ctx7 library` and `ctx7 docs`, available to OMP's shell. Follow Context7's own setup/authentication instructions. Without it, the playbook directs the model to official documentation or local references.
- Bun for OMP's plugin installer; development uses Bun 1.3 or newer.

## Install

Once this repository is published on GitHub:

```sh
omp plugin install github:daniilzabludovsky/omp-context7-modes
```

Start a new OMP process to load the extension. In an existing session, restart OMP and resume that session. `/reload-plugins` in OMP 18.20.2 refreshes discovery/MCP state, but does not guarantee loading new TypeScript extension factories; a process restart is the reliable path.

For local development, from a checkout:

```sh
omp plugin link .
omp
```

The `omp.extensions` manifest points directly to `index.ts`; no build or generated JavaScript is needed. Install or link it once: do not also copy it into `~/.omp/agent/extensions` or load it with `-e` in the same runtime.

## Usage

Inside OMP:

```text
/ctx7-mode
/ctx7-mode off
/ctx7-mode automatic
/ctx7-mode regexed
```

The command without arguments shows the current mode. Valid mode names are lowercase. Changing a mode saves it immediately; it affects the next agent turn and does not alter a request already in flight.

| Mode | Instructions injected |
| --- | --- |
| `off` | Never. This does not disable an independently installed Context7 tool or prevent explicit CLI calls. |
| `automatic` | Every user turn receives the compact playbook; the model decides whether a third-party documentation lookup is relevant. No lookup is forced. |
| `regexed` (default) | Only if the current user prompt matches `/\b(?:context7|ctx7)\b/i`. |

Examples in `regexed` mode:

```text
Use ctx7 to check the installed React API.       → activates
Check CONTEXT7 for this migration.              → activates
Explain React hooks.                           → inactive
Explain mycontext7adapter.                      → inactive
```

Only the current hook's `event.prompt` is matched, never prior turns or tool output. OMP supplies transformed prompt text and joins queued user messages with blank lines. The exact JavaScript word-boundary behavior applies: `ctx7-docs` matches; `_ctx7` and `ctx7_suffix` do not.

## Lookup playbook

When activated, the extension asks the model to:

1. Determine installed library versions from project manifests or lockfiles.
2. Resolve the library with `ctx7 library`, then request focused documentation with `ctx7 docs`; consult CLI help for syntax when needed.
3. Prefer version-matched official documentation and disclose version mismatches.
4. Cite documentation source URLs for claims.
5. Never send secrets, credentials, `.env` contents, or private source to Context7. Use public library names, versions, and minimal generic questions.
6. If lookup is unavailable or fails, use official documentation or local references, disclose limitations and uncertainty, and continue unrelated work without inventing documentation.

These are model instructions, not a sandbox or a guarantee about model behavior. This plugin itself reads only its mode settings; it does not scan project files or transmit data. Any actual lookup runs through the model's existing tools and permissions.

## Persistence and coexistence

The selected mode is stored as `{"mode":"regexed"}` in `context7-modes.json` under OMP's active agent directory (normally `~/.omp/agent/context7-modes.json`). The host's `getAgentDir()` respects profile and directory overrides. Settings live outside the plugin checkout and survive restarts and plugin upgrades.

- Missing, unreadable, or invalid settings default to `regexed`.
- Writes use a private temporary file and atomic rename. A failed save reports an error and keeps the previous in-memory mode.
- An already-running OMP process retains its loaded mode; restart it to read changes saved by another process. Last successful save wins.
- Each active turn appends one namespaced policy block, with a duplicate guard. Inactive turns add nothing. No chat-history messages, startup banners, tools, or tool-blocking hooks are registered.
- Existing system-prompt entries are preserved. Jevstice and other extensions retain their own policies and gates; this plugin neither bypasses nor configures them.

To reset the default, use `/ctx7-mode regexed`. To uninstall:

```sh
omp plugin uninstall omp-context7-modes
```

Restart OMP afterward. Uninstallation leaves the mode file intact; remove that file separately if you want to erase the preference.

## Development

```sh
bun install --ignore-scripts
bun test
bun run typecheck
```

Tests isolate settings in temporary directories and exercise all modes, exact trigger boundaries, non-sticky turns, duplicate prevention, policy preservation, command validation, persistence after reload, invalid settings, and save failures. Development dependencies provide the matching OMP types; the plugin has no install scripts or runtime dependency bundle.

Before publishing, run the checks above, inspect `npm pack --dry-run`, and ensure `index.ts`, `package.json`, `README.md`, and `LICENSE` are present. The GitHub install command requires a publicly reachable repository containing those files; preparing a local checkout alone does not publish it.

## License

[MIT](LICENSE).
