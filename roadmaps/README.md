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

For the accepted FlarexDB schema/compiler/sync/Payload/Medusa architecture
boundary, start with
[`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md).
Roadmaps 20, 21, and 35 record the corresponding executor and sync checkpoints;
older cache or mixed-transaction text is not authoritative when it conflicts
with that decision record.

For the low-level turn-by-turn implementation order, use
[`flarexdb-foundation/README.md`](./flarexdb-foundation/README.md). It links the
separate schema/migration, OCC/transaction, and commit-compiler plans and keeps
Payload, Medusa, sync, caches, and high-level APIs outside the first proof.

Start with:

- [01-backend-data-model-and-do-shape.md](./01-backend-data-model-and-do-shape.md)
- [02-schema-placement-and-shards.md](./02-schema-placement-and-shards.md) (legacy partition/shard prototype; current proposed design uses internal `scope_id`)
- [03-occ-and-transactions.md](./03-occ-and-transactions.md)
- [04-indexes.md](./04-indexes.md)
- [05-sync-and-subscriptions.md](./05-sync-and-subscriptions.md)
- [05-sync-protocol-implementation.md](./05-sync-protocol-implementation.md)
- [06-dynamic-worker-execution.md](./06-dynamic-worker-execution.md)
- [07-cross-shard-workflows.md](./07-cross-shard-workflows.md) (legacy partition/shard prototype)
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
- [19-function-routing-and-shard-policy.md](./19-function-routing-and-shard-policy.md) (legacy partition/shard prototype)
- [20-postgres-executor.md](./20-postgres-executor.md)
- [21-cloudflare-freshness-cache.md](./21-cloudflare-freshness-cache.md)
- [22-effect-migration-checklist.md](./22-effect-migration-checklist.md)
- [23-hosted-runtime-core.md](./23-hosted-runtime-core.md)
- [24-shared-artifact-runtime-host-kit.md](./24-shared-artifact-runtime-host-kit.md)
- [25-shared-artifact-runtime-host-kit-goals.md](./25-shared-artifact-runtime-host-kit-goals.md)
- [26-execution-artifact-lifecycle-parity.md](./26-execution-artifact-lifecycle-parity.md)
- [27-execution-artifact-lifecycle-parity-goals.md](./27-execution-artifact-lifecycle-parity-goals.md)
- [28-authoritative-analysis-effect-quality.md](./28-authoritative-analysis-effect-quality.md)
- [29-authoritative-analysis-effect-quality-goals.md](./29-authoritative-analysis-effect-quality-goals.md)
- [31-hosted-project-identity-and-auth.md](./31-hosted-project-identity-and-auth.md)
- [32-hosted-project-identity-and-auth-goals.md](./32-hosted-project-identity-and-auth-goals.md)
- [35-commit-compiler-and-session-intent.md](./35-commit-compiler-and-session-intent.md)
- [flarexdb-foundation/README.md](./flarexdb-foundation/README.md)
