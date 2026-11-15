# Complete Product workflow CPU

This harness runs the actual pinned `createProductsWorkflow`, its eight native
module/Link registrations, the Medusa adapter, Effect runtime, and Core
admission/staging/commit/event logic. The minimal input has one Product, one
required option and one value (three business rows); the rich input is the
existing one-Product conformance graph (29 business rows, including a managed
variant, images, prices/rules, memberships and Links).

Core's trusted `CorePersistence` port is supplied by benchmark-only in-memory
revision/index/global storage. No PostgreSQL or PGlite engine runs. Unused eager
database imports resolve to constructors that throw if reached. Unused physical
fixture constructors also throw; the existing registry observation function is
preserved from its source. The final bundle is checked for engine/test-runner
imports. The storage fixture fails closed on relational predicate evaluation
and index history; it is not a general database implementation.

`PRODUCT_CPU_TRANSPORT=client` includes the real Flarex JS client, JSON request
and response processing, and the real public invocation decoder. Its local
fetch bridge invokes the native workflow directly. It excludes network I/O,
backend authentication, function resolution/execution and deployment routing.
`direct` measures the same workflow without that client bridge. Neither route
is a complete deployed HTTP request benchmark.

Preparation/installation, reference seeding, output validation, independent
native readback, final business-row/event-family/outcome/revision verification
and cleanup run outside each request timer. Keys and request Effects are made
inside the timer. Process CPU, available calling-thread CPU and wall time are
reported separately. Quiet runs include the memory port's work. A separate
`PRODUCT_CPU_DIAGNOSTIC=1` run attributes synchronous memory-storage body CPU;
its timer overhead is excluded from quiet comparisons. Inspector profiles also
belong to a separate diagnostic cohort.

Build from the repository root after the pinned native Medusa packages have
been built. The build uses native `dist` exports, not an alternative business
implementation:

```sh
bun --tsconfig-override packages/executor/benchmarks/core-aot/types.tsconfig.json packages/medusa-adapter/benchmarks/product-cpu/build.mjs work/validation/product-cpu
```

Resolve that output directory's `effect` import to the workspace's patched
Effect 4.1.4. Run quiet children sequentially, without concurrent builds/tests:

```sh
PRODUCT_CPU_SCENARIO=rich PRODUCT_CPU_TRANSPORT=client PRODUCT_CPU_SAMPLES=16 PRODUCT_CPU_WARMUPS=8 node work/validation/product-cpu/worker.mjs
```

Use `minimal` for the three-row input and run the same frozen bundle with Bun
for the other runtime. Configuration is validated and bounded. A profile prefix
can be set with `PRODUCT_CPU_PROFILE=/absolute/path/profile` in a Node
diagnostic run. Every child rejects failed graph/publication verification or
cleanup, rather than retaining its timing as a successful performance row.

The serial comparison runner requires Node and verifies each child's runtime
label. It runs two fresh processes per Node/Bun and minimal/rich configuration,
with eight warmups and sixteen measured requests per process, reversing cohort
order in the second round. The output directory must be new:

```sh
node packages/medusa-adapter/benchmarks/product-cpu/run.mjs work/validation/product-cpu work/validation/product-cpu/quiet /absolute/path/to/bun
```

The explicit storage checks exercise historical snapshots, exact index anchors,
tombstones, byte ownership, duplicate-batch refusal without partial publication,
stale leases, exact bigint globals, log pagination and predecessor selection:

```sh
node --import ./packages/medusa-adapter/node_modules/tsx/dist/loader.mjs packages/medusa-adapter/benchmarks/product-cpu/memory-persistence.check.ts
node node_modules/typescript/bin/tsc -p packages/medusa-adapter/benchmarks/product-cpu/tsconfig.json
```

These results cannot establish SQL-driver CPU, database durability/isolation,
Cloudflare/Wasm performance, scale, arbitrary workflow compatibility, or a
native Perry result. Those require their own completed execution and checks.
