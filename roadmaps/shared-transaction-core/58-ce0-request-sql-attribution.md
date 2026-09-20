# Complete Request SQL Attribution

Status: bounded complete-request attribution implemented; shared materialization
correction and protected readiness-root work remain open.

## Outcome And Boundary

Attribute the paired scalar profile's common empty-read work and additional
nonempty mutation statements before replacing a core contract. The paired
measurement establishes counts but its limited family counters do not identify
all control metadata or distinguish multiple statements touching one family.

Extend the existing test-only PostgreSQL observer with opt-in SQL-text digest
groups, top-level commands, known physical-family mentions and query ordinals.
Retain no SQL text, parameters or result bodies. Digests identify exact statement
text, not normalized semantic plans; family mentions are not a SQL parser.
Use the existing real host, independent references, fixture and environment
recorder for empty reads, zero/one/eight/thirty-two inserts and exact replay.
Verify results, publication, replay and pool cleanup outside observation.

Attribution instrumentation is deliberately separate from neutral latency
measurement. Hashing and classification costs preclude using these durations as
replacement latency evidence. Parameter and returned-byte costs, server plans,
CPU, WAL, lock duration and capacity remain unmeasured.

## Challenged Alternatives And Ownership

Do not delete the extra statements merely because the specialized first-insert
reference omits them: the generic materializer also handles replacements,
tombstones, dependency checks, prior memberships and guarded state transitions.
Trace each difference to its actual owner and retained invariant. Similarly,
equal core/reference read counts do not establish minimal shared admission cost.
Avoid another pool proxy, production telemetry hook or benchmark-specific
runtime path; the existing observer owns interception and restoration.

No production API, schema, format or durable-data change is needed for this
slice. There is no displaced runtime implementation to preserve or retire.
All diagnostics remain under test support, and the existing default observer
keeps its lower-cost counters without statement hashing.

## Validation And Completion

Exercise enabled attribution with real ordinary-role PostgreSQL, including
parameter variation, callback queries, failures and query/listener restoration.
Reconcile grouped calls and ordinals with total calls; known family classification
must not retain payload data. Run the selected request comparison with exact
fixture verification. Run affected types/lint and both read-only reviews before
the scoped commit; stop owned resources. PGlite correctness witnesses remain
unchanged because this slice changes only driver-specific diagnostic support.

Record resulting owner attribution and the next justified correction here.
Keep raw reports and environment/source hashes in local measurement artifacts;
numerical run receipts belong in the report and commit rather than a roadmap log.

## Current Owner Attribution

The nonempty scalar difference is fixed across the admitted one/eight/thirty-two
row profiles. Exact statement hashes differ for some equivalent writes, so the
net call attribution uses top-level command and mentioned-family sets, followed
by source inspection; hashes alone are not semantic equivalence evidence.

| Additional core calls | Owner and retained purpose |
| --- | --- |
| Six scope-clock reads | Two membership-head readers, row append authority, two index append authority checks, and unique mutation authority |
| Four membership-head reads | Intrinsic/developer action preparation and each index append's predecessor validation |
| Three current-row/revision checks | Live-parent validation for both index batches and unique ownership |
| Two unique-key reads | Action preparation reads current owners; mutation application locks and validates current owners and key slots before writing |
| One dependency-head query | Shared participant validates the closed command against current/latest revision evidence |
| Two index writes | Intrinsic and developer membership batches each write revisions and current pointers; the restricted reference combines the two families of memberships |

The source owners are `applicationDocumentMaterialization/participant.ts`,
`applicationDocumentMaterialization/materialization.ts`, `appRows.ts`,
`appIndexEntries.ts`, and `appUniqueKeys.ts`. The restricted reference is not a
general replacement for these contracts. A foreign prior revision, malformed
parent, stale epoch or conflicting owner still requires a decisive refusal.

Empty reads show substantial repeated control/admission evidence: scope and
provisioning resolution, active heads and activation frames, schema manifests,
ordered/unique definitions, readiness, write ownership and data-binding evidence.
This work spans preparation and current transaction admission; repeated SQL text
does not imply it is safe to reuse stale authority. The responsible owners are
`scopeAuthorityResolution.ts`, `applicationActivation.ts`,
`applicationRelationReadinessFold.ts`, `applicationReadiness.ts`,
`applicationBindingProjection.ts` and `cmsTransaction/admission.ts`.
Protected metadata/readiness-root gates remain required before replacing deep
integrity verification with a cached commitment.

## Next Correction Boundary

Investigate a single bounded membership application at the existing shared
materialization/index owner: keep intrinsic and developer logical preparation,
then combine their physical membership application where order and failure
semantics permit. This addresses duplicated authority, parent and predecessor
reads plus split writes without adding a privileged skip-validation flag.
Existing bounded chunks may still require multiple physical writes; no reduction
is assumed at every row count, and changing a batch budget needs its own proof.
Before implementation, preflight exact failure order, duplicate positions,
per-command budgets, live/tombstone transitions, unchanged memberships, mixed
intrinsic/developer history and native/CMS consumers. A passing first-insert
reference alone cannot authorize that replacement. Broader evidence reuse across
row/index/unique owners and cross-request metadata caching are separate decisions.
