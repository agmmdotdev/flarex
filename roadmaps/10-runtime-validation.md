# Runtime Validation

## Registry Effect Service Validation Boundary

Previous completed checkpoint: `9a66f62` Add registry protocol schema proof.

What changed:

- RegistryDO request decoding still happens through `flarex-protocol/registry`
  at the HTTP boundary.
- Registry creation/listing now runs through `RegistryService`, which depends
  on an Effect `RegistryStore`, `RegistryClock`, and `RegistryIds`.
- SQL failures are represented as typed `RegistrySqlError` values at the store
  boundary before the DO host maps them to a stable HTTP 500 JSON response at
  the Effect runtime boundary.
- Current time now comes from Effect `DateTime.now` through the registry clock
  service, making the service layer testable without hiding `Date.now()` in
  domain logic.

Why it changed:

The first schema proof validated transport input. This checkpoint starts moving
post-validation behavior into Effect services so runtime validation,
persistence, and typed error handling can be composed and tested without a
Cloudflare `fetch()` router owning all behavior.

Convex references inspected:

- No new Convex source files were required for this RegistryDO validation
  boundary. The semantic target remains backend-side validation before state
  mutation.

Cloudflare differences:

- The Durable Object `fetch()` method remains the public entrypoint and creates
  one Effect runtime execution boundary per route branch. Typed registry store
  failures are matched before leaving that boundary.
- Durable Object SQL storage is still synchronous Cloudflare storage, wrapped
  by `Effect.try` rather than replaced with a new database abstraction.

Known limitations:

- `ProtocolValidationError` remains thrown by sync schema helpers and caught at
  the DO HTTP boundary. A later HttpApi or effectful decoder slice can move
  protocol validation into the Effect error channel.
- Field-level parse diagnostics and shared error-to-response mapping remain
  future work.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryDO.test.ts
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Registry Protocol Schema Boundary

Previous completed checkpoint: `27afbea` Add Effect migration reviewer.

What changed:

- RegistryDO create-deployment requests now decode through
  `flarex-protocol/registry` before persistence.
- Invalid JSON still fails at the existing HTTP JSON boundary.
- Schema-invalid create-deployment bodies now fail with a typed
  `ProtocolValidationError` mapped to HTTP 400.
- Added focused Miniflare coverage for create/list deployment, invalid JSON,
  schema-invalid body, and duplicate deployment-id update behavior.

Why it changed:

This is the first small Effect Schema proof for backend runtime validation. It
keeps the existing fetch router and SQL transaction behavior intact while
proving that an internal protocol package can own runtime request contracts.

Convex references inspected:

- No new Convex source files were required for this RegistryDO boundary proof.
- The semantic target remains Convex-style backend validation before state
  mutation, but this specific slice is about Flarex transport shape rather than
  user function or document validation.

Cloudflare differences:

- The validation runs inside a Durable Object `fetch()` handler and maps typed
  protocol validation failures to ordinary JSON HTTP responses.
- HttpApi is intentionally not introduced yet; that remains a later spike once
  the schema/package boundary is proven.

Known limitations:

- The error message is intentionally coarse for this first boundary. Field-path
  parse diagnostics can be improved when shared protocol error formatting is
  introduced.
- RegistryDO still uses direct `Date.now()` and `crypto.randomUUID()` because
  this checkpoint does not yet introduce Effect services or Clock/Ids layers.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryDO.test.ts
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Goal

Flarex validators must be executable runtime contracts, not only TypeScript
types and schema metadata. Invalid function arguments must be rejected before
user code runs, and invalid documents must never enter authoritative shard
storage.

## Implemented

- Added strict recursive validator execution for:
  - IDs
  - null, finite numbers, booleans, strings, bigint, and bytes
  - literals
  - arrays
  - strict objects with required and optional fields
  - records
  - unions
  - `any`
- Added path-aware `ValidationError` messages in `flarex/values`.
- Added `validateFunctionArgs` and `validateValue` for generated runtimes.
- The authoritative `/invoke` path validates declared arguments before loading
  schema, beginning a transaction, or running user code.
- Insert and replace validate full documents.
- Patch reads and validates the resulting full document, not the partial patch.
- `PartitionDO.commit` revalidates every non-delete write against its cached
  deployed table validator. This is the authoritative protection for future
  syscall and internal commit callers.
- The generated Worker validates function arguments and returns locally before
  calling the backend, while the backend validates deployed args at
  `/executions/start`, return values at `/executions/:sessionId/finish`, and
  document writes at syscall/commit boundaries.
- Deployment function metadata is persisted in `DeploymentDO` and `/invoke`
  prefers that metadata for kind and argument validation.
- Deployment-time validator-shape checks reject malformed table, argument, and
  return validators before they are stored.
- Return validators are now enforced after handler execution and before query
  response or mutation commit.
- Mutation writes are not committed when return validation fails.
- SDK function builders now use the `returns` validator to constrain handler
  return types at compile time.
- `v.id("table")` validators now check the referenced table, not only that the
  value is a string.
- The authoritative backend validates ID table mappings in arguments,
  documents, return values, and direct partition commits.
- The generated Worker validates ID table mappings with the same canonical
  numeric ID format as the authoritative backend.

## Why This Shape

Validation at invoke time gives fast errors and ensures invalid arguments never
reach user code. Validation at commit time is still required because the shard
database is the trust boundary. A future Dynamic Worker syscall path must not
be able to bypass the deployed schema by constructing writes directly.

Patch validation applies to the merged final document. Validating only the
partial patch would incorrectly reject omitted required fields and would allow
a patch to leave an invalid final document.

## Convex References

- `crates/udf/src/validation.rs`
  - `ValidatedPathAndArgs` validates args before UDF execution.
- `crates/model/src/modules/function_validators.rs`
  - args validators must be object validators or unvalidated `any`.
  - return validation is a separate boundary.
- `crates/common/src/schemas/validator.rs`
  - recursive value checks, strict object fields, optional fields, records,
    unions, and ID table checks.
  - `Validator::Id` decodes a developer document ID and compares the resolved
    table name against the validator table.
- `crates/isolate/src/ops/validate_args.rs`
- `crates/isolate/src/ops/validate_returns.rs`

## Cloudflare Differences

- Flarex currently runs a TypeScript validator in the generated Worker and a
  small backend-local equivalent in the authoritative backend. Convex uses its
  Rust value and schema validator implementation as the central backend
  contract.
- `PartitionDO` validates against its local deployed-schema cache because it is
  the single-shard commit owner. Schema version zero remains an explicit
  low-level bootstrap/test mode without document validation.
- Flarex IDs currently use a simple numeric table prefix (`1:document-id`) and
  validate that prefix against table metadata.
- The authoritative backend resolves table IDs from `DeploymentSchema.tables`.
  The generated Worker derives a deterministic table-id map from sorted schema
  table names for local fast validation, but data writes now route through the
  authoritative syscall and OCC engine.
- TypeScript checks catch normal handler/return-validator mismatches, but they
  cannot replace runtime validation because user code can still use `any`,
  assertions, or generated/remote code paths.

## Known Limitations

- Authoritative HTTP JSON transport does not support bigint or bytes yet.
- Backend and SDK validator implementations are intentionally small duplicates
  for now and must be consolidated into a runtime-neutral shared package.
- Generated Worker writes now use the authoritative single-shard syscall/OCC
  path, but the execution session itself is not yet restart durable.
- The handler registry is still local/in-memory for tests and prototypes.
  Deployment metadata owns the contract, but the Dynamic Worker executor is not
  connected yet.

## Next Work

1. Add Convex-compatible value transport for bigint and bytes.
2. Move the validator engine into a shared runtime-neutral package used by the
   SDK, backend, generator, and future Dynamic Worker syscall host.
3. Port Convex-style runtime marker and validator-export analysis so deployed
   argument and return validators come from authoritative backend analysis.
4. Add return validation for future actions and workflow mutations once those
   execution paths exist.
5. Move the duplicated SDK/backend ID codec into the future runtime-neutral
   shared package.

## Authoritative Analysis Direction

Convex function registration exports validators through runtime functions.
During deployment analysis, the backend isolate calls those exporter functions,
parses the validator JSON, and persists it as part of `AnalyzedFunction`.
Invocation resolves the analyzed function and validates visibility, function
kind, argument shape, argument size, and return values from that authoritative
metadata.

Flarex should copy this model:

```txt
SDK registration
  -> strict validator exporters
  -> backend-controlled dynamic execution isolate analysis
  -> persisted analyzed function metadata
  -> invocation and return validation
```

The generated execution artifact may validate locally for faster failure, but
the backend must validate from active authoritative analyzed metadata before
execution and commit.

Convex references:

- `npm-packages/convex/src/server/impl/registration_impl.ts`
- `crates/isolate/src/environment/analyze.rs`
- `crates/model/src/modules/function_validators.rs`
- `crates/udf/src/validation.rs`

Detailed push and analysis design:
`roadmaps/17-deployment-analysis-and-push.md`.

## Registration Exporter Update

The public SDK now exposes Convex-style `exportArgs()` and `exportReturns()`
runtime functions on every registered Flarex function. Missing argument
validation exports `v.any()` JSON, missing return validation exports `null`,
and undefined validators fail during strict serialization.

Validation helpers now also accept a root argument validator so the existing
generated Worker and metadata generator remain compatible with the wider
registration contract. Authoritative analysis still needs to enforce Convex's
backend rule that function argument validation must resolve to an object
validator or unvalidated `any`.

## Analysis Validator Parsing Update

Added `assertValidatorJson` to the shared Flarex validation layer. Local module
analysis now parses and structurally validates `exportArgs()` and
`exportReturns()` output before returning analyzed function metadata.

Argument analysis now enforces Convex's object-validator-or-unvalidated-`any`
rule. Return analysis accepts any valid validator or `null` for an unvalidated
return. Malformed nested object, array, record, union, ID, literal, and scalar
validator shapes fail before deployment metadata can be produced.

This parser lives in the zero-runtime-dependency `flarex/validator-json`
subpath so Vite config loading and Node development analysis do not import the
broader SDK graph or Cloudflare-only backend types. The backend still has its
own equivalent parser; moving it to consume this runtime-neutral parser remains
follow-up work.

Convex references:

- `npm-packages/convex/src/server/impl/registration_impl.ts`
- `crates/isolate/src/environment/analyze.rs`
- `crates/model/src/modules/function_validators.rs`

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
```

## Active Deployment Validation Update

Previous completed checkpoint: `b08269e` Record active deployment pointer on
finish.

Backend execution-session validation now consumes active deployment analysis
instead of the mutable function metadata table. `ExecutionDO.start` loads the
active deployment, finds the requested function in
`analysis.functions.functions`, and validates arguments against that
function's analyzed validator before any syscall session can run.

Direct `executeInvoke` also prefers active analysis when one exists. It keeps a
temporary no-active fallback for low-level backend transaction tests, but if an
active deployment exists and the requested path is not in that active analysis,
the invoke fails before user handler execution.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - `ValidatedPathAndArgs` and return validators are resolved before query or
    mutation execution.
- `crates/model/src/modules/function_validators.rs`
  - function validators are stored deployment metadata, not handler-local
    choices.

Cloudflare difference: Flarex validates in TypeScript at the Durable Object
boundary for now. Convex validates in Rust against its central module and
schema models. The semantic target is the same: active analyzed metadata is
the authoritative validation contract.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Verification

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check -- custom/cloudflare-executor
```

## Internal Runtime Authorization Update

Previous completed checkpoint: `c623476` Route invoke through artifact
runtime.

Generated execution artifacts now enforce optional authorization for internal
runtime routes:

- `/__flarex_internal/invoke`
- `/__flarex_internal/metadata`

When `FLAREX_INTERNAL_TOKEN` is configured, those routes require
`Authorization: Bearer <token>`. The backend sends the matching token through
`FLAREX_ARTIFACT_RUNTIME_TOKEN` when calling `FLAREX_ARTIFACT_RUNTIME`.

This is not a user authentication feature. It is a backend/runtime capability
guard so managed execution artifact routes are not accidentally exposed as
public app APIs.

Convex reference:

- `crates/node_executor/src/executor.rs`
  - executor requests include backend callback/auth material separate from user
    function arguments.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```
