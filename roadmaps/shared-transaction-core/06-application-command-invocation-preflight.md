# Application Invocation Of Trusted Framework Commands

## Status And Recommended Decision

Preflight complete; implementation proposed. The approved work for this record
is investigation and design. It does not enable an API, change a persisted
contract, or authorize a migration or runtime implementation.

Recommend one private **Action-to-framework-command vertical** first. A real
Application Action calls the existing Currency/CMS/Application command through
an authenticated callback and returns its result. Task invocation follows a
separate attempt/fence/retry gate; it is specified below but is not bundled into
the first implementation. Ordinary CMS and commerce commands may use the same
invocation contract only after their exact descriptors are individually admitted.

The [named command](./05-named-command-preflight.md) already proves atomic
participation inside the trusted host. This record adds the missing caller
boundary. R1/R2 and that command remain complete in their accepted scope.
Representative performance, production activation and general mixed sandbox
OCC remain independently gated. Do not invent another transaction engine.

Read with the [accepted ownership design](../../design-notes/flarexdb-commerce-occ-migration-preflight.md),
[execution profiles](../flarexdb-framework-integration/preflight/14-transaction-execution-profiles.md),
[clean Application APIs](../50-clean-application-apis.md),
[Action/effect ownership](../47-aav-a1-direct-action-and-shared-effect-authority.md),
and [Task mutation settlement](../durable-task-engine/preflight/45-dte06-task-mutation-settlement-reconciliation.md).

## Current Source Findings

| Source | Current behavior and consequence |
| --- | --- |
| [Clean Action operation](../../packages/application-invocation/src/Action.ts) | `runAction` validates a typed Action reference and delegates to `ApplicationActionSystem`; completed/replayed and non-completed outcomes are deliberately distinct. Keep this ingress. |
| [Action system](../../packages/standard-application-invocation/src/ApplicationActionSystem.ts) and [composition](../../packages/standard-application-invocation/src/ApplicationActionHostComposition.ts) | Own admission, exact parent authority, dispatch, callback lifetime and Action settlement. A framework command is a child operation, not a replacement Action lifecycle. |
| [Action runtime](../../packages/function-runtime/src/edgeAction.ts) and [callback bridge](../../packages/standard-application-invocation/src/edgeActionCallbackBridgeV1.ts) | Context/callback kinds are `runQuery` and `runMutation`; the mutation branch derives a key and prepares native child-mutation evidence. There is no admitted framework-command callback. |
| [Host policy](../../packages/flarex-protocol/src/edge-action-host-policy-v1.ts) | Exact policy fixes the callback/runtime ABI and permitted operations. Adding a method without changing authenticated policy would bypass admission. |
| [Composite host](../../packages/persistence-postgres/src/crossDomainCommand/host.ts) | Constructor accepts trusted deployment/database/binding/command inputs; `run` accepts JSON and a private UUID-shaped request key. It hashes `identityAndAccessPolicy` for replay equivalence but does not authenticate or authorize an application principal. |
| [Composite recovery](../../packages/persistence-postgres/src/crossDomainCommand/host.ts) and [recovery router](../../packages/persistence-postgres/src/relationalTransaction/requestRecovery.ts) | Recovery is private to one invocation and re-enters current admission before lookup. No exposed frozen-intent resolver exists for a new callback host after restart or head movement. The router correctly never retries business execution. |
| [Payload proof runtime](../../packages/payload-adapter/src/runtime.ts) and [profile](../../packages/payload-adapter/src/profile.ts) | Real Local API calls use `overrideAccess: false`, but the fixture collection allows all access and installs title-triggered fault hooks. These are conformance behavior, not an application authorization or ordinary content runtime. |
| [Effect protocol](../../packages/flarex-protocol/src/execution-evidence-v1.ts) and [SQL schema](../../packages/persistence-postgres/src/schema.ts) | Effect kinds are exactly `outbound_http` and `child_mutation`. SQL checks and request/outcome columns encode those meanings. A framework command requires explicit effect-contract and migration work; an adapter cannot relabel it as a native child mutation. |
| [Task authority](../../packages/standard-application-invocation/src/ApplicationTaskMutationAuthority.ts), [Worker callback](../../packages/flarex-backend/src/taskComputeDelivery/ApplicationTaskMutationCallback.ts) and [Node gateway](../../packages/flarex-backend/src/taskComputeDelivery/NodeTaskCallbackGateway.ts) | Already own attempt-bound principal, ordinal, deadline, cancellation and child-mutation reconciliation. Reuse parent mechanics later; do not route a command through the native mutation operation or assume adding an Action method equips Tasks. |

These are inspected source gaps at a new admission boundary, not defects in the
private command's existing contract. No implementation or database test was run
for this documentation-only preflight.

## First Application Flow And API

Use one private `publishAnnouncement` Action in the real system-test application
producer. Its handler calls the named `publishCurrencyAnnouncement` command
and returns its Currency result, CMS result and Application row ID. A second
handler calls the same command and then deliberately fails. The latter proves
that the child command commits independently of its enclosing Action.

Keep host ingress as `runAction(actionReference, args, { requestKey })`.
Proposed Action-context spelling is:

```ts
const result = await ctx.runCommand(commands.publishCurrencyAnnouncement, args)
```

This is proposed syntax, not an existing export. `commands` contains typed
references emitted for a trusted host-owned command directory. A command
reference describes a command ID and its argument/result contract; it is not a
native mutation reference and is never authorization. User source cannot
register an implementation, choose a provider, pass a callback, import Medusa
or Payload server packages, or select tables through this API.

Only this named composite command is enabled in the first directory. Do not
add `ctx.cms`, `ctx.commerce`, a universal `transaction(callback)`, another
`runAction` owner, or an ambient root `runCommand` service for arbitrary callers.
The outer Action already has a clean typed ingress. The Worker sends bounded
command identity and arguments; parent/scope/principal/keys come from the host.

## Authority And Package Ownership

The Application invocation owner prepares an opaque, immutable command grant
from authenticated parent execution, concrete scope/placement, admitted
Application revision, canonical `ExecutionIdentity`, and an explicit command
allowlist. For the first proof, use a host-supplied grant for the exact test
principal and Action/command pair; do not invent a role or permission database.
Anonymous and unmatched principals fail before command work.

The grant binds command ID, executable contract digest, argument/result
validators, access-policy digest, complete selected framework frame/head,
Application write-policy/schema identity, Currency installation and Content
identity. A copied structural object, typed reference or digest alone cannot
mint the grant. Validate the grant's live parent and command admission before
dispatch; validate the selected data bindings again under the command's scope
clock lock. Reject head/placement/generation drift for new work.

| Owner | Proposed responsibility |
| --- | --- |
| `@flarex/application-definition` | Typed command-reference description and producer validation only; no trusted implementation registry or SQL capability. |
| `@flarex/application-invocation` | Keep existing Action ingress and result/error facades; no persistence/backend dependency added to this clean package. |
| `@flarex/standard-application-invocation` | Application command descriptor/grant service, principal/allowlist admission, Action callback composition and projection of the child outcome. |
| `@flarex/function-runtime` and `flarex-protocol` | Bounded `runCommand` context contract, exact request/result codecs and command-key/intent commitments. |
| `flarex-backend` | Actual Worker capability transport, runtime/policy pinning, generated-source build, cancellation and close/drain integration. No authorization inferred from a wire command ID. |
| `@flarex/persistence-postgres` | Existing parent effect authority, new command-effect branch, frozen command-intent recovery, and current composite transaction/publication owner. |
| Medusa/Payload adapters | Actual service behavior and ordinary trusted command configuration; retain semantic write ownership and framework validation. |
| `@flarex/system-test` | Real Action source, application installation, connected Worker and SQL proof. No authority or publication implementation in the harness. |

Use an Effect service/Layer for the shared command directory and its live/test
composition. Keep grants and callback sessions as explicit request-owned
instances. Business effects belong in operations; Layers capture configuration
and lifetime. Preserve typed failures, interruption and defects at their owning
boundaries. Do not copy the existing Promise-heavy callback implementation into
a second bridge: factor only exact shared sequencing/drain mechanics when the
new branch needs them, preserving existing behavior and focused proofs.

The first Payload runtime is an explicitly host-authorized service operation.
Move title-triggered fault hooks to the conformance owner and provide a normal
bounded configuration for the admitted command. Preserve the existing negative
fixtures and their assertions. Do not turn a Flarex identity into an invented
Payload auth document or claim end-user Payload access semantics. Keep
`overrideAccess: false`; any command-grant access hook is trusted, synchronous
in authority meaning, and tied to the same request capability. Bind its policy
and implementation identity in the command descriptor, since the current
content configuration digest alone does not describe those hooks.

## Atomicity, Replay And Result Contract

The three domain steps remain one child SQL transaction. An Action may execute
before/after that transaction; its final failure cannot undo a committed child.
No transaction is held open while arbitrary Action code runs. Native queries
and mutations receive no command capability. A crafted command syscall from
those runtimes must fail, even if it has a valid-looking reference.

Separate two commitments:

- The child request key identifies one operation slot under the same scope,
  parent Action invocation and host-owned syscall ordinal, with a dedicated
  command domain separator. It is stable after restart and excludes arguments
  and mutable binding identity so changed intent conflicts instead of becoming
  another write. Use the full digest and a protocol-owned bounded text codec.
- The exact intent binds that key to the command contract, canonical arguments,
  principal/access policy, parent revision and selected framework bindings.
  Persist it before declaring dispatch. Do not resolve a new current binding
  and silently overwrite the original intent during recovery.

The existing private `composite/<uuid>` regex cannot represent this full-digest
key. Replace that command-local restriction with the approved protocol-owned
key boundary for the new caller; retain only proven private fixture convenience
and migrate its consumers deliberately. Never obtain a fresh random key for a
retry. Existing retained records must not be rewritten or deleted to change the
producer; compatibility/retention disposition must be explicit in that slice.

The command owner needs a source-private frozen-intent admission/execution and
outcome-resolution seam. Reuse its canonicalization, existing committed-outcome
resolver, physical session, shared recovery and publisher. Do not copy the SQL
or make a second publisher. An authorized result lookup must use the original
scope/key/function/identity/request commitments even after active-head movement;
reading an already committed result does not authorize another write against
that old binding. Scope-access revocation can still deny disclosure.

| Evidence at recovery | Required behavior |
| --- | --- |
| Exact child committed result exists | Return the same value/digest and reconcile effect confirmation; no framework callback reruns. |
| Retained result body expired | Explicit result-unavailable outcome; never execute to rebuild it. |
| Same slot has different command/args/policy/bindings | Request conflict; never mint a second key automatically. |
| Prepared intent, no dispatch declared | Dispatch only after revalidating the same parent/grant and frozen bindings; otherwise fail before dispatch. |
| Dispatch declared, no conclusive child result | Reconcile through the persistence owner with bounded settlement. A missing row or a host's last phase is not proof of rollback. Preserve uncertainty if the owner cannot establish a decision. |
| Child committed, outer Action failed/cancelled | Preserve child success evidence and the Action's non-completed terminal result separately. |

Expected authorization/input/conflict/staleness failures remain distinct typed
errors. Resource failures do not become authorization failures; corruption does
not become resource exhaustion. A child outcome that is uncertain or unavailable
is settlement data at the coordinator boundary, not a generic retryable throw.
The Action bridge must poison completion on unresolved callback uncertainty even
when application code catches its boundary error. Never turn a failure to record
confirmation into a claim that the child rolled back.

## Shared Effect Ledger And Migration Boundary

Add a distinct `framework_command` branch to the existing external-effect
owner. Reuse the parent subject, ordinal, fence and prepared/dispatching/
confirmed/uncertain lifecycle; do not add a command-run table or another
orchestration ledger. The branch retains a command request key, command ID and
contract digest, an immutable canonical request-body reference containing the
frozen intent, and a confirmed outcome digest. Reuse existing evidence-body
storage mechanics with a command-specific codec; no raw request or result body
is placed into ad-hoc SQL JSON columns.

This requires an additive migration on the existing effect table: dedicated
command identity/outcome columns plus exact branch checks for kinds, request
body reference and confirmation. Existing HTTP and native child-mutation
columns retain their meanings and must be null for the command branch where
inapplicable. All old rows and their current checks remain supported. Implement
both fresh-install and upgrade paths, codecs, transition decoders, Action
parent-effect aggregation, reconciliation and retention readers as one owner
change. Enumerate every reader before committing the migration.

Use explicit new compatibility identities for the expanded effect envelope and
Action callback/host-policy ABI where their old exact decoders cannot admit the
new shape. Keep names of current product services unversioned. Do not reinterpret
existing V1 bytes, rename an old physical table merely for chronology, or enable
new writes while an active reader only understands the old union. There is no
production rollout in this slice; mixed-reader refusal and upgrade tests still
must establish the activation order.

Approval of implementation must explicitly include this shared effect contract,
additive migration, Action policy/runtime changes, command authorization and
frozen-intent recovery. They are necessary parts of this proposed capability,
not incidental permission inferred from the earlier shared-core refactor.

## Lifetime And Task Disposition

The Action host owns one callback session and shared syscall sequence. The
command shares its existing 64-call/1-MiB/10-second admitted execution envelope
across domain participants; the callback gets no reset of the outer deadline.
Before dispatch, ensure the remaining parent budget covers command execution
and the declared physical/effect settlement reserve. Close revokes further
calls, cancels active work, drains physical settlement and reconciles effect
evidence before releasing the parent capability. A late committed result is
recorded as committed, even when the parent was interrupted. Recovery has its
own existing bounded allowance and never restarts arbitrary Action source.

| Parent | Admission in first slice | Later requirement |
| --- | --- | --- |
| Direct Action | Proposed, one named command | Complete exact-runtime, principal, replay and settlement proof below. |
| Durable Task | Not enabled | Run-stable command slot across attempts, distinct current attempt/fence authorization, immutable Task revision/principal, pre-heartbeat admission, lease/cancellation races, takeover and reconciliation on both admitted Worker and Node transports. |
| Native query/mutation | Refused | No independent child commit inside their atomic execution contract. General mixed OCC is separate. |
| Arbitrary HTTP caller or public SDK | Not enabled | Route authentication, rate/resource policy, exposure and deployment decisions. |

For Tasks, a future key must bind scope/run/command ordinal independently of
attempt/fence; the dispatch capability must still bind the current attempt and
fence. Reuse the Task-owned external-effect reconciliation and launch principal
mechanics. Do not reset intent on retry, silently use anonymous identity, or
hold a Task lease/database transaction across workflow suspension. A successful
Action proof alone does not prove Task retry correctness.

## Implementation Scope And Decisive Proof

Implement the Action vertical as one coherent approved capability:

1. Define the exact command descriptor, grant, callback/key/intent codecs and
   effect branch; implement migration and unchanged old-contract tests.
2. Add principal-bound admission and frozen-intent execution/recovery to the
   existing private command owner; separate ordinary Payload setup from fault
   fixtures while preserving actual service paths and conformance coverage.
3. Integrate the Action runtime, pinned policy and host callback/effect branch;
   keep `runAction` as ingress and keep other runtimes unable to dispatch it.
4. Add the real application source and connected proof, then remove displaced
   mechanics within the slice and update the owning roadmap status.

| Gate | Required evidence |
| --- | --- |
| Real invocation | Clean `runAction` -> genuine Action Worker -> authenticated `runCommand` callback -> real Currency/Payload/Application command; no direct host call masquerading as application use. |
| Atomic child / independent parent | Child late failure leaves no partial state; child success followed by Action failure preserves all three writes and one child outcome/wake. |
| Authorization | Anonymous, wrong principal/Action, unknown reference, copied grant, cross-scope/placement, swapped installation and unsupported runtime all reject without child writes. Principal and command policy remain pinned. |
| Exact replay | Parent replay and fresh callback-host recovery do not repeat the command. Changed arguments at the same slot conflict. Expired result refuses re-execution. |
| Head movement | Before dispatch: stale grant refuses. After child COMMIT: original result resolves and effect confirmation reconciles without rerunning callbacks under either head. |
| Crash/uncertainty | Fault before/after effect prepare, dispatch declaration, child COMMIT, confirmation and Action settlement; process loss and lost acknowledgements cannot cause a fresh-key write or false rollback report. |
| Cancellation and resource limits | Interruption during Payload/SQL, caught callback errors, detached callbacks, drained close and exhausted parent budget preserve actual settlement and forbid further dispatch. |
| Existing contracts | Native query/mutation callbacks, Action HTTP evidence, existing retained Action/Task rows, private composite/Payload/Currency suites and old exact ABI refusal remain intact. |
| Migration | Fresh and pre-change catalogs on PGlite and ordinary-role PostgreSQL; old rows decode unchanged, new branch checks reject malformed state, old-only reader activation refuses new command writes. |

Run affected package typechecks/builds, protocol and migration tests, focused
PGlite and genuine PostgreSQL correctness suites, genuine Worker execution,
source/bundle boundary checks, core/diff/staged lint and both standing reviewers.
Record detailed receipts outside living roadmaps. No test or compiler success
may stand in for the connected Worker plus physical PostgreSQL gates.

Completion of this slice admits only one private Action command. Task callbacks,
public endpoints, arbitrary Payload hooks, durable domain-event delivery,
additional commerce installations, Product scale and general mixed OCC retain
separate decisions. No performance implementation is selected here.
