# Bun AOT CPU experiments

This is an investigation harness. It changes no runtime owner or validation
contract and is separate from complete request performance acceptance.
Read the [measured findings](./RESULTS.md) and
[retained observations](./observations.windows-x64.json) for the local cohort.

Run from the repository root with installed workspace dependencies and a Bun
version supporting machine-code AOT:

```powershell
node packages/medusa-adapter/benchmarks/bun-aot/run.mjs --bun C:/Users/User/.bun/bin/bun.exe --out work/validation/bun-aot-cpu --rounds 7 --iterations 100000 --mechanism-iterations 20000000
```

Use the installed Bun path on other machines, or omit `--bun` when it is on
`PATH`. Output defaults to a new directory under `work/validation`. No database,
network service, new worktree, or runtime dependency installation is needed.
An explicit output directory must be empty; a nonempty directory is refused
before any evidence is overwritten.
The command builds executables for its current platform, then runs children
sequentially. Do not overlap performance runs with builds or test suites.

## Matched controls

The decoder worker imports the existing six schema suites from
`../schema-aot/cases.ts`. The generated mode uses the actual checked-in owner
installers. The interpreter build replaces those installers with no-ops before
bundling. It never rewrites the source installation. Owner-excluded raw object
schemas stay interpreted in generated mode, including the iterator-budget root.
This differs from the earlier experiment that compiles every listed suite root.

For each mode, one frozen JavaScript bundle runs under Node JIT, Bun JIT,
a Bun bytecode executable, and a Bun machine-code AOT executable. Generated mode
also builds directly from the original TypeScript, preserving the compiler's
access to types. Its additional static-code control passes
`--disallow-code-generation-from-strings=strict`. That flag applies only to the
decoder workload, which needs no runtime-generated code. Original TypeScript
builds and frozen JavaScript builds are distinct build-input controls.

Every decoder child checks valid/invalid inputs, strict/default excess-key
policy, decoded values including defaults, and first/all ordered errors before
timing. Observations preserve BigInt, undefined and non-finite numbers.
Cross-process parity and workload/checksum agreement are required. Timed errors
use the existing decoder's default first-error policy. Each row warms for 5,000
decodes, valid rows use `--iterations`, and invalid rows are capped at 10,000.
Each row rotates its existing small input corpus.

The separate mechanism worker compares controlled JSON objects, newly owned
plain objects, newly owned class instances, projection plus one traversal, and
static versus runtime-generated arithmetic. The generated function's body
contains a process-specific comment: Bun can compile a constant `new Function`
string, which would otherwise invalidate this control. Checksum equality is
mandatory. These kernels are diagnostic examples, not replacement validators,
business implementations, or a reason to introduce classes across the core.
Projection consumes trusted fixture values; application projection must follow
the existing authoritative capture/decoder boundary.

## Evidence and limits

The runner rotates process order across rounds and reverses alternate rounds.
It retains every successful measurement, raw child output, build command,
artifact hash, version, source revision/dirty state and compiler explanation.
A child failure fails the command and retains its logs; it is never converted
into a timing result. No CPU profiler runs during the quiet measurements.

`results.json` contains medians and per-row wall-time ranges; `runs.json` retains
individual rounds. CPU is process user plus system CPU inside the measured
loops, including child-runtime background work. Windows CPU accounting is coarse:
short rows can report zero CPU, so inspect wall time and repeated longer loops
as well. The median of per-process totals differs from summing per-row medians.
The total gives equal configured workloads to schemas, not production traffic
weights. Process elapsed time also includes initialization, parity checks,
warmup and shutdown, so it is not a cold-start measurement.

Setup allocation is excluded from the JSON/owned-property rows. The separately
named projection row includes allocation and one traversal, so an apparent
property-access win cannot hide its conversion cost. No result establishes that
copying a real request is profitable. Static compiler counts describe the whole
reachable graph, including initialization; they are not exclusive CPU samples.

There is no PostgreSQL request, PGlite transaction, server CPU, network, host,
scale or deployment claim. Complete-request comparisons still require the same
frozen graph, ordinary-role PostgreSQL, committed-result verification, separate
quiet/CPU runs and an interpreter control in each runtime. Existing generated
Application fixtures may evaluate code at runtime, which must be accounted for
before calling the whole request ahead-of-time compiled.

## What can make AOT faster

Bun's [compiler documentation](https://bun.com/docs/compiler) distinguishes
`bun build --compile` (bundled JavaScript with a JIT), `--bytecode` (precompiled
bytecode), and `bun compile` / `bun build --compile --aot` (machine code without
a JIT). [Bytecode caching](https://bun.com/docs/compiler/bytecode) primarily
removes parsing/bytecode compilation work at startup. It does not turn every
operation into a typed native operation.

The [AOT compiler](https://bun.com/docs/compiler/aot) can replace a property
lookup with a fixed-offset load and an indirect call with a direct/inlined call
when it can prove shapes and callees. A JIT can learn those from execution;
AOT has to establish them statically. Dynamic library code can therefore run
slower under AOT. Compiling an executable alone promises no warm CPU speedup.

Use [types and owned layouts](https://bun.com/docs/compiler/types) at genuine
trusted boundaries, retain types by building from TypeScript, and keep a known
fixed set of fields separate from genuinely dynamic keys. A type assertion does
not validate or reconstruct a parsed object. Measure the whole conversion plus
its consumers before adopting a representation change.

Use [`--explain=json`, guards and allocation reports](https://bun.com/docs/compiler/explain)
to locate lost static information, then intersect those locations with actual
hot CPU profiles. Do not chase the overall typed percentage or rewrite a
security-sensitive descriptor/WeakMap operation solely because it appears in
the report. Keep freshness, issuer identity and no-getter capture guarantees.

Keep hot generated decoders/serializers as static modules where their existing
semantics allow it. [Runtime-generated code](https://bun.com/docs/compiler/compatibility#code-from-strings)
that Bun cannot resolve at build time runs interpreted in AOT. Leave inspector,
huge-heap, disk-code-loading and other costly build options out unless the
application requires them. Do not remove a required protection for a benchmark.

Finally, count the work itself: fewer redundant captures, object allocations,
generic dispatches and repeated schema traversals can help all runtimes when
removed at their actual owners. AOT cannot remove database waits or required
transaction/OCC/publication work. A twofold speedup of a component consuming
10% of request CPU yields only about 5% less total request CPU.
