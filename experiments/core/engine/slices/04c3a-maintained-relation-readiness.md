# Maintained relation readiness for a new revision

Status: **Independent current-core, pinned-Convex and accepted-direction challenge
and peer exchange complete; connected prerequisites identified; runtime replacement
not started**. This is a prerequisite of
[ordinary Standard execution](./04c3-standard-finite-execution.md), not completion
of that cutover. Replication remains deferred.

Flarex source checkpoint: `dde48c281`, with the uncommitted 04C3 replacement.
Convex pin: `84fbb0e70b4e857913673871cb847ad11a55f3d5`.

## Problem and source challenge

An app has a serving relation schema A and its physical receipt at frontier S.
Business writes advance the app to T while maintaining that relation. Deploying
a new function revision with the same immutable schema currently requires a
physical receipt at T. Rebuilding its serving sidecar is correctly forbidden.
Neither forging a newer receipt frontier nor relaxing every readiness comparison
is an acceptable fix.

The independent challenges converged on these distinctions:

| Responsibility | Pinned mechanism and Flarex disposition |
| --- | --- |
| Unchanged current schema | Convex reuses the exact currently active schema document. Flarex may derive a new revision's readiness from its exact currently serving immutable relation schema only after proving maintained coverage. |
| Current index eligibility | Convex separately compares actual current index metadata, retaining identical enabled physical identities. Keep all ordinary-index, unique, candidate, ownership and execution-authority checks; active-schema equality does not replace them. |
| Maintenance after the original receipt | Convex applies document/index/schema-registry updates atomically for every relevant write. Prove the equivalent supported-writer closure before deriving maintained relation evidence. |
| Historical A after B | Convex does not resurrect overwritten schema validity. Flarex rollback must freshly validate A against current data; A's historical semantic receipt is insufficient. |
| Current physical identity | Authenticate enabled attempt, fence, physical specification, digest, storage generation and epoch. Historical receipt lineage and an active head alone are insufficient. |
| Final activation | Rederive or revalidate the genuine serving reference under the final scope lock and activation CAS. A borrowed reference must not regain validity through active-root ABA. |

Pinned owners are [schema submission](../../../../../../crates/database/src/bootstrap_model/schema/mod.rs),
[index preparation](../../../../../../crates/database/src/bootstrap_model/index.rs),
[document/index application](../../../../../../crates/database/src/transaction.rs),
[index updates](../../../../../../crates/indexing/src/index_registry.rs),
[backfill](../../../../../../crates/database/src/database_index_workers/mod.rs),
and their executing [deployment caller](../../../../../../crates/application/src/deploy_config.rs).
The inspected source is at the pin; this is not an upstream runtime-test claim.
Convex's ID validator does not enforce our live foreign-row/adjacency semantics;
the necessary difference belongs in the
[mechanism record](../divergences/maintained-relation-readiness.md).

## Existing owners and truthful representation

[Serving inspection](../../../../packages/persistence-postgres/src/application/relations/applicationRelationServing.ts)
authenticates a coherent current active root and canonical dense child set.
[Readiness](../../../../packages/persistence-postgres/src/application/relations/readiness/Repository.ts)
authenticates historical receipt lineage.
[Current physical projection validation](../../../../packages/persistence-postgres/src/application/relations/build/Repository.ts)
separately checks the enabled exact physical attempt and authority.
These checks have different responsibilities and must be composed by their
existing owners.

The [fold](../../../../packages/persistence-postgres/src/application/relations/applicationRelationReadinessFold.ts)
already persists an independent `relationFrontierCommitSeq`. Child replay
authenticates the physical child at that exact relation frontier. A new parent
must not claim T while retaining a child certified at S. A private maintained
serving reference can preserve the truthful historical relation frontier while
deriving the new target revision's canonical manifest/binding correlation.
Historical-frontier acceptance must require that genuine owner-issued reference;
it must not become a global `frontier <= current` rule. Existing persisted replay
and new-target canonical correlation still require connected proof. A durable
format change is not yet demonstrated necessary for this same-current case.

## Writer closure prerequisite

Application publication derives relation transitions from all merged row intents
and atomically applies rows, edges and adjacency. This includes native effects
merged into an Application finite root. Full-proof CMS publication also supplies
the genuine Application relation pair.

Source-bound standalone CMS publication is a distinct executing path. Its source
template currently passes `relations: null` and directly publishes its lowered
delta. V3 Payload admission intentionally permits ownership of the same bound
Application relation endpoint tables, so namespace or profile labels cannot prove
disjointness. Its native-reference protocol does not by itself maintain the
Application relation sidecars. Trusted serving composition already provides the
genuine relation port, and the current Application binding can lend the exact
definitions. The connected correction belongs to that core preparation and
materialization handoff, with Application and logical-source schema authorities
kept distinct. The connected [source CMS maintenance contract](./04c3b-source-cms-relation-maintenance.md) records its independent challenge and selected replacement before runtime edits.

Logical Commerce has a different exclusion proof: admitted Medusa ownership,
single qualified-table definition ownership, retained-history ownership checks,
the V3 Application/Payload-only exception, and current exact Application binding
correlation together prevent taking these Application endpoint identities.
Preserve those gates; a namespace label alone is not an exclusion proof.

## Rollback prerequisite

Original A may have immutable evolution `create`. After A -> B, calling the
existing semantic `advance(A)` does not validate it anew: the current semantic
state/receipt protocol only admits immutable `preserve + reuse` origins and
rejects an origin equal to the target schema. Changing A's immutable plan or
reusing its old semantic receipt would be false evidence.

The existing semantic-page kernel can scan a genuine target definition set
against a current fixed frontier and physical projection without rewriting
sidecars. The remaining contract must distinguish fresh serving revalidation
from immutable evolution, bind progress and completion to the target A and
observed current serving head/physical attempt, and retain bounded lifecycle,
concurrent-write and final-acceptance rules. Its provenance/receipt representation
is still open. Do not substitute historical pointer reversal.

## Required connected evidence

- A new revision with the exact current schema after source insert/update/delete
  and target restrictions, including business writes between settle and activation.
- Changed semantics with the same physical index use current semantic validation.
  A -> B -> A validates current data, including data B accepts and A rejects.
- Actual standalone V3 Payload writes maintain incoming relation results and
  target-delete restrictions; a mixed Application-root control remains covered.
- Missing or mismatched active roots, dense children, receipt lineage, physical
  attempts, fences, generations, epochs, target/control composition and copied
  capabilities refuse through their existing owners.
- Activation races and active-root ABA cannot revive a borrowed reference.
  Receipt retention, cold reconstruction and stored-active replay stay valid.
- PGlite and ordinary-role PostgreSQL owner/consumer proof, affected checks,
  both read-only reviews, cleanup and a scoped commit remain required.

The unchanged-serving optimization is not enabled until writer closure and the
truthful representation are proven. The current physical builder and unrelated
readiness/admission gates remain strict. This record does not contract supported
Payload behavior or select a permanent exclusion in place of its repair.
