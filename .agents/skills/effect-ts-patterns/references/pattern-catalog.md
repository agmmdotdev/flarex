# Effect Pattern Catalog

Use the relevant section with [the skill](../SKILL.md); verify APIs against the
installed version. This catalog adds evaluation, codec and ownership detail.
For data boundaries use [data contracts](data-contracts.md); for failure policy
use [error handling](../../effect-ts-error-handling/SKILL.md).

## Function boundaries and composition

Pure helpers stay TypeScript. Reusable observable operations/service methods use
named Effect.fn; standalone values, Layer construction and test bodies use gen.
A measured hot path, public combinator without instrumentation, or deliberately
placed explicit spans can justify an untraced constructor.

## Choosing pipe, generators, and collection combinators

| Dependency shape | Composition |
| --- | --- |
| Short linear transform/recovery/timeout/retry/observability chain | pipe with owning operators |
| Several named dependent successes, branches or loops | Installed Effect/Result/Option gen |
| Independent members | all/traverse with explicit order, failure selection/accumulation, concurrency, cancellation and allocation |
| Completed Cause-bearing outcome | Exit map/match at its owner; not domain sequencing |

Refactor the whole flow, rather than replacing each propagation guard with a
one-step pipeline. Avoid one-combinator generators, deeply nested pipelines and
repeated one-step pipe calls.

Result/Option array/record expressions execute BEFORE all receives them; the
first failure/None result cannot undo later decoder/callback/allocator/logger/API
calls. A lazy iterable defers member creation and stops consumption on failure/
absence; use it only when that representation is clear. gen preserves direct
call-level short-circuiting. Preserve that behavior, not just the final verdict.

Effect values are lazy descriptions, but their JavaScript factory calls execute
while constructing the collection. Set/test runtime ordering, concurrency,
failure and interruption; dependent Effects belong in gen/flatMap, not all.

## Option, Result or Either, and Exit

Schema owns data validity independently of its outcome carrier.

| Outcome | Use and boundary |
| --- | --- |
| Absence without a reason | Option; convert nullable input once with the installed nullish constructor |
| Recoverable pure result deliberately retained/accumulated as data | v4 Result; v3 uses the installed Either API |
| Expected executing failure | Keep E; do not convert to result data merely to branch and rebuild Effects |
| Completed typed failure/defect/interruption | Exit/Cause at runtime, supervisor, cleanup, diagnostic or test owners |

Validation, authentication and I/O failures are not None. Catch only the tagged
missing variant when it means absence, preserving other E variants. Defects/
interruption do not become ordinary business failures.

## Matching and conditional flow

Use plain guards for simple predicates; match/fold for plain outcome branches,
Effect.match for plain handlers and matchEffect for Effect handlers. Growing
tagged/structural unions need Match or exhaustive switch/never; no default that
silently treats a new variant as the last known case. Cause-aware matching stays
with the boundary owning the full Cause.

## Errors and foreign effects

Classify expected domain, transient/terminal integration failure and defects
before choosing operators. Map foreign throws/rejections once at the narrow
adapter; tagged failures may receive one genuine new domain/host projection with
provenance preserved. Broad typed recovery must own the whole E channel.
Retry only safe transient failures with bounds and eligibility checked on EVERY
failure; transient then terminal must stop. Durable retry evidence remains
durable. See [error patterns](../../effect-ts-error-handling/references/effect-error-patterns.md).

## Services, Layers, Scope, and concurrency

- Organize by domain. Separate pure policy/models, service contracts, substantial
  live Layers and roots when responsibilities differ; a small implementation may
  keep a static Layer without one-file folder ceremony.
- Services represent shared capabilities, lifecycle owners or test substitutes,
  not every explicit port. A Context tag holds one value per Context; use a plain
  value/scoped factory for simultaneous instances.
- Keep contracts narrow and implementations contract-typed. Close implementation
  dependencies in the Layer, finish the domain graph, then compose host/app/tests.
  Success Layers supply lifecycle-free values; effectful Layers construct them.
  Verify the installed scoped Layer API.
- Business effects stay on service methods. Service-free Layers are startup gates
  or scoped background processes, not ordinary request/mutation work.
- Pair acquire/release; Scope owns resources. Structure/supervise/join/interrupt
  fibers before request/Worker/object/test owners end. Never put request/object
  state into global Layers.
- Use Effect time/Schedule for cancellable/testable in-process policy.

## Runtime and HTTP boundaries

Keep one runner per real executable/foreign callback edge; never escape R/E
with a runner inside Effect services. A resourceful long-lived host constructs
its runtime/Context once and disposes it with the host.

Ordinary outbound HTTP uses the installed client, explicit status policy,
Schema body decoding, timeout and safe bounded retry. Cloudflare service-binding/
Durable Object fetch remains a typed platform adapter. A narrow tryPromise is
valid at a real Promise edge; one wrapper over async/throw/catch orchestration
does not make the inner flow Effect-native.

## Encoded data and database codecs

- Name encoded/decoded types; decode foreign input once, keep exact domain
  values internally, encode once at the outgoing boundary. Distinct trust or
  representation changes may justify distinct decodes.
- Keep total TextEncoder.encode, known primitive formatting and defensive byte
  copying pure. Schema owns reusable transforms; Result carries deliberate pure
  parse data, Effect carries executing typed failure.
- Inspect coercion semantics. Numeric text may require finiteness, integer/safe
  range, sign, lexical form, precision and brands. Use bigint/exact decimal/
  validated text for exact database numerics; number needs exact safe-range proof.
- Hoist stable Schema/text codecs. Decode untrusted UTF-8 fatally when replacement
  characters corrupt meaning. General hex/base64 Encoding helpers must preserve
  project alphabet, padding, pad bits, case, Unicode, JSON order, size and
  byte-for-byte canonicality.
- Driver codecs normalize representation, not domain validity: decode rows AFTER
  normalization and encode validated parameters BEFORE calls. Do not scatter
  String/Number/JSON/byte conversion across queries.
- Preserve defensive Uint8Array copies against aliasing; brands are not ownership.
  Map malformed stored data once to typed corruption, never absence or unrelated
  defect normalization.

## Runtime immutability and value ownership

| Mechanism | Actual guarantee |
| --- | --- |
| readonly/ReadonlyArray/as const/satisfies | Compile-time constraints, no runtime freeze |
| Object.freeze | Shallow freeze; returns the same object |
| Object.freeze(structuredClone(value)) | Deep detachment, shallow root freeze |
| Schema/Data.Class/TaggedClass/service/Layer | Their validation/equality/dependency contract, no implied deep freeze |
| HashMap/HashSet/Chunk | Persistent updates/structural sharing, not public wire replacement |
| Ref/SynchronizedRef/SubscriptionRef | Lifecycle-owned changing state, not durable authority or distributed locks |

Establish ownership before freezing; do not freeze caller input unless its API
transfers ownership. Avoid universal deepFreeze(unknown); domain-specific
recursive freezing needs supported shapes and owned values. Keep fresh owned
construction pure, not sync/try ceremony. Preserve defensive bytes and frozen
opaque handles whose identity/private WeakMap establishes authenticity;
structural Schema cannot recreate that guarantee.

## Schema, Config, and tests

[data-contracts.md](data-contracts.md) owns schema/decoder selection, capture
exceptions, replacement semantics and corruption mapping. Hoist static compilers
and compile metadata at stable factories; runtime types, encoded forms,
persistence shapes and tests must agree. Preserve authoritative protocol
validators; contextual authority checks follow decoding.

Use typed Config/injectable providers after package adoption. Prefer Effect-aware
tests, test Layers, deterministic clocks and structured concurrency; test changed
failure/interruption/release/retry/Layer behavior. Keep unavoidable Promise test
bridges in one adapter.
