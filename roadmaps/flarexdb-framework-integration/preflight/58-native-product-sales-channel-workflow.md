# Native Product Sales Channel Workflow: Gate C Preflight

Status: complete within the private bounded atomic profile. Gate A and B1/B2/B3 remain
complete within their recorded private profiles. This preflight does not admit
full `createProductsWorkflow`, production serving or a general workflow engine.

## Outcome And Why Now

Connect the already admitted Product, Sales Channel and stored Link through the
actual pinned `associateProductsWithSalesChannelsStep`. The nearest complete
proof creates one Sales Channel and a bounded batch of simple Products, associates
the returned IDs, reads the pending endpoints and Link rows, then commits once.
The same request replays its retained result without rerunning native callbacks.

Use an explicitly named private composition, not the name or export of Medusa's
full Product-creation workflow. Its initial input selects simple Product creation
(ID/title and the necessary existing defaults, without options, variants or
external relations) and one Sales Channel (ID/name and existing defaults). This
keeps event admission and dependencies explicit; it is not a new universal DTO.
An association-only test composition must also exercise already-existing pairs.

This completes preflight 50's first connected milestone, while preserving the
full Product workflow's remaining Pricing, Inventory/Stock Location, Fulfillment,
other Links and transitive execution audits as separate requirements.

## Authority And Current Evidence

- `design-notes/flarex-db-accepted-design.md`, Medusa boundary: reserved relational
  rows remain authoritative; Flarex alone owns scope admission, settlement and
  publication. Medusa owns service, Link and workflow meaning.
- `roadmaps/16-package-boundaries.md`: framework adaptation stays above neutral
  persistence; a workflow consumer does not introduce a new transaction owner.
- Preflight 50 Gate C and preflight 57: the fresh fifteen-table candidate and its
  three confined profiles are present; the native association step is not yet
  promoted or admitted.
- `roadmaps/workflow-foundations/10-medusa-workflow-integration.md`, 11, 15 and 16:
  finite ordered steps/transforms, selected methods, child composition, internal
  event sets, atomic rollback and retained root replay are existing capabilities.
- `third_party/medusa/SOURCE.json`: pinned fork
  `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, baseline 2.13.4. The island is inert;
  executable code must be promoted into the existing private workspace packages.

## Exact Native Trace

Paths in this section are relative to
`third_party/medusa/upstream/packages/core/core-flows/src/`.

| Native source | Invoke path | Compensation and boundary |
| --- | --- | --- |
| `sales-channel/steps/associate-products-with-channels.ts` | Empty/missing `links` returns `StepResponse([], [])` before resolving anything. Nonempty input maps every pair to the Product/Sales Channel Link definition, resolves `ContainerRegistrationKeys.LINK` (`link`), and calls `create`. | Retains the mapped definitions, not returned Link IDs, as compensation input. Compensation calls `dismiss` unless its argument is falsy. An empty array is truthy and therefore still resolves Link/calls `dismiss([])` if the native compensator is invoked. |
| `product/steps/create-products.ts` | Resolves Product and calls `createProducts` with the supplied array; retains native returned rows and IDs. | Calls `deleteProducts` for a nonempty ID array. No early invocation short-circuit is present. |
| `sales-channel/steps/create-sales-channels.ts` | Resolves Sales Channel and calls `createSalesChannels(input.data)`; retains rows and IDs. | Calls `deleteSalesChannels` unless the captured argument is falsy; an empty array still reaches the service. |
| `product/workflows/create-products.ts` | Creates Products, maps each returned ID with the corresponding input's `sales_channels`, then invokes the association step. | The surrounding workflow also invokes shipping-profile Link creation, variant workflow composition and other steps. Extracting the association dependency does not admit this whole composer. |

The association step itself requires no Customer service, Product/Sales Channel
service call, graph query, lock provider, HTTP bootstrap, external effect or
suspension. It does not check endpoint existence, deduplicate pairs, filter
already-associated rows or make repeated attachment a no-op. Preserve the stored
Link owner's characterized duplicate, ID-replacement and lifecycle behavior.
Do not add endpoint validation or silent filtering to make the adapter appear
more helpful than the native contract. The connected creation proof establishes
its own endpoint existence by using IDs returned earlier in the same root.

The selected step is not the separate `linkProductsToSalesChannelWorkflow`:
that workflow also invokes a detach step and has add/remove behavior. Do not
promote it or its full Sales Channel barrel as an accidental dependency.
A scoped search found no dedicated association-step or named association-workflow
`.spec.ts`/`.test.ts` in the pinned island. Preserve the existing native Link
routing/storage witnesses and add explicitly authored connected step tests.

## Recommended Existing-owner Composition

```text
native createSalesChannelsStep
  -> native createProductsStep
  -> transform returned IDs into endpoint pairs
  -> native associateProductsWithSalesChannelsStep
  -> admitted Product / Sales Channel / Link-root reads
  -> existing atomic root settlement and retained replay
```

1. Promote only these three native step files with narrow package exports.
   Relocate imports to the existing portable packages and declare their
   compensation `transactionCovered`, following the existing promoted creation
   steps. Retain original invocation and compensation bodies and record the
   adaptation as workflow-fork provenance, not unchanged whole-engine parity.
2. Extend the existing Product workflow registration with the selected
   `createProducts` signature over its existing create command. Add Sales Channel
   and Link workflow definitions inside their current cohesive construction
   owners. Bind Link's actual `create` command under the native `link` key; no
   new router, entity dispatcher or global container registry is required.
3. Reuse `defineWorkflowMethod`, `defineWorkflowModule`,
   `prepareWorkflowResources`, `prepareAtomicWorkflowHost` and
   `runNativeMedusaWorkflow`. The source identity accepted by the workflow-module
   constructor can narrow to its existing consumed `name`/`profile` fields,
   rather than requiring Link to fabricate unused ordinary-DML model/service
   descriptions. This is an adapter-owned metadata/type simplification; it grants
   no authority and changes no persisted identity format.
4. Reuse Product's existing graph definition and Link's B3 graph. Prepare Sales
   Channel's scalar graph from its checked table, existing count command and
   `salesChannelStaticResources.joinerConfig`, as Currency already does. Keep
   pending reads on those three separate roots. Cross-module hydration such as
   `product.sales_channels.*` is not required by this step and stays unadmitted.
5. Reuse the existing participant event policies and
   `internalModuleWorkflowEvents`. Select the actual Product-created,
   Sales-Channel-created and Link-attached internal events for the admitted
   simple creation calls. There is no new external workflow event family or
   duplicate adapter-authored event. Do not select unrelated write methods merely
   to grant an event name. Full native rows, including generated Link IDs, remain
   validated before projecting the workflow response.

Callers continue to obtain commands/graph/workflow definitions from the Product,
Sales Channel and Link entry points. A single named workflow preparation facade
accepts the installed profiles, existing execution factory, reviewed revision
and subscribers. It owns resource selection and step preparation; callers do not
import and assemble method tokens, repositories, service managers or graph
internals. Installation identity and selected profiles remain explicit.

No change to `persistence-postgres`, schema tables, migrations, Flarex relation
storage, transaction settlement or the workflow SDK execution model is proposed.
If a connected witness demonstrates such a gap, preserve it and stop at its
owning boundary for separate approval rather than adding consumer glue.

## Implemented Private Surface

`prepareProductSalesChannelWorkflow` selects the three module-owned registrations
and the actual promoted creation/association steps. Its complete simple input is
one Sales Channel and one to four Products, with optional caller IDs. The native
services generate omitted IDs; association uses their returned rows. Separate
Product, Sales Channel and Link-root queries expose pending scalar projections.
The maximum batch remains within the existing request budget; the facade does
not raise a limit or select an expanded execution profile.

The Product and Sales Channel entry points expose selected `createProducts` and
`createSalesChannels` workflow methods. The existing Link entry exposes only
`create` to this composition. Sales Channel's repository preparation returns its
existing checked read-table projection alongside its binder, so scalar graph
registration does not rebuild table metadata. Workflow source identity now
requires only the already consumed name/profile fields.

The association promotion adds a type-only `Pick<Link, "create" | "dismiss">`
at the portable generic resolver; it reuses the native Link owner instead of
inventing another resource interface. Import relocation, resolver typing and
explicit transaction-covered compensation are the only step adaptations.
No persistence, schema, migration or workflow-engine change belongs to this gate.

## Compensation, Failure And Replay Decision

Use the existing all-database atomic profile. Native inverse callbacks
remain source evidence, but are not executed by this runner. A later failure
rolls back the whole pending transaction, including all three participants and
their event records. This is an intentional execution difference from Medusa's
general saga behavior, not a claim that inverse operations and rollback are
universally interchangeable.

In particular, a repeated attachment can replace the ID of an existing active
pair. The native compensator dismisses the pair rather than restoring its old
ID/state. The atomic profile must restore the exact pre-request row on failure,
not run that inverse and leave the old association soft-deleted. Retain a
pre-existing-pair late-failure witness alongside the fresh-creation rollback case.

The runner already refuses unannotated compensators, captures output and
compensation evidence together, and leaves settlement to its caller. Unknown
compensators, remote effects, post-commit cancellation, waits/signals, distributed
retries and durable step checkpoints remain outside this profile. Do not add a
fallback saga runner or hold a database transaction across a pause.

Existing full-Cause/sticky refusal, foreign-Promise ownership, cancellation,
escape checks and uncertain-root-settlement recovery remain unchanged. Reusing a
retained request key replays the committed root result; a new request key remains
a new native operation and may replace a Link ID. Do not conflate these cases.

## Bounds And Validation Gates

- Retain current definition, request-call, capture-byte, query and row limits.
  The Link command admits at most 256 input pairs; this does not prove that every
  256-Product creation root fits all other budgets. Choose and prove the facade's
  complete input envelope against its actual aggregate cost. Do not locally raise
  ceilings, chunk one root into independent commits or swallow a limit refusal.
- Characterize native invoke and compensator bodies, including empty/omitted
  association input and the asymmetric empty compensation checks. Preserve the
  difference between runtime-tolerated omission and the stricter declared native
  interface; do not broaden the public facade automatically.
- Prove real native step execution using the finite `product`, `sales_channel`
  and `link` resources. Wrong/absent resources, borrowed services and unsupported
  methods must fail closed. Baseline generic host tests are not this admission.
- On PGlite and ordinary-role PostgreSQL, create endpoints and links in one root,
  read pending state through admitted queries, verify post-commit rows and exact
  native events/facts, and replay without rerunning callbacks or emitting again.
- Test duplicate pairs, distinct fresh requests, pre-existing active/deleted
  pairs, malformed late input, wrong event identity, late callback failure and
  caught resource refusal. Preserve all pre-request state on rollback.
- Prove cancellation, escaped resources, revision mismatch and uncertain-commit
  recovery through existing owners. Subscriber failure must not undo successful
  business state. Force an observed same-scope PostgreSQL lock wait for competing
  roots; two simultaneous Promises are not sufficient concurrency evidence.
- Retain native Link routing cases and B3 conformance; rerun shared workflow/graph
  and relevant Product/Sales Channel regressions. Verify narrow source provenance,
  portable imports, types, lint and both required reviewers before a scoped commit.
  Installation plus cold reopening retains its existing cancellable deadline.

## Retain / Extend / Replace / Delete

| Decision | Owner and completion condition |
| --- | --- |
| Retain | Native step bodies/compensators, the immutable source island, existing Product/Currency workflows, B3 Link commands, schema/profile admission, event validation, root replay and settlement. |
| Extend | Private core-flow promotion, module-owned workflow methods, Sales Channel scalar graph and one named connected composition. Extend only the already consumed workflow source-identity type if needed. |
| Replace | Native infrastructure imports and implicit step-compensation mode in promoted files with the existing portable imports and explicit atomic profile. No second execution path is retained. |
| Delete | Temporary method/repository assembly, diagnostic callbacks and provisional exports introduced during implementation once the connected proof owns their assertions. Do not remove independently supported existing workflows. |

Completion admits only this connected private milestone. Full Product creation,
additional modules/Links, cross-module graph hydration, arbitrary hooks, remote
effects, workflow persistence and production activation need their own evidence.
