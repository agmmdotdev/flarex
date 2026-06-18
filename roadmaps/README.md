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

Each domain roadmap owns its own concise implementation checkpoint history,
including the previous completed checkpoint's commit ID and title. Do not
create a global chronological implementation log or combine all project
history into one giant file. After verification, create and report an
automatic checkpoint commit.

Start with:

- [01-backend-data-model-and-do-shape.md](./01-backend-data-model-and-do-shape.md)
- [02-schema-placement-and-shards.md](./02-schema-placement-and-shards.md)
- [03-occ-and-transactions.md](./03-occ-and-transactions.md)
- [04-indexes.md](./04-indexes.md)
- [05-sync-and-subscriptions.md](./05-sync-and-subscriptions.md)
- [05-sync-protocol-implementation.md](./05-sync-protocol-implementation.md)
- [06-dynamic-worker-execution.md](./06-dynamic-worker-execution.md)
- [07-cross-shard-workflows.md](./07-cross-shard-workflows.md)
- [08-projections.md](./08-projections.md)
- [09-sdk-and-cli-fork.md](./09-sdk-and-cli-fork.md)
- [10-runtime-validation.md](./10-runtime-validation.md)
- [11-testing-and-simulation-strategy.md](./11-testing-and-simulation-strategy.md)
- [12-repository-operations.md](./12-repository-operations.md)
- [13-convex-first-system-porting.md](./13-convex-first-system-porting.md)
- [14-local-dev-server.md](./14-local-dev-server.md)
- [15-test-sdk.md](./15-test-sdk.md)
- [16-package-boundaries.md](./16-package-boundaries.md)
- [17-deployment-analysis-and-push.md](./17-deployment-analysis-and-push.md)
- [18-react-client-hooks.md](./18-react-client-hooks.md)
