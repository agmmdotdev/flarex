# Flarex Roadmaps

This folder contains living, domain-specific sources of truth for Flarex's
architecture, rationale, current status, known gaps, target direction, and next
correctness gates. Keep each file focused. Use
[`_domain-template.md`](./_domain-template.md) when creating or compacting a
domain roadmap.

Roadmaps do not replace more precise authorities:

- code, schemas, and tests own exact implemented behavior;
- accepted design notes own cross-domain architecture according to the
  precedence in [`../AGENTS.md`](../AGENTS.md); and
- Git commits and pull requests own chronological implementation history and
  verification receipts.

Update a roadmap when a durable domain fact changes: scope or ownership,
architecture or invariants, rationale, Convex compatibility, implemented
capability status, known gaps, target direction, sequencing, or correctness
gates. A code touch by itself is not a reason to update a roadmap.

Do not add commit IDs, commit messages, per-turn change summaries, reviewer
receipts, verification command receipts, or chronological checkpoint sections
to living roadmaps. Existing accumulated checkpoint sections are migration
inputs to be compacted domain by domain; do not extend them. Older instructions
inside individual roadmap files to append checkpoint details are superseded by
this policy.

When roadmap text and implementation differ, investigate before editing either
one. Decide whether the implementation drifted from accepted design or new
evidence changed the accepted direction. Fix accidental implementation drift;
update stale roadmap truth when the direction genuinely changed. Never make a
roadmap match code merely to legitimize an unreviewed divergence.

For the accepted FlarexDB schema/compiler/sync/Payload/Medusa architecture
boundary, start with
[`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md).
Roadmaps 20, 21, and 35 own the corresponding executor, sync/cache, and commit
compiler domain truth; older cache or mixed-transaction text is not
authoritative when it conflicts with that decision record.

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
