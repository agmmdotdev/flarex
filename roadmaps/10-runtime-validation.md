# Runtime Validation

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
