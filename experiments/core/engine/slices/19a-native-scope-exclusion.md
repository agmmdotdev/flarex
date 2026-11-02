# Native scope exclusion through the shared Core owner

Status: **Implemented after independent current/design/Convex challenges and
peer exchange, with paired Core, genuine native and complete Native19 consumer
coverage and connected regressions. Wider goal gates remain open.**

Baseline: `4e6059e1b112c9cd12d75e7aa3487e81b6854f1d`.
Convex: `db914cf06e2b06ee985646611b9e12ed7a770318`.
This is a shared prerequisite of the complete
[Inventory/Variant replacement](./19-native-inventory-and-variant-read-workflows.md),
not a Task, arbitrary Locking-provider or performance project.

## Initial failure and supported obligation

The initial genuine Core Item fixture refused preparation before its business witnesses.
`prepareCreateReservationWorkflow` selected `prepareWorkflowLocking`, whose composed
resource declared `scopeExclusive:true`. Workflow host assembly forwarded
`executionIsolation:"scopeExclusive"`; Core native configuration marked it
unsupported and rejected it. There was one participant within the default eight,
no Task selection and no queue mismatch. Adjustment requested the same mode
next. Stocking, Level deletion and absolute Level update do not select it.
All three Native19 families reach genuine reservation/adjustment setup.

The [accepted Inventory contract](../../../../roadmaps/flarexdb-framework-integration/preflight/98-stock-adjustments-and-reservations.md)
distinguishes callback exclusion from OCC. Preserve selected callback mutual
exclusion before admission/body entry through settlement, isolation-bound request
identity, authenticated live root/borrowed-context evidence and independent scopes.
Ordinary callback bodies remain concurrent while competing writer settlement waits.
Preserve deadlines, cancellation, Promise draining, lease/generation fencing and
uncertain-outcome recovery without native callback replay.

Legacy holds authority `SHARE` and clock-row `NO KEY UPDATE` through its SQL
transaction. Default snapshot `KEY SHARE` is compatible, allowing ordinary bodies
to continue while their eventual publication waits. Replace that long transaction;
the translated core cannot retain it across untrusted callbacks.

The original Item-deletion PostgreSQL race holds an ordinary callback after its
guard, awaits a selected Reservation/Adjustment commit, then releases deletion
and expects stale conflict. Draining every ordinary callback before exclusive
entry would deadlock this existing witness. Preserve its boundary unchanged.

## Pinned mechanism boundary

Convex `database.rs:301-310,1970-2045` permits parallel snapshot bodies;
`committer.rs:914-977,1035-1050` validates published and accepted-unsaved changes.
`database.rs:1882-1905` retries ordinary OCC handlers. These do not provide native
callback exclusion. The dedicated
[native scope-exclusion divergence](../divergences/native-scope-exclusion.md)
owns this adaptation, distinct from per-transaction operation exclusion.

Core lease fencing, a short acceptance mutex, per-request queue and app-owner
capacity alone do not issue this guarantee. A prepared-host mutex or maximumRequests=1
would miss writers or broaden callback serialization.

## Selected owner mechanism

Use the existing trusted Core database/kernel, committer and app-generation
admission/settlement owners, bound to actual namespace and lease generation:

- Ordinary bodies take no exclusion permit. Their settlements acquire namespace
  shared protection before accepted-prefix insertion and retain it through the existing
  durability/publication/acknowledgement or recovery disposition.
- Selected native roots acquire exclusive protection before admission/body entry,
  retaining it through settlement and owned-work drain. Their own commits use
  authentic request-bound evidence rather than waiting on themselves.
- Already accepted settlements finish or reconcile first; ordinary bodies are
  not drained. Competing new acceptance cannot preempt the holder. Hold no Source
  acceptance mutex or SQL transaction across waiting or callbacks.
- Evidence is unforgeable, live and bound to root/borrowed contexts, identity,
  namespace and generation. Existing lifecycle owners revoke it and recover;
  the barrier adds no commit or recovery authority.

All runtime logical writes funnel through `committer.submit`, including system,
schema, claim, recovery, ordinary, abort and authority-epoch paths. Protect that
boundary rather than only `database.commit`; classify lease/recovery control
operations so liveness does not wait behind its own application permit.

Acceptance transfers save ownership beyond caller interruption. A scoped bracket
around `submit` alone would release protection too early after an accepted save.
Transfer the permit to `AcceptedCommit` at acceptance; release it only at known
publication/ACK or terminal stop with the generation closed/fenced. Preaccept and
no-write paths release their caller-owned permit. A stopped generation cannot
admit a fresh exclusive callback merely because its pending ACKs failed.

The renewed challenge selects this mechanism with the ownership, namespace,
control and lifecycle constraints below. They are implementation invariants,
not permission to weaken a supported guarantee. Paired owner and genuine native
proof cover this mechanism; the complete consumer closure has its separate gate.

The source challenge also identifies these required ownership details:

- Native host closes/aborts the operation before `Core.commit`; operation cleanup
  alone cannot release selected protection. Retain authenticated ownership through
  the finalized packet/claim and accepted settlement until both drain and
  persistence obligations finish.
- Bind reentrancy to issuer-private finalization-vault evidence, not a public
  boolean or ambient token. Carry semantic namespace explicitly even when the
  only changes are private global-table outcomes. Global authority/program
  publication needs an explicit deadlock-free cross-namespace disposition.
- Close/revoke the gate before failing pending acknowledgements or waiting for
  schema-worker drain. Otherwise a worker awaiting shared protection behind a
  live exclusive root can deadlock shutdown.
- Lease acquisition/fencing/bootstrap must not wait behind the application gate.
  Gate semantic metadata submission rather than whole schema-worker execution;
  disabled-index physical backfill retains its existing fences.
- Hosts sharing one actual app generation share the protection. Independently
  opened Core databases have separate memory owners: Source lease fencing alone
  does not prove cross-process callback exclusion. Preserve single-owner routing,
  generation retirement/drain and the wider hosting gates.
- Committed DTO replay remains ahead of fresh native execution admission. Fair
  waiting uses the original deadline/cancellation contract, followed by renewed
  readiness and generation checks.

Reuse the existing commerce-context `registerScopeExclusion` hook for genuine
root and nested/borrowed contexts and its shared guard owner, replacing the
Legacy-only SQL-clock evidence with actual Core protection. Do not add a second
context registry or accept copied/proxied context identity.

### Remaining control and namespace classification

Initial request claims are durable submissions before both ordinary Native and
Application bodies. Fencing every claim behind namespace exclusive protection
would block new ordinary bodies. Use issuer-private request-control classification
only for the actual claim insert/reclaim, claimed-to-failed abort and predecessor
recovery transitions. They still use Source validation and fenced persistence;
they confer no body or result authority. Committed result injection, including
read-only DTO outcomes, remains settlement. Never infer bypass from system-only
rows or an empty business delta.

Semantic scope is the authentic bundle namespace, not source scopeUuid/epochUuid
and not the physical global table containing a request. Core root null is a real
namespace, distinct from a global-authority barrier. The global fence admits two
compatible groups: selected native roots and true global authority/program
publications. Members of each group may overlap; opposite groups exclude each
other. Selected roots take their native-group permit before namespace exclusive
protection. Ordinary settlement takes namespace shared protection only; global
publications take only their global-group permit. A selected self-commit must
reuse both existing holds; reacquiring a native-group permit behind a waiting
global publication would deadlock. Authenticated request-control transitions take no
application settlement permit; they still obey committer validation, generation
closure and the persistence fence. They cannot authorize committed results or
unrelated metadata. Ordinary claims and callback admission can therefore progress
while the selected namespace body holds exclusion.

The Core proof uses actual root and component namespaces inside one kernel.
Separate persistence instances alone would not prove that concurrency. The accepted
[single-owner routing contract](../divergences/single-app-owner-routing.md)
requires fresh writers to borrow the same retained canonical owner; arbitrary
external takeover while it serves is unsupported. Reuse the existing
[owner recovery contract](../divergences/app-owner-recovery.md), including
cancellation/join, SQL-save drain, fencing, reconstruction and claim reconciliation.

Admission waiting and post-grant readiness use the existing native lifetime's
original absolute deadline. Recheck generation and expiry before callback entry;
queueing does not reset the deadline. Committed DTO recovery precedes fresh
execution admission.

## Coordinated implementation ownership

- Kernel worker owns the generation/namespace barrier and private issuer,
  core/database.ts, committer.ts, trusted transaction/finalization,
  api.ts and nativeRootRequest.ts. Integrate all semantic writer paths and
  accepted-save ownership in that existing owner; publish the exact admission,
  self-settlement and live-proof interface to the adapter/proof workers first.
- Atomic adapter worker owns native configuration, host/execution and the shared
  scope-exclusion guard. Reuse existing context registration and the single bounded
  native lifetime; connect the original deadline before acquisition and preserve
  the existing full-Cause and Promise-drain contracts. Keep Legacy evidence with
  its existing SQL owner. No workflow or fixture may suppress the selection.
- Core proof worker owns focused two-driver barrier/claim/finalization/generation
  scenarios and affected internal type-test callers. Use real Core owners and
  namespace identities rather than a second scheduler or storage model.
- Genuine proof worker owns actual Inventory reservation/adjustment/exclusion
  witnesses over the current Core fixture. Preserve the existing Native19
  deletion races and all original consumer cases.
- Root owns documentation, provenance, serial jobs/resources, integration,
  independent project reviews and the scoped commit. Workers coordinate explicit
  files/interfaces, preserve each other's work and run no competing jobs.

Default-mode frame/identity bytes should remain stable where the new optional
selection is absent. Selected mode must be part of Core's authenticated request
frame even for non-workflow callers. This is a native profile, not a universal
transaction API or another commit/lifetime/recovery engine.

## Required connected proof

### Acquisition ownership correction

Independent review identified a missing ownership handoff in the initial
implementation. The host restored the entire deadline-wrapped acquisition inside
acquireUseRelease. Cancellation could discard a successfully opened operation
before that bracket registered its abort. Creation cleanup could already have seen
success. Claim terminalization abandoned the grant without draining the
lost operation, so a later selected request could remain blocked until database
closure.

The preserved post-success/pre-transfer cancellation witness reproduced this leak:
the first native body never entered and its claim terminalized, but the next
selected reservation expired waiting while the database remained open. Separate
real-owner witnesses reproduced the lost exclusive-grant and ordinary-settlement
permit handoffs before the caller adopted their successful values. The corrected
regressions preserve execution diagnostics and transparent actual-method
delegation. These are cancellation/interface-handoff witnesses, not proof
of a particular active timer interleaving.

The existing claim/acquisition owner must retain actual cleanup authority before
exposure, not infer a drained flag after failure. Owning the context only after
delivery is insufficient for an inner permit lost earlier. Keep pending
acquisition cleanup, authentic context abort and accepted-settlement transfer
with their existing trusted Core owners. No adapter mutex, second lifetime or
replacement recovery path may substitute for ownership in the existing Core.

The implemented correction creates owner-held acquisition tickets before waiting
and races only void readiness against the original deadline. It registers authentic
grants/permits with the claim or committer before readiness; acceptance still
transfers settlement ownership to AcceptedCommit. The actual root transaction
abort capability is registered on its claim atomically before borrowed exposure.
Abort terminalization joins that actual context; an admission that never opened
a context cancels its real ticket instead of asserting a synthetic drained flag.

### Post-acquisition readiness deadline

Participant initialization after exclusive admission performs real binding and
outcome reads. The initial checkpoints alone could not interrupt a stalled read
at the request's deadline: acquisition's deadline race had finished and callback
execution's race had not started. A database statement timeout supplied a
different, potentially longer bound.

Readiness now runs within the existing lifetime's withinDeadline, retaining its
original absolute expiry and actual operation cleanup owner. The genuine
post-grant readiness regression advances the original request clock, refuses
before native callback entry, drains the operation and admits following selected
work before test cleanup. Preserve that boundary without resetting the timer,
adding another lifetime or relying on a later checkpoint.

### Independent global metadata publication

The global fence must protect selected native callbacks without serializing
ordinary global publications with each other. The existing accepted-metadata
witness holds one program save, requires a same-key collision to reach Source
conflict validation, and requires an independent program save to finish before
the first is released. The initial universal global-exclusive writer permit
prevented both and deadlocked that witness.

Preserve Convex's accepted-prefix validation, independent asynchronous saves and
ordered metadata-delta publication. Selected callbacks in different namespaces
may overlap; global publications may overlap with each other; these two groups
must exclude each other. Ordinary settlements retain namespace protection and
Source validation without globally excluding unrelated publications. Opposite
queued groups require fair admission, and selected self-settlement must reuse its
authentic existing protection. Retain owner-held tickets, cancellation, accepted
save ownership and close-before-drain behavior. The implemented compatible-group
fence preserves these constraints after renewed independent challenge.

Independent current-core, accepted-direction and pinned-source challenges agree
on this correction. Convex committer accepted-prefix insertion, metadata snapshots,
published/pending conflict checks and asynchronous saves
(`committer.rs:959-976,1001-1013,1041-1045,1259-1281`) preserve independent global
admission. Current exact metadata reads and registry-delta merging retain that
authority. Admit a contiguous compatible queue prefix, stopping later arrivals
behind a queued opposite group. A later global collision may wait behind a queued
selected root before reaching its unchanged Source verdict; no new early conflict
engine or always-immediate refusal guarantee is required.

### Registration program-catalog dependencies

The compatible-group witness exposed an unrelated conservative read: schema
discovery previously recorded the full program catalog even when no supplied or
installed registration proof consumed that catalog. The actual beta conflict
matched the actual program index and alpha revision key, while both namespaces'
active schemas had no registration proof. Source correctly validated the recorded
read; the correction places that observation with its registration consumers.

The registration owner retains the full table catalog and every discovered
namespace's active, pending and validated schema-state dependency, including
absence. It records the complete program catalog at its actual consumers:
fresh/pending registration emptiness, direct
complete closure authentication, every active-registration memo hit or miss, and
candidate abandonment's program/head absence check. Zero-table/zero-program
proofs, unexpected revisions/heads, foreign tables and concurrent proof
introduction retain their protection. Memo misses avoid duplicate observations.

Independent current-core, accepted-direction and pinned-source challenges agree
on that bounded owner correction. Do not alter Source conflict checks, snapshots,
registry-delta merging or errors, add administrative retries, reschedule the
independent-save witness, or remove the existing exact schema-state conflict.

### Administrative metadata conflict

The metadata barrier does not rebase a previously prepared administrative
transaction. Application-registration guards observe active, pending and
validated schema state across namespaces. Another namespace's pending proposal
can therefore invalidate a blocked preparation. Preserve the exact Source OCC
refusal and prove fresh administrative preparation succeeds after release;
do not weaken conflict validation to promise every concurrent schema operation
succeeds.

Retain default OCC parallel-body behavior and its one-winner/stale-conflict
witness. Prove selected callbacks cannot overlap; ordinary bodies can progress
while their competing acceptance/publication waits. Preserve original Item
deletion races. Genuine competing reservations must produce their native
one-success/`not_allowed` outcome without replay or substituted `writeConflict`.

Exercise distinct scopes/multiple hosts over the actual shared owner, nested live
evidence and dropped/copied/proxied/foreign/expired refusal, isolation-bound
request reuse, cancellation/deadline before grant, owned-work draining, already
accepted unsaved writes, lease/generation loss and lost-ACK recovery. Prove no
leaked permit or unsafe fresh callback entry after uncertain settlement.

Run focused owners and genuine consumers on PGlite and ordinary-role PostgreSQL,
affected Application/native/recovery regressions, source/portability guards, Oxc
fast checks, lint and both project reviews. Actual host claims retain separate
evidence. PostgreSQL stays sole durable authority; no physical family, replacement
scope-clock engine, retained-data reset or generalized Task support is justified.
