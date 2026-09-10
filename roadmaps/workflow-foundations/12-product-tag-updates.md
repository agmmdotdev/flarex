# Product-tag Updates And Selected Atomic Participants

## Status And Decision

Status: implemented as a source-private atomic capability, with connected
PGlite and ordinary-role PostgreSQL validation and both standing reviews.
The host accepts one through eight explicitly selected participants, authenticates
them against the active commerce binding, and registers selector-based tag updates.
The validation contract below remains required for future changes; runtime
receipts belong in Git.

The [update facade](../../packages/medusa-adapter/src/product-tag-update-workflow.ts)
runs the pinned Product-tag update workflow with Product as
its only selected participant, both in a Product-only deployment and in a
deployment that also has Currency installed. Preserve one existing transaction,
pending graph reads, checked hooks, durable events and core-owned recovery.

This capability extends selected-participant admission, adds the
Product-owned selector command, and ports the actual update flow onto the shared
host. It exercises a second real workflow without another commerce module or
another execution engine. It needs no preceding Task extension, graph rewrite,
lock engine or relational OCC project.

The [accepted design](../../design-notes/flarex-db-accepted-design.md),
[framework storage architecture](../../design-notes/flarexdb-framework-storage-architecture.md),
[atomic composition](./09-atomic-composition.md) and
[workflow host](./11-workflow-host-composition.md) retain their authority. This
approved capability changes private atomic admission from the complete active
set to an authenticated selected subset. That is an intentional contract change,
not a diagnosed shared-core defect or permission inferred from a failing test.

## Current Evidence

| Source | Finding and consequence |
| --- | --- |
| [Participant preparation](../../packages/persistence-postgres/src/atomicCommerce/participants.ts) and [workflow host](../../packages/medusa-adapter/src/workflow/host.ts) | Admit a nonempty selection; core retains the eight-installation ceiling and the workflow host requires exact selection/configuration matching. |
| [Atomic admission](../../packages/persistence-postgres/src/atomicCommerce/admission.ts) | Every selected member must occur in the active commerce binding; unselected installations grant no authority. |
| [Per-installation admission](../../packages/persistence-postgres/src/commerceTransaction/admission.ts) | Already authenticates one selected installation within the active binding, including scope, placement, profile and current evidence. Reuse this owner for each selected member. |
| [Binding model](../../packages/persistence-postgres/src/frameworkSchema/binding/model.ts) and [decoder](../../packages/persistence-postgres/src/frameworkSchema/binding/canonical.ts) | Format 2 permits up to eight installations, including a one-installation array. No new persisted binding format is needed for this cardinality. |
| [Atomic execution](../../packages/persistence-postgres/src/atomicCommerce/host.ts) and [publication](../../packages/persistence-postgres/src/commerceTransaction/publication.ts) | Already finalize a first admitted contribution plus additional contributions. One member leaves the additional list empty; retain this settlement owner and prove that path. |
| [Product service adapter](../../packages/medusa-adapter/src/product-service.ts) and [selector decoder](../../packages/medusa-adapter/src/product-tag-update-input.ts) | `updateTagsBySelector` invokes the selector overload once; existing `updateTags` retains its ID overload and `{ id, data }` contract. |
| [Named read inputs](../../packages/medusa-adapter/src/product-service-input.ts) | Existing `listTags` admits ID or ID-array and exact value filters through checked module reads. Reuse these semantics for the step's pre-read. |
| [Product tag model](../../packages/medusa-product/src/models/product-tag.ts) | Live tag values have a unique index. Assigning one value to several matching tags can fail; selector support does not promise a successful bulk rename. |

Medusa semantics follow the exact fork in
[SOURCE.json](../../third_party/medusa/SOURCE.json), not an assumed current
upstream engine. Its
[update workflow](../../third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/update-product-tags.ts)
updates tags, invokes `productTagsUpdated`, derives event IDs from actual results,
emits `product-tag.updated`, and returns the updated tags. Its
[step](../../third_party/medusa/upstream/packages/core/core-flows/src/product/steps/update-product-tags.ts)
first lists the prior projection, calls the service's selector update once, and
retains prior data for an upsert compensator.

The reference workflow input names Product Type DTOs, while its step uses the
correct Tag DTOs. The active fork corrects those type references and preserves
the selected business sequence. The retained source island remains unchanged.

## Selected Participant Contract

The atomic core accepts one through eight explicitly selected, authentic
participants. Each selected installation must exist in the current active
commerce binding with its admitted reference and profile. Missing, inactive,
duplicate, forged or mismatched selections fail; admission never silently drops
a member. The workflow selection must still exactly match its supplied installed
module map, so extra configuration does not become an implicit capability.

Unselected active modules grant no command, graph, table or event access. They
need no resource wrappers, service construction or empty contribution stores.
An explicitly selected but unused participant retains the existing authenticated
empty-contribution behavior. Selection is authority, not an observation of which
tables a callback happened to use.

Keep these existing invariants:

- One trusted target, placement, scope authority and transaction session. Acquire
  the scope clock first and selected installation locks in deterministic digest
  order. Do not introduce a separate single-module execution branch.
- Authenticate each profile, installation and command allowlist through the
  existing owners. Selected profiles contribute the strictest aggregate caps;
  base root limits remain unchanged.
- Capture the complete active binding head in admission/replay evidence. Even
  movement affecting an unselected module must follow existing binding-change
  and request-conflict behavior. Do not introduce a partial-binding hash to make
  an old request key reusable under changed evidence.
- Preserve sticky root refusal, cancellation, closure, one publication and
  uncertain-commit reconciliation. Neither callbacks nor participant admission
  gain automatic retries or child commits.
- Preserve full validation of stored commit facts before participant projection.
  Selecting Product must not hide corrupt Currency facts in an older commit.

An empty active binding frame remains a valid persisted representation where the
binding owner permits it; an empty workflow participant set remains invalid.
Schema installation, lineage, migration, journal, commit/outbox formats and
Application-row authority do not change. Existing complete-set compositions
remain valid instances of the new selected-set contract.

## Product Update Profile And Authoring

The Product-owned `updateTagsBySelector` command accepts a checked selector and
update and invokes the actual Medusa selector overload once through the existing
scoped service adapter. The existing ID command retains its accepted inputs.
Both reuse checked DML update validation; other related-entity decoders do not
gain selector behavior.

The initial workflow profile is explicit:

| Input | Admitted behavior |
| --- | --- |
| `selector.id` | Optional string or array of strings, using the existing named-read policy and its 256-member input ceiling. |
| `selector.value` | Optional exact string, combined with the ID filter through existing service semantics. |
| Empty selector | All matching live tags under the service's selector semantics and existing atomic limits; never update only the pre-read page or split into commits. |
| `update` | Requires `value: string`. Empty patches, ID/managed-field changes, metadata changes and unknown fields are outside this workflow profile. |
| `additional_data` | Optional checked JSON object passed to the hook. |
| Other filters | Refuse search, arbitrary operators and value arrays; do not silently discard unsupported fields. |

The pinned [Tag DTOs](../../packages/medusa-types/src/product/common.ts) have an
optional value update and wider filters. The required value and narrower selector
above are intentional private-profile limits, not full DTO parity. String
validation and storage limits remain with the existing checked owners; the
workflow must not silently trim or normalize tag values.

No matches, including an empty ID array, return the actual service's empty
result and produce no invented update IDs. Same-value updates retain actual
service/fact/event behavior rather than introducing an optimization. A selector
matching multiple live tags can violate the unique value constraint; prove whole
root rollback. The 256-member input ceiling is not a guarantee that a workload
fits the smaller statement, byte or time limits.

The [Product workflow registration](../../packages/medusa-adapter/src/product-workflow-module.ts)
provides `listProductTags` over the existing read token and selector-based
`updateProductTags` over the new token. Tuple decoders, command inputs and checked
results remain Product-owned. A projected list result must not promise full DTO
fields or require a field omitted by a valid selection. Updated tag results can
reuse the current checked ID/value result shape.

The update facade selects Product reads/update, Product graph and events. Its
hook receives inferred fresh resources through the shared host. Module event
validation covers `product.product-tag.updated`; workflow event validation
correlates `product-tag.updated` IDs with actual successful update observations,
retaining order and event-group policy. Reuse durable event storage and delivery.
Do not grant create methods just to seed a test: mixed create/update module event
families in one selected participant remain outside this capability.

The pinned pre-read and its compensation input retain their resource charges.
The active port includes the needed
[projection helper](../../third_party/medusa/upstream/packages/core/utils/src/common/get-selects-and-relations-from-object-array.ts)
and its [original assertion](../../third_party/medusa/upstream/packages/core/utils/src/common/__tests__/get-selects-and-relations-from-object-array.spec.ts)
through narrow active-package imports. Its existing `deduplicate` and `isObject`
dependencies retain their owners. The compensator source is retained and the
step marks `compensation: "transactionCovered"`, as the create step does. The atomic
runner rolls back uncommitted work and never executes compensating writes after
rollback. This does not add durable-step recovery semantics.

## Alternatives And Replacement Inventory

Reducing the count alone leaves Product-only execution broken in a deployment
with other commerce bindings. Admitting every installed module or attaching a
dummy Currency participant makes workflow authority depend on unrelated
installations. Mapping a selector into repeated ID updates changes service
batching, accounting and event behavior. A second host or an exact/subset mode
flag adds execution choices without a supported consumer that needs them.
The selected-set contract closes both admission restrictions while
keeping one owner and explicit resources.

| Path | Disposition |
| --- | --- |
| Atomic participant cardinality and complete-set admission checks | Rewritten to require a nonempty authenticated subset; individual admission checks retained. |
| Shared workflow host | Extended minimum cardinality; exact selection/configuration matching and module-neutral assembly retained. |
| Product ID update and named read commands | Existing consumers and validation retained; semantically distinct selector command added. |
| Product workflow method registration and event correlation | Module-owned registration extended, thin update facade added; exact tag event correlation shared with creation through one package-local owner. |
| Pinned update workflow, step, projection helper and relevant original tests | Needed closure ported with import relocation, the explicit atomic policy and corrected Tag type names. |
| Existing Product/Currency create workflow and fixtures | Keep as the real cross-module profile and regression proof. Update fixtures use their own explicit Product-only selection. |
| Shared transaction, graph execution, event publisher and recovery | Keep existing owners; no replacement or parallel bridge. |
| Reference island and promotion guards | Keep immutable reference content; update the [promotion manifest](../flarexdb-framework-integration/preflight/medusa-currency-promotion.json), exports and required built outputs for the exact promoted closure without weakening guard policy. |

No existing source-private facade is displaced here, so there is no retained
legacy path, temporary bridge or data migration. The creation facade's duplicated
event-correlation body is removed in favor of the shared Product-tag owner.

The checked-in [Convex context](../../../../npm-packages/convex/src/server/registration.ts)
documents same-transaction calls and child mutation rollback. It supports the
distinction between function selection and runtime authority, but Flarex commerce
continues to refuse the entire atomic root after a participant failure. This
capability adds neither Convex child transactions nor native journal/OCC access.

## Validation And Remaining Boundaries

The [connected update suite](../../packages/medusa-adapter/test/product-tag-update-workflow.test.ts)
installs Product through the real coordinator, then adds Currency through the
same binding owner. It exercises both selected-module configurations. The
existing two-module workflow and atomic suites retain their independent proofs.

Required evidence:

- Cardinality and authority: zero rejected, one supported, existing eight-member
  ceiling retained, duplicates/forgeries/missing profiles refused, unselected
  resources unavailable and whole-head movement still enforced. Pin the existing
  one-binding persisted representation without weakening older format assertions.
- Service behavior: ID/value selectors, no matches, empty IDs, empty selector,
  unchanged values, unaffected rows, strict input refusal, and uniqueness failure
  with no partial state. Verify the pre-read does not limit update selection.
- Connected execution: the hook sees pending Product graph changes; independent
  ordinary-role PostgreSQL connections see only committed state. Both event
  families and the result settle once with exact ID/group correlation.
- Failure/recovery: hook failure, caught validation/graph refusal, decoder defect,
  cancellation, exhausted limits and escaped resources cannot publish partial
  work. Duplicate requests and lost acknowledgement retain core-owned recovery
  without rerunning arbitrary callbacks.
- Regression: retain original Product/Currency assertions, the existing ID-update
  path, the two-module workflow and atomic/graph suites, including full-fact
  corruption checks. Run connected lanes on PGlite and ordinary-role PostgreSQL;
  retain original utility and selected composer assertions.
- Integration quality: affected TypeScript checks, source/promotion guards,
  portable import checks, `pnpm lint:core`, worktree and staged diff lint gates,
  and both standing reviewers against the final significant diff. Clean only
  owned test artifacts according to the existing workspace cleanup rules.

Both deployment configurations execute the real update flow through these owners.
The existing atomic suite also activates a single-entry format-2 binding, while
the update suite exercises a single-entry format-1 binding and coexistence with
a format-2 multi-module binding. Both persisted contracts remain supported.
Cloudflare execution,
public serving, performance/production readiness, Task continuations, external
effects, remote joins and additional commerce modules remain separate decisions.
