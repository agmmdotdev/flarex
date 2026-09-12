# Application Preparation Input Reuse

Status: proposed; shared-owner implementation awaits approval.

## Outcome And Evidence

Reduce repeated metadata acquisition during one private command's Application
preparation, without retaining inputs across commands or caching readiness.
This follows the implemented [Payload admission](./64-payload-prepared-admission.md)
and [preference preparation](./65-payload-prepared-preference-installation.md)
slices. The existing actual Payload Local API benchmark is the nearest complete
request proof; Commerce and the combined command are connected consumers, not
separate implementations of Application preparation.

Current source identifies two concrete reuse candidates:

- `applicationRelationReadinessFold.ts` calls schema resolution, then relation
  preparation. `applicationRelationSchemaAuthority.ts` and
  `applicationRelationReadiness/Repository.ts` each call
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
Existing inclusive spans locate the remaining cost in preparation but do not
attribute it to either candidate. First expose the relevant existing activation,
schema, relation, unique-closure/eligibility, physical-lifecycle and authority
spans in the opt-in benchmark, and correlate repeated work with SQL counts.
Record numerical receipts in Git, not as a durable performance guarantee here.

## Recommended Contract And Owners

1. Keep preparation request-owned, including fresh preparation on replay and
   recovery attempts. No new bind-time Application state, cache, TTL, global
   registry of successful reads, or automatic refresh policy.
2. Reuse an acquired canonical value only through its real owner and within the
   same preparation. Preserve exact control-database/port identity, deployment,
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
5. Keep current acceptance unchanged: scope and placement fencing, current active
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
