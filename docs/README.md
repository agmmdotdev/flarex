# Historical Prototype Architecture

Status: superseded first-design archive. These documents are retained for
provenance and useful semantic examples; they do not define the accepted target
architecture or current implementation order.

Much of this directory describes the original `PartitionDO`/Durable Object
SQLite authority, explicit application partitions, projections, and
cross-partition Workflow mutations. That app-data architecture was an unshipped
prototype and is being replaced, not promoted into the target through permanent
compatibility layers.

Use the current sources of truth instead:

1. [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
   for accepted architecture, trust boundaries, and replacement rules.
2. [`../design-notes/flarex-commerce-cms-v1-schema-cutline.md`](../design-notes/flarex-commerce-cms-v1-schema-cutline.md)
   for the minimal v1 inventory and explicit deferrals.
3. [`../roadmaps/flarexdb-foundation/README.md`](../roadmaps/flarexdb-foundation/README.md)
   for active implementation order and correctness gates.
4. [`../roadmaps/20-postgres-executor.md`](../roadmaps/20-postgres-executor.md)
   and [`../roadmaps/21-cloudflare-freshness-cache.md`](../roadmaps/21-cloudflare-freshness-cache.md)
   for executor and sync direction.
5. [`../roadmaps/README.md`](../roadmaps/README.md) for the maintained domain
   index.

When reading `01` through `13`, classify each claim as historical provenance,
a still-intended developer semantic to port and test, or obsolete physical and
runtime design to remove. A historical filename or working prototype does not
override the accepted design. Use Git when chronological detail is needed.
