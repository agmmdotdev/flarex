# Stored Product Sales Channel Link: B3 Preflight

Status: B3 complete for the bounded private stored-Link profile. B1 and B2 are
complete. Full Link conformance passes on PGlite and ordinary-role PostgreSQL
after the approved shared assignment-batch correction, without a deadline change.
Workflow Gate C remains unapproved.

## Shared Installation Timing Sensitivity

The fresh fifteen-table candidate requires 95 installation steps. Before the
assignment-batch correction, its PGlite setup intermittently reached the shared
`commerceHostFixture` 90-second Effect
deadline before installation plus the cold-profile reopening proof completes.
The consumer tests were then skipped: this was not a native Link command failure.
An intervening successful run does not establish the cause of the timeout.

Reproduce from `packages/medusa-adapter` with
`FLAREX_PRODUCT_TIMINGS=1 pnpm exec vitest run --config vitest.link.config.ts --reporter=verbose`
and `FLAREX_TEST_DRIVER` unset or set to `pglite`. The existing fixture timing
output records progress through five batches (80 of 95 steps) before the final
batch and cold reopening. Expected: the admitted candidate finishes setup within
the unchanged shared fixture deadline. Actual: setup can fail with Effect
`TimeoutError`, preventing dependent assertions in that run. Both ordinary,
uninstrumented database lanes have completed native Link conformance under the
unchanged deadline, but subsequent uninstrumented PGlite setup also timed out
before the final review regression could execute. The observed sensitivity was
not limited to profiling overhead. Following the approved batch replacement,
both complete ordinary lanes pass; this is bounded functional acceptance, not
a claim that all timing variability or the historical root cause is established.

The deadline owner is
`packages/persistence-postgres/test/commerceHostFixture.ts`; installation and
verification execute through the shared fresh migration coordinator and its
verification scope. This evidence does not yet distinguish a shared runtime
performance defect, test-budget insufficiency or environmental sensitivity.
No Link-specific workaround, higher deadline or claim of production performance
is admitted. The bounded shared correction below is separately approved.
Preserve the consumer witness and rerun both database
lanes after any approved correction; review and commit remain completion gates.

### Diagnosis And Approved Shared-owner Correction

Serial diagnostic measurements separate full-plan runner issuance from stored
graph reconstruction and the final cold reopening. Runner issuance is negligible
in this witness; rebuilding that runner is not the recommended correction. The
measured candidate is repeated shared metadata restoration, including physical
name assignments and Effect function-stack/span construction. Main-thread idle
samples do not distinguish database execution, worker transport and scheduling;
neither an occasional passing run nor query counts prove a single root cause.

Approved correction: reduce demonstrated duplicate immutable-value
restoration in the existing migration/physical-value owners. Investigate exact
assignment-row reuse within the existing authenticated read pass before adding
any mechanism. Reuse must include all actual detached row projections, issued
collision identity and validation policy; retain fresh SQL reads and release
references at the existing read-pass boundary. If that boundary offers no useful
reuse, do not extend it across writes or transactions. Remove transparent helper
tracing only where sampling and a controlled comparison demonstrate its cost;
retain named repository/domain operations and full failure semantics.

Exact same-collision assignment-row memoization did not demonstrate useful
end-to-end improvement and is not retained. The existing read-pass lifetime and
retention limits remain unchanged. A smaller private canonical-comparison tracing
change has isolated cost evidence and is implemented at the physical-value owner.
Named assignment/layout restoration spans, errors and canonical checks remain
intact. No diagnostic hooks or benchmark cases remain in the integration suite.

No schema, public API, new cache lifetime, larger retention bound, runner redesign,
Medusa-specific branch or deadline change is part of this correction.
The displaced scalar SQL loop is removed by the approved replacement below;
there is no selectable alternate path.
Acceptance requires corruption/projection, collision, cold-restoration,
read-pass isolation and cancellation regressions, a neutral owner fixture and
another supported consumer, followed by complete Link conformance in PGlite and
ordinary-role PostgreSQL. Compare work and timings under the same serial setup;
remove temporary instrumentation before final review and commit. Broader changes
to the stated owners or authority/lifetime contracts require a new preflight.

### Shared Assignment Batch Correction: Implemented

The displaced `prepareCoordinatorGraphInTransaction` called the scalar
physical-name-assignment ensure operation for every assignment, on every batch
and on cold reopening. This candidate has 237 assignments. Each scalar ensure
reauthenticates the collision through SQL, attempts an immutable insert, and
resolves the stored occupant. Diagnostic query counts and current source agree
on this repeated work; counts do not by themselves quantify its elapsed cost.

The approved correction is a bounded set-oriented assignment operation in
that existing repository, replacing the coordinator's scalar loop. It should
authenticate current collision evidence once per operation, batch immutable
inserts and occupant reads, then retain exact-byte, spelling, digest, projection
and cross-collision checks for every assignment. No retained database references,
new cache, Medusa branch, larger deadline or transaction lifetime is proposed.
The approval covers changed SQL grouping and the corresponding conflict/lock proofs.

The replacement validates the entire supplied inventory in input order before
writes, bounds prepared canonical evidence by the existing layout limit, and
reauthenticates stored collision evidence once. Inserts use global assignment
digest order with at most 64 rows and 256 KiB canonical bytes per statement.
Only after all inserts complete does it read bounded occupant batches and apply
the existing digest-first, lazy-spelling authentication policy in input order.
This private batch contract intentionally separates input validation from SQL
conflict resolution; it does not preserve the displaced scalar loop's interleaving
of those phases. No stored-row cache survives a write. Transaction settlement and
rollback remain with the existing outer owner.

The neutral owner regressions cover row/byte batches, aggregate refusal,
corruption, replay and transaction rollback on both databases; PostgreSQL also
observes a real overlapping-inventory insert lock wait. The scalar coordinator
path and production API are replaced without a compatibility fallback.
Acceptance remains the complete ordinary Link proof
under the unchanged fixture deadline, with another supported consumer and final
review. No broader installer or workflow redesign is implied.

## Outcome And Why Now

Install one fresh Product + Sales Channel + ProductSalesChannel candidate and
exercise the actual native Link router/services through three confined profiles
in the existing atomic commerce host. Prove attach, dismiss, endpoint-selected
soft-delete/restore, Link-root reads, events and replay against stored rows.
This supplies the `LINK` dependency of the native
`associate-products-with-channels` step; that step remains Gate C.

The accepted [Medusa boundary](../../../design-notes/flarex-db-accepted-design.md#medusa-boundary),
[commerce-owned Link design](../../../design-notes/flarexdb-medusa-commerce-adapter.md#2-commerce-owned-link-entity),
[adoption gate](../06-medusa-adoption.md#status-and-scope),
[shared-installation contract](./55-shared-installation-atomic-commerce.md) and
[native storage contract](./56-native-link-storage-contract.md) govern this slice.
No new Flarex persistence, settlement, feed family, core branch, resource ceiling
or versioned API is proposed. If that assumption fails, preserve the witness and
stop at the shared-core owner; do not repair it in the Link consumer.

## Current Source Evidence

The semantic source remains `third_party/medusa/SOURCE.json`'s pinned fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, package baseline `2.13.4`.
The island is inert; active workspace packages are separately promoted copies.
Reference paths below are relative to its `packages/` directory.

| Owner | Relevant contract or mismatch |
| --- | --- |
| `modules/link-modules/src/definitions/product-sales-channel.ts` | Many-to-many endpoint pair; `id` is non-key; no extra fields or endpoint FK/liveness enforcement. Native Link-root aliases have no method suffix. |
| `modules/link-modules/src/utils/generate-entity.ts` | Owns endpoint primary-key fields, timestamps, ID index and active endpoint indexes, but returns a MikroORM `EntitySchema`. The DML compiler is not this Link's schema source. |
| `modules/link-modules/src/repositories/link.ts` | Generates IDs, mutates native input objects for event construction, and uses ORM `create`/`upsertMany`. Replace the persistence mechanism, not native attach identity semantics. |
| `modules/link-modules/src/services/link.ts` | Owns native query construction and dismiss/endpoint selectors; forwards the transaction manager to repository methods. |
| `modules/link-modules/src/services/link-module-service.ts` | Owns tuple normalization, serialization, lifecycle return maps and attached/detached event building. `create` builds events from its input objects, not merely its returned rows. |
| `modules/link-modules/src/services/dynamic-service-class.ts` and `loaders/container.ts` | Own native service/config naming and Joiner exposure. Construction can be direct and scoped; no Awilix/connection bootstrap is required. |
| `core/modules-sdk/src/link.ts` | Owns routing, grouping and traversal. Constructor falls back to global `MedusaModule` for omitted or empty module lists. Cascade returns errors as data and can launch parallel branches. |
| `core/modules-sdk/src/__tests__/remote-link.spec.ts` | Original routing/traversal witnesses use mocked modules; retain them, but they are not storage evidence. |
| `core/core-flows/src/sales-channel/steps/associate-products-with-channels.ts` | Nonempty invocation needs `LINK.create`; compensation needs `LINK.dismiss`. Empty forward input returns before resolution, but compensation with `[]` still resolves LINK. |

B2's core already supplies full-key mutation, explicit active-row upsert,
unchanged restore observations and trusted non-key event evidence. Existing
Product/Sales Channel schema composition contains fourteen endpoint tables;
`packages/medusa-modules-sdk` currently exposes definitions, not a Link runtime.

## Ownership And Construction

1. Promote the finite native Link closure into a private
   `packages/medusa-link-modules` owner and a portable explicit `./link` entry in
   the existing `packages/medusa-modules-sdk`. Preserve source hashes and label
   infrastructure adaptations. Do not import the source island at runtime or
   promote every link definition, loaders, migrations or ORM packages.
2. Keep structural Link generation with the promoted native Link owner. Extract
   the selected value-only definition from the native generator's algorithm;
   check its endpoint key, columns and indexes against the reference generator.
   Translate it through the existing checked table/lowering owner with Link
   provenance. Do not invent a DML model or copy fifteen hand-authored tables.
3. Put repository, event validation and composition in `medusa-adapter`. Reuse
   `commerceRepositoryContext`, `withCommerceService`, `commerceServiceCommands`,
   query capture/projection/execution and the existing host. Bind actual native
   methods directly. Do not force a non-DML Link through generated ordinary-model
   internal services, or create a general Link registry/CRUD factory.
4. One Link construction entry point owns metadata checks, repository binding,
   native service/router wiring, commands and event policy. Callers provide the
   checked configured candidate and their existing host dependencies. They must
   not individually construct repository, base repository, service, event builder,
   router or manager. The host still explicitly selects the three participants.
5. Keep existing fourteen-table endpoint-only consumers as supported smaller
   configurations, not a runtime fallback. Add the fifteen-table candidate through
   their existing configured-schema owner; Product, Sales Channel and Link grants
   remain disjoint. This is a fresh private fixture, not an existing-row upgrade.

There is no current working stored-Link caller to compare against. The proposed
caller shape is one prepared Link module exposing command tokens/event policy,
then the existing atomic participant configuration. Exact exported names belong
to implementation; no fake API is claimed to exist in this preflight.

## Shared Graph Mismatch: Correct The Owner, Not The Link

The current `medusa-adapter/src/local-graph/module.ts` refuses native aliases
without `args.methodSuffix`; `local-graph/query.ts` also requires a nonblank suffix
and exactly one `ReadTable.primaryKeys` component. Its `graphOrder` uses the first
key and treats each `uniqueOrder` column as independently unique.

Source-level reproducer: give `prepareLocalGraph` an authentic read command and
a table with `primaryKeys: ["left_id", "right_id"]`, matching scalar columns,
ordinary projection/decoder and a valid alias. Even with a nonblank matching
suffix, preparation returns `unsupportedProfile` before the command executes.
Separately, `moduleAliases(ProductSalesChannel)` refuses its native unsuffixed
aliases. These are current explicit guards, not results of a new database run.
Replacing the table key with `id` would misstate native uniqueness; supplying a
made-up suffix would conceal the actual method binding. Neither is acceptable.

Proposed correction belongs to the shared **Medusa graph adapter**, not Flarex:

- Bind each admitted native alias/model to its actual authenticated read command.
  Remove the redundant method-suffix requirement from graph dispatch metadata;
  preserve native suffix checks where a module constructor actually uses them.
  Migrate Product/Currency graph definitions and workflow metadata capture together.
- Retain the complete declared key and deterministic tuple tie-breaking. Do not
  describe a component as independently unique. Reuse the existing bounded read
  window and physical store's full-key tie-break ordering; no new query executor.
- Prove a renamed neutral composite table, equal leading components, duplicate
  non-key IDs, stable offset/count/projection, malformed aliases and existing
  Product/Currency behavior. Existing command and profile authorization remains.
- B3 graph admission is Link-root scalar reads for the declared singular/plural
  aliases. Endpoint modules retain their own reads. Cross-module graph hydration
  such as `product.sales_channels.*`, arbitrary relation filters and reverse
  aliases are not silently included; add them from the next workflow requirement.

Disposition: the approved correction is implemented at the shared graph adapter.
The native stored-Link implementation passes its complete two-driver conformance
after the shared installation correction above.

## Native Compatibility And Refusal Boundaries

- Preserve the characterized endpoint-pair key, replacement ID on repeated attach,
  whole-batch duplicate refusal, native selectors/maps, and attached/detached
  envelopes. Retain B2's approved authoritative timestamp divergence; do not
  reproduce stale flush responses or manager-dependent precision loss.
- Capture caller input before the native repository's ID mutation. The event
  builder must observe the generated ID on its own input object; storage evidence
  must independently validate it. Do not emit substitute adapter-authored events.
- Validate actual native aggregation using operation-local stored rows, including
  earlier IDs replaced later in the same root and no-write repeated restores.
  All durable events still use the existing common commit/outbox owner.
- Require explicit loaded modules; an empty list must not reach global fallback.
  No module set, table, event contract or service can be registered by command code.
- Admit endpoint-triggered traversal from one selected endpoint module/key per
  native call, including batches of IDs. The selected definition has one related
  Link and no endpoint delete cascade, so it does not require parallel transaction
  branches. Reject unsupported multi-origin/multi-link traversal before execution;
  do not introduce a scheduling queue or weaken the core overlap refusal.
- Native cascade errors-as-data are not atomic success. Validate the complete
  returned tuple and latch/refuse a nonempty error list before projecting IDs.
  Preserve already-latched failures, defects and interruption through existing
  Promise/Effect ownership. Test caught failures and escaped native services.
- High-level `Link.delete` is endpoint-selected soft deletion, not physical row
  deletion. Direct Link-module hard delete is not admitted in this slice: its
  native event payload path needs its own identity characterization if required.

## Validation And Completion Gates

- Compare the checked Link schema with native generator metadata: pair PK,
  nonunique ID, timestamp defaults, deletion and endpoint indexes; all fifteen
  tables installed through existing compilation/installation owners.
- Preserve original native routing assertions and preflight 56's storage cases.
  Label portability/timestamp differences separately from unchanged source cases.
- On both PGlite and ordinary-role PostgreSQL: create both endpoints and attach
  through native Link in one root, read pending state, validate all three profiles'
  facts/events, commit once and replay unchanged. Then prove replacement, dismiss,
  repeated restore, endpoint-selected traversal, duplicate batches and missing rows.
- Prove wrong event ID, late native failure, nonempty cascade errors, cancellation,
  wrong scope/participant, escaped manager, limit refusal and uncertain settlement.
  For overlapping attaches, force a real PostgreSQL lock-wait interleaving; two
  concurrent Promises alone are not that witness. Keep existing ceilings/assertions.
- Run shared graph owner and Product/Currency regressions, existing Product/Sales
  Channel/atomic storage consumers, relevant typechecks, provenance/portable/test
  guards, core/diff/staged lint, both required reviewers and one scoped commit.
- Gate C, Pricing, Inventory/Stock Location, shipping-profile dependencies, full
  Product creation, workflow pauses, remote effects and production remain closed.
  Customer is not a prerequisite for this Link or association step.

## Retain / Extend / Replace / Delete

| Action | Owner and completion gate |
| --- | --- |
| Retain | Pinned island, original routing/storage witnesses, existing endpoint configurations, command/profile authority and receipt/finalizer. |
| Extend | Finite promoted native Link package/SDK entry, existing schema composition/lowering, shared graph declared-key support and adapter-owned Link integration. |
| Replace | ORM repository/entity output and global bootstrap with checked values and scoped native bindings; redundant graph suffix dispatch metadata with direct authenticated command binding. |
| Delete | Displaced graph fields/caller assembly within this slice; temporary diagnostics after moving meaningful witnesses to their owners. No legacy API, synthetic key, second event bus or storage fallback. |
