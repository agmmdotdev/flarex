# Retire affected Application attempts without deleting evidence

Status: **Owner policy accepted; independent current-core, accepted-direction and
pinned-Convex challenge and peer exchange complete; retained lifecycle direction
selected; runtime implementation not started**. The
[accepted policy](../05-stored-attempt-disposition.md) owns the decision. This
record supplies the connected implementation boundary for Standard cutover.

Flarex checkpoint: `0dd23ccf2`, with uncommitted 04C3 work.
Convex pin: `84fbb0e70b4e857913673871cb847ad11a55f3d5`.

## Challenge and necessary replacement

Existing abort/expiry is not an implementation of this policy. Its terminalizer
deletes the journal and cascading receipts/dependencies, deletes the snapshot
lease, and clears original arguments, grants and Application authority. Ordinary
terminal schema checks and readers require those removals. Preserve those
ordinary contracts; add an explicit retained `retired` lifecycle for affected
`durableOperations` / `application_v1` attempts instead.

Pinned Convex stores successful session results atomically with business data.
It has no persisted incomplete syscall journal or old-readset retirement API.
Its committed-result-first retry and fenced persistence recovery establish the
ordering to preserve, not an archive/delete implementation to copy. See the
[focused divergence](../divergences/retained-application-attempt-retirement.md).

## Selected lifecycle contract

- Retain original request identity, arguments, grant, Application authority,
  journal root/seal, receipts, dependencies, participant records, claim evidence
  and snapshot tuple in place. Record an authenticated retirement reason/time
  through the existing lifecycle owner; do not disguise retirement as expiry or
  dirty-open cleanup.
- Introduce the dedicated durable state and compatible schema/decoder handling.
  Do not blindly add it to `isTerminalTransactionSessionLifecycleV1`: existing
  consumers also interpret that predicate as payload-cleared terminality. A
  retained retired row requires authenticated, non-plannable handling.
- Keep the original finite lease expiry unchanged and prohibit renewal. Existing
  history-floor accounting then retains a bounded residual pin until that expiry,
  preserving snapshot evidence without immediate unpinning or indefinite renewal.
- Preserve the existing authentication/disclosure order and outcome correlation.
  Committed results or committed-result-expiry evidence win over retirement.
  A committed session with missing authoritative outcome is corruption.
- Do not create a successful mutation token, new body permission, new native-hook
  execution or a second independent finalizer. Retirement is an application
  non-success after durable settlement, with stable same-request replay.

The exact durable fields, reason codec and public terminal projection must be
recorded with their owning schema/API before edits. Existing result-expiry and
tombstone semantics are not replaced by a new retention policy.

## Classification and accepting order

The saved format has no producer/completeness version: 04A deliberately changed
neither the journal format nor receipt codec. Do not infer pre-fix execution from
age, codec, canonical hashes or a seal. Those prove integrity, not original N+1
completion semantics.

Reuse the actual receipt canonical/hash, sequence and counter validators to
classify authenticated Application durable evidence with successful non-final
range reads whose completion cannot be proved from its original saved state.
Include open/failed as well as sealed/finishing cases without constructing a
commit plan or granting execution. Preserve genuine pristine, zero-range and
all-final controls. Malformed, missing, inconsistent or unreadable evidence is
failure/recovery, never successful retirement classification. An Application
root with native child records remains an Application root; standalone native,
finite and historical `systemV1` profiles are excluded.

Use the existing located lifecycle transaction and canonical exclusion order:

1. Authenticate the exact original selector/request/profile and bounded evidence.
2. Acquire execution-authority `FOR UPDATE`, scope-clock `FOR UPDATE`, then the
   exact session/fence and existing lease/root/claim locks in their owning order.
3. Recheck the fully correlated PostgreSQL outcome after lock waits. A publisher
   that committed first is replayed. Unknown settlement stays recovery-only.
4. Revalidate the exact classification inputs and unchanged session/fence/root
   after waiting. A live claim is not automatic takeover permission. Use actual
   claim/lifecycle authorization; finishing has no claim and races under the same
   exclusion. Never seal an open root to manufacture a proof.
5. Atomically persist the retained retirement transition. Return an internal
   retirement verdict from SQL and project application non-success only after
   confirmed COMMIT. Throwing the application error inside SQL would roll it back.

If classification runs outside the transaction, its proof must pin and recheck
all mutable session/root/receipt/dependency/claim/lease identity under these locks.
Prefer reuse of the owning validators rather than a parallel historical decoder.
Scope generation/epoch mismatch retains its current explicit refusal until an
actual historical cleanup-authority proof is selected; never infer permission.

## Executing closure and uncertainty

Install the shared accepting refusal/classification before enabling a retirement
sweep. A scheduler-only helper leaves an unsafe seal able to publish first.
Cover actual Standard same-request retry, raw durable redispatch, finishing,
direct publication, recovery, journal/participant operations, sealing, renewal
and replacement. Acquisition's early `finishing` return precedes its existing
root load and must not bypass the classification. A previously prepared plan
still needs the final locked state/fence check.

`recoverPointCommitDecisionUncertain` can reconstruct and republish a seal; it is
not safe outcome reconciliation for an affected attempt. Use the existing
correlated outcome plus retained-state owner under exclusion, without resuming
the finisher or body. Lost retirement COMMIT acknowledgement also remains
uncertain until that same owner proves the exact outcome/retirement marker.

Audit retention/cleanup entrances as well as execution: preserving retirement
evidence must not depend on an ordinary abort cleanup never being called. Keep
named unaffected legacy/system finishers only for their real consumers and removal
gate. No new Application durable allocation or fallback is selected.

The cutover must also exclude publication-capable older hosts using the existing
managed maintenance/fencing protocol before the corrected path serves requests.
A new source guard does not retroactively change a running old binary. Committed
pre-cutover outcomes remain committed; no historical data reset is authorized.

## Required connected proof

- Both databases: authenticated affected/unaffected/corrupt/excluded-profile
  classification, exact historical byte preservation, expired original authority,
  live claims, finishing without claims and repeated same-key terminal behavior.
- Ordinary PostgreSQL independent connections: publisher wins, retirement wins,
  stale fences, lock-wait outcome recheck, old prepared plan refusal and journal/
  renewal attempts after retirement.
- Actual Standard and retained redispatch/recovery routes: committed and expired-
  result replay, retired non-success, no false busy loop, no body or native-hook
  reexecution and no unsafe finisher call.
- Actual lost retirement acknowledgement: exact marker/outcome reconciliation,
  no synthetic success token or fresh request allocation.
- Snapshot evidence remains; renewal fails; original lease expiry bounds its
  residual history pin. Ordinary abort/expiry and unaffected native/system paths
  retain their existing contracts.
- Source/schema guards, affected Oxc and both-driver checks, both mandatory
  reviews, cleanup and a scoped commit remain gates.

No retirement migration, deletion or runtime transition has been performed by
creating this record. Replication remains deferred.
