# hbar-agentic-harness

TypeScript CLI that **generates and validates [scaffold-hbar](https://github.com/buidler-labs/scaffold-hbar) templates** from a product brief you supply.

The harness is **template-agnostic**. You bring a PRD, a YAML spec, and validators for *your* Hedera demo (HCS feed, tip jar, marketplace, etc.). The loop is always the same: seed → generate → validate → repair until pass or budget exhausted.

## What it does

1. **Seeds** an isolated workspace from a pinned `scaffold-hbar` git ref
2. **Vendors** optional skills and harness context into the workspace
3. **Runs a generator agent** (Cursor CLI `agent` by default) against your PRD
4. **Validates** in layers you enable in the spec (see below)
5. **Repairs** on failure with focused prompts, up to `maxAttempts`
6. **Audits** agent logs for oracle peeking (informational — does not fail the run)
7. **Writes artifacts** under `runs/` for inspection

**Pass condition:** every validation tier enabled in the spec must pass. Oracle audit never blocks a pass.

## Validation tiers (opt-in via spec)

| Tier | Spec fields | What it checks |
|------|-------------|----------------|
| **0–1 Deterministic** | `validators.static`, `validators.commands`, `requiredFiles`, `forbiddenFiles`, `secretScan` | Files, JSON/text assertions, secrets, yarn install/lint/build (or your commands) |
| **2 Playwright gate** | `validators.playwright` | Dev server boots; configured routes return OK; optional console / forbidden-text checks |
| **3 Semantic** | `contract` + `validator` | Read-only agent drives the live app and grades numbered acceptance assertions |

Tier 0–1 is the minimum. Tier 2–3 are optional but recommended for UI demos.

## Prerequisites

### Always

- **Node.js** >= 20
- **git** (workspace seeding)
- **yarn** (seeded workspaces are Yarn-based)
- **Cursor CLI** (`agent` on your `PATH`, authenticated)
- A **scaffold-hbar** clone or remote URL for `seed.repo`
- Your own **PRD** markdown (not shipped in this repo — see [`docs/prds/README.md`](docs/prds/README.md))

```bash
git clone git@github.com:buidler-labs/hbar-agentic-harness.git
cd hbar-agentic-harness
npm install
```

### If you enable Tier 2 (`validators.playwright`)

- Chromium for the harness Playwright dependency:

```bash
npx playwright install chromium
```

### If you enable Tier 3 (`contract` + `validator`)

- An **acceptance contract** JSON (numbered assertions the semantic agent grades)
- Playwright MCP available to the Cursor agent (the harness merges MCP config into the workspace; keep a working Playwright MCP setup for headless runs)
- Validator agent flags that allow MCP tool use in CI/headless contexts, typically:
  - `--force`
  - `--sandbox disabled`
  - `--approve-mcps`

Semantic infrastructure failures (MCP rejected, no browser) abort the repair loop instead of asking the generator to “fix” the app.

## What you must provide

To run a new Hedera template benchmark, supply:

| Input | Required? | Notes |
|-------|-----------|--------|
| **PRD** (`prd`) | Yes | Local markdown under `docs/prds/` (gitignored except the folder README) |
| **Spec YAML** | Yes | Paths, seed, generator, validators, constraints |
| **Static validator JSON** | Yes | Structural / text / secret assertions for this template |
| **Command validator JSON** | Yes | Yarn (or other) commands that must succeed without live secrets |
| **scaffold-hbar seed** | Yes | Update `seed.repo` / `seed.ref` for your machine |
| **Skills paths** (`skills`) | Optional | Absolute paths to `SKILL.md` files to vendor into the workspace |
| **Playwright smoke YAML** | Tier 2 | `server.command` / `server.url` + routes to hit |
| **Acceptance contract** | Tier 3 | Numbered assertions; source of truth for semantic pass/fail |
| **Validator agent block** | Tier 3 | Separate from the generator; usually stricter MCP/sandbox flags |

Machine-specific paths (`seed.repo`, `skills`, sometimes absolute tool paths) must be edited before you run.

## Configure a spec

Example layout (paths are yours to fill in):

```yaml
name: my-hedera-template
prd: docs/prds/my-template.md
# contract: contracts/my-template-acceptance.json   # Tier 3

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
    - --trust
    - --sandbox
    - enabled
    - --workspace
    - "{workspace}"
    - --force
    - --output-format
    - stream-json
    - --stream-partial-output
  timeoutMs: 3600000

# validator:                        # Tier 3 — separate agent
#   enabled: true
#   provider: command
#   command: agent
#   args: [ -p, --trust, --force, --sandbox, disabled, --approve-mcps, ... ]

# skills:
#   - /path/to/some-skill/SKILL.md

validators:
  static: validators/my-template-static.json
  commands: validators/my-template-yarn.json
  # playwright: playwright/my-template-smoke.yaml   # Tier 2

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

A checked-in example spec lives in [`specs/`](specs/) — use it as a reference for field shape, then point every path at **your** PRD, validators, and seed.

### Adding a new template

For a novel Hedera demo, copy the skeleton and follow the checklist:

- Guide: [`docs/authoring-a-template.md`](docs/authoring-a-template.md)
- Files: [`skeletons/new-template/`](skeletons/new-template/)

## Run

```bash
npm run harness -- run specs/my-template.yaml
npm run harness -- run specs/my-template.yaml --max-attempts 3
```

Re-run deterministic (+ Playwright gate if configured) on an existing workspace:

```bash
npm run harness -- validate specs/my-template.yaml --workspace runs/<run-id>/workspace
```

Re-run semantic validation only (requires `contract` + `validator` in the spec):

```bash
npm run harness -- validate-semantic specs/my-template.yaml --workspace runs/<run-id>/workspace
```

## Repository layout

```
├── src/              # Harness implementation
├── specs/            # YAML run configs (examples)
├── validators/       # JSON static + command validators
├── contracts/        # Acceptance contracts (Tier 3)
├── playwright/       # Playwright gate smoke configs (Tier 2)
├── skeletons/        # Copyable stubs for a new template benchmark
├── docs/
│   ├── authoring-a-template.md
│   └── prds/         # Local PRDs only (gitignored except README)
└── runs/             # Run artifacts (gitignored)
```

## Run artifacts

Each run creates `runs/<timestamp>-<spec-name>/`:

| Path | Contents |
|------|----------|
| `workspace/` | Seeded base + agent modifications |
| `prompts/` | Generator, repair, and validator prompts |
| `logs/` | Agent streams, validation, Playwright gate, semantic results |
| `cache/` | Cross-attempt caches (e.g. install fingerprint) |
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

- **Validation is authoritative** — agents do not declare success; the harness does.
- **Blind by default** — no reference finished template is passed in; compare outputs manually if you want.
- **Oracle audit** — scans agent logs for access outside the run workspace; logged only.
- **Yarn-only constraints** — typical for scaffold-hbar; encode package-manager rules in the spec.
- **Repair stays in-workspace** — findings (including semantic assertion IDs when Tier 3 is on) feed the next generator prompt.

## License

MIT
