# Ordinary Standard mutations through the shared root

Status: **Independent three-way challenge and peer exchange complete; connected
replacement selected; runtime implementation unstarted**. The historical-data
[disposition](../05-stored-attempt-disposition.md) remains open for its affected
path. This record does not complete [04C](./04c-standard-mutation-cutover.md).

Current source checkpoint: Flarex `677a2ec00f1098c900b17a86c446e917297f988c`.
Convex reference: `84fbb0e70b4e857913673871cb847ad11a55f3d5`.

## Independent challenge and convergence

Current-core, pinned-Convex and accepted-direction agents formed independent
findings, then exchanged counterexamples. The connected outcome is the actual
unversioned Standard new-request path using finite execution. Another private
preparation helper, or a switch limited to simpler schemas, is insufficient.

| Current executing responsibility | Keep, adapt or replace |
| --- | --- |
| Standard selects the executable, canonicalizes arguments/request identity, checks identity/current revocation, issues a grant and projects authoritative outcomes. | Keep the owners and their authentication/disclosure order. |
| `captureLive` structurally wraps the activation repository and authority. | Retain genuine capabilities through their owning composition root and host lifetime; matching methods are not issuer identity. |
| The durable initial executor and durable activation are used for every new Standard request. | Replace this construction with existing finite entry, runner, immutable freeze and publisher. No fresh durable fallback after a finite failure. |
| Existing finite admission takes registered bindings, permits public roots, and gates composite schemas to V3 with empty Application relations/edges. | Issue preparation for the exact originally selected executable, preserving public versus authenticated internal/preselected/Task/action entrances and supported legacy/V2/V3 representations. Remove gates only with the connected proof. |
| Standard relation mutations maintain ordered edges and target-delete restrictions. | Reuse existing relation binding, commit and publication owners. Include source and target relation semantics/physical identities in the actual write closure. |
| The finite `applicationSchema` projection has empty relation/extension/incoming closure. | Extend the existing projection for supported maintenance; a target delete needs incoming restrictions even without a source-row write. Do not add a whole-head dependency. |
| Incoming relation reads in the relational harness use query systems; the Application mutation journal exposes point/index operations. | Preserve current supported mutation write maintenance without inventing a new incoming-relation mutation syscall. |
| Durable activation rejects a stored/requested profile mismatch; busy finite entry does not issue a new executable entry. | Authenticate existing profile and outcome before selecting the owner. Preserve committed replay and Standard `inProgress`; never treat busy as body permission. |
| Durable and finite redispatch explicitly reject the other recovery profile. | Route authenticated stored consumers through their actual recovery owner. Factory presence alone is not routing. |
| Finite retry consumes a same-factory, single-use nonacceptance proof. | Adapt Standard retry through that proof, preserving limits, full Causes and the original signed program. Unknown acknowledgement remains recovery-only. |
| Current nested-failure witnesses inspect durable child receipts. | Preserve genuine Worker patch/catch/no-publication behavior, replace the displaced receipt observation and prove absence of new durable child journals. |

## Convex mechanism and required differences

At the pin, [_retry_mutation](../../../../../../crates/application/src/application_function_runner/mod.rs)
creates a fresh logical transaction, checks a committed session outcome, validates
and executes at that snapshot, then commits the successful outcome with business
data. Eligible OCC/throughput failures have bounded retry. An uncertain save is
not blanket permission to execute another body.

[FunctionCaller::allowed_visibility](../../../../../../crates/common/src/types/functions.rs)
supplies public versus internal visibility, and
[ValidatedPathAndArgs](../../../../../../crates/udf/src/validation.rs) consumes
function metadata through the original transaction. The
[function router](../../../../../../crates/application/src/application_function_runner/mod.rs)
transfers identity, begin timestamp and prior writes;
[Transaction::apply_function_runner_tx](../../../../../../crates/database/src/transaction.rs)
requires timestamp equality before merging execution reads/writes.

[SessionRequestModel](../../../../../../crates/model/src/session_requests/mod.rs)
records exact request absence in the readset. Concurrent duplicates may both
execute before OCC selects one successful commit. This does not supply Flarex's
existing persistent claims, busy results or stored-profile protocol.

Before affected implementation, record necessary mechanism differences separately:
original signed-program retry, persistent attempt/profile/claim ownership, and
replay authentication/order. Search/reuse any existing owning record first.
Fresh revocation and sticky child failures already have dedicated divergences.
The accepted [mixed-mutation contract](../../../../design-notes/flarexdb-mixed-mutation-execution.md)
does not let a retry grant authorize newer code/schema merely because current
metadata is compatible. Application retry eligibility does not make native hooks
or external effects replayable. No executable upstream test was located in the
inspected pinned mutation/session-request subtree; source evidence is not an
upstream test pass.

## Executing owners and removal boundary

Start at [ApplicationMutationSystem](../../../../packages/standard-application-invocation/src/ApplicationMutationSystem.ts),
[applicationMutationAdmission](../../../../packages/persistence-postgres/src/application/applicationMutationAdmission.ts),
[finitePreparation](../../../../packages/persistence-postgres/src/application/activation/finitePreparation.ts),
[finite metadata](../../../../packages/persistence-postgres/src/execution/finiteMetadataDependencies.ts),
and [finite execution](../../../../packages/executor/src/mutation/execution/finitePointMutationExecution.ts).
Reuse existing activation, publication, outcome, replacement, terminalization,
claim/liveness and recovery owners. Keep physical SQL transactions short and
outside Worker/native execution.

Remove durable **new-request** construction from Standard and migrate executing
callers/tests. Retain durable readers/finishers only for named authenticated old
anchors or historical `systemV1` consumers, with explicit disposition/removal
gates. Do not preserve unused wrappers for compatibility. No durable rows or
outcomes are deleted by this contract.

Coordinated workers must own disjoint responsibility/files for persistence
selection/relation closure, executor entry/recovery, and Standard composition/
consumer migration. Record their exact API/lifetime handoffs before dispatch;
sequence overlapping owners rather than inventing duplicate enforcement.

## Required connected evidence

- Ordinary Standard public/authenticated/internal/preselected and Task/action
  consumers record `finiteRoot`, with no displaced new durable child journals.
- Exact selected A followed by head B never silently substitutes B. Preserve
  allowed semantic transitions and existing stale-selection refusal rules.
- Existing legacy/V2/V3 and real nonempty relation mutations pass on PGlite and
  ordinary PostgreSQL. Relation-definition/source/target changes and ABA after
  freeze refuse without rows, edges, commits, outcomes or events publishing.
- Committed replay avoids another body; racing duplicates yield outcome or
  `inProgress`. Profile mismatch never creates a new body or false request-key
  conflict. Unknown entry commit grants no callback; unknown final acknowledgement
  reconciles the authoritative outcome before retry.
- Retry consumes conclusive nonacceptance authority once, retaining signed
  program/schema, retry budget and fresh current authority. Host disposal,
  cancellation, revocation and caught nested failures retain their current rules.
- Actual Worker, range/pending and Product/Payload consumers, affected Oxc checks,
  lint/guards, both read-only reviews and owned-resource cleanup remain gates.

The old range-attempt disposition pauses its affected activation/recovery path,
not independent authorized work. Ordinary Standard cutover remains unimplemented
until the complete connected contract is proven. Mutation DO coordination,
save/publication recovery and complete-flow performance remain later goal gates;
replication remains deferred.
