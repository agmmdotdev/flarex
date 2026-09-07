# Original Medusa Product Tests Through Flarex

## Status And Scope

Implemented and validated privately after user approval following record 28.
This is a test-harness capability. It does not admit additional Product methods,
change shared core behavior, or add a serving facade or durable event provider.

The two complete pinned module-service files, events.spec.ts and products.spec.ts,
are promoted byte-for-byte with their assertions unchanged. The pure Product data
builder and Medusa mock event bus are reused. The fixture barrel exposes only its
pure builder, leaving its ORM fixture writers in the source island. Product event
constants retain their pinned implementation with import relocation only.

The dedicated runner extends the Currency test entry point. One serial entry
imports both suites and shares one installed Product database for each driver.
Between cases, only the compiler-declared Product business tables are truncated;
installation, readiness and commit history remain. Each service mutation uses a
fresh request identity and the existing private command, host and transaction
owner. The injected upstream mock receives the authenticated local event batch
only after acknowledged commit. Failed local delivery fails the harness.

## Explicit Coverage

The [case inventory](./product-upstream-test-cases.json) enumerates all 57 cases
in those two files. At this gate three were admitted: nested creation with its exact 12 events,
image creation rank, and the original missing-variant-option error. One case was
already skipped upstream; 53 required capabilities outside that profile.
Other Product suite files are not registered by this capability.

[Record 30](./30-medusa-product-related-create-and-reads.md) now implements related
creation, associations and bounded reads, bringing current admission to eleven
original cases. The inventory reflects that newer gate; the three-case results
below retain this runner's historical acceptance evidence.

At that gate, original read cases required collection/variant-option filtering, standalone image
writes, unadmitted relations, or 1000 images beyond the existing 256-row bound.
Their assertions remained intact and excluded explicitly. Existing record 28 tests
continue to cover the bounded read/population behavior. A selected original case
must fail normally when behavior disagrees; never adapt the expected result.

## Reproduction And Acceptance

Run pnpm --filter @flarex/medusa-adapter test:product:upstream for PGlite.
For ordinary-role PostgreSQL set FLAREX_TEST_DRIVER=postgres and
FLAREX_POSTGRES_DATABASE_URL before running the same command.
The existing 90-second installation/cold-open deadline and 120-second cleanup
hook remain. The original runner acceptance required exactly three admitted
cases and 54 skips, tied to byte-verified pinned source. Current admission follows
record 30's eleven-case inventory and coverage assertion.

Acceptance requires both database lanes, strict authored-runner typechecking and Currency source compatibility,
Currency runner preservation, promotion/browser guards, focused source-guard
tests, lint and both repository reviewers. Observed results are recorded below.

The Product source files execute with Vitest's TypeScript transformation as
compatibility tests. They are not added to the strict authored-code typecheck:
the pinned tests contain historical class-style DML type uses, unused locals,
and methods absent from the published Product interface. Their bytes and runtime
assertions are preserved rather than changing them for a different compiler
contract. This gate's private full-service test proxy dispatched four admitted
methods; record 30 expands that to eight. Other property access fails. This is not a public or complete
IProductModuleService implementation.

## Observed Acceptance (2026-09-08)

- Three original Product cases passed on PGlite (103.64 seconds) and ordinary-role
  PostgreSQL 18.3 (116.41 seconds); each lane reported all 54 excluded cases.
  Both lanes retained the original 90-second setup/cold-open deadline.
- Deliberately selecting no admitted cases failed with the coverage mismatch
  error. The reporter checks exact full test identities and counts, so missing,
  extra, duplicate or entirely skipped coverage cannot pass.
- Currency preservation passed 19 cases on PGlite and 18 on PostgreSQL, with its
  one PGlite-specific interruption case skipped in the latter lane.
- Affected Medusa package builds, strict authored adapter typechecking and the
  existing Currency source compatibility typecheck passed. The native compiler
  was bounded with GOMAXPROCS=2 and GOMEMLIMIT=1GiB after Windows resource
  exhaustion and a machine restart interrupted earlier validation sessions.
- All 37 promotion/source-boundary tests, the 614-input portable browser guard,
  repository lint, staged lint and both required reviewers passed.

These proofs ran in an isolated checkout based on 00093659 to avoid concurrent
Product relation-helper edits in the shared checkout. Integration onto relation-helper commit 20b3f338 also passed all three original
cases on PostgreSQL (91.68 seconds), strict adapter/Currency compatibility
typechecking, all 37 source-guard tests and the combined 617-input browser guard. Full Product suite parity,
additional mutations, production serving and durable events remain unadmitted.
