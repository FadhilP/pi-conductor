# Pi Conductor

A bundled setup for [Pi](https://pi.dev) containing focused extensions for planning, repository research, verification, safety, background work, checkpoints, and a quieter terminal UI.

Installing this repository loads every extension listed below plus the `focus-dark` theme. Each package can also be installed independently; see its README for setup and full usage.

## Packages

- **[pi-advisor](./pi-advisor)** — Consults a selected tool-free model for difficult planning, architecture review, and failure recovery using a bounded, redacted context snapshot.
- **[pi-conductor-core](./pi-conductor-core)** — Optionally coordinates tool policies from Advisor, Scout, and Continuity while preserving their standalone behavior.
- **[pi-continuity](./pi-continuity)** — Adds explicit plan mode, structured clarifications, visible task lists, and opt-in durable workspace memory through `continuity_update`.
- **[pi-focus](./pi-focus)** — Provides a low-noise Pi terminal UI, compact or comfortable layouts, and the `focus-dark` theme through `/ui` commands.
- **[pi-guard](./pi-guard)** — Intercepts risky shell and file operations, requests confirmation for known destructive actions, and blocks writes outside safe workspace paths.
- **[pi-heartbeat](./pi-heartbeat)** — Runs bounded background shell jobs while other work continues, with tools for starting, checking, and cancelling jobs.
- **[pi-scout](./pi-scout)** — Performs bounded, read-only repository reconnaissance with exact source citations; also supports explicit searches across Pi sessions.
- **[pi-timeline](./pi-timeline)** — Creates Git-backed filesystem checkpoints tied to prompts, then supports listing, restoring, forking, or clearing them.
- **[pi-verify](./pi-verify)** — Detects and runs existing project checks with bounded time and output, either for changed work or the whole project.

## Requirements

- Node.js 22.18 or newer
- Pi and the peer packages declared in [`package.json`](./package.json)

## Install

Install the complete local bundle:

```sh
pi install /absolute/path/to/pi-conductor
```

Then reload Pi:

```text
/reload
```

Review package source before installation. Pi extensions run with your user permissions.
