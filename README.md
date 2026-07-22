# hbar-agentic-harness

TypeScript CLI for **generating and validating [scaffold-hbar](https://github.com/buidler-labs/scaffold-hbar) templates** with an agentic loop: seed a workspace, run a generator agent, validate deterministically, and repair until pass or budget exhausted.

The harness is **generic** — you bring your own PRD, spec, and validators per template. Product docs and machine-specific paths stay local.

## What it does

1. **Seeds** an isolated workspace from a pinned `scaffold-hbar` git ref
2. **Vendors skills** into the workspace (optional)
3. **Runs a generator agent** (Cursor CLI by default) to transform the workspace into a template
4. **Audits** agent logs for oracle peeking (informational — does not fail the run)
5. **Validates** output with file checks, static JSON assertions, secret scan, and yarn commands
6. **Repairs** on failure with focused prompts, up to `maxAttempts`
7. **Writes artifacts** under `runs/` for inspection and comparison

**Pass condition:** deterministic validation passes. Oracle audit results are logged separately.

## Prerequisites

- **Node.js** >= 20
- **git** (for workspace seeding)
- **yarn** (validation runs yarn commands in the seeded workspace)
- **Cursor CLI** (`agent` on your PATH) — configured in the spec's `generator` block
- A local **scaffold-hbar** clone (or remote URL) for seeding
- Your own **PRD** markdown file (see below)

## Quick start

```bash
git clone git@github.com:web3buidlerz/hbar-agentic-harness.git
cd hbar-agentic-harness
npm install
```

### 1. Add a PRD locally

PRDs are **not committed** to this repo. Create one under `docs/prds/`:

```bash
mkdir -p docs/prds
# add docs/prds/my-template.md with product requirements
```

See [`docs/prds/README.md`](docs/prds/README.md) for details.

### 2. Configure a spec

Copy or edit a YAML spec in `specs/`. At minimum you need:

| Field | Purpose |
|-------|---------|
| `prd` | Path to your local PRD markdown |
| `seed.repo` / `seed.ref` | Git source for the workspace (e.g. scaffold-hbar `main`) |
| `generator` | CLI command and args for the generator agent |
| `validators.static` | JSON file with structural assertions |
| `validators.commands` | JSON file with yarn commands to run |
| `requiredFiles` / `forbiddenFiles` | Spec-level file checks |

An example layout is in [`specs/hedera-demo-from-main.yaml`](specs/hedera-demo-from-main.yaml). **Update all paths** (`seed.repo`, `skills`, `prd`) for your machine before running.

Minimal spec skeleton:

```yaml
name: my-template
prd: docs/prds/my-template.md

seed:
  repo: /path/to/scaffold-hbar   # or https://github.com/buidler-labs/scaffold-hbar
  ref: main
  preflight:
    commands:
      - command: yarn install

generator:
  provider: command
  command: agent
  args:
    - -p
    - --workspace
    - "{workspace}"
    - --output-format
    - stream-json
    - --stream-partial-output
  timeoutMs: 3600000

validators:
  static: validators/my-template-static.json
  commands: validators/my-template-yarn.json

requiredFiles:
  - template.json
  - README.md
  - AGENTS.md

forbiddenFiles:
  - .env

maxAttempts: 3

logging:
  jsonl: runs/harness.log.jsonl
  notes: runs/harness-notes.md
```

### 3. Run

```bash
npm run harness -- run specs/my-template.yaml
npm run harness -- run specs/my-template.yaml --max-attempts 3
```

Re-run validation only on an existing workspace:

```bash
npm run harness -- validate specs/my-template.yaml --workspace runs/<run-id>/workspace
```

Re-run semantic (Tier 3 / acceptance contract) validation only:

```bash
npm run harness -- validate-semantic specs/my-template.yaml --workspace runs/<run-id>/workspace
```

## Repository layout

```
├── src/              # Harness implementation
├── specs/            # YAML run configs (example spec included)
├── validators/       # JSON static + command validators
├── docs/prds/        # Local PRDs only (gitignored except README)
├── playwright/       # Smoke config (not wired yet)
└── runs/             # Run artifacts (gitignored)
```

## Run artifacts

Each run creates `runs/<timestamp>-<spec-name>/`:

| Path | Contents |
|------|----------|
| `workspace/` | Seeded base + agent modifications |
| `prompts/` | Generator and repair prompts |
| `logs/` | Agent stream, activity, validation, oracle audit |
| `reports/report.json` | Final pass/fail, seed SHA, findings |
| `status.json` | Live progress during long runs |

Cross-run logs (append-only):

- `runs/harness.log.jsonl` — structured events
- `runs/harness-notes.md` — human-readable notes

## Scripts

| Command | Description |
|---------|-------------|
| `npm run harness -- <cmd>` | Build and run the CLI |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |

CLI commands: `run`, `validate`, `validate-semantic` (`supervise` is not implemented yet).

## Design notes

- **Deterministic validation is authoritative** — the agent does not declare success.
- **Blind benchmarks** — no reference template is passed to the harness; compare outputs manually afterward.
- **Oracle audit** — scans agent logs for access outside the run workspace; logged but does not block pass when validation succeeds.
- **Yarn-only** — scaffold-hbar templates use Yarn workspaces; npm/pnpm are rejected via spec constraints.

## License

MIT
