# Private Cross-Domain Command Preflight

## Decision And Status

Implemented privately as `makeCurrencyAnnouncementHost`, with the retained
operation identity `publishCurrencyAnnouncement`. One trusted command upserts
Currency through the real Medusa service, creates a scalar Payload CMS post,
and inserts one Application-owned record in one scope and physical transaction.
It returns one retained result and settles through one outer finalizer.

R1/R2 completed the audited default ownership replacements. This separate
capability adds actual participation across the framework boundaries. Public
exposure, event delivery, multiple relational installations and general mixed
sandbox OCC retain separate admission gates.

The [accepted shared-owner design](../../design-notes/flarexdb-commerce-occ-migration-preflight.md),
[execution profiles](../flarexdb-framework-integration/preflight/14-transaction-execution-profiles.md#explicit-cross-domain-atomic-command),
and [framework transaction gate](../flarexdb-framework-integration/04-transactions-and-commit-publication.md#explicit-cross-domain-command-gate)
own the direction. This record defines the implemented first admission and
its bounded scope. The original revised shared-transactions design report,
sections 7 and 13, separates default consolidation from optional named SQL
composition and says not to invent a refactor when existing owners fit.

The [application invocation preflight](./06-application-command-invocation-preflight.md)
now specifies the proposed caller boundary. This private host's policy digest
is replay evidence, not an application authorization grant; its conformance
runtime and process-local recovery do not establish an Action/Task API.

## Current Owners And Evidence

| Source | Implemented responsibility |
| --- | --- |
| [Composite host](../../packages/persistence-postgres/src/crossDomainCommand/host.ts) | One fixed command, admitted domain contexts, aggregate lifetime, retained lookup, combined contribution and outer publication. |
| [Composite binding](../../packages/persistence-postgres/src/crossDomainCommand/binding.ts) | Live commerce proof bound to the exact transaction, scope-clock object, frame and head; standalone CMS continues rejecting commerce bindings. |
| [Physical session](../../packages/persistence-postgres/src/physicalSession/postgres.ts), [relational session](../../packages/persistence-postgres/src/relationalTransaction/session.ts) | Existing acquisition, physical settlement and cleanup state machines. |
| [Document participant](../../packages/persistence-postgres/src/applicationDocumentMaterialization/participant.ts) | Shared preparation, index/head/dependency validation and combined lowering; CMS-specific closure and receipt authority stays with CMS. |
| [Application insert participant](../../packages/persistence-postgres/src/applicationDocumentMaterialization/insertParticipant.ts) | One schema-validated Application-owned insert, pending read and authenticated once-only closure. |
| [CMS publication](../../packages/persistence-postgres/src/cmsTransaction/publication.ts), [commerce publication](../../packages/persistence-postgres/src/commerceTransaction/publication.ts) | Existing standalone roots reuse participant preparation or contribution consumption while retaining their own finalization contracts. |
| [Publication](../../packages/persistence-postgres/src/commitPublication/publication.ts), [request recovery](../../packages/persistence-postgres/src/relationalTransaction/requestRecovery.ts) | One sequence/header, all Application and Currency facts, one retained result/wake/clock advance, and recovery-only re-entry. |
| [Currency service](../../packages/medusa-adapter/src/currency-service.ts) | Private write command uses the existing internal upsert and module retrieve with the same manager. |

The [combined scenario](../../packages/persistence-postgres/test/currencyAnnouncement.test.ts)
exercises real Currency and Payload operations, rollback inventories, retained
replay, authority and closure refusals, native range overlap and physical
PostgreSQL failures. [Lifetime tests](../../packages/persistence-postgres/test/compositeLifetime.test.ts)
cover shared budgets and rollback-only state; [failure projection tests](../../packages/persistence-postgres/test/compositeFailure.test.ts)
preserve publication corruption/resource categories. Existing standalone
CMS, scalar Payload, relation/preference, native transaction and Currency proofs
remain regression obligations. Detailed execution receipts live outside the
roadmap.

## First Command Contract

Use a private `publishCurrencyAnnouncement` command as the bounded integration
proof: upsert one Currency through the existing private Medusa internal service
path, create one scalar CMS post through Payload's Local API, then create one
Application-owned announcement record. Return the Currency service result,
the CMS result (including its row identity), and `applicationId`. The final Application step is the decisive late-failure case.
This remains a source-private integration command, with no public application API.

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

Aggregate limits retain the current framework envelope: 10 seconds
for admitted command execution, 1 second per statement, 500 ms lock wait, and 2 seconds
for cleanup. Share at most 64 charged operations and 1 MiB captured command,
working-state, receipt and result budget across participants; retain 64 KiB
individual row/document ceilings and existing domain-specific tighter limits.
Nested calls do not reset the deadline or receive another full budget. Reuse
the existing separate bounded recovery attempt. No automatic callback retry,
savepoint recovery or new timeout/cleanup policy is admitted. Authority
preparation before physical session entry is outside this execution envelope,
as in the existing framework hosts; these limits are not latency measurements.

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
event intents: this first implemented profile admits no domain events and therefore
does not complete that broader delivery gate. Performance and Product scale
remain independent; neither is the implementation selected by this preflight.

## Implementation Order And Completion Proof

The implementation forms one coherent capability: participant closure seams and root
adapter reuse; composite binding/lifetime/replay admission; explicit Application
capability and combined lowering; fixed Payload/Currency command integration;
failure/concurrency/recovery conformance and removal of displaced mechanics.
Broader event and production acceptance remain separate capabilities.

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
