# Store Order retrieval and listing HTTP

## Status And Scope

Status: admitted private bounded reads on PGlite, ordinary-role Postgres and
actual Workerd. Deployment and measured capacity remain separate gates.

This profile owns `GET /store/orders/:id` and `GET /store/orders` on the private
Store Effect HTTP host. Native Order transfers, Order mutations, production
activation and measured capacity retain separate scopes.

## Current Sources Of Truth

The [accepted database design](../../../design-notes/flarex-db-accepted-design.md)
owns authority. The pinned native Order handlers, `get-order-detail`,
`get-orders-list` and their status aggregation own commerce behavior. The
[native Query owner](../../workflow-foundations/06-local-graph-query.md)
governs service dispatch, native joins and complete-cohort admission. The
[completion profile](./store-cart-completion-http.md) owns checkout writes.

Decisive consumers are the
[HTTP proof](../../../packages/medusa-adapter/test/store-order-request.test.ts)
and [Workerd proof](../../../apps/executor/test/storeOrderApplicationDO.postgres.test.ts).

## Current Architecture

Both selected native handlers invoke their unchanged workflow IDs through the
existing workflow-engine capability. The portable SDK executes the actual
prepared read workflows using the existing scoped Promise owner. No atomic
mutation root, durable outcome or event is created for a GET. Individual native
service reads keep their independent protected snapshots; a complete response
does not claim one snapshot across those calls.

Detail retains the pinned public access rule, publishable-key validation,
draft exclusion and missing-Order refusal. Listing requires a verified Customer
and always combines that identity and draft exclusion with native ID, status,
`$and` and `$or` filters. Native workflow transformations retain payment and
fulfillment status aggregation and forced internal relation reads. Lists retain
forced ID, status, version and Item fields; they remove only unrequested Payment
Collection and Fulfillment bodies.

The Order read registry selects genuine Order, Payment, Fulfillment,
Order–PaymentCollection, Order–Fulfillment and Product readers. It reuses native
Order formatting, totals, versioned local relationships and the readonly
Order–Product declaration. Fulfillment Items, Labels and owning Addresses are
real local relationships. The Cart read registry retains its own profiles.

## Invariants And Trust Boundaries

Postgres remains the only committed-data authority. HTTP receives read
capabilities and detached DTOs; it receives no raw database, manager or settlement
capability. Query and Promise owners retain complete Causes, interruption,
cleanup and source authentication. Unsupported projections and operators refuse.

Native default pagination selects fifty Orders. The named Store profile admits
at most fifty root rows and four related Links per Order, with up to two hundred
related identities. It uses the shared database page/count window and genuine
native Query metadata. HTTP neither slices a complete catalog nor synthesizes
counts or batches around a smaller cohort limit. ID ordering supports both
directions. Existing finance, checkout and Cart read bounds remain distinct.

The serving catalog adds the genuine Order–Fulfillment source, for twenty-six
commerce sources. Five named Order read hosts share the existing generation
with the Cart/Payment/checkout hosts: forty prepared hosts and the existing
8 MiB prepared-byte budget. Shared query, value, byte and call budgets still
bound combinations of expansions.

Only the five named read hosts select an explicit native identity working set:
their authenticated source table count multiplied by the existing 256-row
complete-cohort allowance. This selects 5,888 identities for Order, 2,304 for
Payment, 3,072 for Fulfillment and 256 for each Link source. Document size remains
65,536 bytes. The existing host captures these limits in its profile identity.
Ordinary readers retain 128 identities; Core ceilings and row admission stay
unchanged. Off-page, deleted and unmatched candidates can consume the finite
allowance during count and residual evaluation.

These five readers also select a thirty-second protected-command deadline through
the existing trusted host contract. Page/count, local population and native
formatting share that command budget. Ordinary readers keep ten seconds; the
existing thirty-second framework ceiling, cancellation and cleanup stay intact.

The same named read profile selects 65,536 value nodes for host result capture,
native numeric DTOs, Query outputs and SDK intermediates. The shared capture
owners retain the 8,192-node ordinary default and unchanged byte/depth checks.
Complete own-undefined sidecars and restored values remain charged. Selected
fields and row counts alone do not bound nested numeric/JSON value volume.

The read runner also selects 65,536 resolution nodes through the SDK's trusted
execution port. The selected quota applies to transform-result compilation and
expanded reference traversal, including child frames. Ordinary executions keep
4,096 nodes; definition, depth and reference-authentication limits are unchanged.
The former fixed execution quota rejected full native page transforms after
value capture. This remains a bounded execution selection with no Core change.

## Decisions And Rationale

Order page selection and count reuse the shared read window before native local
population and formatting. Stored financial and checkout reads retain their
original complete-cohort policies. The deprecated common remote-query step has
one named paged Order branch preserving native `{ rows, metadata }`; other
branches keep their existing contracts.

The shared native input owner preserves top-level own `undefined` optional
filters and page variables produced by the native workflows. Its prior JSON-only
filter schema rejected the native detail producer's `version: undefined` before
normalization. The corrected boundary retains bounded intermediate capture and
rejects functions, unsafe paths and non-JSON nested payloads; native normalization
still owns filter meaning.

The Link metadata owner's previous ceiling of 128 refused the explicitly selected
two-hundred-identity cohort before graph construction. Its absolute admission
ceiling now matches the existing shared complete-read ceiling of 256. Every
selected path retains its own captured bounds, and existing selected bounds
remain unchanged. This introduces no larger Core budget or settlement mechanism.

Shared ID reads have explicit cohort, owning-reference and native presentation
options. Defaults retain four rows and their original projection policy. The
named Store Fulfillment profile selects checked nullable owning references and
native bare/wildcard relation presentation; the existing population owner and
receipt reconstruction retain the same FK direction and complete-row checks.
The ID query boundary also uses the existing native input capture before
decoding: native `buildQuery` owns an `undefined` `fields` member for all-fields
reads. Queued and immediate reads now share its omission semantics. Named Order
list schemas retain the native producer's own `order: undefined` until native
Query normalization. Neither correction introduces an HTTP cleanup pass.

Native Link aliases retain their own list contract. A two-hop endpoint is plural
when either the alias or its relationship wrapper declares a list. The previous
interpreter ignored alias listness and rejected two genuine Payment Collections
as corrupt. Singular reverse paths remain singular; suffix aliases retain their
separate output cardinality and selected bounds.

Versioned population groups validated parent IDs sharing a version into one
membership conjunction per version. The previous three-node branch per parent
exceeded the unchanged 64-node Core predicate ceiling for a fifty-Order page.
The Order owner preserves exact parent/version pairs and malformed-parent
refusals while retaining one protected bounded query. Distinct-version cohorts
still consume the existing shared predicate budget.

The initial Store read composition inherited the ordinary 128-identity host
allowance, which refused the native fifty-Order default page during observation
capture. The named composition now selects the existing trusted `nativeLimits`
contract using source metadata. This is a profile working-set selection;
Core correctly retains its existing capture enforcement and default limits.
Full default pages also exceed the ordinary numeric DTO node allowance after
native formatting. That profile value limit now follows the complete result
through its existing capture owners, instead of being reset at each boundary.

## Convex Compatibility And Flarex Divergences

Independent challenges inspected the actual pinned Convex snapshot, nested-query
transaction lending and checkpoint mechanisms. No Core mechanism change is
selected. Existing Medusa HTTP service reads retain their recorded independent
lifetimes; this profile adds no graph-wide snapshot guarantee or durable GET root.

## Implemented Capabilities

Native route/workflow source guards, HTTP and SDK composition witnesses cover
access, envelopes, mandatory status fields and mixed-Cause preservation. Owner
witnesses exercise real pagination/count, populated Fulfillment relationships
and the new explicit cohort policies. Connected acceptance covers native default
detail, fifty-row pages with genuine count/offset and ordering, verified-Customer
and draft isolation, native soft-deleted exclusion, explicit status fields and
unchanged rows, revisions, indexes, outcomes and events on both database drivers.
Actual Workerd additionally covers private executor admission, populated
Fulfillment data, cold recreation and existing populated Cart retrieval under
the recorded `nodejs_compat` host with cache-disabled Hyperdrive.

## Known Gaps And Limitations

Transfer requests, broader Order filters/ordering, arbitrary graph entry points,
deployment and measured capacity are outside this profile. Optional Product
expansions retain their existing Product cohort policies. Shared resource limits
can refuse a larger combination of individually admitted relationships.
Page size does not bound count or residual candidates; arbitrary counts and
unbounded source populations are not supported by this finite working set.

## Target Direction

Retain native Medusa read semantics behind the private Effect HTTP adapter and
shared protected read owners. Extend route families only with complete native
dependency, access and runtime evidence.

## Next Correctness Gates

Order transfers, broader filters and projections require their own native
dependency and access profiles. Deployment, measured capacity and arbitrary
source populations retain independent acceptance gates. Retain the connected
database, existing Cart completion and actual Workerd regressions when changing
shared capture, Query, SDK or host policies.
