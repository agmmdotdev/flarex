# Private scope authority for signed Application grants

Design status: **Accepted adaptation of the existing grant contract**.
Implementation status: **Implemented for the selected fresh Application path**;
actual app-DO owner readiness remains gated.
Measurement status: **Unmeasured**.

## Ownership and decision

The [fresh Application cutover](../slices/06a-application-persistence-cutover.md)
translates the existing [authorization split](../02-read-authorization.md#accepted-responsibility-split).
The accepted contract explicitly invalidates an attempt grant when authoritative
scope revocation advances. It distinguishes this from snapshot permission data
and unrelated immutable deployment/function-head movement. This record changes
the internal representation/enforcement owner, not that observable policy.

The portable engine owns private metadata and publication. The Application
profile owns signed grant correlation, credential validity and disclosure/syscall
checks. The host owns readiness and old-owner draining. Existing scopes remain
unmigrated; no durable data reset follows from this fresh-target implementation.

## Pinned Convex mechanism

Reference db914cf06e2b06ee985646611b9e12ed7a770318. The
[Application query cache](../../../../../../crates/application/src/cache/mod.rs)
tracks identity observation and validates dependency tokens at the requested
snapshot. [Transaction reads](../../../../../../crates/database/src/reads.rs)
retain exact dependencies; the [committer](../../../../../../crates/database/src/committer.rs)
checks the remaining committed suffix and accepted pending writes before
publication. Permission rows use these ordinary snapshot mechanisms.

This does not by itself implement Flarex's signed execution-capability revocation
contract across its trusted host and emitted user Worker. The normal document,
index, write-log and atomic persistence algorithms remain the translated ones.
No claim is made that every upstream authentication mechanism was absent or
that ordinary permission updates universally cancel an admitted operation.

## Current core and proposed direction challenge

The current Application grant carries program/schema/request and revocation
identity; it contains no snapshot token. Authentication/grant issuance precedes
outcome disclosure. Current-head comparisons also exist in read admission, but
accepted entry-fixed selector rules do not treat unrelated head movement as
revocation. Keeping those comparisons would preserve obsolete choreography.

Independent current-core, accepted-direction and pinned-source challenges,
followed by peer exchange, selected one trusted target for grant-correlated
claim/body/outcome state. Implementation review identified a counterexample to
using only per-function metadata: revoking another function must not leave the
scope-wide authority unchanged. An adapter-local counter or cache would create
a second owner and would not survive cold reconstruction coherently.

## Why a difference is necessary

Flarex's split trusted execution and user-Worker capability model already has
signed grant and explicit scope-withdrawal obligations. A previously valid
business snapshot cannot revive a withdrawn capability. Preserve that duty
through the translated shared storage; retaining a separate physical grant
clock or repeatedly querying the old SQL scope/head owner is unnecessary.
The smallest adaptation is private authority metadata plus profile enforcement
at its existing boundaries. Ordinary application permissions remain at S.

## Replacement mechanism and implementation

Planned executing owners: core/api.ts and core/database.ts under the existing
persistence package, and application/coreMutation.ts at the Application profile.
One private instance-bound authority record stores its epoch. Trusted maintenance
advances it monotonically through the same transaction/document/index/committer
and ordered publication owner; bootstrap/cold reopen reconstruct it from those
logs. It is not stored in a separate physical table or a workflow global.

The profile reads the ready owner's published epoch for grant issuance and
required outcome/result disclosure and admitted syscall checks. No per-hit SQL
query or adapter-local epoch cache is added. Body admission records the exact
authority dependency, so committed or accepted-pending revocation races cannot
silently settle an old grant. Normal function-head movement does not advance
scope revocation and cannot rebind a grant to a newer program/schema.

The signed expiry is also captured as an immutable commit-admission deadline.
The portable committer checks the operation Clock after acceptance waits and
immediately before adding pending writes. Expiry before admission prevents user
writes/outcome publication; expiry after admission does not undo a durable result
or permit another body. The profile still checks expiry before disclosure.
The operation-owned Worker RPC boundary transports diagnostics and that same
Clock explicitly, without broadening unrelated borrowed database runtimes.

The epoch check supplements credential/deadline, ownership and authentic signed
program checks; none is replaced by an unsigned scalar. Raw metadata writes and
commit capabilities stay trusted. Claim persistence precedes selecting the body
snapshot; the original grant does not need to be signed again for that snapshot.

## Preserved and changed guarantees

Keep grant withdrawal, authentication-before-replay disclosure, exact signed
program/schema and profile-owned failure/replay behavior. Keep snapshot access
rules, exact dependencies, PostgreSQL authority and singular publication.
Physical scope-clock/head rereads are replaced for the selected target only.
There is no new policy making ordinary permission changes strong revocation.

A persistence lease fences writes but does not notify an old RAM reader of
ownership loss. The first trusted-host proof closes its old instance before
reopen. Full asynchronous owner loss, read admission, revocation publication and
drain races need the actual app-DO lifecycle proof before host activation.

Immutable program/manifest identity and the active database validator are distinct.
Each body attempt uses and tracks its snapshot's active table/index metadata;
retaining the signed program does not retain obsolete write validation.

## Required witnesses and remaining limits

Prove pre-body revocation, revocation while a body is paused, refusal before
protected result/outcome disclosure, acceptance conflict against a pending
revocation and cold epoch reconstruction. Benign head movement is a separate
control: existing exact program/schema stays pinned and new calls see new head.
Retain the controlled pre-admission expiry and admitted-before-expiry lost-ack
controls, plus the actual user-Worker operation-Clock witness.
Run owner/profile regressions in PGlite and ordinary-role PostgreSQL separately.
No Node or emitted user-Worker test substitutes for app-DO ownership/revocation
readiness proof. Executing owners are core/database.ts and core/committer.ts,
application/coreMutation.ts, and Standard CoreApplicationMutationRunner.ts.
Source names and this design alone establish neither support nor performance.
