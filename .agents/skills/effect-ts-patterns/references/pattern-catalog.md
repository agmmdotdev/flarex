# Effect Pattern Catalog

Read the relevant section before implementing or reviewing the corresponding
construct. Confirm exact names against the installed Effect version.

## Contents

- Function boundaries and composition
- Choosing pipe, generators, and collection combinators
- Option, Result or Either, and Exit
- Matching and conditional flow
- Errors and foreign effects
- Services, Layers, Scope, and concurrency
- Runtime and HTTP boundaries
- Encoded data and database codecs
- Runtime immutability and value ownership
- Schema, Config, and tests
- Active review checklist

## Function boundaries and composition

- Keep pure helpers as ordinary TypeScript.
- Use `Effect.fn("Domain.operation")` for reusable observable operations and
  service method implementations when the installed version provides it.
- Use `Effect.gen` for standalone values, Layer construction, test bodies, and
  imperative composition inside an existing operation boundary.
- Use `pipe` for a short linear series of transformations, recovery, timeout,
  retry, or observability operators.
- Prefer a generator when several dependent values, loops, or branches are
  easier to read imperatively.
- Avoid one-combinator generators, deeply nested pipelines, and repeated
  one-step `.pipe(...)` calls that obscure success or failure flow.
- Use untraced function constructors only for a measured hot path, a public
  combinator where instrumentation is not part of the contract, or a boundary
  with deliberately placed explicit spans.

## Choosing pipe, generators, and collection combinators

Choose by data dependency and evaluation behavior:

- For `Option` and `Result`, use `pipe` with `map` / `flatMap` for a short linear
  transformation when each combinator consumes the preceding value and later
  intermediate successes are not all needed. Use the installed `gen` for
  several unwrapped success values, dependent branches, loops, or when later
  calls must not occur after an earlier `None` or failure.
- For `Effect`, both a pipeline and `Effect.gen` describe lazy work. Prefer a
  short pipeline for linear operator chains and `Effect.gen` when several
  yielded values, branches, loops, or dependent effects are clearer
  imperatively. Do not manually inspect an outcome only to rebuild the same
  absence or failure.
- Refactor the entire composition shape instead of converting every
  `isFailure`, `isNone`, or equivalent propagation guard into a separate
  one-step pipeline. Prefer a short `map` / `flatMap` pipeline for one linear
  transformation or dependent step, and `gen` when several named or dependent
  successes must be unwrapped in order.
- Use `all` or a collection traversal only for independent members. Confirm
  ordering, failure selection or accumulation, concurrency, cancellation,
  and allocation before replacing sequential code.
- `Option` and `Result` are eager data. JavaScript evaluates expressions used
  to build an array or record before `Option.all` or `Result.all` receives it;
  the combinator may return the first `None` or failure but cannot prevent
  those earlier member expressions from running. A lazy iterable can defer
  member creation because these combinators consume it incrementally and stop
  at the first `None` or failure. Use `Option.gen` or `Result.gen` when direct
  call-level short-circuiting is observable or contractual, and use a lazy
  iterable only when that representation is independently clear and intended.
- `Effect` values are lazy descriptions. `Effect.all` does not make argument
  Effects run while constructing the collection, but ordinary JavaScript
  expressions or factory calls used to build that collection still execute.
  Execution order, concurrency, failure, and interruption belong to the runtime
  contract; set and test them deliberately. Keep dependent effects in
  `Effect.gen` or a focused `flatMap` pipeline.
- `Exit` is a completed outcome containing the full `Cause`, including defects
  and interruption. It does not inherit the `gen` / `all` sequencing advice for
  `Option`, `Result`, and `Effect`. Map its success or match its `Cause` only at
  a boundary that owns those semantics; do not use it as a substitute for
  normal Effect composition.

Preserve short-circuiting itself, not just the final success and failure values.
A refactor that invokes a later validator, callback, allocator, logger, or
foreign API after an earlier failure is a behavior change even when the final
failure appears identical.

## Option, Result or Either, and Exit

### Option

Use `Option<A>` for composable absence without an error reason. Convert nullable
input at the boundary with the installed nullish constructor. Fold once with
`Option.match` when both cases are required.

Do not collapse authentication, validation, I/O, or multiple domain failures
to `None`. If only one tagged error means absence, catch only that error and
preserve the rest of `E`.

### Result or Either

Effect v4 uses `Result`; Effect v3 commonly uses `Either`. Use the module
exported by the installed version. This representation is appropriate when a
recoverable success/failure is intentionally a pure data value, such as a batch
item result or an internal parsing result that must be accumulated.

Do not convert an Effect to Result or Either merely to branch and immediately
rebuild Effects. Keep the failure in `E` and use tag-specific recovery or
`Effect.matchEffect` unless data is the actual contract.

### Exit

Use `Exit` when a runtime owner, supervisor, cleanup path, diagnostic adapter,
or test must retain typed failures, defects, and interruption. Fold it with
`Exit.match` or inspect its `Cause` at that boundary.

Do not normalize defects or interruption into ordinary business failures.

## Matching and conditional flow

- Use an ordinary `if`, ternary, or guard clause for one simple pure predicate.
- Use `Option.match`, `Result.match` or `Either.match`, and `Exit.match` to fold
  those outcome types when both cases matter.
- Use the installed `Match` API or an exhaustive `switch` plus `never` check
  for tagged or structural unions where a new variant must become a compile
  error.
- Use `Effect.match` when both handlers return plain values and
  `Effect.matchEffect` when handlers return Effects.
- Use Cause-aware matching only at boundaries that deliberately own the full
  failure cause.
- Do not hide future variants behind a default branch that silently treats them
  as the last known case.

## Errors and foreign effects

- Classify failures as expected domain failure, transient integration failure,
  terminal integration failure, or defect before selecting operators.
- Map throwing and rejecting foreign APIs once with the installed Effect
  constructor at the narrowest foreign boundary.
- Emit tagged errors at their source and propagate them without repeated
  downstream wrapping.
- Recover by tag in domain flow. Use a broad typed catch only at a boundary
  intentionally converting the whole failure channel.
- Retry only transient failures and only when repeating the operation is safe;
  bound the schedule.
- Observe defects and full Causes at runtime or integration boundaries rather
  than treating them as normal domain control flow.

## Services, Layers, Scope, and concurrency

- Organize substantial Effect code by domain first. Keep pure models and
  policies, service contracts, substantial live Layers, and composition roots
  separate when they change for different reasons.
- Use a service for a shared capability, lifecycle owner, or test substitute,
  not for every small explicit port.
- Keep a plain value or scoped factory when several instances of one kind must
  coexist; a Context tag represents one capability value in a given Context.
- Keep service contracts narrow and implementations contract-typed.
- Separate a substantial adapter Layer from its service contract. A small
  single implementation may keep a static Layer on the service rather than
  creating one-file folder ceremony.
- Close implementation dependencies in the Layer and provide the finished
  domain graph before composing application, host, or test boundaries.
- Use a success Layer for an already-created lifecycle-free value and an
  effectful Layer for construction. Confirm the installed version's scoped
  Layer API rather than copying another major version.
- Keep business effects on service methods. Use side-effect-only Layers for
  explicit startup gates or scoped background processes that provide no
  service, not ordinary request or mutation work.
- Pair acquisition with release and keep resource ownership in Scope.
- Keep fibers structured, scoped, supervised, joined, or explicitly
  interrupted. Do not let work escape request, Worker, object, or test
  lifetimes accidentally.
- Do not capture request- or object-scoped state in a global Layer.
- Use Effect time and scheduling services when cancellation or deterministic
  tests matter.

## Runtime and HTTP boundaries

- Keep one explicit Effect runner at each real executable or foreign callback
  boundary.
- For a long-lived host, build a lifecycle-owned runtime or Context once when
  it owns resourceful Layers; dispose it at the host lifecycle boundary.
- Never call a runner inside Effect-native domain or service code to escape the
  requirement or failure channel.
- For ordinary outbound HTTP in Effect-native services, prefer the installed
  Effect HTTP client service, explicit status policy, Schema body decoding,
  timeout, and safe bounded retries.
- Keep Cloudflare service-binding or Durable Object fetch capabilities behind a
  narrow typed platform adapter rather than mechanically treating them as
  ordinary Internet HTTP.
- A narrow `Effect.tryPromise` remains correct at a real Promise boundary; one
  giant wrapper around nested async/throw/catch logic is only an Effect veneer.

## Encoded data and database codecs

- Identify the encoded and decoded types before choosing syntax. Decode
  unknown or foreign representations once, keep precise domain values
  internally, and encode once at the outgoing boundary.
- Keep total pure conversions as ordinary TypeScript. Do not wrap a safe
  `TextEncoder.encode`, known primitive formatting, or defensive byte copy in
  Effect merely for style.
- Use Schema when encoded and decoded forms are a reusable contract. Use
  `Result` for a pure recoverable parse deliberately retained as data, and
  keep failure in Effect when the boundary owns typed recovery or reporting.
- Do not assume a named coercion is strict. Inspect the installed transform;
  refine numeric text for finiteness, integer and safe range, sign, lexical
  form, precision, and domain brands as required.
- Prefer `bigint`, an exact decimal type, or validated text for database exact
  numerics. Convert to `number` only after an explicit exact safe-range proof.
- Hoist stable Schema decoders and encoders plus reusable text codecs. Decode
  untrusted UTF-8 fatally when replacement characters would corrupt meaning.
- Use installed Effect Encoding helpers for general hex/base64 parsing and
  encoding. Preserve project-owned canonical rules for alphabet, padding, pad
  bits, case, Unicode, JSON order, size, or byte-for-byte equivalence.
- Treat driver codecs as representation normalization, not domain validation.
  Decode rows after driver normalization and encode validated values before
  parameters; do not scatter `String`, `Number`, JSON parsing, or byte codecs
  across queries.
- Preserve defensive `Uint8Array` copies when they establish ownership or
  prevent mutable aliasing; Schema branding does not provide immutability.
- Map malformed stored data once to the owning typed corruption error. Do not
  erase corruption as absence or normalize unrelated defects into a parse
  failure.

## Runtime immutability and value ownership

- Name the required guarantee before choosing a tool. TypeScript `readonly`,
  `ReadonlyArray`, `as const`, and `satisfies` constrain code at compile time;
  they do not prevent runtime mutation.
- Use `Object.freeze` only for a real shallow runtime contract. Construct or
  copy an owned record first; do not freeze caller-owned input in place unless
  the API explicitly transfers ownership.
- Remember that `Object.freeze` is shallow and returns the same object.
  `Object.freeze(structuredClone(value))` gives deep detachment with only a
  shallow root freeze.
- Avoid universal `deepFreeze(unknown)` helpers. If a canonical plain-data
  domain requires recursive freezing, document the supported shapes, establish
  ownership first, and keep the helper domain-specific.
- Do not assume Schema decoding, `Data.Class`, `Data.TaggedClass`, a service,
  or a Layer produces a deeply frozen value. Validation, structural equality,
  dependency ownership, and runtime immutability are separate decisions.
- Use Effect persistent collections such as `HashMap`, `HashSet`, or `Chunk`
  when repeated functional updates or structural sharing provide a concrete
  internal benefit. Do not leak them through public array, map, or wire
  contracts merely for style.
- Use `Ref`, `SynchronizedRef`, or `SubscriptionRef` for lifecycle-owned state
  that intentionally changes. They do not replace durable database authority,
  transaction evidence, or distributed coordination.
- Preserve frozen opaque handles when object identity plus private `WeakMap`
  state establishes process-local capability authenticity. Structural Schema
  decoding cannot recreate that guarantee.
- Preserve defensive byte copies at mutable-buffer boundaries. Neither
  readonly types nor Schema brands establish `Uint8Array` ownership.
- Keep pure owned-value construction pure. Do not wrap a safe fresh-object
  freeze in `Effect.sync` or `Effect.try` only to increase Effect usage.

## Schema, Config, and tests

- Hoist stable Schema decoders and encoders out of per-request paths and loops.
  Compile dynamic schemas once at the narrowest stable factory boundary.
- Prefer Effect-returning Schema operations inside Effect code so decoding
  failures remain typed.
- Keep runtime schemas, decoded and encoded types, persistence shapes, and tests
  in agreement.
- Preserve project-owned validators and protocol semantics; do not replace
  their public contract merely for library uniformity.
- Prefer typed Config and injectable providers after a package adopts them.
- Use an Effect-aware test runner, test Layers, deterministic clocks, and
  structured concurrency helpers when available.
- Test typed failure, interruption, release, retry, and Layer wiring when those
  behaviors are part of the change.
- Keep any unavoidable Promise test bridge in one explicit adapter rather than
  creating manual runtimes in every test.

## Active review checklist

Inspect the changed code plus its smallest connected flow and ask:

- Is a reusable Effect operation hidden in a plain wrapper returning
  `Effect.gen`?
- Would Option clarify intentional absence without erasing a needed reason?
- Is a Result or Either genuinely data, or is it duplicating `E`?
- Is Exit restricted to a boundary that needs the complete Cause?
- Can a tagged or outcome branch be folded exhaustively?
- Is `pipe` or `Effect.gen` chosen for clarity rather than local habit?
- Are `A`, `E`, and `R` still exact?
- Is a throw, rejected Promise, raw response, or unknown input mapped and
  decoded once at its owner?
- Are encoded and decoded representations explicit, precision-preserving, and
  converted once at their boundary?
- Does a general driver or encoding codec preserve every required canonical
  and domain invariant, or is an additional project decoder required?
- Is runtime immutability actually required, and is ownership established
  before freezing rather than mutating caller-owned input?
- Are readonly types, persistent collections, and the `Ref` family used for
  their distinct compile-time, functional-update, and managed-state semantics?
- Are domain logic, service contracts, adapter Layers, and composition roots
  separated according to responsibility rather than ceremony?
- Does Layer construction only own dependencies, resources, startup gates, or
  scoped processes instead of eagerly executing business operations?
- Does each Context service have the right cardinality and lifetime for its
  application, Worker, object, request, transaction, or operation owner?
- Are Layer, Scope, fiber, runtime, and test lifecycles explicit?
- Is a directly touched violation small and safe enough to correct now?
