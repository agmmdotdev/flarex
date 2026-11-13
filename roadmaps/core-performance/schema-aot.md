# Static Schema decoding

The selected Schema AOT activation covers the existing core's scalar budgets,
captured option contracts, native policy, document system fields, index metadata
and schema metadata, plus Medusa Product service inputs and value profiles.
Each owner retains its authoritative Schema values and installs checked-in
Effect-generated decode operations before constructing parsers. The Product
schema definitions live separately from their decoder/error wrappers so native
consumers share the same definitions and initialization order.

This is an internal parsing optimization. Canonical capture, accessor refusal,
intrinsic checks, strict excess-key policy, diagnostic ordering, defaults,
resource accounting, issuer identity and database authority retain their owners.
No runtime JIT/compiler enable import or dynamic function construction is added.
Effect's compiler is unstable and remains pinned to the workspace Effect version.

The eight ordered target arrays are the build manifests. Run
`pnpm schema:aot:generate` after changing a target, its dependencies or Effect;
`pnpm schema:aot:check` must pass before shipping such changes. Generation bypasses
old installers while loading current definitions, then compares exact emitted
code and the Effect version. Do not manually edit generated modules or reuse
their installer with a different AST array. Retain the generated JavaScript and
its declaration together when packaging these source packages.

Metadata-derived schema factories and raw schema input, program identity, source
pin, iterator-budget and schema-worker budget/option objects remain interpreted.
Replaying caller-owned getters at those boundaries can change a refusal into
acceptance, so their object ASTs are deliberately excluded. Recursive/suspended
nodes, transformations and defaults use Effect's supported generated operations
or interpreter fallback; listing a target does not mean every traversal has a
synchronous fast path. Failed fast paths can replay pure checks. Preserve
deterministic checks and owned/captured inputs when extending activation.

The [decoder experiment](../../packages/medusa-adapter/benchmarks/schema-aot/README.md)
checks interpreter parity and activation of existing owner parsers separately
from decoder timing. Complete PostgreSQL request comparisons must use the same
frozen execution graph in Node and Bun AOT, with an interpreter control for each
runtime. Client CPU excludes PostgreSQL server CPU. The mixed benchmark fixture
evaluates its generated Application function during preparation; a compiled Bun
host does not prove that fixture-created function was compiled ahead of time.
Neither local results nor the compiler activation establish complete performance
acceptance, scale or support for every Medusa adapter.

## Existing compatibility witnesses

The older logical Product host still has refusal-contract witnesses needing
separate disposition: `logical-product-create-storage.test.ts` expects a retained
`CoreNativeUniqueConflict` cause but receives no cause, and
`logical-product-service.test.ts` expects `rollbackOnly` for invalid enum,
duplicate-handle and two search-budget refusals but receives `invalidInput` or
`limitExceeded`. The same expectations fail with generated installers bypassed.
They remain failing witnesses at the commerce error-projection/test-contract
boundary; this activation does not weaken them or repair the adapter around a
shared defect. Work depending on those refusal branches remains paused pending
their owner's correction/disposition. Current core-backed Product request
validation and the bounded benchmark are a distinct scope.
