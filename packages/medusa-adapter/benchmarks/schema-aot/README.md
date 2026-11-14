# Core Schema AOT experiment

Run from the repository root with Node and the installed workspace dependencies:

```powershell
pnpm --filter @flarex/medusa-adapter exec tsx --conditions=source benchmarks/schema-aot/run.ts --out C:/path/to/results
```

`pnpm schema:aot:test` runs the bounded parity/activation suite. It uses a fresh
temporary artifact directory by default; forward `--out C:/path/to/results` to
retain results at a chosen location.

The runner compiles the executing core's iterator-budget, index-metadata,
native foreign-key and schema-metadata schemas, plus Medusa Product read/config
schemas, with Effect's unstable `SchemaAOTCompiler`. It writes
a static ES module and results to the supplied directory. The runtime import is
resolved to the current installation so an external artifact directory works;
regenerate after moving the installation or changing schemas or Effect.

Fresh Node processes disable code generation from strings and alternate
interpreter/AOT order across five rounds. Parsers
are created after installation, warmed, and measured on valid and invalid input
separately, under both default and strict excess-key parsing. Each worker also
checks known acceptance/refusal and excess-key cases and compares
decoded values, issue paths, messages and diagnostic order for first/all errors.
Inputs are ordinary deterministic objects; proxy/getter replay is outside this
experiment. `--iterations` and `--rounds` control the bounded measurements.

Runtime owners now install their own static artifacts before parser creation;
see the [activation contract](../../../../roadmaps/core-performance/schema-aot.md).
The interpreter control bypasses those artifacts before importing any owners in
a fresh process. A separate untimed worker observes the actual existing core and
Product decoder operations, compares their decoded values, checks default
insertion and strict refusal, and proves accessors are refused before parsing.
This observer uses Effect's generated-code runtime helper and is kept in
JavaScript because that helper's internal declarations are deliberately stripped.
The measured worker has no observation proxies.

This remains a decoder microbenchmark: it does not measure transactions or
establish request-level improvements. Unsupported operations retain Effect's
interpreter. No dynamic function construction is needed by the generated module.

The separate [Bun AOT CPU experiment](../bun-aot/README.md) compares Node JIT,
Bun JIT, bytecode and machine-code AOT using these suites and the actual owner
installers, with independent object-layout and runtime-code-generation controls.
