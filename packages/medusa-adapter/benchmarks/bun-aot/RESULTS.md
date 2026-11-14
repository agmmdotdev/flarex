# Bun AOT CPU findings

Bun machine-code AOT helps when the compiler can specialize the work. It does
not automatically eliminate schema interpretation, generic Effect dispatch,
allocation, diagnostic construction, runtime code generation, or database work.
On the actual six-schema corpus here, AOT alone was approximately level with
Node; AOT combined with the installed generated decoders used about 25% less
CPU than Node with those same decoders. This is a decoder result, not an
end-to-end Flarex speedup.

## Measured decoder work

Windows x64, AMD Ryzen 5 2600, Node 26.13.0, Bun 1.4.5, patched Effect 4.1.4.
Seven fresh-process rounds per configuration, sequential rotated/reversed order.
Each configuration decodes the same six schemas with default/strict policies,
100,000 valid decodes per row and 10,000 invalid decodes per row. Each row has
5,000 warmups. Values, first/all ordered diagnostics, defaults and excess-key
outcomes matched across all 105 workers, including the separate mechanisms.

These are medians of each process's sum of measured-loop CPU, in milliseconds;
the arbitrary corpus weighting is not production traffic weighting.

| Runtime / build input | Interpreter control | Installed generated decoders |
| --- | ---: | ---: |
| Node JIT, frozen JS | 3,956 | 3,249 |
| Bun JIT, frozen JS | 5,216 | 4,236 |
| Bun bytecode executable, frozen JS | 4,937 | 4,435 |
| Bun machine-code AOT, frozen JS | 4,078 | 2,422 |
| Bun machine-code AOT, original TS | — | 2,517 |
| Original TS AOT, code generation disabled | — | 3,139 |

The useful comparison against the current Node decoder configuration is
3,249 to 2,422 ms: **25.5% less CPU**, about 1.34 times as much decoder work per
unit of process CPU in this fixed workload. Within Bun AOT, installed generation reduces 4,078 to
2,422 ms, or **40.6% less CPU**. Node also benefits from installed generation
(3,956 to 3,249 ms, **17.9% less CPU**).

Preserving original TypeScript did not improve this aggregate over the frozen-JS
AOT build. The code-generation-disabled flag increased CPU relative to ordinary
TS AOT by about 25%. Its static property/call counts were almost identical. This
experiment does not establish the cause; there is no evidence for adopting the
flag as a CPU optimization here. Bytecode caching likewise produced no warmed
CPU advantage over the other Bun JIT configurations.

The iterator-budget object root deliberately remains interpreted in generated
mode. Only its already-safe scalar targets are installed, following the
existing no-getter/replay contract. Invalid fast paths can still run the
interpreter to obtain full diagnostics. These outcomes must not be removed to
improve a benchmark.

## Where specialization pays, and where it loses

The controlled mechanism kernels each perform 20 million operations. This
table uses **median loop wall time**, not coarse Windows per-row CPU counters.
The JSON and prebuilt-object rows exclude their initial construction; the
projection row explicitly includes repeated allocation and one traversal.

| Kernel | Node JIT | Bun AOT from frozen JS | Bun AOT from original TS |
| --- | ---: | ---: | ---: |
| Repeated JSON-object field reads | 102.7 ms | 94.5 ms | 37.5 ms |
| Repeated owned class field reads | 104.5 ms | 44.4 ms | 22.8 ms |
| Repeated owned plain-object field reads | 102.2 ms | 51.2 ms | 34.7 ms |
| Projection plus one traversal | 371.9 ms | 334.5 ms | 262.5 ms |
| Static arithmetic function | 107.3 ms | 23.5 ms | 23.3 ms |
| Runtime-generated arithmetic function | 108.0 ms | 592.2 ms | 515.2 ms |

The original-TS AOT class/property and static-call examples are about **4.6
times faster than Node** in these tiny kernels. The runtime-generated function
is about **4.8 times slower**. A constant `new Function` string can be compiled
by Bun, so this control adds a process-specific comment to prevent build-time
resolution. Static and generated calls return identical checksums.

One traversal after reconstruction costs substantially more than reading the
existing JSON objects in all three shown configurations. Copying a value just
to make one consumer faster can lose overall. These results support testing a
stable owned representation at a real long-lived hot boundary, with construction
cost included. They do not support a blanket conversion to classes.

There are real tails: Bun JIT's projection row ranges from 273 to 4,561 ms and
TS AOT's from 215 to 1,065 ms. They are retained in the raw rounds; no outliers
were removed. Medians alone do not establish latency acceptance or a stable
production multiplier.

## What the source and profiles explain

The original-TS decoder compiler report counts 7,194 by-name, 1,733 checked and
2,592 free property accesses in the application-side reachable graph. Its
dependency counts are 9,222 by-name, 3,888 checked and 3,993 free accesses.
Application call sites include 2,455 unknown and 2,565 proven callees. These are
static whole-graph counts, including initialization, not hot CPU proportions.

Reported obstacles include descriptor-based capture, `WeakMap` lookups, dynamic
record shapes and external callbacks. Some are deliberate trust/identity
mechanisms. Replacing them on the strength of this report would be unjustified.
Intersect the report with current-request CPU profiles before selecting a
runtime-owner change.

Separate whole-process Node and original-TS AOT CPU diagnostics both retain
SchemaAST property traversal, issue collection and Effect iterator/exit work.
Node's profile also shows strict `hasExcessProperties` checks and GC. The actual
Effect helper constructs its covered-key Set on each call; that is a concrete
library-owner investigation candidate, not proof of a safe cache or removable
CPU budget. AOT cannot eliminate required algorithms merely by compiling them.
The Node profile has 1,557 samples and the AOT profile only 266; sampling periods
differ. These profiles include initialization, parity and warmup and cannot be
subtracted or treated as exclusive request CPU.

The current mixed fixtures also use `new Function` in
`coreMixedProductFixture.ts` and `mixedMutationInProcessRuntime.ts`. Bun can
precompile some resolvable constant strings, but the host executable alone does
not prove which fixture handlers were precompiled. Inspect the artifact and
profile before interpreting a whole-request Node/AOT comparison.

## Recommended next work

1. Keep the current generated schema modules and build real AOT artifacts with
   `--aot`. Plain `--compile` and `--bytecode` are separate controls.
2. Build from original TypeScript where possible. It materially helps the small
   layout/call kernels; keep the existing frozen-JS build as an independent
   control because it won the decoder aggregate here.
3. Make hot executable code available at build time. Account for generated
   Application functions and avoid runtime compilation of hot validators or
   serializers where an existing static generator preserves their semantics.
4. Find an actual hot owner where a captured/decoded value is repeatedly
   reinterpreted. Experiment with stable fields, known call targets, retained
   owned data and less allocation there, including its full lifecycle cost.
   Preserve capture, freshness, identity, refusal order and database authority.
5. Repeat the full request comparison with ordinary-role PostgreSQL, identical
   work and outputs, and separate quiet and profiling runs. Match the Node/Bun
   interpreter controls. Measure request CPU and latency separately from server
   CPU and waits. A 2x improvement in 10% of CPU saves only 5% of total CPU.

There is no configured `FLAREX_POSTGRES_DATABASE_URL` in this session, so no
complete PostgreSQL request comparison was run. No PGlite/real-Postgres schema
or transaction validation was needed or claimed: persistence schema and runtime
owners were unchanged. The Cloudflare production-host boundary is unchanged.

## Evidence and reproduction

Use [the harness instructions](./README.md). The checked-in
[observations](./observations.windows-x64.json) contain every row's median/range,
build commands/hashes, versions, static-report summaries, profile summaries,
source revision and measured-worker hashes. Compressed raw rounds and both raw
CPU profiles are in `evidence/`, with their original and compressed hashes in
the observations. Executables and full build logs remain under
`work/validation/bun-aot-cpu/measured`; they are not checked in.

The final driver additionally passed a two-round, 30-worker bounded smoke with
its Schema result decoding, row-contract checks, safe output-directory guard
and portable path conversion. Those tiny smoke timings are not performance
evidence. Existing output was refused without writes; a failed build retained
stderr and produced no successful report. Focused TypeScript, JS syntax,
`lint:core`, `lint:diff` and `schema:aot:check` passed. The latter verified all 60
decode targets in eight modules. The observations disclose the driver-only
validation changes after the long cohort launched; timing workers were unchanged.

Mechanisms and expectations were checked against Bun's primary documentation:
[compiler modes](https://bun.com/docs/compiler),
[AOT behavior and limits](https://bun.com/docs/compiler/aot),
[types and layouts](https://bun.com/docs/compiler/types),
[explain reports](https://bun.com/docs/compiler/explain), and
[runtime-generated code](https://bun.com/docs/compiler/compatibility#code-from-strings).
The installed Effect 4.1.4 source supplies the decoder/registry/fallback behavior.
