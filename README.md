# hbar-agentic-harness

TypeScript CLI harness for generating and validating scaffold-hbar templates with a blind generator/validator loop.

## Architecture

- Human-authored PRDs define product intent.
- Minimal YAML specs define seed, constraints, validators, and budgets.
- The generator agent transforms a seeded `scaffold-hbar` workspace.
- Deterministic validation is authoritative.
- Persistent logs accumulate across runs in `runs/harness.log.jsonl` and `runs/harness-notes.md`.

## Usage

```bash
npm run harness -- run specs/<your-spec>.yaml
npm run harness -- run specs/<your-spec>.yaml --max-attempts 3
```

## PRDs (local only)

Human-authored product requirements go in `docs/prds/` on your machine. That directory is **gitignored** except for `docs/prds/README.md` — each developer adds their own PRDs locally and points to them from a spec:

```yaml
prd: docs/prds/my-template.md
```

## Example benchmark

See [`specs/hedera-demo-from-main.yaml`](specs/hedera-demo-from-main.yaml) for an example spec layout (seed, generator, validators, constraints). Update `seed.repo`, `skills`, and `prd` paths for your environment before running.

- The harness does not receive any reference implementation.
- Human comparison against an existing template happens outside the harness after the run.

## Scripts

- `npm run harness` builds and runs the CLI.
- `npm run build` compiles TypeScript into `dist/`.
- `npm run typecheck` checks TypeScript without emitting files.

## Run Artifacts

Each run writes:

- `runs/<timestamp>-<spec>/workspace`
- `runs/<timestamp>-<spec>/prompts`
- `runs/<timestamp>-<spec>/logs`
- `runs/<timestamp>-<spec>/reports/report.json`
- `runs/harness.log.jsonl`
- `runs/harness-notes.md`
