# Invocation-sticky Application child failure

Design status: **Preserve the accepted current Application profile during cutover**.
Implementation status: **Existing current runtime; genuine Standard durability
witness implemented**. Measurement status: **Unmeasured**.
Owner: [04C Standard mutation cutover](../slices/04c-standard-mutation-cutover.md).

## Pinned mechanism

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`,
[Transaction subtransactions](../../../../../../crates/database/src/transaction.rs)
checkpoint writes, pending indexes, metadata and schema/component registries.
[NestedWrites](../../../../../../crates/database/src/writes.rs) retains a parent
owner and validates the nesting token; rollback restores that owner rather than
applying inverse business writes.

The actual [nested syscall](../../../../../../crates/isolate/src/environment/udf/async_syscall.rs)
rolls back a Mutation when its handler outcome is Err, restores the resulting
transaction to the parent and then propagates the result. Registered return
validation occurs afterward. A return-validator rejection is therefore not the
same rollback branch as a handler error at this pin. Infrastructure errors also
must not be described as recoverable child outcomes.

Reads/usage, random/ID/time progression and scheduling counters are outside the
write checkpoint. Write-size counters live inside checkpointed Writes. Copying
this mechanism later requires explicit selection of each state/accounting rule;
neither all-state rewind nor all-accounting retention describes the pin.

## Required difference and actual owner

The [current Application migration authority](../../../../roadmaps/49-application-analysis-migration.md)
selects the simpler invocation-sticky rule: every rejected admitted internal call
fails the root, even if Application code catches or assimilates its Promise
(AA-R6, lines 1230–1235 and 1382–1383). Its retirement section makes old SAP/FSV
runtime suites historical and expressly obsoletes caught-child return-validator
publication. The [SAP06 record](../../../../roadmaps/45-private-internal-user-code-calls.md)
describes a distinct retired exact-runtime profile and is not silently changed.

The executing [Application runtime](../../../../packages/function-runtime/src/applicationFunctionRuntimeV1.ts)
tracks each admitted child settlement and promotes a rejected child to root
failure during final draining. The Worker preserves declared FlarexError data;
the mutation runner maps it through the existing typed Application error owner.
Parent catch does not clear that tracked settlement.

This accepted profile is why 04C preserves terminal child failure instead of
introducing Convex's catchable handler rollback as an internal representation
change. A future change to catchability requires an explicit guarantee decision.
The present source does not establish child-write leakage into a successful
root: success is refused and all private work remains unpublished.

## Guarantees, costs and affected consumers

Nested work keeps one root snapshot, pending state, deadline and outer settlement.
The root failure discards both parent and child work. No child durable commit,
PostgreSQL savepoint, compensating write, hidden retry or native-hook replay is
introduced. Existing monotonic budgets and typed failure boundaries remain.

Current Application internal-call consumers are affected. Native borrowed failure
already has its own whole-root abort contract; this record does not merge the
profiles. No wire, durable outcome, journal identity or schema changes are needed.

The pending-index owner needs coherent disposal, not a new child checkpoint for
this profile. If catchable rollback is selected later, pending documents,
attempts/ordinals, written-ID suppression and pending index state must restore
together while retaining the deliberately selected reads/accounting rules.

## Acceptance and removal boundary

The genuine Standard/Miniflare witness must reach child patch, declared error,
parent catch and post-catch work, then prove typed root failure and unchanged
application publication. A successful nested write and later independent command
are required controls. Both database lanes use the same contract.

Do not replace this with a historical exact-runtime test, a fabricated root or
an unhandled-child-only case. Runtime and complete-request performance receipts
belong in Git. No production hosting or complete Convex parity follows from this
bounded profile preservation.
