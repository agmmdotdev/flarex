# Task Command Integration

Status: trusted workflow binding, run creation, lifecycle, genuine
ordinary/control subjects, continuation/checkpoint authority, finite commerce
children, callback outcome evidence and Task-bound event gates are implemented
privately. The bounded native inline Product import is implemented and
validated. Compute delivery, hosted activation and general workflow
admission remain separate. This is a general capability outline; the
[folder index](./README.md) owns scope and the one-capability-at-a-time process.

## Purpose

Let durable execution invoke admitted command owners, including commerce,
without exposing raw persistence or changing the commands' transaction profiles.
Product can provide the first commerce example without defining the native API.

## Questions For Preflight

- Which existing Task callback, invocation, and outcome contracts can be reused?
- What additional commerce participation is required, and who owns its adapter?
- How are command selection, principal, scope, installation, execution lease,
  and operation identity authenticated?
- How are deadlines, cancellation, fresh scoped services, and cleanup composed?
- How do exact replay, uncertain settlement, unavailable outcomes, and binding
  changes propagate to the workflow?
- Which shared mechanics justify reuse, and which differences require separate
  Application and commerce contracts?

## Starting Sources

- [Identity](./01-execution-identity-and-replay.md) and [recovery](./02-durable-operations-and-recovery.md)
- [Existing Application Task mutation authority](../../packages/standard-application-invocation/src/ApplicationTaskMutationAuthority.ts)
- [Commerce command contract](../../packages/persistence-postgres/src/frameworks/commerceTransaction/commands.ts)
- [Commerce host](../../packages/persistence-postgres/src/frameworks/commerceTransaction/host.ts)
- [Shared transaction ownership](../shared-transaction-core/README.md)

## Outcome To Establish

A scoped command integration contract with no competing commit authority.
Choose a small real command proof for success, rollback, lost response, stale
execution, and contradictory replay before importing a complete Medusa workflow.
Generalization must preserve each command owner's actual guarantees.

## Selected Inline Import Contract

The [inline import preflight](../flarexdb-framework-integration/preflight/109-native-inline-product-import-workflow.md)
requires a trusted workflow definition reference in the existing Task owner.
It binds immutable workflow and adapter revisions, execution profile and policy,
and scoped principal evidence. It has no fabricated Application runtime or
artifact identity. Existing Application and retained definition generations keep
their own codecs and meaning. Run creation, replay, attempts, leases and fences
continue through the existing Task owners.

The implemented binding uses the closed `trusted_workflow` definition-reference
generation and a scoped immutable binding digest. It pins one authenticated-user
principal digest. Current-reference persistence and lifecycle decisions preserve
the retained Application and legacy codecs. The
[Task storage owner](../durable-task-engine/preflight/20-task-system-storage-and-schema-contract.md#trusted-workflow-binding-prerequisite)
owns its additive storage contract. Existing compute and due-discovery profiles
refuse this generation until an authentic execution adapter is admitted.

A separately admitted `child_commerce` external effect binds the actual
prepared commerce command, policy, captured arguments and stable run/occurrence
identity. It must not fill an Application mutation function-path field with a
synthetic target. Commerce owns its request evidence and exact committed outcome
lookup; an expired or uncertain result never permits a fresh operation key.

The actual child transaction checks the authenticated parent attempt after its
established scope entry, and again immediately before settlement. Preserve scope
authority/clock, run, then effect lock ordering. Use database wall time for the
live lease check and bound the finite child by the remaining lease and settlement
budget. A dispatch-time check alone grants no settlement authority.

The issuer authenticates an in-process binding against stored canonical bytes,
the complete attempt policy and principal reference. It verifies the existing
canonical principal object and its scope, current executing attempt, cancellation
state, immutable attempt identity and database wall-clock lease. Inspection
returns owned immutable facts; it grants no live verdict. Revocation invalidates
the authentic handle. Principal object decoding now lives with the shared Task
contract; the backend object store retains storage and authenticated issuance.

Run creation and subject issuance require an authentic deadline-owned Task
persistence target. The existing PostgreSQL resource owns bounded pool
acquisition and startup lock/statement/transaction deadlines, including
installation admission; the shared Task transaction seam reapplies its captured
policy before authority/run locks. Generic targets fail before I/O. The explicit
PGlite test owner proves SQL behavior, without claiming pool acquisition or
remote connection bounds. The original transaction owner retains drain,
rollback and connection cleanup.
Caller interruption remains deferred while that owner drains foreign work. If
the masked operation ends in a deadline failure, the original projected failure
Cause is retained; this does not claim an early driver abort or an interrupted
Exit. Error projection occurs at the foreign transaction boundary, so pending
interruption cannot bypass a later owner-error conversion.

The commerce host must explicitly select the authentic `taskBinding` and
`scopeExclusive` isolation. Omission preserves ordinary command identity and
refuses Task children. The selected binding is included in host policy identity;
the binding's opaque workflow policy remains the framework interpreter's
responsibility. A subject for another binding cannot enter that host.

This profile admits occurrences 1 through 16. The stable request key hashes
scope, logical run and occurrence, excluding binding, attempt and fence. Exact
request evidence separately binds the immutable workflow binding, command,
arguments, current installations, host policy and optional event eligibility.
The ordinary command API refuses the reserved Task request-key namespace.

Preparation, dispatch declaration, business publication and confirmed effect
receipt share the existing commerce transaction. This finite database-only
child has no remote dispatch gap. A fresh attempt reuses the same occurrence
and retained outcome; a missing, conflicting or expired receipt never authorizes
another business call. The existing uncertain-settlement recovery owner remains
responsible; no additional retry engine is introduced.

Entry requires the complete configured command budget plus a one-second
settlement reserve within both the live lease and maximum attempt duration.
The original absolute command deadline remains in force through settlement.
Fresh database lease checks surround publication and finish after the effect
receipt update, so refusal rolls back business data, facts, events and receipt.
No transaction or connection spans waiting or provider work.

## Callback, Control And Event Owners

`makeTrustedWorkflowCallbackJournal` reuses the existing external-effect ledger
with a distinct `trusted_callback` kind. Trusted construction fixes authentic
workflow binding, callback identity/revision, input/outcome codec revisions,
control permission and finite callback budget. Scope/run/ordinal identity stays
stable across attempts. One short transaction declares dispatch, the actual
callback executes outside SQL, and another still-live transaction records a
known tagged returned/failed JSON outcome. Input, policy, binding and outcome
evidence remain exact. Known provider errors are encoded by the framework;
infrastructure failure, defects and interruption retain their original Cause.

Confirmed known outcomes replay without invocation. Dispatching or uncertain
evidence is explicitly unknown and never becomes fresh work; late or revoked
settlement cannot write a known outcome. The finite callback budget is checked
against the lease and at settlement. SQL bounds do not abort an arbitrary hanging
foreign callback, and no timeout wrapper abandons it or supplies exactly-once
semantics. Its actual cancellation/drain contract belongs to its provider owner.

`runControlChild` selects only explicitly allowlisted cleanup commands. It uses
the same logical receipt identity as an ordinary call while still requiring a
genuine current control subject and exact request equality. Control mode grants
no general commerce permission. The inline profile permits Notification
preparation/finalization cleanup and refuses Product forward work.

The [event eligibility owner](./07-durable-workflow-events.md#cross-commit-delivery-eligibility)
can hold each child's committed intents under two conjunctive groups.
`makeTrustedWorkflowEventEligibilityStore` binds one or two constructor-owned
roles and their occurrence/commit limits to the authentic workflow. Its
`open`, `inspect` and `decide` operations derive stable scope/run/role/occurrence
identity and revalidate the live ordinary/control subject around the existing
group owner. A native group string alone grants no release/clear capability.
The existing publication and subscriber owners remain authoritative.

The selected inline composition uses Product occurrence 1; success Notification
phase occurrences 2/3 and failure occurrences 4/5. Provider callback occurrences
1/2 are independent of commerce ordinals. Product intents require the parent
gate; Notification intents require parent plus the corresponding role gate.
Actual native `EmitEvents` acknowledges the exact phase messages before role
release, without producing duplicate intents. The parent gate allows five
enrolled child commits and each role two. Native finish policy owns the final
parent release/clear decision. Clearing eligibility cannot undo a child commit.

The separate [private continuation contract](./03-continuations-waits-and-signals.md)
and [control contract](./04-cancellation-and-compensation.md) connect these owners
to one fixed native profile. The framework retains its interpreter, checkpoint
codec and business graph; Task retains singular lifecycle/ledger authority.
No autonomous scheduler, general provider/workflow API, hosted route, retention
or garbage-collection contract follows from this private admission.
