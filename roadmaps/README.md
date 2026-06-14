# Flarex Roadmaps

This folder records domain-specific design decisions and implementation notes.
Keep each file focused. Do not turn one file into the complete project history.

Every implementation turn must update the relevant domain file with:

- what changed
- why it changed
- Convex source files inspected or used as inspiration
- how Flarex differs because it runs on Cloudflare Durable Objects
- known limitations and follow-up work
- verification commands run

Start with:

- [01-backend-data-model-and-do-shape.md](./01-backend-data-model-and-do-shape.md)
- [02-schema-placement-and-shards.md](./02-schema-placement-and-shards.md)
- [03-occ-and-transactions.md](./03-occ-and-transactions.md)
- [04-indexes.md](./04-indexes.md)
- [05-sync-and-subscriptions.md](./05-sync-and-subscriptions.md)
- [06-dynamic-worker-execution.md](./06-dynamic-worker-execution.md)
- [07-cross-shard-workflows.md](./07-cross-shard-workflows.md)
- [08-projections.md](./08-projections.md)
- [09-sdk-and-cli-fork.md](./09-sdk-and-cli-fork.md)
- [10-runtime-validation.md](./10-runtime-validation.md)
- [11-testing-and-simulation-strategy.md](./11-testing-and-simulation-strategy.md)
- [12-repository-operations.md](./12-repository-operations.md)
