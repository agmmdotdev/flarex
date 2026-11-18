# Strong-reference settlement core

Status: the common publisher enforces current and relational soft-delete
strong references through an authenticated activation projection. Application
and Payload source admission is open for this supported candidate. Additional
framework and failure-mode proofs remain gates below; draft/version visibility
is outside this profile.

## Trigger and owner

The admitted logical candidate can name a cross-source `strongReference` and
install a complete reverse index. A check in the composite command or Medusa adapter is
insufficient: ordinary Application point commits, Application-backed CMS
commits, source-bound Payload commits and Medusa commits have distinct semantic
participants. They converge at scope publication, after acquiring the scope's
ordinary-write exclusion and before advancing the authoritative commit clock.
The shared persistence/publication owner enforces the relationship for every
writer before advancing the commit clock.

## Selected contract

The executable cutover breaks the private logical candidate to definition
version 2. Each extension declares `current` or `softDeleteNull(field)` for
both endpoints. Core candidate validation matches that declaration to the
owner's document table or relational soft-delete capability; it cannot be a
caller-selected override of Product's `deleted_at` semantics. Retained version-1
candidate history blocks version-2 admission in `requireRetainedOwners` until
an explicit disposable-development reset or approved offline artifact
conversion. In-place re-admission over that history is not available. This
slice does not reset or delete its artifacts or rows. A Payload collection
with drafts/versions needs its publication visibility proven separately before
its source is opened; a current document row alone is not that proof.

Activation binds a compact, authenticated endpoint table set to the active
logical schema head. The common publisher reads that head without reopening and
hashing the full installation artifact on each request. For a head with reference
endpoints, it checks the actual finished publication facts, including Medusa's
streamed row pages, by indexed commit identity before advancing the clock. The
head uses an exact version-2 encoding. A touched endpoint enters the shared
final-state validator, which reads the complete authenticated row-fact prefix
and transaction-local current rows. The publisher maintains the reverse index
for native Application writes and uses it for bounded incoming checks. Missing
targets and target deletion while live sources remain abort settlement. An
unrelated Currency write uses the head and bounded fact probe without loading
the full relationship projection.

An Application-declared index can share the reverse definition. The final-state
validator accepts that index only when its active maintenance evidence matches
the selected schema and its pending entries match final source rows. Native
materialization then owns coverage; source-bound reverse indexes still advance
their explicit frontier. The mixed Application/Payload/Currency witness is
recorded in [mixed-source publication](./55-mixed-source-reference-publication.md).

Connected PGlite and ordinary-role PostgreSQL witnesses cover standalone
Application source insertion, Payload source insertion, Product soft deletion,
source detachment, cross-deployment scope refusal, and a concurrent
insert/delete race. Same-deployment multi-scope identity remains a separate
isolation gate.
The [Medusa-origin witness](./54-medusa-origin-document-reference.md) adds a
native Product source pointing to an Application document ID, Application
target-delete restriction, soft-delete release and failed restore. These paths
also show missing-target rollback, Product replay and unrelated Currency
publication.

For an executable touched endpoint, the implementation reads an authenticated
reference projection from the target database under the same scope lock, checks
current build coverage,
and validates the final transaction-local rows after all participants have
lowered their pages but before the clock advances. The validation must consider
both directions: a new or changed source points to one live target, and a
deleted or rekeyed target has no remaining live source. The final-state check
allows parent and child writes in either order within one settlement. The
derived reverse index is required for bounded incoming checks; a scan over all
rows or shops is not an alternative.

The control database owns the logical schema artifact and stable definition
catalog, while the publisher owns one target-database transaction. It cannot
open a second control-database read inside that settlement and call the result
atomic. Activation must therefore copy the bounded reference policy and its
selected stable table/index/unique identities into an authenticated target-side
activation projection. The head retains only endpoint membership for the fast
unaffected-write check. Touched writes read the activation projection and
verify its digest/head binding in the same target transaction. This replaces
the earlier assumption that the publisher can resolve the control candidate
under its scope lock; no framework adapter may supply the projection at write
time.

Activation compares the proposed policy with the authenticated current policy
under the scope lock. An unchanged enforced reference inherits its invariant.
A new or changed reference is refused if its source table has any current rows,
using a bounded existence probe. Populated-source activation needs a later
resumable validation certificate; a full scan while holding the scope lock is
not acceptable. This preserves existing data and prevents invalid preexisting
sources from silently acquiring an active reference.

The generic unique-slot reader previously required an owner revision published
through the old scope clock. The publication-only reader accepts a pending
pointer only with its matching immutable row fact. Target lookup and source
reverse selection reuse generic unique/index owners and bounded resource
contracts. Parent/child ordering within one settlement and additional source
profiles still need connected proof; no adapter may bypass the shared check.

The current candidate permits only `restrict` on target deletion. Runtime
enforces relational `softDeleteNull` target liveness. Payload draft/version
publication visibility remains unproved and those profiles stay closed. A
soft-deleted Product is not a live target, and a Payload draft must not be
treated as published. Native Medusa stored Links retain their separate
cardinality and endpoint-existence policy.

The active-head endpoint projection is derived only from the authenticated
candidate during activation. Existing version-1 heads without that projection
cannot serve or be activated again through the version-2 reader. They require
an explicit disposable-development reset or an approved offline conversion of
the retained head/candidate artifacts; a missing projection must not mean an empty
relationship set. They now fail closed on read; no data is deleted by this
slice. The validator and supported-source admission form one connected behavior.

## Completion proof

Further connected proof is needed for an Application-backed CMS publication,
parent and child in either order within one
settlement, target rekey, rollback after lowering, replay and uncertain COMMIT.
The populated-source activation path needs a resumable validation certificate
before its conservative empty-table gate can be removed. Each new source or
liveness profile needs its own real writer and recovery witnesses on PGlite and
ordinary-role PostgreSQL. Keep unproved liveness profiles closed at admission;
do not infer general framework relationship support from the current candidate.
