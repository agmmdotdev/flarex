# Payload Runtime Contracts And Conformance Ownership

Status: implemented private runtime cleanup; broader capabilities remain gated

## Outcome And Scope

Refactor the existing closed Payload runtime so its ordinary construction owns
runtime lifecycle and registered operations, while a named conformance factory
owns scenario hooks, fault injection, and test observations. Replace its
string-dispatched JSON interior with operation-specific decoded contracts and
direct handlers. Centralize shared query and field policy where semantics agree.

This is the first cleanup after the private package extraction. The aim is to
make the current Local API vertical understandable and extensible before adding
another capability. It does not generalize the fixed collection into arbitrary
collection support, expose user hooks, add operations, change persisted identity,
or enable public/hosted serving.

`packages/payload-adapter` owns the implementation and test-support composition.
Existing persistence scenarios and the Currency/Payload composition test are
consumers to migrate. The CMS command registry, transaction host, Application
schema/write policy, binding tokens, relation storage, and publication owners
keep their current contracts. A need to alter one of those contracts is a
separate owner decision rather than a reason to hide a workaround here.

## Evidence And Reuse Decisions

Governing sources are the accepted Payload adapter design, the
[Payload adoption roadmap](../07-payload-adoption.md), the
[exact release contract](./07-payload-release-and-adapter-contract.md), and the
[package extraction boundary](./52-payload-adapter-package-extraction.md).
Apply `.agents/skills/payload-flarex-integration/SKILL.md` from the repository root.

Pre-cleanup evidence and implemented ownership corrections:

| Previous owner | Observed issue | Implemented correction |
| --- | --- | --- |
| `packages/payload-adapter/src/runtime.ts`, `makePayloadRuntime` | Construction installs title-triggered nested/failure hooks and returns test counters and raw instance inspection together with commands/binding. | Move scenario definitions and observations to test support, sharing one internal runtime constructor. Ordinary construction does not install conformance behavior. |
| `runtime.ts`, `invoke(context, operation: string, args: Json)` | Operation-specific key lists, guards, dispatch, and result capture are interleaved; typed distinctions disappear into a string and JSON. | Decode the admitted argument shape at each command boundary and call a directly bound handler. Preserve internal argument/result types until the existing JSON host boundary. |
| `runtime.ts` query admission and `adapter.ts` `where`/`find` | Equality fields and paging rules repeat across caller and sanitized framework input. The two boundaries deliberately accept different shapes. | Share primitive policy and normalized values; keep separate caller, sanitized-filter, and authenticated-loader decoders. |
| `contract.ts`, `profile.ts`, and field guards in runtime/adapter | Collection/field knowledge appears in several representations, creating drift risk. | Reuse existing field metadata for genuinely shared capability checks; keep native Payload defaults/validation with Payload. Preserve authenticated configuration bytes. |
| `payloadScalarScenario.ts` and relation/publication/composite scenarios | Tests consume runtime observations and infer constructor internals through nested `ReturnType` expressions. | Export a deliberate conformance result type from test support and migrate these consumers with their assertions intact. |

The executing dependency is the adapter package's installed `payload@3.88.0`.
Its `dist/database/types.d.ts` supplies `BaseDatabaseAdapter`, `FindOneArgs`,
`FindArgs`, and result types; caller-selected generics still require a justified
foreign boundary assertion. Use those types instead of recreating Payload DTOs.

The same installed package provides decisive implementation evidence:

- `dist/database/combineQueries.js` wraps caller and access predicates in `and`.
  Therefore the runtime caller decoder cannot simply replace the adapter parser.
- `dist/collections/dataloader.js` sends internal `id.in` batches and
  `pagination: false` through the request. It mutates the borrowed request's
  transaction ID. Those forms require the existing authenticated loader path;
  sharing a decoder must not admit them as ordinary caller queries.
- `dist/utilities/initTransaction.js`, `commitTransaction.js`, and
  `killTransaction.js` establish pending-ID reuse, framework completion, and
  rollback behavior. Moving the harness must preserve the existing foreign
  request bridge and Flarex's outer settlement authority.

These installed files are inspection evidence, not new production deep imports.
The package manifest, lockfile, and release contract remain the pin/provenance
owners. Recheck the executing source when changing these contracts.

## Target Construction And Operation Shape

The representative conformance caller before cleanup:

```ts
const runtime = yield* makePayloadRuntime(profile)
const host = yield* runtime.bind(hostInput)
const before = runtime.executions()
yield* host.run(key, runtime.commands.create, input)
```

The migrated conformance caller:

```ts
const fixture = yield* makePayloadConformanceRuntime(profile)
const host = yield* fixture.runtime.bind(hostInput)
const before = fixture.observations.executions()
yield* host.run(key, fixture.runtime.commands.create, input)
```

An ordinary caller keeps `makePayloadRuntime(profile)`, `runtime.bind(...)`, and
the admitted commands, without fixture hooks or counters. Both constructors use
one source-private composition implementation. Only the internal testing
subpath exposes fixed scenario construction and raw-instance inspection. The
ordinary constructor must not gain a caller-provided hook/configuration option.
No second startup, request, transaction, or recovery implementation is added.

The generic CMS host intentionally accepts JSON. Keep that persistence contract
unchanged: each existing registered command decodes its input inside the current
admitted execution, invokes its typed handler, and captures its result for the
host. Do not move decoding ahead of binding/replay admission or change request
hashing. Internal handlers should retain concrete document, page, or count result
shapes, using native types and existing decoders where sound. A generic public
CMS API is outside this cleanup.

Use operation-owned schemas/decoders under the existing Effect guidance. Define
strictness, excess keys, omission, null, defaults, and first-failure ordering
explicitly. Payload continues to perform native required-field/default/hook
validation; the command decoder restricts the admitted surface. Avoid replacing
Payload validation failures with an earlier generic schema failure.

Resolve profile-specific configuration and identities through one cohesive
adapter owner. Reuse `payloadContentConfiguration`, relation field definitions,
`payloadManyIds`, `payloadJoinQuery`, and the population budget owner where their
contracts fit. No universal metadata compiler or profile registry is needed for
this slice. Keep the immutable profile token's issuer checks in persistence.

## Alternatives Challenged

- Splitting the large files without changing responsibility or typed contracts
  would preserve the same coupling behind more imports.
- Introducing a generic `CmsCommand<Input, Output>` in persistence would expand
  this cleanup into a shared command API change. Typed adapter interiors can be
  established using the existing host boundary.
- Using one permissive query schema at every boundary would admit internal
  loader forms to callers or reject legitimate sanitized Payload input.
- Generating all Payload configuration from a new schema DSL would duplicate
  framework behavior and risk changing authenticated bytes.
- Removing diagnostic hooks or counters outright would lose nested-failure,
  interruption, and no-reexecution witnesses used by connected consumers.

## Retain, Extend, Replace, Delete

| Decision | Target and completion condition |
| --- | --- |
| Retain | Native Local API lifecycle, the fixed admitted profiles/configuration digests, command names, request hashes, JSON host boundary, error families, output bounds, runtime closure, and transaction/publication authority. |
| Retain and relocate | Fixed conformance hooks, raw-instance probes, execution/touched/pending counters, and all meaningful assertions. Their ordinary-runtime ownership retires when every scenario uses the shared conformance factory. |
| Extend | Existing internal testing subpath with the conformance factory and deliberate result type; existing shared field/query policy owners only where semantics agree. |
| Replace | String/JSON dispatch interior and independently maintained shared constraints with directly bound typed operations and explicit boundary decoders. |
| Delete | Superseded inline validators, old scenario wiring, and redundant exports after callers migrate. No compatibility alias or duplicate implementation without a demonstrated external obligation. |

## Validation And Completion Gates

- Show ordinary and conformance callers before/after, including the Currency
  composite's replay/interruption observations. Demonstrate ordinary construction
  cannot install the fixed scenario behavior through document titles.
- Prove invalid internal argument combinations fail at compile time and valid
  decoded arguments/results flow without broad assertions. Keep framework
  generic exceptions confined to their actual foreign boundary.
- Exercise shared query restrictions through both caller and sanitized adapter
  inputs. Preserve rejection of caller `id.in`/unbounded reads and success of
  authenticated population batches. Check unknown keys, omission/null, defaults,
  and error ordering through real Local API calls.
- Preserve the full scalar, relation, many, join, population, preference cleanup,
  rebinding, and composite witnesses. Keep native PostgreSQL concurrency,
  uniqueness, interruption, and uncertain-COMMIT recovery distinct from PGlite.
  Use the repository's existing test-lane configuration and unchanged limits;
  coordinate heavy local lanes to avoid contention. An unavailable driver or
  intermittent failure must be reported, not counted as a pass.
- Run affected typechecks, package export checks, core/diff/staged lint, and both
  required reviewers against the final owned scope. Review evidence must address
  the concrete organization/type/reuse problems above, not only regressions.
- Preserve concurrent Medusa work. Only its Payload conformance consumer changes
  belong to this slice. Complete removal and roadmap reconciliation before the
  implementation commit. No compatibility alias or displaced runtime path is
  retained.

## Current Implementation Owners

`composition.ts` is the shared source-private construction/lifetime owner.
`runtime.ts` exposes only commands and binding; `conformance.ts`, exported by
the testing subpath, owns fixed hooks and observations. The migrated persistence
and Currency/Payload scenarios consume that deliberate conformance type.

`inputs.ts` preserves ordered per-operation admission, `operations.ts` binds
each decoded input to its native Local API call, and `results.ts` captures JSON
ownership while checking document/page/count envelopes. `query.ts` shares
equality and paging constraints without admitting sanitized `and` or internal
loader `id.in` forms at the caller boundary. Collection policy reuses existing
field metadata; Payload retains native defaults and field validation.

The string dispatcher, ordinary-runtime scenario hooks/counters, duplicate
field allowlists, and duplicate paging/equality rules have been removed. The
CMS JSON boundary, authenticated configuration identities, transaction bridge,
storage and publication owners remain unchanged. Ordinary construction and
conformance share one implementation; neither is a production-serving claim.
