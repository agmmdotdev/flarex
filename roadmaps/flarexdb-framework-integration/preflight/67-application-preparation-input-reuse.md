# Application Preparation Input Reuse

Status: implemented acceptance-integrity correction and request-local
manifest-binding reuse. Unique-closure preparation reuse remains deferred.

## Acceptance Integrity Correction

The required pre-removal witness exposed missing fresh control-catalog coverage
in existing prepared acceptance. This is not a regression introduced by reuse.
`test/applicationPreparationCatalogIntegrity.test.ts` reproduces both cases:

1. Prepare a valid private Application binding and prove normal acceptance.
2. Change its control manifest-binding canonical bytes without updating the
   stored digest. Fresh preparation rejects stored corruption, but acceptance
   of the already-prepared input returns a binding projection.
3. Restore the row, then remove its control unique-set closure. Fresh preparation
   rejects the missing closure, but the same prepared input is still accepted.
4. Restore the closure and prove normal acceptance again. Each mutation is
   isolated with test-owned cleanup; the target active head remains unchanged.

Before correction, the refusal assertions failed on both database drivers. The
small scalar/unique fixture is sufficient to disprove this prerequisite; it
does not establish the behavior of every relation profile or a production
corruption path. The refusal assertions remain enabled, not inverted or skipped.

Responsible paths are `ApplicationRelationReadinessFold` accepting validation,
its relation/schema input owners, and unique eligibility/physical-lifecycle
validation. Acceptance compares captured catalog-derived identities with target
readiness evidence. Unique eligibility reinspects live target build state using
its captured definition snapshot; physical lifecycle validates target lifecycle
rows. Those target checks did not reacquire the changed control manifest binding or
missing unique closure in the witnessed cases. Existing duplicate preparation
reads can still detect changes occurring before the second acquisition, so
removing them cannot rely on the claimed accepting coverage.

The owner approved strengthening prepared Application acceptance before resuming
reuse. The accepting operation now resolves the selected schema through the
existing complete catalog decoder and correlates it with the captured published
bundle. The physical-lifecycle owner rereads the selected unique closure through
its canonical decoder and compares its set identity with the prepared value,
including an empty set. Missing state and changed canonical bytes fail closed.

These are sequential read-only control-catalog observations during prepared
admission, before issuing a usable binding. The target scope/active-head locks
remain with the existing outer owner. No control write lock is acquired and no
atomic snapshot across separately placed control/target databases is claimed.
Unchanged catalogs retain normal admission; unsupported privileged catalog
mutation after an observation is not made atomic with the command by this slice.
Standalone readiness, migration and activation lifetimes remain unchanged.

## Outcome And Evidence

Reduce repeated metadata acquisition during one private command's Application
preparation, without retaining inputs across commands or caching readiness.
This follows the implemented [Payload admission](./64-payload-prepared-admission.md)
and [preference preparation](./65-payload-prepared-preference-installation.md)
slices. The existing actual Payload Local API benchmark is the nearest complete
request proof; Commerce and the combined command are connected consumers, not
separate implementations of Application preparation.

The preflight identified two concrete reuse candidates:

- `applicationRelationReadinessFold.ts` calls schema resolution, then relation
  preparation. `applicationRelationSchemaAuthority.ts` and
  `applicationRelationReadiness/Repository.ts` previously each called
  `locateApplicationRelationManifestBindingEffect` for that same manifest.
  Relation preparation additionally locates native definitions; those definitions
  and their lineage checks are not replaceable by a schema-shaped object.
- Unique eligibility in `appUniqueConstraintSetBuildV1.ts` reads the unique-set
  closure, then `physicalDefinitionLifecycle.ts` reads that closure again during
  the same fold. The latter still owns exact closure/eligibility correlation.
  `applicationWriteOwnership/UniqueDeclarations.ts` checks the complete declared
  managed-table set through a different contract; it must not be silently
  replaced with an eligibility verdict.

The fold also resolves authority and performs several auxiliary transactions.
Those are separate observations, not permission to merge their lifetimes.
The opt-in benchmark exposes the existing activation, schema, relation,
unique-closure/eligibility, physical-lifecycle and authority spans, correlating
repeated work with SQL counts. Numerical receipts belong in Git, not as a durable
performance guarantee here.

## Selected Reuse And Deferred Candidate

The composed fold reuses its schema resolver's manifest-binding acquisition when
preparing native relations. The schema owner authenticates the exact issued
value, control database, deployment and manifest identity; the consumer receives
a detached copy. Native definition lookup, root agreement and lineage validation
remain owned by relation preparation. Independent callers still acquire their
own manifest binding through the same preparation implementation. Nothing is
retained by a bound host across requests, and acceptance still reacquires current
catalog evidence rather than trusting this planning-only reuse.

Unique-closure preparation reuse is deferred: attribution found substantially
less cost than repeated manifest restoration. The current acquisition paths and
all closure/eligibility correlation remain intact; this slice adds only their
missing accepting integrity check. Avoid additional snapshot/token plumbing for
that lower-cost candidate without separate measurement justifying it.

The latency comparison uses an integrity-corrected, non-reusing baseline against
the reused implementation. Comparing only with the earlier unsafe acceptance
would conflate the correctness cost and the optimization benefit.

## Approved Contract And Owners

1. Keep preparation request-owned, including fresh preparation on replay and
   recovery attempts. No new bind-time Application state, cache, TTL, global
   registry of successful reads, or automatic refresh policy.
2. Reuse an acquired canonical value only through its real owner and within the
   same preparation. Preserve authentic owner issuance, exact control-database
   identity and relation-port validation, deployment,
   manifest/schema identity, byte validation, resource limits and immutable
   ownership. An arbitrary caller-supplied lookalike must not skip acquisition
   or validation. Prefer existing authenticated handles; add a narrow private
   owner seam only where no suitable contract exists.
3. For the two candidates above, retain each consumer's domain checks. Keep
   schema-to-manifest correlation, native relation definition/lineage checks,
   unique eligibility and physical-lifecycle correlation with their existing
   owners. Do not collapse these into a universal metadata context or validator.
4. Preserve standalone resolver and preparation APIs for independent callers.
   Route the composed fold through one implementation of the same checks, not
   a second optimized algorithm or success fallback.
5. Preserve acceptance beyond the approved catalog correction: scope and placement fencing, current active
   head, complete readiness fold/replay, ownership history, physical and relation
   eligibility, and binding checks remain live under existing locks. Reused
   preparation inputs are not executable authority.
6. Preserve validation order and typed failure/absence semantics. Concurrent
   metadata changes must be detected by the applicable fresh acceptance checks;
   prove that coverage before eliminating any later read that currently catches
   such changes. If it is missing, stop and preflight the required authority
   correction instead of assuming that immutable metadata cannot be corrupted.

Implementation belongs to persistence's Application activation/readiness,
manifest-binding, unique-closure/eligibility and physical-lifecycle owners.
Payload runtime/adapter code should need no workaround. The accepted database
design, Payload adapter boundary and package-boundary roadmap remain governing.

## Alternatives And Cleanup

- Extend: existing preparation composition and the smallest owner-specific
  input-sharing seams supported by measured repetition and integrity evidence.
- Replace/delete: the duplicate acquisitions in that composed path, plus
  temporary benchmark instrumentation or experimental paths not retained as
  useful opt-in observations.
- Retain: independent public/private callers' normal acquisition APIs, canonical
  codecs, all current accepting validation, and declared-unique-set checks.
- Reject: cross-request Application caching, digest-only trust, schema objects
  masquerading as native relation authority, adapter SQL, broad transaction
  contexts, parallel queries on a borrowed transaction, and weakened assertions.
- Defer: combining auxiliary transactions, changing lock order/strength/duration,
  merging control reads under target locks, removing authority resolutions,
  changing activation/rebind behavior, schemas/migrations, public APIs and hosting.

## Completion Gates

Native relation conformance setup must exercise complete native publication.
Synthetic row/edge writes followed by a scope-clock advance omit enabled index
coverage and therefore do not establish a valid committed starting state for
readiness, replay or historical-receipt assertions. The shared driver-neutral
fixture uses journal operations, sealing, stored evidence and the existing
point-commit publisher with all enabled materialization owners. It preserves
deterministic journal-compatible identities, asserts the publisher-allocated
commit sequence, and removes duplicated manual PostgreSQL lowering. Deliberate
corruption remains a separate mutation after valid publication; no production
readiness requirement or resource limit is weakened to make a fixture pass.

Compare frozen before/after sources with the same opt-in workload and serialized
ordinary-role PostgreSQL measurements. Report complete-request p50/p95, SQL work,
startup separately, and inclusive owner phases without adding nested durations.
Require a demonstrable reduction in repeated preparation work and an improved
complete-request median before presenting this as a completed latency change.
Do not promise that all preparation cost, tail latency or deployed overhead is
removed. If attribution does not justify a candidate, omit it explicitly.

Run both PGlite and ordinary-role PostgreSQL owner regressions: malformed or
missing metadata, changed canonical bytes with unchanged digests, foreign
port/database/schema inputs, zero/nonzero unique sets, relation origins, current
head changes between prepare and accept, cancellation and lock lifetime. Preserve
standalone behavior and all admitted Payload scalar/relation/many/join profiles,
preferences, rollback/replay, Commerce admission and the combined command.
Run affected typechecks, lint and both project reviewers against the final owned
diff; stop owned resources, update durable status and commit one completed slice.
