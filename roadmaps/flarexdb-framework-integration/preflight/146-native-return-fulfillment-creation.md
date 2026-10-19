# Native Return Fulfillment creation preflight

Status: implemented for the private bounded local Manual Return creation and
explicit retained-cancellation profile. Production activation, independently
durable execution and broader Return or Order workflows remain separate.

## Native authority and closure

Authority is Medusa 2.13.4 at revision
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
`third_party/medusa/SOURCE.json`. Native paths below are relative to
`third_party/medusa/upstream/`.

- `packages/core/core-flows/src/fulfillment/workflows/create-return-fulfillment.ts`
  owns `create-return-fulfillment-workflow`. It runs the same singleton Stock
  Location query and input/Location transform as ordinary Fulfillment creation,
  then invokes the genuine Return creation step.
- `packages/core/core-flows/src/fulfillment/steps/create-return-fulfillment.ts`
  calls `createReturnFulfillment`, returns the complete native result and retains
  its actual ID. Its inverse calls ordinary `cancelFulfillment`; the source's
  TODO does not admit a replacement Return cancellation algorithm.
- `packages/modules/fulfillment/src/services/fulfillment-module-service.ts`
  strips inline `order`, creates the Fulfillment graph, then retrieves its
  Shipping Option with `select: ["id", "name", "data", "metadata"]`. That read
  occurs after creation and outside the provider exception-cleanup block.
  Provider creation, provider-result update and initial-object serialization
  retain their native ordering.
- `packages/modules/fulfillment/src/services/fulfillment-provider.ts` delegates
  to the selected provider's `createReturnFulfillment`, passing the created
  Fulfillment augmented with the selected Shipping Option. It does not pass
  inline Order separately.
- `packages/modules/providers/fulfillment-manual/src/services/manual-fulfillment.ts`
  supplies the genuine local provider result `{ data: {}, labels: [] }`.

No Order, Inventory, Pricing or Module Link capability follows from inline DTO
fields. Fulfillment DML declares no top-level Return ID relationship. Existing
data and metadata remain ordinary JSON, without an invented Return association.

## Immutable native evidence and disposition

The packet is `%TEMP%/flarex-146-native-return-fulfillment-witness`.
Executed runner `run.postgres.v1.mjs` has SHA256
`f75975715d3c1736184bd44b8a6d414bd7b6eca1a448876f84f8ae24ea4355de`.
The complete report is
`unchanged-native-postgres-runs/2026-10-19T11-14-56.200Z-6444/report.json`,
SHA256 `63abc0963f04a26045a82bd7b09f0f575414f12922e1a6157c2308aeb68b5cb9`.
All 28 per-case artifact byte lengths and hashes match; preparation and cohort
constraints succeed, cleanup has no failures, and all 56 owned-schema absence
proofs hold. The separate nominal smoke and immutable donor 141 packet remain
preserved.

This executes the original pinned workflow, SDK, singleton Query, native
services, default MikroORM/PostgreSQL repository conversion and genuine Manual
provider through an ordinary role. No native business algorithm is replaced.
The input/Location transform, exact four-field Option read, actual provider
arguments, raw graph milestones, full DTOs, retained IDs and original scheduler
cancellation are observed separately. Native JSON encoding records provider
arguments; the safe own-data diagnostic intentionally keeps native instances
opaque and is not itself a full argument DTO.

Omitted, null and historical Shipping Options each fail at the post-insert
retrieve, leaving one new root, Address and Item in these native independent
transactions. The provider and cleanup delete are not called, no module event
is emitted, and the failed creation step retains no cancellation ID. A missing
Option or Provider identity instead fails before persistence. An unregistered
Provider reaches native exception cleanup after creation. These observations do
not authorize moving the read or adding native cleanup. Preserve the original
business ordering and errors; failed Flarex atomic roots publish none of their
staged graph, history, facts or events under the existing settlement owner.

Ordinary and return-marked provider-option data both succeed, as does an Option
whose Provider differs from the actual Return Fulfillment Provider. No return
eligibility or provider-match guard may be invented. Historical registered
Provider ownership and missing/historical Location outcomes remain explicit
cases, rather than inferred from unrelated foreign-key behavior.

Manual's empty data patch merges into nonempty input JSON; null or omitted input
data remains null in the initial DTO while final storage and a genuine later
read contain `{}`. Empty provider Labels do not remove input Labels: the
maximum retains the same four identities and raw child timestamps. Preserve
these existing creation semantics and their causal receipts.

Actual original cancellation retains the created ID and ordinary cancellation
semantics. Shipped and delivered inputs create successfully but their inverses
finish `failed` with native guard errors recorded at the real module call. The
native exported errors array omits those compensation errors; an empty exported
array is not compensation success. Genuine nested-child identity and retained
ID are checked before its original inverse. No manually reconstructed callback
input establishes these observations.

The witness establishes this local default-backend envelope, not Drizzle parity,
the Flarex adapter, arbitrary providers, complete bootstrap or hosted serving.
No native business correction or new shared-core contract is selected.

## Implemented private profile

The original workflow and step use the same finite SDK seams as
[ordinary creation](./141-native-fulfillment-creation.md). Preserve its Location
selection, full DTO, retained ID and cancellation callback. The trusted outer
owner retains atomic settlement, rollback-only failure and publication.

The existing local Fulfillment factory supplies the Return method and one
read-only Shipping Option repository over its existing checked table. It reuses
the same PromiseOwner, manager bridge, event subscriber and query/projection
owners. Only the witnessed scalar-ID, active-row, four-field retrieve envelope
is admitted; counted reads, arbitrary population and writes are refused. The
genuine internal service owns missing/historical Option errors.

The mixed Option/Fulfillment constructor retains its existing method surface. The
Return facade selects only Return creation and ordinary cancellation, plus the
existing hidden Stock Location query capability. Its receipt authenticates
the Option read against the created root before the existing native provider
update reads, without permitting Option mutations or events. Ordinary and Return
facades share one creation admission owner, preserving their distinct native
workflow names, selected methods and input commitments.

The private envelope is one root, up to four Items and four Labels,
the existing twelve-table Fulfillment source and two-table Stock Location
source. It reuses the existing creation allowance of 128 calls with the normal
64-event and 1 MiB limits and existing thirty-second command deadline. The
maximum graph and actual inverse fit that allowance. No schema upgrade, new construction owner,
provider family, Task profile or locking capability is selected.

The finite step is transaction-covered: failed roots and late failure publish
none of their staged graph, history, facts or events. The original retained
business callback remains callable through its selected ordinary cancellation
capability and is distinct from outer rollback. This does not supply deferred
compensation, a durable Return scheduler or restart recovery.

## Native witness and admission gates

The unchanged-native packet must preserve nominal, empty and maximum graphs,
protected sibling rows, actual provider arguments, complete native DTOs, raw
rows/history, events and original-transaction cancellation. It must distinguish
initial creation output from final provider-assigned storage and preserve
nullable/omitted data, signed/fractional quantities and native Label handling.

Missing or historical Location, omitted/null/missing/historical Shipping Option,
ordinary versus return-marked Option, provider mismatch and missing,
unregistered or historical Provider require explicit outcomes. In particular,
the post-create Option read must record actual residual rows and events before
any cleanup change is proposed. Do not move that read, broaden its catch or
fabricate rollback. A native business change requires its separate decision;
failed atomic adapter execution retains the existing outer rollback obligation.

Adapter gates include actual retained cancellation, repeated cancellation,
shipped/delivered cancellation refusal, replay/conflict, exact borrowed resource
selection and lifetime, malformed input, read/receipt tampering, event/resource
bounds and late failure. Validate separately on PGlite and ordinary-role
PostgreSQL, then affected existing Fulfillment and mixed-constructor consumers,
types, builds, source/provenance/portability guards, lint and both project
reviews before committing admission.

Product chunked file import and Product export remain deferred. Hosted serving,
external providers, populated upgrades and Order/Return lifecycle integration
remain outside this bounded outcome.
