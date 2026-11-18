# Legacy Namespace Admission Counterexample

Status: **verified current-owner gap; target correction not selected**.
This is input to [translated-core Task integration](../slices/04-translated-core-integration.md),
not approval to preserve the legacy physical model or add a Task installer.

## Expected And Actual

Expected: requesting fresh logical storage cannot hide retained legacy data or
race a legitimate legacy writer into a different storage generation.

Actual: `documents`, `indexes` and related legacy evidence use `deployment_id`
without a deployment foreign key. In the preserved uncommitted experiment, a
real PGlite witness with an orphan document and absent deployment metadata admits
the proposed logical provisioning option. Its deployment/scope locks do not serialize
with direct legacy revisions or the old backend commit path.

The failing orphan witness is preserved in the uncommitted changes to
[`scopeAuthorityProvisioning.test.ts`](../../../packages/persistence-postgres/test/scope/scopeAuthorityProvisioning.test.ts).
An earlier witness also established that the old initializer ignored the desired
logical generation. Correcting that field alone did not correct namespace safety.
Neither the proposed option nor its failing tests are claimed as a committed
runtime capability by this record.

## Actual Writer And Consumer Closure

- [`documents.ts`](../../../packages/persistence-postgres/src/storage/documents/documents.ts)
  inserts revisions/tombstones; the runtime facade and legacy commit call it.
- [`indexEntries.ts`](../../../packages/persistence-postgres/src/storage/indexes/indexEntries.ts)
  inserts previous-key tombstones and next-key entries; commit calls it.
- [`commits.ts`](../../../packages/persistence-postgres/src/commit/commits.ts)
  settles document/index changes, backend lease timestamp, commit/outbox and
  session finish together. Its backend `leases` row is distinct from scope,
  snapshot and Task leases. Preserve timestamp/final-fence meaning.
- [`runtimePersistence.ts`](../../../packages/persistence-postgres/src/database/runtimePersistence.ts)
  exposes direct revision insertion. The actual H05 proof seed uses it.
  Root helper exports alone do not establish a permanent public obligation.
- H05's named proof teardown deletes the lease and evidence and expects zero
  remaining proof rows. It is not a general product reset API. Any retained
  immutable namespace ownership must give that proof an explicit disposal path.

The current retained-evidence roster is seven legacy persistence families, five
invocation families, three freshness families and three live-query families.
Tombstones, completed sessions and delivered events remain evidence. Compound
write/ack/cleanup owners must not be split or acquire blind response-loss retry.

## Disposition Required

Select the translated physical/bootstrap boundary first. If actual old writers
must coexist, their real SQL and in-flight work must join the common durable
namespace owner through settlement. Metadata deletion or lease stealing cannot
reset generation. If those internals are replaced, migrate the real behavior
and named data/witnesses instead of keeping bypass APIs or old layouts by default.

A distinct immutable generation field on the old namespace row was challenged
as one possible transitional mechanism; no such column, trigger, claim function
or migration has been implemented or selected. No generic reset or legacy data
conversion is authorized. Preserve the counterexample until the actual shared
owner correction and both-driver races prove it closed.
