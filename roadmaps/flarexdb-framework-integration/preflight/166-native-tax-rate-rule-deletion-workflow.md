# Native Tax Rate Rule deletion

## Status and authority

Status: admitted for the private bounded profile on PGlite and ordinary-role
PostgreSQL, with explicitly approved scoped Rule lifecycle ordering.
The selected root is `deleteTaxRateRulesWorkflow({ ids })`, its genuine
`deleteTaxRateRulesStep`, and retained `restoreTaxRateRules` compensation.
The reference remains Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

Accepted shared logical storage, framework ownership and workflow lifetime
boundaries apply. Necessary shared-owner corrections use standing approval.
[Rule creation](./165-native-tax-rate-rule-creation-workflow.md) supplies complete
Rule contracts and a physical inverse. This separate soft-delete/restore root
uses its own approved ordering decision; other profiles remain unchanged.

## Connected native contract

The workflow returns native void. Empty forward IDs skip Tax resolution and
retain an empty array. Nonempty IDs call genuine `softDeleteTaxRateRules(ids)`
and retain the original requested IDs, including duplicates and missing IDs.
Empty compensation skips resolution; nonempty compensation calls genuine
`restoreTaxRateRules` with that retained request.

Both methods come from the generated Medusa service and transaction-managed
internal lifecycle services. The executing original baseline uses the pinned
MikroORM repository and lifecycle utilities. The alternative Drizzle lifecycle
path does not establish this baseline's active-restore or event behavior.
Rules are leaves: parent Rates, Regions and Providers are preserved. Active
uniqueness remains `(tax_rate_id, reference_id)`.

The native affected maps contain `tax_rate_rule_id` for actual affected rows and
deduplicate the requested cohort. Soft-delete skips already-deleted Rules;
restore includes both deleted and active Rules. Restoring a deleted Rule clears
`deleted_at` and advances `updated_at`. Direct active restore returns its ID in
the affected map without changing timestamps or content.

Soft-deleting active Rules emits native deleted events. The pinned restore
service does not register the persistence mutation subscriber: neither changed
restores nor active no-op restores emit restored events. Logical mutations alone
must not be used to invent such messages.

## Original-native history and ordering

Retaining original requested IDs has a native history consequence. A Rule already
deleted before the workflow is skipped forward, but cancellation can restore it.
This behavior is preserved in the baseline; no correction to the native retained
selector is proposed. Missing and duplicate request IDs remain in compensation,
while maps and writes concern actual matched rows.

If another active Rule takes the original unique key, cancellation fails and
rolls back the complete restore cohort. The independent conflicting Rule remains
intact. Native late failure can deliver deleted events before compensation;
compensation restores rows without restored events. Flarex's trusted whole-root
atomic publication and rollback remain separate from that original execution.

Repeating a native transaction ID executes soft-delete again, usually returning
an empty map for the now-deleted cohort, and retains the request anew. Trusted
durable replay must not be inferred from that native behavior.

The original maximum deliberately separates creation, request and ID order.
Native deleted events and both affected maps follow storage insertion order.
The native SQL has no general ordering guarantee. The approved portable profile
binds the complete historical Rule selection and its actual storage-insertion
identities. Deletion events and both affected maps use that selected order;
the Rule creation root's physical inverse keeps its separate profile.

## Bounded implementation

The candidate exposed a shared scalar receipt defect: an active restore's
`rowAtOperation` could contradict the independently observed row and still be
accepted. The expected result is `receiptMismatch`; the original validator
accepted changed business content and managed timestamps. The scoped correction
belongs to `repository/scalar-lifecycle-receipt.ts` under standing core approval.
It correlates unchanged operation rows with any independent final observation,
while retaining authenticated operation rows when closed-child receipts omit
unchanged observations. Mutation preimages remain distinct from the final
pending view. This changes receipt validation, not native restore behavior.
The shared validator returns its established requested IDs and decoded preimage
map so Tax adds only historical membership, ordering, parent and event policy.

The native root also requires the portable SDK's branded authoring-time void
annotation, `WorkflowResponse<WorkflowData<void>>`. The exact source guard binds
that erased annotation; the resolved void contract and runtime program remain
native.

The private `tax.ruleDelete` / `flarex-tax-rule-delete` profile admits zero to
eight requested Rule IDs across at most four existing Rates. Historical
selection is complete, including requested deleted Rules, before active-only
forward transitions are planned. The existing 64-call/64-event and other
resource limits remain unchanged.

Only the exact native root and step are promoted through private exports,
complete callback/source-pair guards and the existing portable workflow host.
Native void, original retained IDs and empty resolution behavior remain intact.
Tax construction, complete DML-derived Rule contracts, the scalar bridge,
`medusaLifecycle` and `scalarLifecycleReceipt` retain their existing ownership.

The confined profile grants Rule soft-delete/restore only. Its receipt policy
authenticates complete historical queries, transitions, active no-ops, affected
maps and deleted events; restore admits no events. Parent repositories remain
denied and only the trusted outer owner settles rows, facts and publication.
Native restore conflicts retain whole-cohort rollback. Trusted durable replay
does not re-execute the native callback; independent cold Tax calculation sees
the committed Rule lifecycle state.

Physical Rule deletion remains with the creation inverse. Rule replacement,
Rate updates/deletion, Tax Region/provider bootstrap, complete Cart admission,
remote providers, File import/export, performance acceptance and production or
hosted activation remain outside this root.
