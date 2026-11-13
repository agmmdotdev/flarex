# Core Schema AOT experiment

Run from the repository root with Node and the installed workspace dependencies:

```powershell
pnpm --filter @flarex/persistence-postgres exec tsx --conditions=source benchmarks/schema-aot/run.ts --out C:/path/to/results
```

The runner compiles the executing core's iterator-budget, index-metadata and
native foreign-key schemas with Effect's unstable `SchemaAOTCompiler`. It writes
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

This is an opt-in decoder microbenchmark. It does not activate compilation in
the application, measure transactions or establish request-level improvements.
Core modules that captured parsers before installation retain those parsers;
production activation would need an explicit startup integration and its own
behavioral and host compatibility gates. Unsupported schema operations still
use Effect's interpreter. No dynamic function construction is needed by the
generated module.
