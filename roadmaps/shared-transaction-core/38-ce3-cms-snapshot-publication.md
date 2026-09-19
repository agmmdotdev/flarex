# CMS Snapshot Reads Across Publication

Status: implemented for the existing CMS host. The subsequent
[native publication cutover](./39-ce3-native-publication-snapshots.md) also permits
native publication alongside these snapshots. [Native attempt protection](./40-ce3-native-attempt-snapshots.md)
also permits session preparation and finishing while a snapshot stays open. Commerce publication
hosts retain strong exclusion; general concurrent writers and CE3 remain open.

## Contract And Owners

Allow standalone CMS reads to overlap ordinary CMS publication while retaining
one coherent PostgreSQL snapshot. Use the existing physical transaction owner,
session, admission, materialization and publisher. The preceding clock witnesses
and active-readiness lock correction are prerequisites, not this behavior.

The physical initial-transaction input explicitly selects read committed or
repeatable read before any budget/configuration query. The relational session
names two trusted profiles: `command` and `snapshotRead`. Every issuer and caller
must select/forward that profile; no implicit compatibility default is retained.
Control transactions select read committed; recovery behavior stays unchanged.
PGlite test composition applies the same isolation selection before its callback.

CMS `read` selects the snapshot profile and locks the scope clock `FOR KEY SHARE`.
CMS keyed execution retains read committed and selects `FOR NO KEY UPDATE` for
ordinary publication. Nested reads borrow the enclosing command, including its
pending changes. The framework receives a read-only data capability, not SQL
`READ ONLY`, which would prohibit the admission locks.

The strong lifecycle clock helper remains unchanged. Authorization revocation,
retained-history movement and lifecycle changes remain exclusive. Other existing
commerce publication hosts retain their current stronger protection pending their own
connected cutover; they still exclude these readers safely. No parallel writer
execution, sequence reassignment or additional authority is introduced.

## Fresh Admission And Failure

Connected execution exposed three nested acquisitions that also belong to core:
stored-active candidate receipt restoration now consumes its caller's protected
clock; its standalone preparation caller still acquires its own shared lock.
Authorization-epoch reads use key share, relying on the unchanged revocation
owner's mandatory strong lock before updating that epoch. This also permits a
current epoch lookup during ordinary sequence publication. Relation edge
lowering takes publication protection rather than upgrading to a lifecycle lock;
it changes edges/adjacency, not clock authority. Native and lifecycle callers
that already hold stronger protection retain it. These are direct owner fixes,
not adapter bypasses.

Repeatable read can precede a lifecycle commit. Clock-row changes protected by
strong transitions reject stale locking reads, as the clock witnesses establish.
For other-row transitions, the clock lock alone is insufficient. Active head,
revision, stored readiness, physical/unique readiness and installation head
validation retain their row protection. Replace the binding repository's boolean
lock input with explicit `none`, `share`, `update`; CMS admission uses `share` so
binding replacement cannot silently authenticate an old head from its snapshot.
Binding lifecycle writers retain their strong scope lock and update head lock.

No command callback is automatically retried after serialization refusal.
Keep the original typed cause and physical rollback/cleanup; uncertain keyed
publication remains recovery-only through the existing request owner.

## Breaking Changes And Cleanup

The private physical/session input and binding-head lock selector change. Migrate
all control/data callers and test issuers, including existing adapter fixtures;
this does not add Medusa integration. Remove the displaced CMS read/share and
write/update selection. Keep strong helpers for their named remaining lifecycle
and publication consumers. No data/schema/codec migration or reset is required.

## Completion Gates

Prove actual same-scope reads finish while a CMS publication is held; a held read
must retain its original document and incoming-relation observations when a
concurrent publication commits. Fresh reads observe the commit. Verify nested
pending reads, binding/authority races, lifecycle exclusion, refusal without
callback retry, physical deadline/cleanup and keyed replay. Keep the existing
same-scope writer serialization and cross-scope publication witnesses.

Run focused PGlite and ordinary-role PostgreSQL regressions, affected package
typechecks, lint and both read-only reviews; migrate stale tests/docs rather than
retain the old exclusion contract. Stop owned resources and commit only after
the connected proof passes. This does not establish general scale or finish CE3.
