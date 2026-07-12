# Runtime Validation And Error Boundaries

## Status And Scope

**Status:** Active domain authority. Runtime validation is broadly implemented
across SDK, protocol, deployment, execution, and persistence boundaries, but
several engines and error adapters remain duplicated or incomplete.

This roadmap owns:

- the layered runtime-validation model;
- where untrusted values become trusted domain values;
- validator execution for arguments, returns, documents, and IDs;
- protocol request/response decoding;
- stored-row and canonical-artifact corruption detection;
- typed domain failures and their HTTP/service-binding mapping; and
- the distinction between developer-facing static types and authoritative
  runtime checks.

It does not own:

- source-package analysis and push sequencing, covered by
  [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md);
- Dynamic Worker sandbox capabilities, covered by
  [`06-dynamic-worker-execution.md`](./06-dynamic-worker-execution.md);
- trusted transaction/OCC behavior, covered by
  [`20-postgres-executor.md`](./20-postgres-executor.md) and the
  [FlarexDB foundation](./flarexdb-foundation/README.md); or
- authentication-provider policy, except where identity/capability values cross
  a runtime validation boundary.

## Current Sources Of Truth

Use these sources in order when they disagree:

1. [`../AGENTS.md`](../AGENTS.md) and the accepted design precedence it defines;
2. accepted design and active domain roadmaps for authority/trust decisions;
3. this roadmap for cross-system validation placement and invariants;
4. protocol schemas, validator implementations, route decoders, domain errors,
   persistence codecs, and tests for exact current behavior; and
5. older checkpoint sections only as provenance or compatibility evidence.

Primary implementation anchors:

- [`packages/flarex/src/values.ts`](../packages/flarex/src/values.ts),
  [`validation.ts`](../packages/flarex/src/validation.ts),
  [`validatorJson.ts`](../packages/flarex/src/validatorJson.ts), and
  [`server.ts`](../packages/flarex/src/server.ts) for developer validators,
  registration exporters, and local validation;
- [`packages/flarex-protocol/src`](../packages/flarex-protocol/src) for shared
  Effect Schema transport contracts, branded identities, and canonical codecs;
- [`packages/analysis/src/index.ts`](../packages/analysis/src/index.ts) for
  authoritative-analysis shape and validator parsing;
- [`packages/flarex-backend/src/validation.ts`](../packages/flarex-backend/src/validation.ts)
  and [`deployment/Validation.ts`](../packages/flarex-backend/src/deployment/Validation.ts)
  for compatibility-backend validation;
- [`packages/executor-http/src/requestDecoders.ts`](../packages/executor-http/src/requestDecoders.ts),
  [`responses.ts`](../packages/executor-http/src/responses.ts), and
  [`errors.ts`](../packages/executor-http/src/errors.ts) for the private Fetch
  adapter;
- [`packages/executor/src`](../packages/executor/src) for active package,
  function, schema, scope, session, and syscall validation;
- [`packages/persistence-postgres/src/validation.ts`](../packages/persistence-postgres/src/validation.ts),
  schema/artifact codecs, and catalog modules for commit and stored-state
  validation; and
- focused tests beside each of those packages.

## Validation Model

Validation is deliberately layered. Repeating a check at a new trust boundary
is not unnecessary duplication when the upstream checker is outside that
boundary.

```text
TypeScript and generated types
  -> SDK registration/export validation
  -> source-package analysis validation
  -> wire/protocol decoding
  -> route authentication and request validation
  -> active deployment/function/scope validation
  -> generated isolate argument/context checks
  -> executor session and syscall validation
  -> document validation before commit
  -> database row/canonical artifact decoding
  -> typed response decoding and error mapping
```

Static types improve developer feedback but authorize nothing. Runtime checks
remain required because callers can use JavaScript, `any`, assertions, stale
generated files, forged HTTP payloads, corrupted storage, or independently
versioned services.

## Current Validation Layers

### 1. SDK Values And Registration

The public SDK supports validators for:

- null, finite numbers, booleans, strings, bigint, bytes, and `any`;
- table IDs;
- literals;
- arrays;
- strict objects with required/optional fields;
- records; and
- unions.

SDK validation produces path-aware `ValidationError` failures and rejects extra
object fields. ID validators can delegate table-name checks to an authoritative
resolver.

Registered functions expose Convex-shaped runtime markers plus `exportArgs()`
and `exportReturns()`. Strict validator serialization rejects `undefined`
inside validator metadata. Missing argument validation exports unvalidated
`any`; missing return validation exports `null`. TypeScript also constrains
handler arguments/returns from declared validators, but those constraints are
developer feedback only.

### 2. Analysis And Deployment Validation

`@flarex/analysis` loads runtime registration metadata and validates:

- exactly recognized function kinds and visibility;
- handler/export identity;
- argument validator JSON, including the object-or-`any` argument rule;
- return validator JSON or `null`;
- schema/table/index metadata;
- partition policies and source positions; and
- conversion agreement between deployment and codegen analysis.

The public backend validates analyzer envelopes, source-package/module
agreement, deep deployment/codegen shapes, duplicate entries, schema/function
consistency, and artifact identity before storing a candidate. Caller-authored
analyzed-start remains a credentialed compatibility path, not normal authority.

### 3. Shared Protocol Decoding

`flarex-protocol` owns JSON-safe schemas and nominal types for deployment,
execution, artifact runtime, identity/auth, sync, scheduler, registry, storage
authority, schema manifests, catalog identities, ordered indexes, and build
state.

Effect Schema decoders convert `unknown` into typed values and keep parse
failures typed until an adapter chooses HTTP or operational presentation. The
protocol layer also owns canonical encodings where byte-for-byte identity
matters: counters, snapshot tokens, schema manifests, physical index specs,
ordered keys, hashes, and branded IDs.

Protocol validation is not limited to shape. Relevant codecs enforce bounds,
ordering, canonical numeric forms, closed discriminated unions, stable identity
separation, nesting ceilings, and rejection of fields that would grant
caller-selected physical/lifecycle authority.

Not every route uses Effect Schema end to end. Some executor HTTP and legacy
backend routes still use explicit manual decoders that return typed validation
errors. Those remain legitimate boundaries but are a consistency gap.

### 4. HTTP And Service-Binding Ingress

At each request boundary Flarex distinguishes:

- malformed JSON;
- structurally invalid bodies;
- unauthorized capability/identity;
- missing configuration/preconditions;
- known domain conflicts or unsupported behavior; and
- unexpected defects.

The private executor Fetch adapter authenticates protected routes before
parsing attacker-controlled JSON. Its decoders validate deployment/project IDs,
function path, kind, visibility, identity, session IDs, idempotency keys,
syscall shapes, read sets, maintenance limits, and delivery operations before
calling executor core.

Artifact-runtime routes validate method/path, capability token, payload schema,
artifact headers, exact artifact reference, source package, and materialized
response. Public backend routes similarly decode protocol payloads before
dispatching into Durable Object or service layers.

Authorization answers “may this caller invoke the capability?” Validation then
answers “is the requested operation well formed and semantically allowed?” One
cannot substitute for the other.

### 5. Active Deployment And Function Validation

The trusted executor resolves function metadata only from the active deployment
package and rejects:

- missing deployment/package/function metadata;
- project mismatch;
- non-active packages;
- malformed analysis/schema metadata;
- unsupported action/workflow execution;
- expected/actual kind mismatch;
- public/internal visibility mismatch;
- missing or invalid partition policy;
- caller partition keys that disagree with analyzed arguments/schema; and
- invalid create-root scope requests.

It currently preserves analyzed `args` and `returns` fields as opaque metadata;
the forward executor does not yet structurally decode or execute those
validators during prepare/finish. That is a production-blocking gap, not an
implicit trust in the generated runtime.

The executor derives execution scope from stored active metadata rather than
accepting storage generation, physical placement, or raw scope authority from
the HTTP request.

The compatibility backend applies equivalent active-analysis checks before
ExecutionDO/PartitionDO sessions. That code is migration coverage, not the
accepted replacement authority.

### 6. Generated Runtime Validation

The compatibility generated project-Worker path validates function existence,
analyzed kind/visibility, arguments, return values, nested-call kind/depth,
internal-route authorization, executor start responses, and result protocols.

The shared HostKit runtime used by current local materialization and hosted
Dynamic Workers validates runtime function identity/kind/visibility,
nested-call rules, authorization, and executor responses, but it does not
execute analyzed argument or return validators. It currently expects the
executor start/finish boundary to own that authority, and the forward executor
has not yet implemented it. Therefore local generated validation is useful
feedback and compatibility evidence, not proof that the accepted hosted path is
safe.

### 7. Session, Syscall, And Commit Validation

The executor validates each session transition and syscall against the prepared
function/session:

- only active sessions may issue syscalls or finish;
- queries cannot issue mutation syscalls;
- project, deployment, package, identity, and session ownership stay joined;
- document IDs and table IDs/names agree;
- insert/patch/replace/delete targets and shapes are checked;
- index/table/document reads use recognized request forms;
- staged-write conflicts and unsupported combinations are explicit;
- abort/maintenance transitions cannot silently publish work.

Document validation is repeated in persistence commit logic. Inserts and
replacements validate the complete value; patches validate the merged final
document. Non-delete staged writes cannot bypass the active schema by reaching
the persistence layer directly.

This commit-level check is the authoritative protection for data validity. An
earlier generated/backend check is insufficient because the syscall or adapter
could be buggy or independently versioned.

### 8. Stored State And Canonical Artifact Validation

Database results are untrusted until decoded. Replacement persistence code
validates identifiers, counters, manifests, hashes, canonical bytes, catalog
relationships, row shapes, lifecycle states, and prepared-plan authority.

Stored corruption is distinct from invalid caller input or an ordinary OCC
conflict. Corruption/checksum/collision errors must fail closed and preserve
enough typed context for operators without being converted into a retryable
user failure.

Immutable schema artifacts are re-derived and compared across JSON, canonical
bytes, and digest. Prepared catalog plans are process-local capabilities and
are revalidated under the owning transaction before writes.

### 9. Output And Error Boundaries

Known domain errors map to stable HTTP categories such as:

- `400` for malformed/invalid operation requests;
- `401` for missing/mismatched capability credentials;
- `403` for authenticated authority/project mismatch;
- `404` for absent resources;
- `409` for lifecycle, active-state, OCC, or metadata conflicts;
- `501` for explicitly unsupported operations; and
- `500` for unexpected defects.

Typed Effect failures remain typed through core logic and become response
objects only at route adapters. Defects and programmer bugs should remain
distinguishable from expected domain failures; broad catch-and-relabel logic
must not turn a defect into a safe retry or client error.

Service-binding and runtime responses are decoded even when the sender is an
internal Flarex service. Deployment skew and compromised/misconfigured services
are still possible.

## Invariants And Trust Boundaries

1. **Every `unknown` boundary decodes before use.** HTTP JSON, WebSocket
   messages, service-binding responses, storage JSON, provider payloads, and
   generated-artifact responses cannot be trusted by TypeScript annotations.
2. **Static typing is never authorization.** Generated types, branded types,
   and handler inference improve correctness but do not replace runtime checks.
3. **Authentication precedes expensive parsing/allocation where possible.** An
   unauthorized private-executor request must not allocate Postgres or parse a
   large hostile body first.
4. **Active analyzed metadata owns invocation validation.** Handler-local or
   caller-submitted metadata cannot override path, kind, visibility, validators,
   schema, routing, or package identity.
5. **Arguments fail before user code.** Invalid arguments cannot start handler
   effects or database syscalls. The forward executor gap below blocks claiming
   this invariant for production.
6. **Returns fail before publication.** Invalid mutation results abort staged
   writes; invalid query results are not returned as success. The forward
   executor gap below blocks claiming this invariant for production.
7. **Final documents validate before commit.** Patch validation applies after
   merge, and every non-delete commit write is rechecked.
8. **IDs validate logical ownership.** A string shape alone is insufficient;
   table identity must match active metadata.
9. **Wire schemas carry no physical authority.** Public payloads cannot select
   storage generation/fence, raw scope placement, physical index IDs/lifecycle,
   transaction handles, or database clients.
10. **Canonical values have one encoding.** Hash/checksum inputs reject
    non-canonical alternate forms rather than normalizing after authority is
    derived.
11. **Stored rows are not self-authenticating.** Decoders detect corruption,
    impossible states, hash mismatch, stale plans, and cross-owner identity.
12. **Typed failures retain domain meaning.** Invalid input, unauthorized,
    conflict, unsupported, dependency failure, corruption, and defect are not
    interchangeable.
13. **Unexpected defects fail closed.** They must not become successful fallback
    behavior or a retryable OCC result.
14. **Local and hosted adapters conform to the same contracts.** Miniflare,
    Fetch, Nitro, Worker, PGlite, and Postgres may differ in hosting, not in
    validation semantics.
15. **Validation has resource bounds.** Recursive structures, arrays, module
    counts, schemas, index declarations, arguments, diagnostics, and request
    bodies need explicit ceilings appropriate to their boundary.

## Decisions And Rationale

### Validate At Both Execution And Commit

Execution-time checks provide clear developer errors and prevent invalid code
from running. Commit-time validation protects authoritative data from a buggy,
stale, or compromised runtime/adapter. The checks serve different threat
boundaries and both are required.

### Use Runtime Exporters For Validator Metadata

Runtime registration exporters reflect the module actually evaluated in the
analysis isolate. This follows Convex more closely than source scanning or
trusting generated metadata and catches undefined/circular validator failures
before activation.

### Keep Protocol Decoding Separate From Domain Validation

A protocol decoder establishes a closed transport shape. Domain services then
check active state, ownership, relationships, and invariants requiring current
data. Combining both into route handlers would make reuse and error
classification inconsistent.

### Treat Stored Corruption As Its Own Failure Class

Invalid input can be rejected to a caller; corrupted authoritative state is an
operator incident. Dedicated corruption/checksum errors prevent retry loops or
HTTP adapters from misrepresenting it as a normal conflict.

### Keep Redundant Validators Until One Shared Contract Is Proven

The SDK, generated shell, compatibility backend, and Postgres persistence
currently contain overlapping validator execution. Removing a copy without
moving the downstream trust check would weaken safety. Consolidation should
share semantics/codecs while preserving checks at each authority boundary.

## Convex Compatibility And Flarex Divergences

Flarex follows Convex's validation model:

- runtime function registration exports validator metadata;
- backend analysis parses and stores authoritative validators;
- `ValidatedPathAndArgs`-style checks happen before user code;
- return validation is independent and precedes commit/publication;
- document schemas apply at authoritative writes;
- objects are strict, optional fields explicit, and IDs table-aware; and
- internal/runtime transport is decoded rather than trusted.

Primary Convex reference areas:

- `npm-packages/convex/src/server/impl/registration_impl.ts` for registration
  markers, exporters, and strict serialization;
- `crates/isolate/src/environment/analyze.rs` for analysis parsing;
- `crates/udf/src/validation.rs` and isolate validate-args/returns ops;
- `crates/model/src/modules/function_validators.rs` for stored function
  validators; and
- `crates/common/src/schemas/validator.rs` for recursive value/ID semantics.

Named Flarex divergences:

- validation is implemented across TypeScript SDK, generated Worker,
  compatibility backend, executor, and persistence rather than one Rust value
  engine;
- internal protocols use Effect Schema plus some manual decoders;
- current JSON transport cannot carry runtime bigint or ArrayBuffer values even
  though the SDK validator surface includes bigint and bytes;
- legacy IDs use a numeric table prefix and compatibility paths resolve table
  mappings differently from replacement catalogs; and
- Cloudflare service bindings and Worker isolation create additional request,
  response, capability, and configuration boundaries.

## Implemented Capabilities

- Recursive path-aware SDK validation and strict registration exporters.
- Backend-controlled analyzer parsing for argument/return/schema metadata.
- Effect Schema protocol decoders and nominal/canonical codecs across major
  internal domains.
- Auth-before-body-validation on protected private executor routes.
- Typed request decoders for invoke lifecycle, syscalls, maintenance, live
  queries, delivery, deployment, registry, scheduler, sync, and artifacts.
- Active deployment package/function/schema/scope validation in the trusted
  executor.
- Shared generated-runtime checks for internal auth, function metadata, nested
  calls, and executor responses, plus argument/return checks on the compatibility
  generated project-Worker path.
- Commit-time document validation for Postgres/PGlite, including merged patch
  values and table-aware IDs.
- Compatibility backend validation for existing DO invocation/commit paths.
- Canonical schema/index/storage-authority codecs with bounds, branded types,
  digest checks, and stored corruption detection.
- Stable mapping for many known executor/domain failures and typed Effect error
  propagation to adapter edges.
- Tests covering malformed payloads, unauthorized ordering, kind/visibility,
  missing metadata, partition/scope mismatch, compatibility-path invalid
  args/returns, forward-path invalid documents, forged analysis, malformed
  responses, stored corruption, canonical encodings, and transaction
  preservation on covered validation failures.

## Known Gaps And Limitations

- Validator execution is duplicated across `flarex`, generated runtime source,
  `flarex-backend`, and `@flarex/persistence-postgres`. Parity is tested but
  semantic drift remains possible.
- The forward `@flarex/executor` path parses active function `args` and
  `returns` as opaque values and does not execute them during prepare/finish.
  The shared HostKit runtime also does not validate them. Consequently the
  accepted Postgres/Dynamic Worker path lacks authoritative function argument
  and return validation even though the legacy generated/DO path has it. This
  must be fixed before production activation.
- Bigint and bytes exist in the SDK validator model, but authoritative JSON
  transport/backend/persistence validation reports them unsupported. A
  Convex-compatible value encoding is not complete.
- Protocol style is mixed: many domains use Effect Schema, while executor HTTP
  and legacy backend paths retain manual record parsers. Error paths and
  strictness are therefore not fully uniform.
- The private executor's unknown-error fallback currently returns the raw
  `Error.message` in a 500 response. Hosted boundaries need sanitized public
  errors plus correlation IDs and boundary-safe structured logging.
- No single cross-system policy enforces request byte limits, recursive depth,
  array/object cardinality, and diagnostic limits for every HTTP/WebSocket
  route. Some high-risk codecs have strong local ceilings; coverage is uneven.
- Stored-row decoding is strong in newer FlarexDB schema/catalog modules, but
  older persistence/DO paths still contain assertions or ad hoc parsing that
  need migration or explicit compatibility quarantine.
- Active deployment validation is split between DeploymentDO compatibility
  metadata and the newer executor deployment-package/FlarexDB schema artifacts.
  Production routing does not yet prove one continuous replacement validation
  chain.
- Actions and `workflowMutation` are represented in metadata but not executable
  by the current artifact runtime; their argument/return/effect policies remain
  future work.
- Internal Dynamic Worker authorization remains optional at one inner hop, as
  recorded in roadmap 06. Shape validation cannot compensate for a missing
  capability boundary.
- Error schemas are not centrally versioned across every public/internal API,
  and some compatibility adapters preserve historical message text rather than
  one structured error code model.
- Property/fuzz testing is strong for selected codecs but not systematic for
  every decoder, validator-engine parity pair, and malformed stored row.

## Target Direction

Preserve layered validation while reducing semantic duplication:

```text
one portable Flarex value + validator codec/engine
  -> SDK registration and local feedback
  -> backend-controlled analysis
  -> versioned protocol contracts
  -> active package/schema metadata
  -> generated isolate fast checks
  -> trusted executor checks
  -> commit/persistence checks
  -> canonical stored-state verification
```

The same engine may run at several layers, but each trust boundary must still
perform its own check. Replacement routing should join active source package,
schema artifact, storage generation/fence, function metadata, identity, and
session validation before any syscall can affect authoritative Postgres state.

## Next Correctness Gates

1. **Enforce active function validators on the forward path.** Structurally
   decode analyzed `args`/`returns` when the active package is loaded, validate
   arguments before session/user-code start, validate returns before query
   response or mutation commit, and prove invalid returns abort staged writes
   in PGlite and real Postgres lanes.
2. **Define one versioned value transport.** Port Convex-compatible bigint,
   bytes, special numeric, ID, and JSON/value encoding semantics with golden
   cross-runtime tests before enabling those validator types end to end.
3. **Consolidate validator semantics without removing authority checks.** Move
   recursive validator JSON parsing/execution and ID rules into a runtime-neutral
   package usable by SDK, analyzer, generated shell, compatibility backend, and
   persistence; retain validation at every boundary.
4. **Sanitize and version error responses.** Give expected domain failures
   stable codes/details, map unexpected defects to opaque 500 responses, attach
   correlation IDs, and log typed internal context without secrets or raw user
   payloads.
5. **Complete boundary resource limits.** Inventory every HTTP, WebSocket,
   service-binding, source-package, schema, argument/result, and stored-JSON
   decoder; set byte/depth/cardinality/time limits and test limit-before-work
   behavior.
6. **Join the replacement validation chain.** Prove that active analyzer output
   exactly matches immutable FlarexDB schema/package artifacts and the selected
   storage generation/fence before executor preparation and commit.
7. **Add parity and hostile-input testing.** Differentially test all validator
   implementations until consolidation, fuzz protocol/canonical codecs and
   stored-row decoders, and prove malformed values never reach domain effects.
8. **Specify unsupported runtime kinds.** Define action and workflow-mutation
   value/effect/return validation and error behavior before enabling those
   execution paths.
