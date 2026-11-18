# Application operation admission before local evaluation

Status: **Bounded Application operation-admission replacement implemented**.
This is a connected prerequisite of
[04C](./04c-standard-mutation-cutover.md), not the ordinary Standard finite
cutover. Source baseline: Flarex `42b862d5b`; Convex
`84fbb0e70b4e857913673871cb847ad11a55f3d5`.

The [focused divergence](../divergences/application-operation-admission.md)
owns the necessary fresh-grant fence beyond Convex's inherited identity.

## Resolved challenge findings

| Counterexample | Selected correction |
| --- | --- |
| An admission operation with an index/participant demand can enter readiness or application-row branches. | Require a genuine Application clock demand with no participant; force null table/index/unique selectors before SQL. |
| A guard awaiting SQL before the evaluator increments in-flight state permits concurrent freeze. | One persistence operation lifetime covers admission, catalog resolution and evaluation, including replay and private preparation. |
| Public executor resolver/run methods each take the same semaphore. Composing them inside another permit deadlocks. | A compound executor call takes one permit and reaches lexical admitted persistence helpers. |
| Eager strict decoding changes revoked-plus-malformed ordering. | Preserve method-specific phases and move the existing singular strict decoder/error owner to persistence for compound use. |
| Reusing the strict unknown decoder for typed persistence callers changes their capture contract. | Retain typed request capture separately. Raw executor callers use the moved strict decoder at their existing phase. |
| Retiring every raw handle method breaks the historical RPC ABI and direct callers. | Keep those named consumers; each raw operation gets its own fresh admission. Remove the displaced current Application split choreography. |
| Lifecycle refusal carries no actual lifecycle; terminalization and nonacceptance writers update different fields. | Return minimal decoded lifecycle evidence and exercise each real writer's resulting priority instead of treating every abort alike. |
| An admission envelope can silently discard an unexpectedly populated body. | Require zero raw rows at the envelope owner after header/layout validation. |
| Wrapping a closed raw evaluator changes its stateRejected result and can change frozen state to aborted. | Preserve typed capture followed by the existing SQL-free evaluator verdict; failure cleanup changes only an open root. |
| A private positive test on an ordinary table lacks the required command policy. | Use the real protected application-command fixture; retain ordinary-table refusal as a negative control. |
| A shared error imported through the broad journal barrel pulls database dependencies into portable Worker bundles. | Expose the single decoder/error owner through a narrow operation-input leaf and preserve executor reexports. |
| Installed Effect.mapError drops other reasons when projecting a mixed Cause. | Map failure reasons with Cause.map at owning journal projections, preserving defects and interruption with producer/result controls. |
| The durable exact-attempt transaction can combine a genuine admission refusal with a rollback/settlement failure before the new compound reaches its outer projection. | Preserve both reasons at the shared target/admission projection; an outer mapper cannot restore a reason already discarded there. |
| Trusted private-command preparation can decline to mint authority after a valid read without invalidating that read. | Preserve only that call's exact isolated eligibility refusal; fresh admission failure, defects, interruption and combined Causes remain terminal. |

All three source challenges agree that Worker-visible refusal/catchability stays
the same. Precise trusted diagnostic priority differs between existing durable
and finite profiles; this is recorded explicitly rather than flattened.

## Capture and migration owner

Add the existing capture owner's operation/envelope pair:

```ts
{ readonly kind: "admission" }
```

The accepted envelope carries only that discriminant, with zero raw business
rows and no reusable authority, timestamp or receipt. Enforce Application clock
demand, exact root/anchor, issuer and host lifetime at the owner; reject foreign
or participant demand before SQL. Preserve the genuine fixed Drizzle shape,
installed artifact proof, 16-argument signature and null business selectors.

For lifecycleChanged, return only the stored lifecycle in the existing session
frontier. Full session data remains exclusive to replacement. Project a dedicated
lifecycle scalar, decode through TransactionSessionLifecycleV1Schema and reject
null, running or unknown values as corruption. The journal consumes this typed
evidence without a second decoder. Preserve replacement-anchor validation and
native scalar/header/layout/body error ordering.

Install the identical canonical function body with one forward migration after
0154. Retain the managed maintenance/quiescence gate, privileges, overload/signature,
VOLATILE, SECURITY INVOKER, search path and existing frontier types. Do not edit
old migrations or drop data. Migration and installation-body hash parity require
both database lanes.

## Compound journal and executor owner

Persistence owns compound point-by-table-name and range-by-table/descriptor
operations. They authenticate the attempt, preserve table-name syntax, freshly
admit, resolve catalog state, decode the strict operation at its proper phase,
capture the typed request, then evaluate/replay. Reads decode their operation's
document ID after table admission; writes addressed by ID retain the current
earlier local ID/table mapping. Raw index resolution retains its existing
descriptor-first phase. Raw typed operations preserve their current capture
precedence before their one-call guard.

Move the existing strict point/index unknown decoders and their singular
UnsupportedPointMutationJournalOperationV1Error to the persistence input owner;
executor reexports preserve nominal identity. Do not duplicate codecs, introduce
an admitted callback/token, or impose strict unknown decoding on typed callers.

Portable Worker consumers import these runtime classes and decoders through the
existing owners' narrow operation-input and error exports. Runtime imports through
the broad journal API also load private native access owners and the PostgreSQL
driver; type-only consumers may retain that API. Preserve each class's nominal
identity and existing reexports rather than adding a second error definition or
host compatibility workaround.

Runner-visible failure classes also live in one portable error owner. The current
and historical runners import it directly; defining execution modules and existing
public surfaces retain nominal reexports. Merely importing a failure type at
runtime must not execute metadata installation or require Node crypto.

The existing finite root owns one in-flight lifetime from before the header wait
through local evaluation. Private command preparation and reference permission
reads already require a single outer count; inner helpers must not double-count.
Refusal, defect, interruption and late close cannot install state or escape cleanup.

Raw point/index evaluation on a closed root retains its existing stateRejected
verdict and frozen evidence. Closed resolvers and new compounds refuse without
SQL or state mutation. The old raw index resolver could issue an inert catalog
handle after closure; that behavior is tightened because it cannot obtain fresh
operation admission and has no named live/public/durable consumer obligation.
The raw ABI remains for active operations. Recheck index closure after catalog
waits before issuing a handle. Private preparation/permission owners keep their
specific late-closure errors rather than receiving a blanket wrapper error.

Migrate current Application RPC forwarding, bound journal contracts/binder and
executor implementation to the compounds under one existing semaphore. Preserve
Worker method names, ordering, sequence and result projection. Keep guarded raw
methods for the actual historical handle ABI and direct fixtures. Private
Application commands must admit each returned run call; private permission reads
use admitted inner evaluation. Borrowed native participants keep their own profile.
Finite incoming relation reads remain refused.

## Refusal priority and full failure

The finite header's existing order is claim ownership, lifecycle, expiry, then
revocation among these conditions. Durable admission can prioritize revocation
earlier. Current durable compound calls keep their existing kernel behavior;
finite calls retain finite priority. Authoritative nonacceptance rejection can
first report executionClaimUnavailable after advancing the claim fence. The
separate terminalization abort owner retains the claim and can report the actual
attemptNotRunning/aborted lifecycle. Tests must use the selected writer, not
manually patch a session into an invalid evidence/lifecycle combination.

The Worker receives the same opaque terminal stopped error, while the trusted
runner retains the exact journal Cause and selected issue. Preserve each mapped
identity and complete Cause; do not claim exact cross-profile multi-fault
diagnostic parity or reorder shared native capture checks. All these authority
refusals remain terminal before value delivery. Only the existing exact isolated
pre-stage document-validation refusal remains catchable.

Trusted private-command preparation separately retains its existing capability-
mint eligibility refusal: an already-reading root or concurrent read may refuse
new command authority and still publish valid read-only evidence. Only the exact
isolated error created by that call's local eligibility checks is preserved.
This is not another catchable Worker syscall error. A revoked, expired or otherwise
inadmissible root is refused by the earlier fresh header and remains terminal,
even when it would also fail command-mint eligibility.

## Coordinated implementation and proof

The capture worker owns capture/projection, canonical SQL, the forward migration
and capture/installation tests. The journal/executor worker owns strict decoder
relocation, contracts, common admission/failure/lifetime, compound/raw/private
paths, bound forwarding and affected mocks. The witness worker owns genuine
activated-root scenarios, dual-driver wrappers and current finite Worker
composition. They coordinate API handoffs and preserve other shared edits.

Use genuine finite entry and the current ApplicationPointMutationRunner with
Miniflare, not a fake nominal root or historical mixed-runtime substitute. An
awaited observer may commit real revocation before delegating the second read
exactly once; it must not implement admission itself. Include an unrevoked twin.

Required cases: known hit and exact point/range receipt replay after revocation;
replay/accounting controls; revoked invalid pending key and catalog/decoder
precedence; actual PostgreSQL lock wait crossing expiry plus a live control;
unchanged lease/claim times; header-only selectors/body and single compound
admission; actual/malformed lifecycle and replacement evidence; simultaneous
refusals; freeze versus blocked admission; private command/permission lifetimes;
full Causes and native separation. Existing 04A/04B evidence/refill/accounting
contracts remain required regressions.

The durable compound regression must reach the real exact-attempt kernel and
transaction-settlement owner. A test transport may substitute a controlled
rejection only after the genuine refused transaction has rolled back. Assert
both the actual admission refusal and settlement failure with their provenance;
do not construct an admitted root or substitute a combined Cause for the kernel.

Run affected Oxc checks, both database lanes, current Worker/required actual-host
regressions, source guards, core/diff/staged lint and both required reviews. The
ordinary Standard cutover, metadata preparation, old-anchor disposition,
out-of-order saves, mutation DO hosting and performance remain wider goal gates.
