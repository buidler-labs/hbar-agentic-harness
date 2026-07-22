# Local PRDs

Product requirement documents live here **on your machine only** — they are not committed to the harness repo (`docs/prds/*` is gitignored except this README).

Each YAML spec references a PRD path, for example:

```yaml
prd: docs/prds/my-template.md
```

Add your own markdown PRD before running a benchmark. The harness reads it at run time and passes the content to the **generator** agent.

The PRD describes *what to build*. For Tier 3 semantic validation, also author a separate **acceptance contract** (JSON under `contracts/`) with numbered, browser-verifiable assertions — that file, not the PRD, is what the validator agent grades against.

Full checklist + copyable stubs: [`docs/authoring-a-template.md`](../authoring-a-template.md) and [`skeletons/new-template/`](../../skeletons/new-template/).
