# Local PRDs

Product requirement documents live here **on your machine only** — they are not committed to the harness repo.

Each YAML spec references a PRD path, for example:

```yaml
prd: docs/prds/my-template.md
```

Add your own markdown PRD before running a benchmark. The harness reads it at run time and passes the content to the generator agent.
