# Type-preserving Bun AOT build experiment

This experiment asks whether compiling original implementation TypeScript helps
the current mixed Application/Product request. It reuses `worker.ts`, the actual
scenario, generated schema decoders, PostgreSQL settlement, committed readback
and cleanup from the [request benchmark](./README.md). It adds no runtime owner,
adapter behavior, schema, SQL or transaction changes.

## Measured mixed-request result

Windows x64, Ryzen 5 2600, Node 26.13.0 and Bun 1.4.5. The complete matrix uses
four fresh workers and 120 measured requests per input, plus five warmups per
worker. These are client CPU means and nearest-rank wall percentiles, in ms:

| Input | Mean CPU | Median wall | P95 wall |
| --- | ---: | ---: | ---: |
| Node, frozen JS | 114.91 | 108.89 | 177.96 |
| Bun AOT, frozen JS | 97.13 | 111.86 | 142.32 |
| Bun AOT, original Core/adapter TS | 81.72 | 92.10 | 113.51 |
| Core/adapter TS, uniform config | 83.58 | 95.66 | 116.45 |
| Core/adapter and Medusa source | 82.03 | 93.50 | 115.32 |
| All source, uniform config | 89.49 | 102.26 | 160.60 |

The direct Core/adapter route used **15.9% less CPU** than JavaScript AOT.
Retaining Medusa source added no consistent advantage. Eliminating all
"compiled without types" files did not produce the best result.

A second series compares the three main AOT routes in all six possible orders:
six workers and 180 measured requests per route, with five warmups per worker.

| Input | Mean CPU | Median wall | P95 wall |
| --- | ---: | ---: | ---: |
| Frozen JS | 145.23 | 168.83 | 304.61 |
| Original Core/adapter TS | 113.99 | 132.10 | 240.46 |
| Core/adapter and Medusa source | 122.27 | 140.83 | 271.51 |

Direct Core/adapter TypeScript used **21.5% less CPU** than JavaScript AOT in
this repeat. Adding Medusa source used 7.3% more CPU than that route. Host
performance varied substantially between and within series; the cause is not
established. Every row is retained, and the two series are reported separately.
There are 1,260 measured requests, 210 warmups and 42 fully verified/disposed
workers across both series. These bounded results support compiling original
Core/adapter TS for further AOT experiments; they do not establish a universal
production speedup or isolate annotations from the other build transformations.

The [observations](./type-inputs.observations.windows-x64.json) retain per-worker
means, artifact hashes, configuration digests and compiler summaries. Their
hashed compressed evidence contains both complete series and raw worker output,
including the existing `pg@8.22` queued-query warning and the emitter witness.
The JavaScript control matches the previous optimized request bundle SHA256:
`47851c6774585d0097b380ba3b28a776caf9ebaa1a9c40ce239699ad7ee352b2`.

The complete native [Product workflow experiment](./PRODUCT-WORKFLOW.md) is a
separate workload; its cost must not be inferred from this mixed service case.

## Inputs

| Variant | Compiler input | Native Medusa | TypeScript config |
| --- | --- | --- | --- |
| `node-js` | Frozen JavaScript, Node JIT | Existing `dist` | Types already erased |
| `aot-js` | Same frozen JavaScript, Bun machine-code AOT | Existing `dist` | Types already erased |
| `aot-core` | Original Core, adapter and fixture TypeScript | Existing `dist` | Existing per-package configs |
| `aot-core-uniform` | Original Core, adapter and fixture TypeScript | Existing `dist` | Shared strict experiment config |
| `aot-medusa` | Original TypeScript, with `source` export condition | Original source | Existing per-package configs |
| `aot-medusa-uniform` | Original TypeScript, with `source` export condition | Original source | Shared strict experiment config |

The experiment config inherits `tsconfig.base.json`, including its libraries,
strictness and exact optional properties, and enables Medusa's legacy decorators
and decorator metadata. It does not replace package typecheck configs. Selecting
source alone is insufficient: the per-package source build reports 270 files
compiled without types; the uniform build reports none. The equivalent counts
with Medusa `dist` are 95 and zero. These are compiler diagnostics, not hot-path
CPU percentages.

Each direct build records the compiler's resolved input graph and input hashes.
The native source variants replace 170 resolved Medusa `dist` inputs with source
inputs. All AOT executables use `--compile --aot`, disable dotenv/bunfig autoload,
and keep disk code loading disabled. Only the installed generated decoder mode
is measured here; the earlier request experiment retains interpreter controls.

These comparisons change the build route as well as available types. Direct
source versus a flattened JavaScript bundle changes module boundaries and
transforms. Medusa source also uses Bun's legacy decorator lowering in place of
the existing built helpers. Passing committed-result checks is bounded behavior
evidence; it is not a proof of every Medusa workflow's compatibility. Attribute
results to the measured route, not exclusively to annotations.

## Repeat

Build all inputs before timing. Use a fresh output directory for every command:

```powershell
$runner = 'packages/executor/benchmarks/core-aot/type-inputs.mjs'
node $runner --bun C:/Users/User/.bun/bin/bun.exe --out work/validation/type-input-assets --build-only
./scripts/core-aot-postgres.ps1 -Action Start
node $runner --assets work/validation/type-input-assets --out work/validation/type-input-measured --rounds 4 --samples 30 --warmups 5
./scripts/core-aot-postgres.ps1 -Action Stop
```

Workers run sequentially, reverse order for the second round of each pair, and
rotate the next pair by two inputs. The retained earlier mixed-request series
used their recorded rotated/reversed schedules; raw run arrays retain the exact order.
`--variants aot-js,aot-core,aot-medusa --rounds 6` selects a focused repeat
covering all six orders of those three routes. New builds freeze the selected
variants; saved assets can serve any subset they contain. Two selected inputs use
alternating forward/reverse order.
Do not overlap quiet runs with builds, tests or other benchmarks. Each worker
uses fresh business samples, measures only `sample.run()`, and verifies durable
Product and Application results afterward. The runtime role and durability
settings must match across workers. Assets and retained compiler logs are
hash-checked before execution. Failed output remains diagnostic evidence and
cannot produce a successful report. Reports contain no endpoint credentials.

Process CPU excludes PostgreSQL server CPU. Windows CPU accounting is coarse;
compare aggregate CPU over the measured cohort and retain per-process means.
Host-wide idle time and CPU frequency are not recorded. Variation between
cohorts cannot be attributed to external load or removed as an outlier from
these observations alone.
The request includes PostgreSQL work but no HTTP ingress. This does not close
native-relative, Cloudflare, deployment or scale acceptance.

## Type-preserving library output

[Bun's library documentation](https://bun.com/docs/compiler/libraries) describes
`.aot.ts` artifacts selected by the `aot` export condition. Unlike declarations,
these preserve implementation types. [Bun's type documentation](https://bun.com/docs/compiler/types)
also explains that JavaScript can benefit from object/callee inference; retaining
types does not guarantee faster code.

On Bun 1.4.5, bundling the full source graph with `--dts` succeeded, but compiling
the emitted `.aot.ts` failed: a valid contextual generic annotation became
`Effect.Success<typeof (>`. The reduced [compiler input](./type-emitter-witness.ts)
reproduces this independently of Core. To reproduce the emitter failure:

```powershell
$probe = 'work/validation/type-emitter-probe'
bun build --dts --root . --entry-naming '[name].[ext]' --target=node packages/executor/benchmarks/core-aot/type-emitter-witness.ts --outdir $probe
bun build --check --target=node "$probe/type-emitter-witness.aot.ts" --outfile "$probe/check.js"
```

Keep the emitted failure as a compiler witness. Do not edit generated types,
loosen checking, or change the valid Core annotation to manufacture a successful
comparison. The direct-source route avoids this emitter. This experiment does
not change Medusa's normal exports or adopt `.aot.ts` for package distribution.
