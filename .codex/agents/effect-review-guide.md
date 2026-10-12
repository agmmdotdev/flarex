# Flarex Effect Overlay

Read with `.agents/skills/effect-ts-patterns/SKILL.md` for implementation,
refactoring and TypeScript review, including plain code whose semantics need
Effect constructs. The skill owns reusable selection/composition; this overlay
owns Flarex-specific API facts and boundary exceptions. Reviewer prompts own
investigation/reporting. Apply standards while implementing, not only at review.

## Version And Evidence

The workspace catalog pins Effect `4.0.0-rc.112`; verify the lockfile and exports
on upgrades. Accepted design/contracts and installed APIs take precedence over
historical examples. Current Effect source is library authority; optional
`opensrc/repos/github.com/effect-TS/effect-smol` predates the RC.
T3 Code at `opensrc/repos/github.com/pingdotgg/t3code` is application evidence,
not uniform authority; its wrapper-debt checklist records unfinished work.
Missing optional caches are not code findings.

RC.112 specifics:

- Use Result/Effect.result, not v3 Either/Effect.either. Option.gen, Result.gen
  and Effect.gen exist; Exit has map/match but no gen/all/flatMap.
- Broad recovery uses Effect.catch/catchCause/catchDefect, not v3 catchAll names;
  catchTag/catchTags remain. Effect.option discards every typed error reason;
  use catchNoSuchElement when only missing-value failure means absence.
- Named Effect.fn creates an operation span; unnamed fn adds a reusable stack
  boundary without that span. fnUntraced drops both and needs a concrete reason.
  Pass definition-time transforms to the fn builder, not pipe on a function.
- Layer.effect/effectContext construct in Layer Scope; Layer.scoped is absent.
  Layer.effectDiscard is startup without a service, not ordinary business work.
- Encoding hex/base64 decoders return Result; enter Effect with fromResult.
  Schema provides FiniteFromString, BigIntFromString and Uint8ArrayFrom*.
  NumberFromString uses JS coercion, not strict lexical/integer/safe-range proof.
  Option.fromNullishOr preserves all non-nullish values.
- Schema error constructors are TaggedError/Error; ErrorInstance describes JS
  Error. SchemaIssue.InvalidValue takes annotations/input/parse options: pass
  getter options through, retaining input only when reportInput is enabled.
- HTTP APIs are unstable exports under effect/unstable/http; FetchHttpClient.layer
  supplies ordinary fetch. Recheck these on every upgrade. Prefer request
  schemaBodyJson and response schemaBodyJson/schemaJson with filterStatusOk or
  matchStatus; impose byte limits separately from Schema decoding.
- Custom Clock implementations need monotonicTimeNanosUnsafe/monotonicTimeNanos
  alongside wall-clock methods. Tracing's monotonic reads must not consume
  scripted wall-clock test ticks.

## Flarex Boundaries

- Preserve exact A/E/R and protocol-owned public, persisted, Convex-facing null,
  omitted fields and { ok } unions. Convert deliberately once at the boundary.
  ValidatorJson and canonical codecs remain authoritative where their semantics
  differ from Schema; throwing parser wrappers must share the typed decoder.
- For changed data boundaries name a Schema/authoritative decoder or concrete
  custom-capture reason. Schema proves structure/intrinsic values, not
  authorization, crypto, freshness, database authority, runtime pins or
  WeakMap-backed issuer identity. Preserve no-getter capture and defects.
- Inspect Result.isFailure followed by success projection (or the inverse) as
  manual propagation; use map/flatMap/mapError/gen when sequencing, preserving
  evaluation/first-failure order. Simple guards stay plain; growing tagged
  unions require exhaustive Match/switch-never.
- Driver/encoding codecs normalize representation, not domain validity.
  Preserve exact numeric ranges/precision, canonical formats, defensive bytes
  and domain corruption errors.
- Readonly, Data.Class/TaggedClass and Schema decoding do not deep-freeze values.
  Copy caller-owned inputs before freezing; preserve canonical ownership and
  opaque capability identity. Ref and persistent collections solve different
  state/update needs, not authority.
- Service contracts, substantial live adapters and composition roots have
  distinct responsibilities. Keep request/Worker/DO state out of global Layers;
  Context tags do not model multiple dynamic instances. Business work stays on
  service methods; scoped startup fibers must end with their owner.
- Long-lived hosts own resourceful runtimes/Contexts for their lifecycle, not
  per-request reconstruction. Keep one runner at each actual host/foreign edge.
- Use Effect time in domain/service code and deterministic conversion in pure
  helpers; preserve database transaction time. Date.now inside Effect.sync still
  bypasses TestClock.
- Ordinary outbound HTTP uses injected Effect transport/status/decoding/timeout/
  safe retry. Service-binding and Durable Object Fetcher.fetch remain typed
  platform adapters.
- Drizzle 0.45 still needs a narrow Promise adapter. Report repeated query-level
  wrapping, but do not require automatic migration or the v3 @effect/sql-drizzle
  package. Drizzle v1 RC/@effect/sql-pg is a separately scoped migration candidate.
- Prefer @effect/vitest, test Layers, TestClock and typed failure/lifecycle tests
  where available; otherwise retain one explicit Promise test bridge.

Correct connected touched-flow violations within authorized scope when decisive
validation exists. Neighboring inconsistency is evidence, not an exception.
TypeScript review must assess every materially changed operation for missing
Schema/Effect/Result/Option/service/Layer usage even with no Effect imports;
report concrete semantic gaps and justified plain/framework boundary exceptions.
The systems reviewer independently reports behavioral consequences without
duplicating Effect API/style review.

## Focused References

Load only the needed guide under `roadmaps/effect-native-guidance/`:

- `09-drizzle-effect-postgres.md`: drivers and migration proof.
- `10-time-clock-and-datetime.md`: acquisition, conversion and clock authority.
- `11-data-validation-and-trust-boundaries.md`: validation and capability capture.
- `12-encoded-data-and-database-codecs.md`: representations and precision.
- `13-runtime-immutability-and-value-ownership.md`: ownership, freezing and state.
- `14-domain-services-layers-and-composition.md`: services and composition roots.

The skill's data-contract/catalog/example references contain reusable detail.
For local witnesses inspect `packages/flarex-protocol/src/validator-engine.ts`,
`live-query.ts`, and `apps/runtime-topology-probe/src/effectBoundary.ts`.
