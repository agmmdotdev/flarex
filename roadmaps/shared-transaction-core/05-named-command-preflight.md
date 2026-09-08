# Private Cross-Domain Command Preflight

## Decision And Status

Proposed; implementation requires explicit approval. The recommended next
shared-core capability is one named trusted command that changes an
Application-owned row, creates a scalar Payload CMS announcement, and performs
one admitted Medusa Currency write in the same scope and physical transaction.
It returns one retained result and settles through one outer finalizer.

R1/R2 completed the audited default ownership replacements. This capability
closes a different gap: independent framework hosts currently share mechanisms
but cannot participate in one command. It is not a prerequisite invented to
reopen R2, a performance project, or general cross-framework logical OCC.

The [accepted shared-owner design](../../design-notes/flarexdb-commerce-occ-migration-preflight.md),
[execution profiles](../flarexdb-framework-integration/preflight/14-transaction-execution-profiles.md#explicit-cross-domain-atomic-command),
and [framework transaction gate](../flarexdb-framework-integration/04-transactions-and-commit-publication.md#explicit-cross-domain-command-gate)
own the direction. This record proposes its concrete first admission and
implementation scope. The original revised shared-transactions design report,
sections 7 and 13, separates default consolidation from optional named SQL
composition and says not to invent a refactor when existing owners fit.

## Current Evidence And Gaps

| Current source | Finding and consequence |
| --- | --- |
| [Physical session](../../packages/persistence-postgres/src/physicalSession/postgres.ts), [relational session](../../packages/persistence-postgres/src/relationalTransaction/session.ts) | Physical transaction lifetime and settlement already have a neutral owner. Reuse them; no new driver or COMMIT state machine. |
| [CMS host](../../packages/persistence-postgres/src/cmsTransaction/host.ts), [commerce host](../../packages/persistence-postgres/src/commerceTransaction/host.ts) | Each opens its own session, locks the scope clock, resolves its own request outcome, runs domain work and finalizes. Sequential host calls cannot provide atomic composition. |
| [CMS admission](../../packages/persistence-postgres/src/cmsTransaction/admission.ts) | Explicitly rejects a frame with commerce. Removing that condition alone would omit the new participant and finalization authority. |
| [Binding model](../../packages/persistence-postgres/src/frameworkSchema/binding/model.ts), [commerce admission](../../packages/persistence-postgres/src/commerceTransaction/admission.ts) | The existing frame can hold Application, Payload content and one commerce binding. Commerce verifies its installation and Application projection; composition must authenticate one common frame/head and placement for all participants. |
| [CMS publication](../../packages/persistence-postgres/src/cmsTransaction/publication.ts) | Authenticates closures and receipts, allocates a sequence, lowers Application data, and publishes. R2 separated ownership, but did not expose a borrowed contribution that waits for another domain. |
| [Commerce publication](../../packages/persistence-postgres/src/commerceTransaction/publication.ts) | Consumes its own row closure, allocates and publishes. Split participant contribution from root finalization without creating a second publication algorithm. |
| [Application materializer](../../packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts), [scope execution](../../packages/persistence-postgres/src/scopeExecution/ScopeExecution.ts) | Row/index/unique/relation lowering and scoped execution exist. Neither alone is an authenticated Application business-write capability. A narrow Application participant is new work. |
| [Publication model](../../packages/persistence-postgres/src/commitPublication/scopePublicationModel.ts) | Already represents Application row intents and relational facts together. Reuse this representation after participant authentication; its structural type is not authority. |
| [Relational fact reader](../../packages/persistence-postgres/src/commitPublication/relationalFacts.ts) | Validates every relational fact against one installation/layout. Scalar CMS content is Application data, so one Currency installation fits; multi-installation consumption is unnecessary for this scope. |
| [Request recovery](../../packages/persistence-postgres/src/relationalTransaction/requestRecovery.ts) | One recovery-only re-entry after an uncertain decision; it does not retry business work. Reuse it for the whole command. |

Existing regression anchors include the CMS host and participant-admission
scenarios, Payload scalar scenarios, commerce publication scenario, and
[actual Currency service publication proof](../../packages/medusa-adapter/test/support/live-checks.ts).
They establish the available individual paths and assertions, not combined-command
conformance. This preflight is source inspection; it does not claim a new test run.

## First Command Contract

Use a private `publishCurrencyAnnouncement` command as the bounded integration
proof: upsert one Currency through the existing private Medusa internal service
path, create one scalar CMS post through Payload's Local API, then create one
Application-owned announcement record. Return the Currency code and both row
identities. The final Application step is the decisive late-failure case.
This command name is a proposal, not a shipped API or a claim of product demand.

Use the existing Currency `internal.upsert` followed by
`service.retrieveCurrency` with the same admitted manager, as the publication
proof does. The public Currency facade currently exposes reads; do not invent a
public Currency write method. Require a ready, initialized Currency installation;
bootstrap is not part of the atomic command.

Use one active Application schema containing the admitted scalar posts table
and one distinct Application-owned table. CMS may write only its bound content
tables. The Application participant may write only the selected Application
table and must apply its schema and write policy. Neither capability may write
the other's table, use raw SQL, or fabricate native transaction grants.

The first profile has `payloadLifecycle: null`, exactly one commerce
installation, no cross-domain relation definitions, and no domain-event
delivery. A Currency code in the Application record is scalar data, not a new
cross-domain reference contract. Refuse unadmitted events before settlement;
do not silently discard or locally buffer them as a substitute for durability.
Ordinary shared commit facts and the outbox wake remain required.

Payload root/request setup and supported access, validation, hook order and
pending reads remain with its adapter. Admit only the checked-in bounded scalar
configuration and trusted test hooks. Arbitrary user hooks, uploads, drafts,
preferences, Product, workflows, public `ctx` APIs, sandbox callbacks and
cross-placement execution are excluded.

## Ownership And Execution

1. The private host captures canonical input and command identity, resolves
   scope/placement and prepares domain capabilities. It opens one existing
   relational session. Preserve scope-clock FOR UPDATE first, then installation
   availability locks and domain rows. Authenticate all participants against the
   same epoch, generation/fence, active Application selection and binding head.
2. Resolve one retained request outcome before any framework callback. Use a
   dedicated private command namespace and function path. Hash canonical args,
   the operation contract identity, complete binding/head, scope/generation and
   existing access-policy identity. Reuse the current outcome schema; no child
   request keys or child success records are written.
3. Issue opaque borrowed capabilities bound to that physical transaction and
   request. Framework contexts retain their own shapes and domain errors. One
   root lifetime governs closure, aggregate resources and rollback-only state;
   domain children cannot seal or settle it. A caught participant failure still
   poisons the entire command. Reject missing, foreign, copied, expired or
   mismatched handles, concurrent sibling operations and detached continuations.
4. Execute the three fixed steps serially. Read-after-write through each domain
   capability must see its pending changes. Application and CMS share the
   underlying document preparation/lowering owner, while retaining distinct
   write authority and working-state ownership. No general callback interpreter
   or arbitrary cross-domain query facade is introduced.
5. Close all borrowed work and seal the full expected participant set. Consume
   each authenticated closure once; reject missing, duplicate, foreign and
   forged contributions, even for a participant producing no changes. Validate
   Application/CMS table ownership and the complete combined document delta
   before lowering, including native index and unique constraints. Do not lower
   two unrelated partial document plans that can omit each other's effects.
6. The outer owner allocates one commit sequence and supplies it to document
   lowering and every fact family. Preserve candidate-schema checks, revision
   history, indexes, uniqueness and relation-maintenance policy in the shared
   materializer. Collect authenticated relational facts from commerce, then
   write one header, ordered complete facts, one result, one wake and one clock
   advancement through the existing publisher. Only the physical owner commits.
7. Return success after confirmed settlement or authoritative retained-outcome
   recovery. A lost COMMIT acknowledgement permits recovery-only re-entry, never
   callback replay on a missing outcome. Retained result expiry, changed request
   input and stale binding retain explicit refusal outcomes. Cancellation waits
   for physical cleanup and revokes every borrowed capability.

Keep current bounded SQL isolation. This is not native snapshot/journal/OCC
execution. Verify that its Application writes remain visible to, and conflict
correctly with, existing native attempts through normal revision/index facts.

Proposed aggregate limits retain the current framework envelope: 10 seconds
for command execution, 1 second per statement, 500 ms lock wait, and 2 seconds
for cleanup. Share at most 64 charged operations and 1 MiB captured command,
working-state, receipt and result budget across participants; retain 64 KiB
individual row/document ceilings and existing domain-specific tighter limits.
Nested calls do not reset the deadline or receive another full budget. Reuse
the existing separate bounded recovery attempt. No automatic callback retry,
savepoint recovery or new timeout/cleanup policy is admitted.

## Source Compatibility And Challenges

The pinned [Medusa source identity](../../third_party/medusa/SOURCE.json) and
[transaction decorator](../../third_party/medusa/upstream/packages/core/utils/src/modules-sdk/decorators/inject-transaction-manager.ts)
show that an existing transaction manager is reused. The adapter already passes
the same manager to internal and module services. Preserve this path and its
Promise continuation ownership instead of writing directly to Currency tables.

The existing Payload 3.88.0 source audit in
[record 14](../flarexdb-framework-integration/preflight/14-transaction-execution-profiles.md#source-evidence)
is consistent with the pinned source inspected for this preflight:
`initTransaction` distinguishes root-created from borrowed requests;
`afterChange` runs before commit; upstream Drizzle `getTransaction` can fall back
to its default connection. Retain Flarex's closed-handle refusal rather than
importing that fallback. Extract only the required adapter invocation seam from
the private scalar runtime; do not copy its whole proof runtime into a new host.

| Path | Disposition |
| --- | --- |
| Neutral physical session, publisher, retained outcomes and recovery router | Keep; reuse their existing state machines. |
| Standalone native, CMS and commerce commands | Keep supported boundaries. Their callers and compatibility proofs are concrete obligations. |
| CMS and commerce root finalizers | Rewrite only the portion needed to use shared participant preparation and closure consumption; retain operation-specific root wrappers for existing callers. Delete displaced duplicate mechanics in the same slice. |
| CMS-only admission restriction | Keep for standalone CMS. Add separately authenticated composite admission, rather than globally relaxing the profile. |
| Application materializer | Keep lowering policy; add the narrow participant preparation/closure seam without importing CMS authority or synthesizing native grants. |
| Synthetic receipt/lifetime proof | Keep its test-only refusal boundary and unique negative proofs. Do not turn it into a fallback publisher. |
| Legacy serving engine, journals, leases and migration/control-plane state | Keep; no serving transition or schema retirement is selected. |
| Existing single-installation fact reader | Keep unchanged unless this exact first profile disproves adequacy. Multiple relational installations require another preflight. |

Do not create a new package, universal participant registry, generic transaction
callback API, transaction tables, history tables, or migration for file-level
uniformity. A private host and narrow participant contracts belong with the
persistence/domain owners; Medusa translation remains in its adapter. Any new
adapter access uses the existing private boundary, not a public package root.

The accepted notes previously still described R2 as awaiting approval and all
commit-family work as pending. Those statements are stale and are reconciled
with current source. Conversely, the broader framework gate mentions typed
event intents: this first proposed profile admits no domain events and therefore
does not complete that broader delivery gate. Performance and Product scale
remain independent; neither is the implementation selected by this preflight.

## Implementation Order And Completion Proof

Implement this as one coherent capability: participant closure seams and root
adapter reuse; composite binding/lifetime/replay admission; explicit Application
capability and combined lowering; fixed Payload/Currency command integration;
then failure/concurrency/recovery conformance and removal of displaced code.
These are implementation steps, not separate research or approval turns.

| Proof | Required evidence |
| --- | --- |
| Success and replay | All three actual domain paths run; one commit/result/wake and one sequence advance; complete Application and Currency facts; duplicate replay invokes no callbacks. |
| Late failure and publication failure | Fail the final Application step, fail immediately after all steps, and fail each publication stage. Entire participating row/revision/index/fact/result/wake inventory remains unchanged. |
| Borrowed lifecycle | Pending reads, nested completion, caught nested errors, missing/removed IDs, copied tokens/closures, closed handles and detached Promise work cannot escape the root owner. |
| Authority and resource limits | Mixed scope/placement/generation/head, swapped installations, CMS/Application table crossover, absent/duplicate receipts, events and aggregate budget/deadline overruns refuse before settlement. |
| Native preservation | Existing native point/range OCC, unique/candidate checks and CMS relation/preference regressions pass; a native attempt overlapping a composite Application write observes the normal conflict behavior. |
| Genuine PostgreSQL | Two connections exercise same-scope and duplicate-key contention, native overlap and applicable activation/installation fencing; cancellation cleans up; real settlement fault injection/process loss proves recovery without re-executing callbacks. PGlite is not evidence for these claims. |
| Framework compatibility | Existing scalar Payload and original Currency service assertions remain unchanged; shared standalone finalizer consumers retain their current semantics. |

Run focused PGlite and PostgreSQL suites for touched hosts, materialization,
publication and actual adapters, package typechecks, `pnpm lint:core` and
`pnpm lint:diff`. Significant implementation requires both project reviewers
and the exact staged lint gate before commit. Record test receipts outside the
living roadmap. Update this record and owning framework contracts to distinguish
the implemented private command from still-gated public, event and mixed-OCC work.

Exit requires the real three-domain call path, a single settlement owner,
complete authenticated publication, unchanged standalone/native guarantees and
passing physical PostgreSQL proofs. A synthetic publisher, three sequential
root hosts, a shared SQL handle, or a passing happy-path fixture is insufficient.
No Cloudflare deployment claim is part of this private persistence capability.
