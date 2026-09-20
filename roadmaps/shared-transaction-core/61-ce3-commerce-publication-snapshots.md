# Commerce Snapshots And Ordinary Publication

Status: snapshot and ordinary publication cutover implemented with connected
validation and review complete. Broader CE3 acceptance remains open.
The [admission cutover](./66-commerce-admission-before-execution.md) subsequently
moves metadata checks ahead of protected command execution and includes the
existing composite owner.

## Outcome And Evidence

Migrate the existing commerce read API from command isolation plus publication
exclusion to the shared repeatable-read snapshot profile and key-share scope
protection. Ordinary standalone and atomic-commerce writes use no-key-update
scope protection for business execution and publication, retaining writer
serialization after concurrent metadata admission. This is
an execution-contract correction at existing core owners, not a new Medusa
module, workflow, storage or public API capability.

The initial proposed CMS/commerce overlap witness exposed a capability boundary:
standalone CMS admission refuses bindings containing commerce without the
separately admitted composite context. Do not weaken that gate for this proof.
Use the actual commerce read API and existing installation/binding admission.
Mixed CMS/commerce reads and cross-domain composition keep their own gates.

## Authority And Breaking Contract

`commerceTransaction/host.ts` selects the existing `snapshotRead` physical profile
and snapshot clock helper for reads. Normal writes and atomic root publication
enter lifecycle protection for metadata and then the explicit commerce publication
gate. Bootstrap retains the strong clock lock: its
initialization marker changes installation eligibility. Scope transitions,
bindings, revocation and retention retain their existing strong locks.

The intentional private scheduling break removes publication exclusion from
commerce reads. A read keeps one PostgreSQL snapshot through all statements,
including size probes and rows not previously queried. It does not see a write
that commits midway through that request. Later requests see completed writes.
The read-only capability remains enforced by the bounded lifetime and store;
PostgreSQL READ ONLY would incorrectly prohibit the required admission locks.

Repeatable-read acceptance must lock the data-binding head with `FOR SHARE`.
The old unlocked head lookup is safe only under the old command/exclusion
contract: after snapshot formation, a binding transition can finish before the
scope lock without changing the scope tuple. Locking the head detects that stale
snapshot instead of admitting revoked profile membership. Existing shared
installation and Application locks retain their fresh checks. A changed scope
tuple similarly refuses stale snapshots after revocation. Do not retry callbacks
or refresh/bless changed evidence inside the same transaction.

Atomic participants borrow the root clock and cannot settle independently.
Business DML, dense commit order, facts/outcomes/wakes, rollback-only behavior and
uncertain-COMMIT recovery keep their existing owners. No new lock service,
transaction API, schema, codec, data migration or fallback is needed. Remove the
old read/exclusive-write selections and unlocked accepting head lookup, retaining
the explicitly named bootstrap profile. Concurrent writers and publication-last
sequencing remain open.

## Completion Gates

Before cutover, reproduce blocked real commerce reads/writes. After cutover,
ordinary-role PostgreSQL must prove reader-first and publisher-first overlap for
standalone and atomic writes with real DML and admission. Hold publication after
all durable atoms but before physical COMMIT; rows and prefixes remain invisible.
Read a previously unqueried row after a concurrent commit to prove the snapshot.
Verify one dense outcome/fact/wake, exact replay without callback reexecution,
blocked competing writers and strong transition exclusion. Force binding and
revocation changes after snapshot formation but before admission; reject before
the read callback, and refuse fresh requests under revoked authority.

Run affected PGlite and ordinary-role PostgreSQL admission, atomic rollback,
cancellation/recovery and snapshot regressions, types/lint and both read-only
reviews. Release barriers and stop owned resources, reconcile roadmaps and commit.
PGlite is not concurrency proof; these bounded tests are not throughput, hosted
deployment, new integration or complete CE3 acceptance.
