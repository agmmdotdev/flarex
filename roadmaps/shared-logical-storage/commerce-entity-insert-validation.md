# Commerce entity insert validation

## Status And Scope

Implemented and validated on PGlite and ordinary-role PostgreSQL as an explicit
internal logical Commerce participant selection,
`insertValidation: "entityBatch"`. It owns required-field validation order for one
bounded same-table insert call. Native entity grouping and error presentation
remain framework responsibilities.

## Current Sources Of Truth

The [accepted design](../../design-notes/flarex-db-accepted-design.md) keeps
framework execution distinct from Application OCC. Atomic participant capture,
logical participant admission and the logical row working set own this policy.
The neutral `participantInsertValidationScenario.ts` and physical installation
controls exercise its authority and refusal boundaries.

## Current Architecture

Trusted host preparation captures the selected primitive with the participant's
existing command and lifetime identities. Per-call logical receipt validation
is required. The working set first applies existing pure defaults and checks
required fields across the complete same-table input in input and declared-column
order. It then processes each fresh row with ordinary scalar and CHECK validation
before primary-key conflict refusal. Capture still rejects unknown columns and
invalid text identities before that sweep; known non-key scalar validation waits
until the per-row phase. Explicit null does not become an omitted default,
including transaction-time fields. Omitted transaction-time fields receive the
existing trusted timestamp; serial allocation remains with its accepting row
owner and is exempt from the required-field sweep.

The sweep and writes share the existing row frontier and authentic candidate
failure issuer. The omitted selection preserves the default insert order.

## Invariants And Trust Boundaries

- Only authenticated prepared logical participants can select this policy.
- Physical profiles and combined borrowed workflow admission reject it.
- Input copies, errors and candidate evidence cannot manufacture authority.
- Required-field rejection performs no writes, serial allocation or events.
- Existing budgets, rollback-only latching, reference checks, publication and
  outer settlement remain authoritative.
- No additional transaction, SQL path, registry, retry or fallback is introduced.

## Decisions And Rationale

Native entity batching may check a later entity's required field before an
earlier entity's database constraint. A named participant policy represents
that deliberate validation boundary without changing every storage caller.
Adapters continue to translate authentic failures rather than rechecking
storage constraints.

## Convex Compatibility And Flarex Divergences

This private framework execution policy changes no Convex developer API,
Application dependency capture or OCC semantics. PostgreSQL remains the commit
authority.

## Implemented Capabilities

The bounded logical path retains complete pending creation records for authentic
required-field errors, default handling, fresh-row CHECK-before-primary ordering
and whole-root rollback. Default profiles retain their existing behavior.

## Known Gaps And Limitations

The selection covers same-table inserts, not arbitrary ORM flush ordering or
cross-table validation precedence. Native consumer compatibility and complete
workflow admission require their own witnesses and database checks.

## Target Direction

Keep validation mechanics with the shared row owner and entity lifecycle,
normalization and diagnostics with the native framework.

## Next Correctness Gates

Future consumers must demonstrate native grouping and first-error behavior,
complete rollback and receipt enforcement on PGlite and ordinary-role PostgreSQL
before selecting this policy.
