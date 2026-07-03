# Authoritative Analysis Effect Quality

This roadmap tracks the next core implementation stream after execution
artifact lifecycle parity: make deployment analysis backend-authoritative while
raising the Effect code quality bar around analyzer, push, and activation
boundaries.

## Current Diagnosis

The local execution artifact analyzer in
`packages/flarex-dev/src/executionArtifact.ts` currently embeds a large
generated worker source string. That worker performs real semantic work:

- imports the developer execution and schema modules inside Miniflare,
- extracts schema, function, validator, source position, and partition
  metadata,
- blocks import-time side effects such as `fetch`, random UUIDs, and
  nondeterministic time,
- normalizes diagnostics and returns analysis to the dev push pipeline.

The backend has already moved toward an authoritative hosted shape:

- public `POST /push` sends the source package to `FLAREX_ANALYZER`;
- analyzer responses are decoded and semantically validated before storage;
- artifact storage recomputes deterministic artifact refs from source packages;
- finish-push verifies artifact availability before activation.

The remaining quality gap is that the semantic analyzer logic is not shared in
a typed, reviewable module. The local analyzer string and hosted analyzer path
can drift, and the internal `/push/start-analyzed` route still represents a
prototype trust boundary that must be protected or removed from normal hosted
production flow.

## Target Architecture

The target is a Convex-shaped source package lifecycle:

```txt
developer source
  -> source package
  -> backend-controlled analyzer
  -> validated deployment analysis and codegen analysis
  -> durable deployment metadata
  -> runtime invocation consumes active analyzed metadata
```

Local dev may run the same analyzer implementation for fast feedback, but local
analysis is not hosted authority. Hosted deployment metadata must come from a
backend-controlled analyzer or from explicitly trusted internal test/platform
plumbing.

## Effect Quality Bar

Every implementation slice in this stream must satisfy these rules:

- Analyzer failures are typed with tagged errors at the first failing boundary.
- Recovery uses `Effect.catchTag` or `Effect.catchTags` for known domain
  failures; broad `catchAll` belongs only at adapter response boundaries.
- Public route handlers keep one runtime boundary per Worker/DO/adapter
  entrypoint.
- Reusable Effect functions use `Effect.fn("Qualified.name")`.
- Schema decoders and Effect Schema compiler calls are hoisted, not rebuilt in
  hot request paths.
- No client-provided deployment analysis is trusted as hosted authority.
- `ValidatorJson` remains the user validation format. Effect Schema validates
  transport, route, service, and persisted metadata around it.
- Shared analyzer code must not depend on Miniflare, R2, Durable Objects, or
  Cloudflare bindings. Host adapters own those mechanics.
- No explicit `any`, weak assertions, or duplicated public contract shapes.
  Use `unknown`, Effect Schema decoders, `satisfies`, and existing exported
  types instead.

## Implementation Slices

- [x] A-0. Create this concrete authoritative-analysis roadmap and matching
  goal checklist.
- [ ] A-1. Audit current analyzer and Convex deployment analysis references,
  then freeze the exact shared analyzer contract.
  - Decide whether the shared code lives in a new `@flarex/analysis` package
    or an existing package.
  - Identify which logic is pure analyzer semantics versus host adapter code.
  - Record source files, exported types, error tags, and test fixtures.
- [ ] A-2. Extract pure analyzer semantics into the shared analyzer module
  without changing runtime behavior.
  - Move schema analysis, function export analysis, validator JSON assertion,
    partition validation/lowering, source-position parsing, and diagnostics
    normalization behind typed functions.
  - Add Node-level unit tests for valid analysis, invalid validators,
    partition errors, diagnostics limits, source-map positions, and
    nondeterminism-sensitive metadata.
- [ ] A-3. Refactor the local Miniflare analyzer worker to call the shared
  analyzer semantics.
  - Keep Miniflare creation, module loading, console capture, deterministic
    globals, and rejected import-time globals as local analyzer host mechanics.
  - Keep behavior-compatible local push/codegen tests.
- [ ] A-4. Make the backend analyzer response path prove it is consuming the
  same shared analyzer contract.
  - Decode analyzer success and failure envelopes through shared protocol
    decoders.
  - Reject analyzer output that does not match the uploaded source package
    contract or codegen analysis consistency rules.
  - Preserve current `/push` response behavior.
- [ ] A-5. Protect or remove normal public trust in `/push/start-analyzed`.
  - Treat direct analyzed-start traffic as internal platform/test plumbing.
  - Add the smallest enforceable guard for hosted production, or move tests to
    an internal-only dispatch path before removal.
  - Keep local dev usable through the source-only push path or an explicitly
    trusted local harness.
- [ ] A-6. Add forged-analysis and source/analysis mismatch tests.
  - Prove public clients cannot activate analysis that was not produced by the
    backend analyzer path.
  - Prove mismatched source package, schema, function metadata, or codegen
    analysis is rejected before activation.
- [ ] A-7. Align local dev codegen and deploy with authoritative backend
  analysis where a backend is configured.
  - Local-only mode may still analyze locally for speed.
  - Backend deploy mode must consume backend-returned `codegenAnalysis` for
    final generated files.
- [ ] A-8. Final audit and cleanup.
  - Confirm no duplicate analyzer semantic helpers remain outside the shared
    analyzer module.
  - Confirm remaining string-generated worker code is only a host adapter shell.
  - Confirm all relevant Effect quality gates and reviewers pass.

## Turn-By-Turn Loop

Every turn in this goal should do exactly one unchecked slice unless validation
or reviewer feedback exposes a small required fix.

1. Read this file and
   `roadmaps/29-authoritative-analysis-effect-quality-goals.md`.
2. Confirm the next unchecked item.
3. Inspect the relevant Convex source files before designing the patch.
4. Implement the slice with typed Effect boundaries and focused tests.
5. Update both roadmap files:
   - tick completed items;
   - record files changed;
   - record previous completed checkpoint commit when known;
   - record Convex references and Cloudflare differences;
   - record validation commands.
6. Run focused package validation plus `git diff --check`.
7. For significant code/test changes, run both standing reviewers:
   - `typescript-diff-reviewer`
   - `code-quality-diff-reviewer`
8. Fix valid findings, rerun validation, and commit the completed slice.

Docs-only checklist updates do not require reviewer subagents.

## Convex References To Start From

- `crates/application/src/deploy_config.rs`
  - `finish_push`, source package fetch, and server-side analysis before
    committed deployment metadata.
- `crates/application/src/application_function_runner/mod.rs`
  - backend-owned analyze path and runtime execution consuming active metadata.
- `crates/isolate/src/environment/analyze.rs`
  - isolate analysis environment and extraction of analyzed functions/routes.
- `crates/model/src/modules/mod.rs`
  - analyzed module metadata is required and stored with modules.
- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata, validator strings, source positions, and module
    version metadata.
- `crates/udf/src/validation.rs`
  - runtime path, visibility, args, and return validation use stored analyzed
    metadata.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen is produced from analysis results.
- `npm-packages/convex/src/server/impl/registration_impl.ts`
  - function registration exports metadata that analysis reads.

## Cloudflare Difference

Convex can run analysis and persist module metadata inside its integrated Rust
backend. Flarex must split this across Workers, service bindings, Durable
Objects, R2, Miniflare, and Dynamic Worker-like execution artifacts.

That difference does not change the authority rule. It only changes the host
adapter:

- local host adapter: Miniflare plus local file watching and fast feedback;
- hosted analyzer adapter: backend-controlled service binding or managed
  Dynamic Worker analyzer;
- deployment adapter: Durable Object push state plus R2 artifact storage;
- runtime adapter: active deployment metadata plus artifact runtime invocation.

The shared analyzer semantics must sit below those adapters.

## Current Checkpoint

Previous completed checkpoint: `3758dd2` (`Mark lifecycle parity audit
complete`).

What changed in this checkpoint:

- Created the authoritative analysis and Effect quality roadmap.
- Made backend-controlled analysis the next explicit implementation stream.
- Defined the turn-by-turn loop and quality gates for future slices.

Known limitations:

- This checkpoint is planning only. It does not yet extract the analyzer
  string, change route trust boundaries, or add forged-analysis tests.

Verification:

```sh
git diff --check
```
