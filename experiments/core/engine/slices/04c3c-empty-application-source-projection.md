# Empty Application evidence has no serving table

Status: **Bounded publisher correction and native witnesses implemented;
wider Standard cutover remains open**. Independent current-core,
accepted-direction and pinned-Convex challenge and peer exchange preceded edits.
The genuine [source CMS witness](./04c3b-source-cms-relation-maintenance.md)
exposes this prerequisite before native business execution.

Source checkpoint: `dde48c281` plus uncommitted 04C3/04C3B work.
Convex pin: `84fbb0e70b4e857913673871cb847ad11a55f3d5`.

## Source findings and selected correction

When Payload owns all authored tables, `prepareApplicationLogicalSource` retains
the exact Application manifest/analysis evidence but produces an empty Application
document source. Canonical candidate validation permits zero tables and zero
bindings. V3 ownership admission still requires and verifies this source. Removing
it or inventing an unrelated fixture table would conceal the actual defect.

`publishLogicalReadMetadata` currently requires every non-view source to choose a
default serving table. That assumption contradicts the admitted empty carrier.
Its runtime consumers admit native Payload/Medusa serving profiles; Application
function, commit, ownership and finite source-policy evidence use the full
canonical candidate independently.

The independent challenges rejected a broad zero-binding skip: Payload evidence
validation occurs later in this publisher, so that change could bypass native
policy refusals. The selected guard omits projection inserts only when all are true:

- Owner is `application`, write profile is `application.occ`, definition kind is
  `documents`.
- Bindings, declared tables, indexes, unique constraints and relations are empty.

Preserve the existing all-view branch separately. Keep every other default-table,
native evidence, malformed definition/binding and stored-data refusal. Do not
invent a default table or empty successful read capability.

Candidate/admission owners already authenticate source identity and complete
evidence. No V3-only decoder or duplicate source-key/manifest validation belongs in
this derived projection. One challenger proposed the generator's fixed key as an
extra guard; the coordinator selects the semantic owner/profile/empty-storage
shape because the existing immutable source identity is already authenticated.
This does not admit arbitrary empty native profiles.

## Convex reference and boundaries

Pinned Convex accepts an empty schema table map, persists/reuses schema metadata
independently of table creation, and iterates actual declared indexes. Inspect
[schema JSON](../../../../../../crates/common/src/schemas/json.rs),
[schema submission](../../../../../../crates/database/src/bootstrap_model/schema/mod.rs)
and [index preparation](../../../../../../crates/database/src/bootstrap_model/index.rs).
This supports separating metadata evidence from owned storage; it is not a direct
Convex equivalent of Flarex's per-source native read projection. The exact
[divergence](../divergences/empty-application-source-projection.md) records that
representation difference.

The correction belongs only in the logical read-metadata publication owner.
Canonical artifacts, candidates, source-policy metadata, binding admission,
function/commit authority and native read admission remain at their current
owners. No SQL transaction, publisher, runtime adapter or durable format is added.

## Required evidence and removal boundary

- The genuine all-Payload V3 source CMS witness passes while preserving the exact
  empty Application source and all canonical evidence. Only actual native serving
  roots/tables/access are projected.
- Repeated ensure/backfill is idempotent. Earlier nonempty-schema projections
  with the same source key remain intact at their separate immutable coordinates.
- Existing all-view, nonempty Application, native-policy and malformed-candidate
  controls retain their behavior. Empty native/malformed inputs must not acquire
  the new omission branch.
- Missing roots retain existing `definitionMissing`/native `sourceMismatch`;
  malformed persisted rows retain `storedCorruption`. Any protected lookup test
  must use a genuine installation, not a fabricated token or earlier refusal.
- PGlite and ordinary-role PostgreSQL owner/native proof, affected checks, both
  required reviews and cleanup remain gates.

Remove only the erroneous requirement that this authenticated empty carrier own
a default serving table. Projection omission inserts no root/child/access rows
and deletes or repurposes nothing. A contradictory existing row at an allegedly
empty immutable coordinate is corruption, not authorization to clean durable data.
