# Local Graph Query

## Status And Recommendation

Status: the approved source-private capability is implemented, validated on
PGlite and ordinary-role PostgreSQL, and reviewed. The
[folder index](./README.md) owns sequencing, and
[atomic composition](./09-atomic-composition.md) owns execution authority.

The source-private Graph Query facade in the Medusa adapter binds to the
existing atomic command context. It prepares checked entry points once and
executes registered module reads with fresh scoped services. It reuses the current
read executor, relation population, service semantics and transaction owner. This
capability needs no Task extension, database schema change, new lock owner, or
relational OCC implementation.

The result is useful local graph reads within a bounded business operation,
including reads of its pending writes. Product and Currency supply the first
consumers. The registry and query contract must not encode their names into
Flarex core. This closes a workflow dependency; it does not supply events,
hooks or the Medusa execution engine.

## Evidence And Design Challenges

The source reference is the revision in
[SOURCE.json](../../third_party/medusa/SOURCE.json), currently
48d5cc675e4e8bc821e22c20c88a751acc66fb5f, baseline 2.13.4.
Current [Medusa Query documentation](https://docs.medusajs.com/learn/fundamentals/module-links/query)
explains service dispatch and additional options. The retained fork determines
what source can actually be reused; current documentation is not parity proof.

| Inspected boundary | Finding and consequence |
| --- | --- |
| [Portable Query](../../third_party/medusa/upstream/packages/core/modules-sdk/src/remote-query/portable-query-runtime.ts) | Direct entry points are useful, but graph options are ignored, alias collisions overwrite entries, and several input properties are silently dropped. Do not expose this permissive runtime as the checked native contract. |
| [Direct dispatch](../../third_party/medusa/upstream/packages/core/modules-sdk/src/remote-query/direct-entrypoint-query.ts) and [field splitting](../../third_party/medusa/upstream/packages/core/modules-sdk/src/remote-query/remote-fetch-data.ts) | Dispatch always calls list-and-count. Simple splitting retains field strings and extracts only the first relation segment; it does not implement full wildcard and nested traversal semantics. |
| [Full Query](../../third_party/medusa/upstream/packages/core/modules-sdk/src/remote-query/query.ts) and [query normalization](../../third_party/medusa/upstream/packages/core/modules-sdk/src/remote-query/to-remote-query.ts) | RemoteJoiner, index, context and container concerns are broader than one local entry point per read. Retain supported field semantics without importing that runtime closure. |
| [Module definition](../../packages/medusa-adapter/src/module-definition.ts), [Product commands](../../packages/medusa-adapter/src/product-service.ts) and [Currency commands](../../packages/medusa-adapter/src/currency-service.ts) | Immutable preparation and fresh scoped services exist. Register actual read commands instead of opening a standalone host or constructing service method names from user input. |
| [Shared reads](../../packages/medusa-adapter/src/query/read.ts), [catalog](../../packages/medusa-adapter/src/query/catalog.ts) and [projection](../../packages/medusa-adapter/src/query/projection.ts) | Filtering, population, counting and projection already have owners. Metadata describes reads but grants no authority and does not prove a static projected DTO type. |
| [Product profiles](../../packages/medusa-adapter/src/product-read-profile.ts) and [Category repository](../../packages/medusa-adapter/src/product-category-repository.ts) | Admitted population and dotted DAL selection differ. Category tree hydration is service-owned, not an ordinary catalog edge. Blind forwarding or direct table reads lose existing semantics. |
| [Currency query](../../packages/medusa-adapter/src/currency-query.ts) and [serialization](../../packages/medusa-adapter/src/currency-values.ts) | Currency uses `code`, has different page defaults, and retains a validated numeric companion for `rounding`. A universal `id` assumption or incidental module defaults would make the graph contract inconsistent. |
| [Category projection](../../packages/medusa-adapter/src/product-category-projection.ts) | Commands use an envelope to preserve own-undefined DTO fields across JSON. Native results must hide this transport detail and define absence semantics. |
| [Atomic context](../../packages/persistence-postgres/src/atomicCommerce/commands.ts) and [host](../../packages/persistence-postgres/src/atomicCommerce/host.ts) | Calls already share authority, transaction, budget, sticky refusal and retained root outcome. No second transaction or replay store is necessary. |

Exposing the portable runtime unchanged would silently accept unsupported
behavior. Implementing remote joins or another relational reader adds owners
without serving the first consumer. A checked facade over existing module
reads is the recommended middle ground.

## Supported Contract

### Preparation And Authority

Prepare one immutable registry for the admitted module set. Derive names from
actual joiner metadata, intersect them with explicit supported read
capabilities, and connect them to registered command tokens. Reject ambiguous
aliases and malformed admitted registrations during preparation. Retain
Product's explicit variant aliases. A generated alias or repository alone does
not admit an entity.

Roots are Product, Category, Collection, Type, Tag, Option, Variant, Image and
Currency through existing read commands. The
[conditional workflow capability](./14-conditional-variant-image-workflow.md)
adds Image through its generated service and existing read profile. Option value
remains a relation target where profiles admit it. Each module owns specialized
path and response policies; ordinary authors should not manually assemble a
graph repository for every model.

Bind the registry to the current atomic context. Prepared metadata holds no
SQL manager or service instance. Each query invokes its registered read command
through that context; the host still admits the exact installation and command
set. A name cannot select another scope, installation, profile or operation.

### Input And Result

Prepare the registry with
[prepareLocalGraph](../../packages/medusa-adapter/src/local-graph/query.ts).
Product command preparation exposes its module-owned `graph` description;
Currency exposes the checked `currencyGraph` definition. The composition root
supplies participant tokens, and the host independently admits the read
commands. These APIs remain source-private; no application ingress is added.

The shared `useQueryGraphStep` adapts this native contract for workflows. An
omitted page uses the native ceiling and requires a complete result;
`isList: false` requires zero or one match with no skipped rows. Only the step
unwraps a single result. It exposes partial JSON and preserves absence as an
intermediate undefined value. The native resource accepts exactly one argument
and returns arrays; extra arguments latch a refusal.

```ts
const query = preparedGraph.bind(commandContext)

const result = yield* query.graph({
  entity: "product_category",
  fields: ["id", "name", "category_children.*"],
  filters: { parent_category_id: null },
  pagination: { take: 25, order: { id: "ASC" } },
})
```

- Accept one native object form: `entity`, nonempty `fields`, optional `filters`
  and `pagination`. Decode unknown input strictly. Refuse unknown members,
  legacy remote-query shapes and unsupported options rather than dropping them.
- Require integer `pagination.take` within the selected profile's existing row
  bound; allow zero for an empty page with a count. Default `skip` to zero and
  retain the existing zero-to-255 offset bound; take is zero-to-256. Reuse admitted ordering, with the root's
  stable identity as default and deterministic tie breaker before pagination.
  Refuse ordering that the read owner cannot express; never sort only an
  already paginated result.
- Always return `{ data, metadata: { count, skip, take } }`. `data` is an array,
  including an empty match. Count follows the module's existing filtered root
  count before pagination, not joined-child cardinality. Decode service results
  and validate count and window values.
- Initially admit existing root-specific scalar, array, null and nested filter
  forms that also fit native command values. Unsupported fields and operators
  fail explicitly. Do not promise arbitrary Medusa `$` operators: the
  [native value contract](../../packages/flarex-protocol/src/value.ts) reserves
  `$`-prefixed object keys in canonical command values. Do not change that
  protocol or invent a universal filter AST for this facade.
- Return checked partial JSON values for dynamic selections. Do not offer an
  unconstrained `graph<T>` or assert a partial row is a complete DTO. Infer
  entity/field information only where prepared literal definitions preserve
  it; runtime metadata cannot manufacture static types.

Explicit pagination and JSON results are deliberate native-profile choices,
not full Medusa Query compatibility. A later workflow adapter must prove how
its original query calls fit this contract. That may require a separately
specified bounded unpaged policy; it must not silently inherit Product's or
Currency's current defaults.

### Fields, Relationships And Representation

Support exposed scalar fields, admitted dotted relation paths, `*` and
`relation.*`. A wildcard expands only exposed scalar fields of that node; it
does not recursively discover relationships or traverse cycles. Validate every
requested segment and preserve full relation prefixes for population.
Traversal stays within existing profile and resource bounds.

Prepare a response field plan from checked DML metadata and explicit
service-owned capabilities, including Category tree paths. Fetch through the
existing service with an admitted selection and population request, then apply
the checked graph field mask. Reuse existing pure projection mechanics where
their behavior matches. Do not pass unsupported dotted DAL selection through a
fallback, reimplement tree hydration or add another relation loader.

The connected reuse comparison includes `to-remote-query.ts` and
`getAllRemoteFetchFieldsAndRelations`. The former constructs a RemoteJoiner
object and also processes filters/context; the latter clones that expansion
tree and returns dotted DAL selection plus remote arguments. Neither output is
the admitted service projection contract here. The implementation instead
reuses the already-promoted Medusa `toPopulateTree` algorithm and the existing
shared `projectRows` executor. Adapter-owned work checks supported paths,
expands node wildcards against checked columns and selects native output
policy. No new source is promoted from the reference island.

The shared projector has explicit native policies for required selected fields
and an optional to-one relationship. Existing DAL plans omit those policies and
retain their prior behavior. Graph preparation marks genuine read commands
using their original core tokens; this adapter check neither issues installation
authority nor replaces core command authentication.

Expose selected fields and declared serialization companions. Identity or join
keys needed only for hydration must not become output accidentally. Retain the
existing validated `rounding`/`raw_rounding` representation when rounding is
selected; do not convert or reconstruct numbers in the graph layer.

Preserve service-defined nulls and empty arrays. Normalize service-owned
undefined object members to absence at the native JSON boundary, including
Category's undefined parent representation. Do not substitute null or expose
the private envelope. Allowed absence must follow declared service policy,
not hide an invalid response. Existing Medusa-facing DTO wrappers retain their
representation and compatibility tests.

Hydration may read more than the final mask exposes. Charge existing read,
intermediate-value and output budgets before projection; a small output must
not permit an oversized scan or tree. Optimizing those reads does not justify a
parallel execution path or increased limits.

### Execution, Failure And Replay

Reads share the owning command's SQL transaction and observe its pending
writes. The facade has no independent commit, lock, retry, cache or retained
result. Calls consume existing shared call, statement, time and byte limits.
Capture caller input before yielding to foreign service code; retain no
mutable caller configuration.

Use the atomic refusal path once for graph-owned invalid input, unsupported
capabilities and invalid service results, before a child call or after result
decoding. Participant failures propagate their existing complete Cause without
re-entering refusal. Catching a graph failure in business code must not clear
rollback-only state. Cancellation and escaped or closed contexts remain with
the existing lifetime owner.

Exact root-command replay returns the retained final result without rerunning
reads or business callbacks. A new command reads fresh data. This is not a
durable per-query snapshot or a promise that resumed workflow steps see old
data.

Convex distinguishes queries invoked inside a mutation's transaction from
queries invoked by an action in independent transactions; see the retained
[registration contracts](../../../../npm-packages/convex/src/server/registration.ts).
The relevant reuse is ownership by the outer operation. This capability uses
the accepted trusted SQL profile; it does not implement native relational OCC
dependencies or make a standalone query host transactional by wrapping it.

## Reuse And Retirement Inventory

| Owner or path | Disposition |
| --- | --- |
| Module definitions, checked DML and actual joiner aliases | Keep; extend preparation with an adapter-owned admitted graph description. Metadata stays separate from authority. |
| Product/Currency services and registered read commands | Keep and invoke. Preserve supported standalone callers and specialized Category behavior. |
| Shared reads, Medusa path-tree helper, relation loader, projection and value codecs | Keep; reuse path normalization and recursive projection. Extend only explicit native response policies; existing DAL defaults and storage semantics remain unchanged. |
| Pinned portable/full Query | Reference for syntax and characterization; do not promote either runtime wholesale. Exact pure extractions require existing provenance/promotion gates and retained tests. |
| Atomic context, persistence, publisher and recovery | Keep unchanged. The facade belongs in `medusa-adapter`, not a new core query subsystem. |
| Temporary probes or duplicated helpers introduced during implementation | Delete before completion. No stored schema or supported API is displaced by this capability. |

## Validation Contract

Maintain one connected capability, including its consumer and failure cases;
registration, projection and integration are not separate approval gates.

1. Characterize admitted pinned Query field, alias and pagination semantics.
   Cover every initial root, nested fields, wildcards, `code` keys, numeric
   companions, Category trees, empty matches, counts and ordering. Real-service
   cases cover tied Category ranks before offset pagination and a populated
   Product query with a zero-sized page. Refuse
   ambiguous aliases, invalid fields, unsupported options/filters, malformed
   input and invalid service responses. Prove input capture.
2. Extend the real
   [atomic proof](../../packages/medusa-adapter/test/atomic-commerce.test.ts):
   write Category parent/child and Currency through actual services, read both
   through the facade before commit, and verify one publication and retained
   outcome. Reads add no write facts. Preserve existing command regressions;
   do not weaken assertions or substitute synthetic installations/service rows.
3. Prove late failure and caught graph refusal roll back both modules. Cover
   shared limits, cancellation, unauthorized command/installation use, captured
   contexts and exact replay without rerunning reads. Run the connected proof
   on PGlite and ordinary-role PostgreSQL; neither proves deployed Cloudflare
   behavior or a new concurrency model.
4. Preserve relevant Product, Category, Currency, shared-query and module
   definition regressions, including original upstream cases. Run affected
   typechecks, promotion checks if applicable and required lint gates. Obtain
   both standing reviews on the final significant diff.
5. Reconcile this roadmap with the actual supported contract and remove
   scaffolding. Completion means the private facade and real atomic consumer
   work together, not only a planner passing unit tests.

## Remaining Boundaries

Stored Module Links and cross-module joins need their own
[relation/link contract](../flarexdb-framework-integration/05-relations-links-and-references.md).
A shared database or joiner metadata creates neither relationship authority nor
a foreign key. Reading Product and Currency in one command is composition;
it does not invent a relation between them.

Defer `query.index`, GraphQL, remote transport, Query context, locale, cache,
`throwIfKeyNotFound`, arbitrary operators, subscriptions, new modules, public
ingress and production activation. No workflow SDK or native Task changes are
part of this capability. Events, hooks and workflow compatibility retain the
gates in [Medusa workflow integration](./10-medusa-workflow-integration.md).
