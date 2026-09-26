# Strong-reference settlement core

Status: the common publication safety gate, authenticated endpoint projection
and schema-matched endpoint-liveness candidate contract are implemented.
Runtime admission remains closed until the connected
referential-enforcement proofs below pass.

## Trigger and owner

The admitted logical candidate can name a cross-source `strongReference` and
install a complete reverse index, but the current runtime has no common
referential check. A check in the composite command or Medusa adapter is
insufficient: ordinary Application point commits, Application-backed CMS
commits, source-bound Payload commits and Medusa commits have distinct semantic
participants. They converge at scope publication, after acquiring the scope's
ordinary-write exclusion and before advancing the authoritative commit clock.
The shared persistence/publication owner must enforce the relationship for
every writer. Source admission must remain closed until that is true.

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
head uses an exact version-2 encoding. An endpoint write now fails as an
unsupported profile, including a standalone point commit. Source
admission still refuses affected framework hosts. This closes the writer bypass
without claiming the reference executable. The first connected PGlite and
ordinary-role PostgreSQL witnesses use an Application/Payload-to-Product
candidate, record Product endpoint membership, roll back a real standalone
Application `users:create` point commit, and preserve unrelated native Currency
publication. The Currency witness checks its actual streamed Medusa publication
facts and the observed head/fact queries. The affected Product host remains
closed at source admission until full runtime enforcement is implemented.

For an executable touched endpoint, the next implementation resolves the active candidate and stable
table/index identities under the same scope lock, checks current build coverage,
and validates the final transaction-local rows after all participants have
lowered their pages but before the clock advances. The validation must consider
both directions: a new or changed source points to one live target, and a
deleted or rekeyed target has no remaining live source. The final-state check
allows parent and child writes in either order within one settlement. The
derived reverse index is required for bounded incoming checks; a scan over all
rows or shops is not an alternative.

The generic unique-slot reader currently requires an owner revision to be
published through the old scope clock. It therefore cannot resolve a target
created earlier in the *same* settlement before clock advancement. The core
must add a transaction-local final-state resolution path, authenticated by the
selected candidate and new commit facts, rather than rejecting child/parent
order or letting an adapter bypass the slot check. Target lookup, source reverse
selection and any relation-edge materialization must use the existing generic
index/edge owners and their bounded resource contracts. Keep the common source
refusal until source insertion, target deletion/soft deletion, same-transaction
parent/child ordering, indexed traversal and ordinary-role PostgreSQL races
are proved together for each opened profile.

The current candidate permits only `restrict` on target deletion. Runtime must
define target liveness for relational soft deletion and Payload draft/version
records before admitting those profiles. Do not silently treat a soft-deleted
Product as a live target or treat a Payload draft as published. Profiles whose
liveness semantics are not yet represented must continue to fail closed. Native
Medusa stored Links retain their separate cardinality and endpoint-existence
policy.

The active-head endpoint projection is derived only from the authenticated
candidate during activation. Existing version-1 heads without that projection
cannot serve or be activated again through the version-2 reader. They require
an explicit disposable-development reset or an approved offline conversion of
the retained head/candidate artifacts; a missing projection must not mean an empty
relationship set. They now fail closed on read; no data is deleted by this
slice. The eventual referential validator and refusal
replacement must be delivered as one connected behavior.

## Completion proof

Exercise an Application-origin and a Medusa-origin reference against real
Payload/Application/Medusa source-bound writers. Include standalone point and
CMS publication, a joint transaction with parent and child in either order,
missing target, target delete/soft delete and restore, reverse traversal,
two-shop isolation, concurrent insert/delete on ordinary-role PostgreSQL,
rollback after lowering, replay and uncertain COMMIT. Verify that unrelated
Currency can still publish in a candidate with relationships. Run both PGlite
and ordinary-role PostgreSQL, affected typechecks and lint, source guards and
both read-only reviews. Only then remove the common source-admission refusal
for the enforced policies and commit the coherent cutover.
