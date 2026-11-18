# Cancellation And Compensation

Status: general preflight pending. The
[inline Product import](../flarexdb-framework-integration/preflight/109-native-inline-product-import-workflow.md)
has an implemented and validated private control/cleanup profile.
It does not complete general compensation support. This is a general capability
outline; the
[folder index](./README.md) owns scope and the one-capability-at-a-time process.

## Purpose

Clarify how a workflow stops forward work, handles already-committed operations,
and reports or resumes incomplete cleanup. Keep business-specific undo policy
separate from native execution and database settlement.

## Selected Private Control Profile

Trusted workflow timeout/cancellation uses a genuine control subject distinct
from ordinary forward authority. The issuer still authenticates persisted
canonical binding/policy/principal, the current executing attempt and fence,
cancellation or control state, and database-clock lease. Revocation closes the
old handle. A descriptive native step, event group or decoded digest is not
cleanup authority.

The commerce host admits `runControlChild` only for explicitly allowlisted
cleanup commands under the same authentic binding and scope-exclusive profile.
Inline import allows its two Notification phase commands; Product forward work
and success Notification are refused in control mode. Ordinary and control
execution retain the same scope/run/occurrence receipt identity. Replaying
cleanup under a fresh control subject therefore requires the same exact command,
arguments, host policy and retained outcome, plus current live permission.

Native cancellation of an unanswered confirmation can remain
`WAITING_TO_COMPENSATE`. The interpreter never fabricates a failed confirmation
response. Its pending control attempt completes as a real failed attempt with
`override_delay` until the original native deadline plus one millisecond.
The existing Task lifecycle retains `continuation_ready` with
`continuation.controlRetry`; an explicit fresh grant later runs native timeout
processing. The selected profile requires at least three attempts. Exhaustion reports failure with unresolved
cleanup meaning, not successful cancellation. Native REVERTED may acknowledge
the current cancellation generation; native FAILED does not.

The default native Product child does not retain a checkpoint. A subsequent
known Notification failure can leave the Product commit intact while child
cancellation returns `NOT_FOUND` and the parent ends FAILED. Its event gate is
cleared, but rows, facts and history are not undone. Cross-commit business
inverses and checkpointed-child cancellation remain separate admissions.

Real provider work occurs outside SQL and uses the existing callback journal.
Known provider failure is framework-owned tagged data. Unknown dispatch or
uncertain evidence never authorizes redelivery, and arbitrary failure, defect
or interruption retains the complete Cause. The native bridge keeps core
failure sticky through finally/compensation, drains owned native work and
refuses successful settlement after that failure. Cold terminal checkpoints
replay the genuine native finish policy before Task completion. None of these
mechanics selects automatic compensation for arbitrary operations.

## Questions For Preflight

- What should cancellation, permanent failure, and interrupted execution mean
  for the selected workflow contract?
- Which work has rolled back and which may require a later compensating action?
- Who determines compensation dependencies, order, and eligibility?
- How can cleanup continue under valid authority after forward work stops?
- What progress is needed to resume compensation after a crash or lost response?
- How are failed compensation, exhausted retries, unresolved outcomes, and
  operator intervention represented and observed?
- Which mechanics can serve non-Medusa workflows with the same semantics?

## Starting Sources

- [Durable operations](./02-durable-operations-and-recovery.md)
- [Task cancellation and lease races](../durable-task-engine/preflight/15-cancellation-heartbeat-lease-and-race-tables.md)
- [Pinned Medusa orchestration](../../third_party/medusa/upstream/packages/core/orchestration/src/transaction/transaction-orchestrator.ts)
- [Atomic composition discussion](./09-atomic-composition.md)

## Outcome To Establish

An explicit relationship between workflow cleanup and native Task terminal
outcomes, backed by failure and restart examples. Choose what belongs in native
capabilities and what remains workflow policy; neither automatic compensation
for every operation nor a new general saga engine is selected here.
