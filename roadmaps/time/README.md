# Core Time And Temporal Values

Status: active cross-cutting package and migration roadmap.

## Decision

`@flarex/time` owns runtime-neutral temporal value capture and deterministic
conversion. It is not the source of current time and it does not own database,
platform, protocol, freshness, expiry, scheduling, or transaction authority.

The package dependency direction is:

```text
@flarex/utils -> @flarex/time -> protocol/domain/host/persistence consumers
```

`@flarex/time` may depend on Effect for `Brand`, `Data`, and pure `Result`
decoders. It must not import another Flarex domain package, PostgreSQL,
Drizzle, Cloudflare, Node, a runtime bridge, or an application composition
root.

## Authority Matrix

| Concern | Owner |
| --- | --- |
| Epoch-millisecond, canonical ISO-instant, and calendar-date value contracts | `@flarex/time` |
| Pure parsing, checked conversion, and comparison | `@flarex/time` |
| Safe same-realm JavaScript `Date` inspection and copying | `@flarex/utils/dates` |
| Current time in Effect-native operations | Effect `Clock` and `DateTime` |
| Transaction time, leases, expiry, ordering, and committed evidence | PostgreSQL inside the owning persistence transaction |
| Cloudflare alarm epoch values | The host adapter |
| Wire grammar, brands, freshness, grant lifetime, skew, and authorization | The owning protocol or domain |
| Permissive legacy or stored-state date normalization | The compatibility owner |

## Public Package Surface

The initial package exposes narrow subpaths only:

- `@flarex/time/epoch-milliseconds` captures integer milliseconds in the full
  ECMAScript `Date` range, rejects the non-canonical JavaScript `-0` spelling,
  snapshots genuine finite `Date` values, creates owned `Date` values, and
  compares captured instants;
- `@flarex/time/iso-instant` captures the exact canonical spelling emitted by
  `Date.prototype.toISOString()`, including signed extended years, and converts
  it to and from captured epoch milliseconds or a genuine finite `Date`; and
- `@flarex/time/calendar-date` captures exact four-digit `YYYY-MM-DD` values
  that round-trip at UTC midnight and converts them to epoch milliseconds.

All unknown-input decoders return Effect v4 `Result` with a tagged error.
Predicates remain allocation-light. Total transformations accept captured
branded values. Effect consumers enter the failure channel once with
`Effect.fromResult` and map the package error only when their domain contract
requires a different failure.

The package does not export `now`, a Context service, a Layer, a runtime, a
throwing parser, a database codec, a timezone default, or a generic
parse-any-date-string function.

## Compatibility And Ownership Transfer

`flarex-protocol/iso-timestamp` remains an import-compatible facade over
`@flarex/time/iso-instant`. Its public function name and `string -> boolean`
signature remain unchanged. Transaction-grant timestamp validation retains its
stricter four-digit-year wire grammar and domain bounds.

Importable compatibility-date validators that already implemented the exact
four-digit UTC-midnight round trip may delegate to
`@flarex/time/calendar-date` while retaining their domain names, messages, and
throwing or typed boundary behavior. Self-contained generated Worker source
cannot import the workspace package and keeps its smallest equivalent local
implementation.

Persisted scheduler and delivery timestamps currently accept broader
JavaScript-parseable text and normalize it to ISO. Tightening those values to a
canonical spelling is a storage trust-contract change, not a mechanical package
migration. It requires its own compatibility evidence and approval.

## Migration Gates

1. Foundation: publish branded epoch, canonical instant, and calendar-date
   contracts with adversarial tests and the protocol compatibility facade.
2. Exact duplicates: migrate only importable consumers with byte-for-byte,
   message, validation-order, and throw/failure equivalence. The Standard
   Application task-binding compatibility-date guard now delegates its exact
   four-digit UTC-midnight contract to `@flarex/time/calendar-date` while
   retaining its domain error and public string boundary.
3. Effect clock hygiene: classify live reads, then replace domain/service live
   time with Effect Clock while retaining platform adapters and external
   watchdogs. The `SchedulerDO` decision and continuation-storage slices are
   complete; see `roadmaps/time/01-live-clock-audit.md` for retained boundaries.
   The package-only executor audit is complete in
   `roadmaps/time/02-executor-clock-preflight.md`; ECLK01-A migrated health
   reporting to an Effect-native operation while retaining the public executor
   `Clock` compatibility boundary. ECLK01-B1 now runs session lifecycle and
   retry orchestration through Effect-native operations while preserving the
   Promise facade, configured-clock compatibility, read order, `Date` identity,
   and error precedence; see
   `roadmaps/time/03-executor-session-clock-preflight.md`. Remaining executor
   clock families stay separately gated. ECLK01-C now runs the package-only
   session-maintenance cutoff and sweep composition through Effect-native
   operations; see
   `roadmaps/time/04-executor-maintenance-clock-preflight.md`. `PartitionDO`
   commit metadata remains a separate host authority decision outside these
   package-only gates.
4. Persistence codecs: centralize representation conversion only where row
   decoding, corruption ownership, transaction order, and database authority
   remain unchanged.
5. Stored-state hardening: separately decide whether permissive stored
   timestamps become canonical and prove upgrade behavior for existing state.
6. Enforcement: after migrated roots are stable, add a scoped Oxlint rule that
   prevents new direct live-clock reads and ad hoc parsing in those roots.

Every behavior-affecting gate requires focused typecheck and unit tests.
Database-authoritative behavior additionally requires PGlite where adequate
and real PostgreSQL whenever transaction clock, locking, expiry, or isolation
semantics matter.
