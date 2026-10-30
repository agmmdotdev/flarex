# Application relation maintenance for the joint native publisher

Status: **Implemented for the supported private joint writer. Historical
coverage, maintained readiness and complete-flow performance remain open**. The
[bounded slice](../slices/04c3e-cross-domain-relation-maintenance.md) owns the
executing closure and proof gates.

## Pinned mechanism

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`,
[index enumeration](../../../../../../crates/indexing/src/index_registry.rs)
and [transaction index updates](../../../../../../crates/database/src/transaction_index.rs)
maintain every registered database index, including pending indexes, in the
ordinary row transaction. [Writer metadata dependencies](../../../../../../crates/database/src/writes.rs)
fence a writer that began before registration. Atomic maintenance establishes
induction after the original build frontier, not a new historical timestamp.

## Why and how Flarex differs

Convex [ID validation](../../../../../../crates/common/src/schemas/validator.rs)
checks encoded table identity. It supplies neither native Payload/Medusa
execution nor live target, incoming membership and delete-restriction semantics.
Flarex's existing relation owner must therefore participate in its existing
joint native transaction as well as its ordinary Application writer.

The displaced joint materializer supplied no Application relation plan. A genuine
relation-bearing Payload create could reach it without emitting the explicit
replacement/set-null intents that it refuses. Strong native reference checks
and disjoint participant table ownership are insufficient substitutes.

Reuse the completed standalone source-CMS mechanism through one complete
current-binding generation. The catalog, three source preparations and genuine
source template share original control-database and lifetime identity. At joint
close, the existing template owner authenticates the actual Payload admission;
the combined materializer consumes its complete Application relation pair.

Relation command authority uses the original Application schema ID. Every
Application, Payload and Currency table retains its own logical-source schema
through the existing per-table mapping. Keep one combined delta, lower,
publisher and outcome. No adapter SQL, native business algorithm, second
transaction or recovery mechanism is added.

Existing request-only binding capture strips retained lifetime. Copying a pair
from it, or mixing a staged pair with outer-root source preparation, would be
false provenance. A failed loan remains failure; relation-free absence still
requires its existing genuine issuer proof.

## Consumers, data and costs

Affected consumers are the supported private joint Application/Payload/Currency
command and its actual source profiles. Preserve atomic rows, indexes, facts,
outcomes, native callbacks and replay behavior. No committed data or historical
fact is rewritten. Correct future writes do not repair earlier omissions.

Costs are bounded generation preparation/accounting and existing relation
planning/target/adjacency work inside the current transaction. The overlapping
[V3/R02 native witness](../../../../packages/persistence-postgres/test/frameworks/crossDomainCommand/jointApplicationRelationsScenario.ts)
checks exact source/index/relation provenance, replay, native callback counts,
late-fault rollback and stale-binding refusal on PGlite and ordinary-role
PostgreSQL. It does not establish historical coverage or complete-flow capacity.
