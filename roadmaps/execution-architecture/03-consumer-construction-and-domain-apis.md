# Consumer Construction And Domain APIs

## Status And Scope

**Construction/API replacement complete for the admitted local profiles.**
The shared-execution baseline is reviewed and committed. The connected
[source and test ownership cutover](04-source-and-test-ownership.md) is complete.
This is the focused third slice of the
[execution architecture roadmap](README.md). It addresses the owner's request
for readable domain organization, clean operation APIs, and domain-owned
construction. Completion applies to the admitted local construction contracts;
public authoring and broader framework admission retain their separate gates.

The first connected implementation is CMS/Payload construction,
including direct reads, supported direct commands and the existing Application
mutation participant. Commerce is a connected boundary comparison and affected
shared consumer, not permission to redesign every framework in one pass.

The [accepted design](../../design-notes/flarex-db-accepted-design.md),
[package boundaries](../16-package-boundaries.md), existing
[direct-read contract](01-direct-read-capabilities.md) and
[runtime/participant ownership](02-runtime-and-participant-ownership.md) govern
this slice. The [shared execution evidence preflight](../mixed-mutation-core/27-shared-execution-evidence-redesign-preflight.md)
owns preparation, admission and publication contracts. The current generation-
owned preparation and finite execution baseline governs the construction work.
The older [domain separation idea](../../design-notes/flarex-postgres-persistence-domain-separation-idea.md)
is exploratory history, not a replacement authority.

## Problem And Nearest Connected Proof

A consumer should select a supported operation and supply its meaningful inputs.
It should not repeatedly reconstruct the provider's authority, installation,
readiness, materialization and lifecycle graph.

The handed-off source had two different kinds of assembly:

- Trusted fixture and benchmark roots legitimately provision databases, install
  metadata, select physical resources, seed data and inject faults. Much of the
  large construction observed here is in these roots; it is not evidence of
  production routing or arbitrary application callers.
- Those roots also reconstructed serving-owner graphs and materialization ports.
  Payload's ordinary runtime accepted persistence-shaped binding inputs, carrying
  those construction details through its own API. Application serving and issued
  CMS bindings now own that assembly; named raw fault/registration witnesses
  retain their explicit trusted construction.

Moving a long input object into a branded wrapper would leave the second problem
intact. The outcome must remove repeated graph assembly and give each operation
a capability whose issuer owns its implementation and lifetime.

The nearest proof is the existing Payload direct/native read/write and borrowed
Application mutation path: same Local API behavior, same pending visibility,
same authority checks and same final outer settlement, with simpler callers.
Composed Application queries and broader Payload admission remain separate.

## Package Domain Map

The [package guide](../../packages/persistence-postgres/README.md) maps current
folders and entry points. This table names the responsibilities reused by the
construction replacement, which crosses Application serving, CMS execution and
the Payload adapter.

| Domain | Current source families | Consumer-facing responsibility |
| --- | --- | --- |
| Database runtime | physicalSession/, relationalTransaction/session.ts, postgres/PGlite construction, drizzleStatementEffect.ts | Scoped database mechanics for privileged lower owners; no business-facing raw handle. |
| Scope authority | scopeAuthorityResolution.ts, scopeAuthorityControlRead.ts, scopeClock.ts, scopeExecution/ | Authenticated scope selection, clock and fencing capabilities. |
| Installation/catalog | frameworkSchema/, migrationCoordination/, installationLifecycle.ts, physicalDefinitionLifecycle.ts | Installed definitions, target/source binding, protected structure and explicit maintenance. |
| Logical storage | logicalDocuments/, appRows.ts, appIndexDefinitions/Entries, unique owners, appRelationEdges/ | Snapshot reads, attempt-owned pending state and canonical storage contributions. |
| Application lifecycle/serving | applicationActivation.ts, applicationReadiness.ts, applicationRelationReadiness/, application schema/task binding owners | Registration/readiness/activation and trusted serving construction with their actual authority. |
| Attempt execution | sessionJournalStore.ts, finite/session helpers, transactionSessionActivation.ts, storedOccExecution/ | Entry, journal/pending observations, admission and conflict evidence for an owned attempt. |
| Publication/recovery | commit/point/, commit/publication/, commit/authority/, committedPointOutcome.ts, commit/events/ | Atomic settlement, durable outcome resolution and supported publication/event evidence; contracts, trusted construction and eligibility have distinct routes. |
| Framework execution | cmsTransaction/, commerceTransaction/, atomicCommerce/, crossDomainCommand/ | Restricted direct or borrowed capabilities using shared storage/settlement owners. |
| Tasks/sync | Task System repositories, compute/wake repositories, commit feed and live-query repositories | Separate durable domain capabilities; task lifecycle and sync policy retain their existing domain owners. |

A dependency on another domain is permitted through its approved capability
boundary. Ownership, authority and resource lifetime determine the direction,
including legitimate transaction-owning coordination. The target is not zero
cross-domain imports or moving framework lifecycle policy into persistence.

## Current Call Chains

These paths identify the implemented construction and operation owners. Connected
validation and retirement gates determine completion of the active cutover.

| Boundary | Current source | Responsibility and exposed detail |
| --- | --- | --- |
| Payload ordinary construction | [runtime.ts](../../packages/payload-adapter/src/runtime.ts), [api.ts](../../packages/payload-adapter/src/api.ts) | makePayloadRuntime owns one scoped native instance; bind/bindRead accept authentic CMS bindings and return admitted native methods. Command tokens and persistence graph inputs are absent from the ordinary API. |
| Native lifecycle | [runtime/native.ts](../../packages/payload-adapter/src/runtime/native.ts) | Creates BasePayload, configuration, bridge and operations; retains hosts in the native instance's exact Scope and refuses use after closure. |
| Direct binding | [direct/binding.ts](../../packages/payload-adapter/src/direct/binding.ts) | Supplies exact native tokens/content identity to the restricted CMS execution surface and retains the resulting host in the native Scope. |
| CMS construction contract | [construction.ts](../../packages/persistence-postgres/src/frameworks/cmsTransaction/construction.ts), [api.ts](../../packages/persistence-postgres/src/frameworks/cmsTransaction/api.ts) | Issues separate authentic scoped command/read bindings from Application serving and explicit policy/source selection; adapter execution receives neither the raw graph nor construction factories. |
| Managed read | [read/host.ts](../../packages/persistence-postgres/src/frameworks/cmsTransaction/read/host.ts) | Authentic command selection, read-only capability, fresh admission, demanded readiness, snapshot and request lifetime already belong to core. |
| Borrowed adapter call | [participant/binding.ts](../../packages/payload-adapter/src/participant/binding.ts) | Selects the native method, retains the exact native Scope and projects native errors; its abort finalizer drains the CMS invocation. |
| Borrowed core call | [borrowedLogicalAttempt.ts](../../packages/persistence-postgres/src/frameworks/cmsTransaction/borrowedLogicalAttempt.ts) | Authenticates attempt/source, selects the exact command, enforces the deadline and closes the call into authoritative contribution/event/accounting completion. |
| Root participant contract | [journal/contracts.ts](../../packages/persistence-postgres/src/execution/journal/contracts.ts), [logicalDocuments/model.ts](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/model.ts) | Owns attempt, admission bundle, historical/pending view and participant completion/abort/usage contracts. The concrete store evaluates them; its construction is separate. |
| Serving construction | [applicationServing.ts](../../packages/persistence-postgres/src/application/applicationServing.ts), [applicationRelationReadinessFixture.ts](../../packages/persistence-postgres/test/application/relations/applicationRelationReadinessFixture.ts) | Application owns the common authority/readiness/materialization graph. Trusted fixtures provision resources and retain named fault profiles; they use the same serving owner for normal bindings. |
| Ordinary direct consumer | [payloadLatencyFixture.ts](../../packages/persistence-postgres/test/integration/payload/payloadLatencyFixture.ts) | Provisions protected resources and makes a scoped CMS binding through Application serving, then binds native methods. |
| Connected consumer | [mixedMutationProductFixture.ts](../../packages/executor/test/performance/support/mixedMutationProductFixture.ts) | standalonePayloadBinding uses the common serving graph and issued CMS binding. Named raw construction is confined to explicit fault witnesses. |
| Other admitted profiles | [payloadFlows.ts](../../packages/executor/test/performance/support/payloadFlows.ts) | Builds scalar/relation/profile-specific hosts and selects ordinary or explicit conformance construction. Preserve these profile differences. |
| Native read/lifetime witness | [logical-payload-managed-read.postgres.test.ts](../../packages/medusa-adapter/test/logical-payload-managed-read.postgres.test.ts) | Constructs separate genuine read/command serving and CMS bindings; proves access, missing-document errors, write refusal, explicit close and escaped Scope refusal. |
| Native failure witness | [fresh-framework-acceptance.postgres.test.ts](../../packages/medusa-adapter/test/fresh-framework-acceptance.postgres.test.ts) | Instruments the actual session and native callback/final guard boundaries. Fault instrumentation is not reusable serving configuration. |

## Selected Responsibility Boundaries

### Concrete Construction Cutover

The approved replacement has three owners. Application construction accepts
installed target/control resources and explicit serving profiles, and creates
the reusable authority, readiness and maintenance graph. Managed read construction
creates only the authority and protected active-binding reader; it must not
construct a publication graph. CMS construction issues authentic, scoped read
or command bindings from that serving owner and trusted source/policy selection.
Payload binds its native instance to those capabilities and exposes admitted
operation methods. Multiple databases, sources and native instances may coexist,
so these are scoped factories rather than process-wide Context singletons.

Replace Payload's derived host-input types and ordinary command map. Keep exact
command tokens available only to trusted registration and explicit conformance
support. Caller envelopes derive from the ordered input owner's admitted field
contracts; internal decoded collection objects remain private. Result contracts
reuse the existing result schemas, including replay, without an independent
capture path. Native validation order and unsupported-profile failures remain
unchanged.

Move borrowed command lookup, deadline enforcement, closure and participant
completion into CMS. Source identity comes from authenticated admission. Payload
retains native command selection and framework error projection. No constructor
installs or activates schema, settles a borrowed root, introduces another runtime
bridge, or changes durable formats. Full-proof/direct, managed and source profiles
remain explicit while their named consumers migrate. Fault controls and cold
materialization refusal witnesses stay in test support.

Acceptance requires complete caller migration, removal of displaced exports and
construction, focused import-boundary checks, escaped-lifetime and forged-binding
refusal, native/replay/failure behavior, PGlite and ordinary-role PostgreSQL, and
affected mixed/sandbox proofs. Construction cost comparisons assess this cutover;
the performance program remains paused and no latency acceptance follows from
an API cleanup.

### Trusted Resource And Installation Composition

Hosts and fixture roots select real driver resources, installed target/control
references, trusted identity/access policy, configuration and shutdown ownership.
They may compose concrete domain Layers. They do not recreate internal repository
graphs at each framework binding.

Installation remains an existing authoritative owner. No constructor here
silently installs schema, activates a source or provisions new credentials.
Separate raw, managed and test driver profiles stay explicit.

### Application Serving Composition

Move reusable serving reconstruction into an Application-owned construction
entry point inside the existing persistence package. It composes the existing
scope, readiness, binding and activation owners; it does not duplicate their
policy or create a second schema authority.

Its inputs express the actual installed resource topology and trusted selection.
Its internal construction creates the concrete repositories and ports currently
repeated by consumers. Raw handles are visible only to this privileged
construction boundary and lower database owners.

Keep fixture-only materialization refusals, raw inspection and fault controls
in test support. Never promote a fixture graph wholesale into production.

### CMS Execution Construction

The CMS owner combines serving selection, source/content identity, retained
preparation, supported maintenance mechanics, budget and lifecycle. It issues
separate read and command bindings for the actual admitted profile.

These bindings are issued execution capabilities, not options bags. Their private
implementation retains dependencies, validates real database/session/authority
relationships and composes existing admission, read, request and publication
owners. Read construction must not acquire command or settlement authority.

Stable shared dependencies may use Context services and live Layers. Target,
scope, source, native instance and attempt-specific values remain explicit
scoped instances when multiple instances coexist. No global database or source
service locator, nested runtime bridge or hidden runPromise.

### Framework Adapter

Payload owns compiled collection meaning, native construction, Local API access,
validation, hooks, request/dataloader semantics, supported method mapping and
native error translation. It binds its exact command tokens/content identity
to the issued CMS capability.

The borrowed adapter selects the native command. Core owns authentic command
lookup, deadline enforcement, borrowed-call closure and storage contribution
assembly. The adapter keeps framework-specific method and error meaning.
Source/event identity is taken from its authenticated owner, not reconstructed
from untrusted arguments.

Application execution still owns orchestration, replay eligibility and outer
settlement. A borrowed capability cannot fall back to a direct call.

## Consumer API

The implemented private contracts reuse existing commands, ordered input
decoders, result schemas and error families. They do not establish a public
authoring API or expand supported framework operations.

The displaced ordinary binding had this shape:

```ts
const runtime = yield* makePayloadRuntime(compiled);
const host = yield* runtime.bind({
  hostRuntime, database, controlDatabase, session,
  deploymentId, scopeId, authority, application,
  identityAndAccessPolicy, materialization,
  logicalStorage: { ports, unique, schemaVersionId, source },
});
const result = yield* host.read(runtime.commands.findByID, args);
```

The selected boundary gives trusted composition an owner-built CMS command
binding. A managed reader receives a separately issued read binding.
The operation consumer supplies neither the internal port graph nor individual
prepared metadata objects:

```ts
const runtime = yield* makePayloadRuntime(compiled);
const host = yield* runtime.bind(cmsCommandBinding);
const created = yield* host.create(requestKey, createArgs);
const result = yield* host.findByID(findArgs);

const reader = yield* runtime.bindRead(cmsReadBinding);
const readResult = yield* reader.findByID(findArgs);
```

The ordinary consumer receives bound private Payload operations, with native
command tokens selected inside the adapter. It does not pair a generic host with
a separately exposed command map. Request keys remain explicit for independently
committed commands and replay; readers receive neither keys nor writes.

Reuse the admitted input-envelope decoders and existing result schemas in
inputs.ts/results.ts. Decoded Payload inputs contain internal collection runtime
objects and must not become caller inputs. Keep caller envelopes distinct and
derive precise method types from their authoritative boundary; preserve
collection/profile restrictions, omitted/null meaning and native validation order.
Do not use the full upstream Local API signature to imply unadmitted support.
Correlate each bound method's input/result through the real command contract,
including stored-result replay, without generic JSON casts or another independent
capture/validation pipeline.

This retains the existing native runtime and authenticated command execution;
it is not a new developer-facing Local API. Trusted participant registration can
still use exact command capabilities through a restricted construction surface.
The binding is created by domain-owned assembly from installed resources and
trusted selection. A factory that merely closes over the old assembled input
fails the construction acceptance gate.

For the borrowed call, retain the existing root registration/selection boundary.
The adapter maps method to command and calls an issued CMS invocation capability.
Core returns the existing authoritative participant completion and owns its
single closure; the consumer does not fetch command definitions or reassemble
changes, events and usage.

The exceptional case stays visible: changed binding, stale installation,
revocation, unsupported command, closed lifetime or uncertain settlement returns
the existing exact failure/Cause at its owning boundary. Failed preparation runs
no native callback. The trusted root closes partial acquisitions. The adapter
must not repair failure by creating a direct host, refreshing through another
connection, extending the deadline or replacing native execution.

## Readable Internal Organization And Import Rules

Start within the existing domain folders:

```text
application/applicationServing.ts # Application-owned serving construction
frameworks/cmsTransaction/
  api.ts                    # Explicit consumer contracts
  construction.ts           # Domain-owned composition
  commands.ts               # Existing token/context owner
  failure.ts                # Existing failure projection
  read/                     # Genuine read execution
  borrowedLogicalAttempt.ts # Borrowed invocation and completion
  publication.ts            # Existing settlement integration
```

Application construction reuses the existing Application owner. A separate
framework-neutral construction owner is not required.
Keep each substantial operation readable through named stages; avoid long
anonymous closures, generic dispatch engines, arbitrary one-file folders and
large re-export barrels.

Import rules must distinguish:

- privileged construction roots, which may import approved construction
  entry points and resource types;
- framework registration/binding code, which uses the declared CMS command,
  binding and participant contracts;
- operation consumers, which use issued capabilities and operation inputs;
- source-private implementation and test/fault entry points.

Enforce approved cross-domain entry points and package exports with focused
structural checks. Include imports, type imports, re-exports and source-relative
bypasses. Analyze runtime cycles and type-only cycles separately. Domain
implementations import their own source modules rather than their public barrel.
Boundary checks supplement behavioral tests; fewer imports alone is not success.

## Contracts, Migration And Retirement

| Current surface | Disposition | Required cutover/removal gate |
| --- | --- | --- |
| PayloadHostInput/PayloadReadHostInput derived from persistence host construction | Replace | Migrate bind/bindRead, ordinary callers and conformance bindings to restricted issued contracts; remove derived input exports. |
| Ordinary consumers pairing generic CMS hosts with PayloadRuntime.commands | Replace | Expose bound admitted native operations; command maps remain only in trusted registration/construction; migrate result/replay consumers with exact types. |
| CMS host input types/constructors exported for general adapter assembly | Restrict/replace | Privileged construction remains with its owner; migrate every declared consumer before retiring adapter-facing raw construction exports. |
| Repeated serving repository/port construction | Move/consolidate | Use Application-owned serving composition; retain only explicit witness injection at the test seam. |
| Borrowed command definition lookup/deadline/closure/evidence assembly in Payload binding | Move to core operation | Preserve adapter method selection, native semantics, error projection and exact authoritative completion. |
| Native Payload instance, compiled collections and operations | Retain/extend binding | Same Scope, command identity and framework behavior; no second native engine. |
| Managed read and full-proof/direct/source profiles | Retain by named callers | Audit profile consumers and preserve each real contract; this slice does not erase a profile by styling it as one mode. |
| Old assembly helpers and broad convenience re-exports | Delete after caller migration | No compatibility wrapper, forwarding API or duplicated graph remains without a named consumer/removal gate. |
| Fault injection, raw database assertions and measurement collectors | Retain in test support | Ordinary construction excludes them; same production operation underneath the test seam. |
| Existing stored schema, receipts, journal identities and durable outcomes | Retain | No data conversion/reset/deletion selected; any newly required format change needs its own explicit disposition. |

Inventory both package exports and source-relative consumers before edits.
Existing private callers must migrate; their existence is not a shipped public
compatibility obligation. No new package, universal repository interface,
framework storage engine, public API, hosted route, advanced evolution or
arbitrary-framework activation is selected.

## Alternatives Challenged

- A package-wide folder shuffle improves navigation while leaving construction
  ownership unresolved. Select connected API/caller cutovers.
- A single framework execute(mode, ...) service obscures direct/borrowed and
  read/command authority. Keep capability distinctions explicit.
- An opaque configuration token or automatic consumer type inference can conceal
  the old graph. Require actual owner-built construction and exact contracts.
- One Context tag for every session/native instance collapses lifetime/cardinality.
  Use scoped values where multiple instances coexist.
- Extracting packages or moving all policy to executor now could create cycles
  and displace existing owners. Establish internal boundaries first and preserve
  the accepted package direction.
- Replacing working storage/transaction logic to obtain symmetry expands this
  slice. Reuse correct mechanics and correct a real owner only with evidence.

## Sequencing And Current Baseline

1. Complete the owner-requested source/test organization in the original checkout,
   including exact consumer, export, lane, guard and resource-path migration.
2. Use the reviewed generation-owned core baseline. The earlier cross-chat handoff
   gate is satisfied; completing the performance program is not a prerequisite.
3. Re-audit the serving graph and actual consumers when replacing construction.
   Explain any materially different authority/lifecycle decision before proceeding.
4. Deliver Application serving composition, CMS issued bindings, borrowed-call
   operation, adapter/caller migration and boundary enforcement as one coherent
   capability. If a shared owner changes, migrate affected Commerce consumers
   in that slice; full Commerce organization is a subsequent connected slice.
5. Validate, review, remove displaced construction/exports and commit the final
   coherent runtime change. Do not split helpers, file moves or test matrices
   into independent implementation goals.

After this first API capability, audit the same construction distinctions across
Commerce/atomic workflow, Application attempts, installation, logical storage,
commit/recovery, tasks and sync. Source/test organization makes those owners
visible; it does not establish that their construction contracts are complete.
The [file cohesion plan](05-file-cohesion-and-readable-flows.md) owns that next
organization work and the substantial implementation bodies that remain.

## Validation And Completion Gates

Documentation completion requires verified local links, coherent authority/status
labels, concrete consumers, exact break/retirement inventory and a scoped docs
commit. It does not require runtime tests or project reviewers.

Runtime completion requires all of the following:

- Representative root and operation callers use complete domain construction.
  Ordinary consumers no longer assemble authority/materialization/repository
  graphs or derive their contract from private constructor inputs.
- Ordinary callers use bound native operations rather than supplying command
  tokens to a generic host. Trusted registration retains exact authentic tokens.
- Types preserve admitted command/input/result correlations and exact Effect
  failures/requirements. Read capabilities have no write/settlement methods.
  Borrowed capabilities cannot masquerade as direct calls.
- Existing native Local API behavior, omitted/null input semantics, native errors,
  access/hooks, nested requests and fresh dataloader lifetime remain unchanged.
- PGlite owner/consumer regressions plus focused ordinary-role Postgres tests:
  direct reads/commands, snapshot/negative dependencies, unique/relation proofs,
  changed binding/revocation, stale prepared metadata, guard/lock order, failed
  acquisition, cancellation/drainage, closed/escaped Scope and lost-COMMIT recovery.
- Connected existing sandbox/Application Payload witness: pending reads/writes,
  one root outcome/publication, no independent child settlement, late rejection,
  replay and fresh retry native instances. Keep the currently admitted methods.
- Reuse the shared-execution measurement owners for a before/after complete
  matched consumer comparison on the handed-off source. No extra acquisition,
  per-call graph construction, transaction or retained-resource leak. Structural
  cleanup does not establish native-relative latency acceptance.
- Affected typechecks, provenance/package guards, core/diff lint and staged diff
  lint; both read-only project reviewers inspect final callers, construction,
  connected failure behavior and cleanup.
- Remove displaced helpers, exports and duplicate assembly in the same slice.
  Preserve historical reports and durable-format decoders with real obligations.
  Stop owned test resources and commit only the verified owned checkpoint.
