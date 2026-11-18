# CE1 Bounded Intrinsic Membership Preparation

Status: intrinsic membership preparation is implemented in the shared materializer
under standing owner approval. [Row batching](./15-ce1-row-batch-application.md)
subsequently replaces the scalar row writer; [index batching](./16-ce1-index-batch-application.md)
replaces the scalar index writer. Unique write batching is open.

## Decision And Boundary

Prepare the complete admitted intrinsic-index transition set before row writes
in `applicationDocumentMaterialization/materialization.ts`. Reuse
`readAppIndexMembershipHeadsInTransactionEffect`, which authenticates each
definition once per call and reads positions in groups of 32. Native publication
and the existing CMS participant both call this materializer. No Medusa
integration or new consumer capability is introduced.

The displaced intrinsic lowering invoked that reader once per changed row. Developer
index planning already uses its multi-position form. The CE0 source trace and
native per-phase baseline identify per-row materialization work; the matched
publication-persistence reference establishes that shared fact publication is
already batched. Repeating complete-request benchmark construction is not a
prerequisite for this owner-local correction with direct before/after evidence.
Broader CE0 attribution/reference acceptance remains open and cannot be claimed
from these results. This refines sequencing to allow this measured CE1 component
alongside remaining CE0 work, without authorizing a changed commit protocol.

## Contract And Alternatives

Prepare row inputs once, derive intrinsic positions, load authenticated membership
heads as a bounded set, validate transitions, then apply the original row/index
write sequence. Keep existing scope/index locks and the same final transaction.
No asynchronous parallel SQL, new cache, registry, codec, transaction or index
readiness authority is needed. Reusing per-row reads through another wrapper
would preserve the measured defect and is rejected.

Retain insert/delete membership, enabled versus building-index handling,
unchanged-key omission and returned-document dependencies. Definition, key,
digest, latest-history and exact-current-pointer checks remain with the existing
reader. Ordinal/cardinality validation remains mandatory. Existing write owners
still validate and apply each membership transition; batching those writes is
subsequent CE1 work. Batch-read state stays transaction-local under the original
locks, and does not grant write authority.

## Breaking Changes And Cleanup

The private failure/observation order changes: row preparation and intrinsic
head validation for the whole admitted set occur before any tentative row write.
A corrupt later membership therefore rejects before earlier rows reach their
write hooks. Failure categories and rollback semantics remain; no per-row hook
may be used as authority. Update affected tests to prove this explicit boundary.
Successful tentative-row/index-write hooks retain their existing order and count.
Private `intrinsicMembershipPreparing` and `intrinsicMembershipPrepared` proof
steps bracket the bounded reads; their interval does not include subsequent
row/index writes or COMMIT. Both private step unions and their tests move together.

Delete the old per-row intrinsic read/plan/write function and redundant combined
row preparation/write helper. This preparation slice retained scalar row/index
persistence owners as active writers. The subsequent row-batching slice replaces
the prepared scalar row API and changes row/index hook ordering; index batching
then replaces the scalar index API at its existing owner. No public API, DDL, data
migration, durable format or framework adapter change is needed.

## Proof And Completion

Exercise multi-row insert, mixed insert/delete, unchanged-body-index membership,
corrupt later membership, multiple logical tables and no intrinsic definitions.
Check exact row/index histories, complete rollback and replay. Run PGlite and
ordinary-role PostgreSQL owner and native/CMS consumer witnesses. Retain same-scope
contention and independent-scope progress tests; no increased concurrency claim.

Measure native publication at the same 1/8/32/128-row workload before/after the
change. Report query counts and timings separately; do not claim production
throughput or a full-reference ratio. Planning membership reads should follow
32-position batches and distinct definitions, rather than one lookup per row.
The still-scalar write owner's own checks remain a visible cost.

Require affected typechecks, lint, both project reviewers and reruns, removal
searches, roadmap reconciliation and a scoped commit. This is one CE1 component,
not completion of row/index/unique batch application or overall CE0/CE1.
