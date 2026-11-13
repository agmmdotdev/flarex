# Local Graph Query

## Status And Ownership

Status: native Query replacement connected for the admitted private profiles;
production activation remains gated. The [folder index](./README.md) owns sequencing;
[atomic composition](./09-atomic-composition.md) owns execution authority.

Medusa owns Remote Query normalization, field selection, aliases, expansion,
joins, argument forwarding, missing-key decisions and presentation. The promoted
[Query](../../packages/medusa-modules-sdk/src/remote-query/query.ts),
[RemoteQuery](../../packages/medusa-modules-sdk/src/remote-query/remote-query.ts)
and [RemoteJoiner](../../packages/medusa-orchestration/src/joiner/remote-joiner.ts)
execute the pinned programs through explicit configuration and fetch callbacks.
The source revision remains [SOURCE.json](../../third_party/medusa/SOURCE.json).
The permissive portable-query prototype is not the executing implementation.

The adapter admits a bounded profile and authenticates native fetches against
already-issued module read commands. Module services retain filtering, local
population, numeric serialization and business semantics. Postgres and the
trusted outer owner retain settlement; query metadata confers no authority.

## Preparation And Dispatch

Each nonempty module graph retains its actual native joiner declarations plus
checked DML relation model names through
[native metadata](../../packages/medusa-adapter/src/local-graph/native-metadata.ts).
Read-only Link declarations extend that metadata without another stored source
or grant. Composition must preserve this evidence. It must not reverse-engineer
native declarations from a second adapter query algorithm.

Workflow resource identities bind each complete native metadata frame through
the existing canonical resource digest. Each frame and the combined outer proof
retain their existing 64 KiB bounds. Repeated endpoint declarations do not become
unbounded outer proof data; their full contents still determine the digest.

[Graph preparation](../../packages/medusa-adapter/src/local-graph/query.ts)
snapshots admitted reads, aliases, ordering and path capabilities. The
[native registry](../../packages/medusa-adapter/src/local-graph/native-registry.ts)
resolves each native service/entity/method suffix to its exact participant and
command. Missing or ambiguous capabilities refuse. A native method name never
selects arbitrary code, a different scope or another installation.

An invocation constructs its own native Query, RemoteQuery and Promise owner.
No active transaction, service container, finalizer or callback runner is global.
The required fetch callback invokes the existing module command through the
current context. Native automatic dispatch owns ID merging, batching, null-take
semantics and list/count envelopes. A counted callback supplies its actual tuple;
the adapter does not manufacture a count from the page length. List-only commands
remain count-free and cannot satisfy a counted page.

## Admitted Inputs And Results

Producers retain explicit strict ABI schemas. The shared native boundary admits
bounded entity, entry-point, service and singleton selection-tree forms, then
uses the actual native normalizer and parsed plan for profile admission. Unknown
roots, prototype-sensitive paths and reserved transport path segments refuse
before native object normalization. Original flat fields pass their owning
capability check before normalization can transform them.
Unsupported members, options and command arguments fail closed. Bounds apply to
captured values, paths, fields and intermediate results.

The existing private `graph` contract requires explicit bounded pagination,
admits stable ordering and returns an actual counted JSON page. The workflow
helper supplies explicit `skip: 0` when absent, because native list/count dispatch
recognizes pagination through skip/cursor presence. Omitted workflow pagination
requires a complete bounded result; single-result use requires zero or one row.
These are named producer restrictions, not universal Medusa Query behavior.

Cart refresh retains separate JSON and native callable views. The native view
admits own undefined only for its three optional cross-module references, and
does not require an unrequested `raw_total`. The child Payment refresh keeps
the pinned dynamic Cart input annotation: its conditional refetch establishes
the stronger view before an update. That refetch still requests and requires
`raw_total`; a type annotation does not supply a missing runtime field.

Bounded Promotion graph reads admit native descriptors without an order. Their
existing DAL and receipt still use ID ordering. Internal calculation and usage
queries retain their required explicit orders, including application-value tie
refusal. The dispatcher does not synthesize an order for a native descriptor.

Native `remoteQuery` and `nativeGraph` preserve native output. Metadata can be
absent on an unpaged native graph call. Native intermediate values can own
undefined properties or dense undefined array elements; the HTTP JSON boundary
serializes them normally. Consumers decode their actual DTOs rather than claim
an arbitrary dynamic selection is a complete model. QueryContext tags pass to
the native normalizer unchanged. Index, GraphQL, locale processing, external
transport and cache execution remain unadmitted; admitted cache descriptors do
not activate cache I/O.

Native field masks determine visible IDs, join columns and numeric companions.
The adapter must not append an unrequested companion, rewrite a natural key to
`id`, reconstruct a native envelope or apply another response projector.

The promoted RemoteJoiner corrects one pinned owner defect: its join-value
accumulator has no object prototype. The raw native object accumulator confused
legal IDs such as `constructor`, `toString` and `__proto__` with inherited
properties, producing extra rows or an unclonable function. The exact source
guard retains this narrow correction and genuine Link regression. ID values
remain admitted; no consumer filter or response repair is introduced.

Native fetch descriptors can contain scalar join aids that are absent from DML,
such as `prices_id` or `payment_sessions_id`. Named DAL projection profiles
reuse native Mikro's absent-scalar behavior through an explicit policy. The
shared default remains strict; declared relations, malformed paths and unsafe
names still refuse. Producer field admission remains independent, and neither
the graph dispatcher nor HTTP filters these native selections or invents columns.

Currency's DAL retains the real `code` key while ignoring safe nonmodel scalar
selections as native Mikro does. Its numeric serializer normalizes companions
when the numeric field is selected; a raw-only selection preserves the stored
spelling. The native Query owns the final requested-field mask. Category's
stored-row decoder owns required stored fields; a selected native DTO omitting
a property does not by itself establish persisted corruption.

## Cohorts, Lifetimes And Failure

The invocation-local
[cohort admission](../../packages/medusa-adapter/src/local-graph/native-cohorts.ts)
observes raw, decoded module DTOs before native attachment. It authenticates
checked relationship directions, counts parents before native ID deduplication,
and enforces existing source, Link, target and per-source ceilings. Canonical
aliases share the strictest active bounds. Same-service hydrated descendants
consume their existing bounds even without a second fetch. This observer never
joins, orders, attaches or projects rows. Missing native targets remain a native
relation-policy decision; invalid returned keys or membership refuse.

Local population membership is authenticated by the issued DAL relation and its
existing receipt. A selected nested DTO can omit an unrequested foreign key.
For these hydrated results, admission counts every child position per actual
parent and across the complete target cohort, and checks carried keys when
present. Independent fetches retain their required target-key membership proof;
outgoing joins still require their actual source keys. No hidden field is added
to a native selection to satisfy admission.

Native expansion grouping can rebind a fetch to a local descendant service or
retain its original service. RemoteJoiner records its already-resolved grouped
parent paths and service/entity configurations in invocation-local metadata,
including aggregated fetches. The observer consumes detached copies of that
evidence to authenticate hydrated parents. It does not infer a second alias or
path resolution algorithm. Native fetch arguments and result presentation remain
with the native engine.

Inside a workflow, reads use the owning command's transaction and can observe
pending writes. HTTP refetches retain their existing independent protected read
lifetimes. Several independent reads do not become one atomic snapshot. There
is no extra database transaction, commit, retry store, lock or recovery path.

The named [Store Order read profile](../flarexdb-framework-integration/preflight/store-order-http.md)
uses the existing database page/count window with fifty root rows and up to two
hundred related identities. Native Link metadata's absolute ceiling is 256,
matching the shared complete-read ceiling; each selected path retains its own
bounds. Shared ID readers select larger cohorts, owning references and native
relation presentation explicitly; their ordinary four-row defaults remain.
This introduces no SQL limit pushdown or larger Core capacity claim. Native
top-level own-undefined filter/page values reach native normalization, while
the shared ID query boundary uses existing omission capture for native DAL
option objects. Invalid nested values and unsupported capabilities still refuse.

The five Store Order readers select a finite native working set through the
existing trusted host contract: authenticated source table count times the
existing 256-row complete-cohort allowance. Ordinary readers retain their
128-identity default and Core ceilings remain unchanged. Count and residual
evaluation can observe candidates beyond the returned page; those identities
consume the selected allowance and can still refuse. This selection grants no
additional module methods, table access or mutation authority.
The same five-reader profile selects the existing thirty-second command ceiling
for page/count and local formatting; ordinary ten-second deadlines remain.

The shared Link interpreter combines native alias and relationship listness
for two-hop endpoints. The genuine `Order.payment_collections` alias declares a
list even though its relationship wrapper omits `isList`; ignoring that alias
previously rejected two genuine Collections as corrupt. Singular reverse paths
and suffix alias output cardinality retain their native contracts and selected
bounds. The Order version-filter owner also factors equal-version parent IDs
into membership groups, preserving exact pairs within the existing relational
predicate budget. Neither correction introduces batching or a larger Core limit.

Caller descriptors and module results are captured before native code receives
mutable detached copies. Trusted native outputs are detached before the same
bounded intermediate capture, including native nonenumerable hydration members.
Participant failures preserve their complete Cause. Graph refusals remain sticky;
catching one cannot clear rollback-only state. Cancellation and closed contexts
remain with the existing owner. Exact root replay uses the retained root outcome;
it does not rerun reads or establish a durable per-query snapshot.

## Validation And Retirement

Native service presentation can flatten physical relationship wrappers. Public
relation metadata must follow the admitted module read paths and their checked
target tables, while DML retains the storage graph. Cart completion exposed the
distinction: native Order presents `items` as OrderLineItem and
`shipping_methods` as OrderShippingMethod, with the OrderItem wrapper under
`items.detail`. Using only physical DML targets misidentifies those public
descendants. The metadata issuer owns this correction; HTTP and module adapters
must retain native `formatOrder` and cannot repair it with a second joiner.
Conflicting public targets across admitted reads refuse during preparation.

The exact source guards compare complete promoted native programs and retained
native assertion ports. Raw pinned versus promoted comparisons cover descriptors,
selection, joins, aliases, context, missing-key behavior and output representation.
Adapter tests separately cover command authentication, producer restrictions,
cohort budgets, immutable preparation and full-Cause propagation.

Connected consumers must pass PGlite and focused ordinary-role Postgres checks.
Actual Workerd acceptance uses its recorded host profile and does not establish
arbitrary providers, deployment, capacity or general framework compatibility.
The accepted core ownership and transaction guarantees require no mechanism
change for this replacement.

The displaced adapter Remote Query joins, field projectors, context lowering and
handwritten missing-key behavior are removed with their callers. Shared DAL read,
projection, population and codecs remain with their real module consumers.
Stored Module Links retain their
[relation contract](../flarexdb-framework-integration/05-relations-links-and-references.md).
Events, hooks and workflow compatibility retain the gates in
[Medusa workflow integration](./10-medusa-workflow-integration.md).
