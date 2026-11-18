# Logical Reference Validation Checkpoints

## Status And Scope

Status: implemented private capability for explicitly admitted ordinary logical
Commerce participants. Neutral atomic-host execution and existing Product
consumer controls cover the bounded owner contract. Native Tax Region creation
remains unadmitted. This roadmap owns explicit reference checks within a trusted
ordinary logical Commerce participant. It does not authorize a native workflow, expose a
public database API, or change settlement, schemas, durable encodings or limits.

The named need is the native
Tax Region creation workflow.
Its module flush must detect a missing Region reference before proceeding to
connected Rate and Rule writes, while preserving native callbacks and failure
precedence. Adapter checks or fabricated SQL failures cannot supply that storage
guarantee. The checkpoint capability alone does not admit that flush behavior.

## Current Sources Of Truth

The [accepted database design](../../design-notes/flarex-db-accepted-design.md),
[shared logical storage design](../../design-notes/flarexdb-shared-logical-storage.md)
and [package boundaries](../16-package-boundaries.md) own architecture and
responsibility. This capability remains subordinate to those accepted decisions.

The implementation owners are:

- [Participant capture](../../packages/persistence-postgres/src/frameworks/atomicCommerce/participants.ts),
  [configuration](../../packages/persistence-postgres/src/frameworks/atomicCommerce/configuration.ts)
  and [execution](../../packages/persistence-postgres/src/frameworks/atomicCommerce/execution.ts)
  own explicit admission and prepared execution identity.
- [Logical Commerce participants](../../packages/persistence-postgres/src/frameworks/commerceTransaction/logicalParticipant.ts)
  and [command contexts](../../packages/persistence-postgres/src/frameworks/commerceTransaction/context.ts)
  expose only the selected bounded operation.
- The [logical working set](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts)
  owns live-row validation, target observations, final revalidation and failure
  issuance. Its [failure evidence registry](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/referenceFailure.ts)
  owns exact-error provenance.

The [neutral atomic-host scenario](../../packages/persistence-postgres/test/frameworks/commerceTransaction/referenceCheckpointScenario.ts),
[direct reference scenario](../../packages/persistence-postgres/test/frameworks/commerceTransaction/productForeignKeyScenario.ts),
[connected driver entries](../../packages/medusa-adapter/test/schemaComposition.test.ts),
[physical admission refusal](../../packages/persistence-postgres/test/frameworks/atomicCommerce/atomicCommerceSharedInstallation.test.ts),
[borrowed workflow refusal](../../packages/persistence-postgres/test/frameworks/atomicCommerce/borrowedWorkflowCapture.test.ts)
and [failure identity controls](../../packages/persistence-postgres/test/storage/documents/logicalReferenceFailure.test.ts)
define the bounded conformance obligations. Native workflow admission needs
separate connected evidence.

## Current Architecture

A trusted participant explicitly selects `allowReferenceCheckpoints: true`.
Capture accepts only the optional literal true. Admission requires logical
storage and `validateLogicalCall`; aggregate validation alone is insufficient.
The selected participant names enter the prepared execution identity. Omitting
the selection preserves existing profile identities and leaves the command
context without this capability.

The optional `checkpointRelationalReferences(tableName)` command operation
binds the existing manager context and transaction identity. The working set
checks the live write-mode borrow, admitted table, logical relational metadata,
ordinary transaction, deadline and call budget through its existing owners.
Physical participants and borrowed finite or durable workflow views without a
complete participant closure refuse this selection. Pending durable overlays
and evaluator-backed roots cannot use the working-set operation.

For the authenticated table, the checkpoint checks each current live row that
has an attempted mutation. It resolves every admitted scalar foreign key
against the current pending view, preserving unique-slot or indexed target
observations for publication revalidation. Nullable references retain their
existing handling. It does not accept supplied row bodies, target-existence
claims or a caller-selected reference policy.

The operation performs reference checks only. It does not run cascades, set
references to null, rekey rows, generate timestamps, emit events, create write
attempts, publish data or settle the transaction. It consumes the existing
operation budget and retains the actual read evidence needed by core.

Final close still performs the existing removal, cascade and replacement phases
before validating live relational targets. A successful checkpoint does not
freeze its table, discharge later checks or make later parent deletion safe.
Profiles without the selection keep the same deferred close behavior and order.

## Invariants And Trust Boundaries

- Core alone validates reference existence and retains dependency evidence.
  Framework code may choose a native flush boundary, but cannot replace this
  operation with a pre-read, direct SQL or a second transaction.
- Scope, table ownership, lifetime, write mode, deadline, limits and sticky
  failure semantics remain enforced by the existing request and working-set
  owners. Catching a checkpoint failure cannot rescue the failed root.
- The capability grants no target writes, clock access, raw transaction,
  settlement or finalizer authority. Untrusted code receives none of these.
- A checkpoint does not apply deletion policy early. Default close processing
  remains authoritative for complete cascades, set-null work and rekey checks.
- All admitted data, history, indexes, facts and events still publish through
  the singular trusted outer settlement owner.

## Decisions And Rationale

Explicit participant selection preserves deferred reference behavior for current
consumers while permitting a native synchronous flush boundary where required.
Reusing the close-time live-target validator avoids a second reference engine.
Identity binding prevents an outcome prepared with this selection from replaying
under an otherwise similar participant that omitted it.

The storage owner records read-only failure evidence in a private WeakMap keyed
by the exact issued error. Evidence identifies checkpoint or close origin, the
child table and document, source column, and target table, column and key. The
existing error classification remains unchanged. The private Commerce facade
exports inspection, not issuance. Copies, serialized values, matching fields and
error causes do not establish provenance; a reused error object retains its
first issuance. This evidence is neither a SQL error nor a recovery capability.
Native error presentation remains a separate adapter/native-source obligation.

## Convex Compatibility And Flarex Divergences

The existing portable Application document and OCC contract remains unchanged.
This private capability serves admitted framework relational semantics over the
shared logical store; it is not a new Convex mutation API. PostgreSQL remains
the only commit authority, and framework profiles remain distinct from native
Application execution. No transaction may span untrusted execution, remote
effects or workflow suspension.

## Implemented Capabilities

The implementation contains explicit participant capture, conditional identity
binding, bounded command exposure, live attempted-row reference validation and
exact-error inspection. Default close reuses that validator after its existing
transition phases. Physical and borrowed-profile refusal controls and neutral
reference scenarios accompany the implementation. Selected atomic execution,
final-close revalidation and default Product behavior are covered independently
of native Tax workflow admission.

## Known Gaps And Limitations

The native Tax consumer still needs authenticated flush staging, native error
presentation and complete workflow receipts. Checkpoint evidence alone does
not render a native database or entity-validation error.

The operation is limited to current live attempted rows of one authenticated
table. It is not a whole-source integrity audit, durable checkpoint, general
constraint flush, or substitute for final close and publication checks.
Physical and borrowed profiles remain unsupported. No deployment, scale,
performance or hosted activation claim follows from bounded local validation.

## Target Direction

Admit a named native consumer only
when its genuine transaction, callbacks, write ordering, failures and retained
inverse are preserved through the existing core and adapter owners. Keep the
shared operation independent of Tax models and native error formatting.

## Next Correctness Gates

- Close the native Tax Region flush and error-presentation gaps,
  approved ordering, complete native results/events and retained compensation
  on both database lanes. Only that connected proof can advance its workflow
  admission; other profiles and default resource limits remain unchanged.
