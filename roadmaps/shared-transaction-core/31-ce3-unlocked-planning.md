# Planning Inputs Before Commit Exclusion

Status: planning/acceptance separation implemented under standing core-redesign
approval. The [CMS command cutover](./64-cms-concurrent-command-settlement.md)
subsequently replaces callback-wide publication exclusion; the serialized CMS
execution descriptions below are the boundary of this earlier preparation slice.
Materialization/publication still serialize, and broader profile coordination is open.

## Outcome And Contract

Active Application binding preparation supplies planning inputs, not execution
authority. It must be able to complete while an ordinary same-scope publication
holds the scope clock. The accepting transaction retains the scope lock and
fresh head, generation, schema, readiness, physical lifecycle and build checks.
This allows preparation to overlap publication; command execution and sequence-
consuming materialization remain serialized in this slice.

The replaced preparation reserved a revision under a shared scope-clock lock, read
a stored candidate receipt under another such lock, and inspected live unique
builds under a third. Document-participant preparation also reserved the candidate
write-guard head under a shared clock. Acceptance retains the necessary live
checks. Removing
only the first clock lock would move the wait to another preliminary check;
removing accepting locks would weaken authority and commit ordering.

Separate immutable catalog preparation from live unique-build eligibility at
the existing unique-set owner. Authenticate and capture the closed definition
set without inspecting the target. Capture caller coordinates before any awaited
read; the preparation must remain bound to its original deployment, schema and
scope. Acceptance requires the exact issuing port and matching preparation,
authority and clock scopes, including for empty sets. Inside acceptance, inspect its actual builds
and coverage under the caller's clock, then derive the same canonical readiness
commitment and compare it with stored readiness. Read the stored candidate
receipt there as well. Preparation may be stale and must never become an
executable active selection or escape as transaction authority.

Physical lifecycle preparation already owns an authenticated physical snapshot
and closed unique catalog. Remove its dependency on live unique eligibility:
enumerating required definitions is a catalog responsibility. Its accepting
catalog/target checks and unique-build eligibility remain independently required.
Ordinary publication does not mutate revision publication inputs; collect those
without acquiring their accepting locks. Reconstruct and compare the bundle
again under accepting protection before any callback. Concurrent lifecycle
changes may invalidate preparation; they must not authorize stale execution.

The accepting catalog check also restores the ordered definition set and its
schema-version bindings through their existing decoders, comparing exact
identity and canonical specification with preparation. The
[reference authority witness](./49-ce0-reference-authority-and-absence.md)
exposed the previous omission beside the unique closure check. This remains a
fresh bounded catalog observation, not an atomic snapshot across separately
placed control and data databases or the deferred protected-metadata fast path.

Candidate write-guard preparation reads and decodes its head without a scope
lock, then compiles the authenticated immutable candidate schema. Applying the
guard rechecks the current head against the locked generation, fence and epoch
before comparing prepared identity or handling failed candidates. Native and
CMS publication retain the same candidate protection and rollback semantics.

## Owners, Breaks And Cleanup

Update Application activation/readiness folding, the unique-set eligibility
owner and its point-commit composition seam, candidate write-guard preparation,
and physical lifecycle preparation.
Migrate every physical-lifecycle preparation caller and relevant tests together.
The internal preparation contract changes; remove displaced live-eligibility
arguments and preliminary target reads rather than preserve fallback or dual
behavior. Standalone readiness/activation and native unique eligibility retain
their authoritative profiles. No durable format, schema, framework public API,
cache or second transaction settlement owner is added.

## Decisive Proofs

- While a genuine active CMS publication is held, a competing request must
  complete binding and document preparation and reach the main exclusive clock
  acquisition before the barrier is released. Its callback runs once after
  release; preserve dense publication and duplicate-result semantics.
- While PostgreSQL holds both the candidate head and scope clock exclusively,
  write-guard preparation must complete. Subsequent candidate replacement must
  refuse that preparation at application; a changed epoch must also refuse a
  prepared failed candidate.
- On PGlite and ordinary-role PostgreSQL, reject forged preparation, wrong issuer
  or scope, changed active head/fence, missing/disabled unique builds, catalog and
  stored-readiness corruption before executing the accepting callback. Preserve
  fresh integrity checks between preparation and acceptance.
- Retain active request rollback/replay, native readiness/unique-set and physical
  lifecycle regressions. Compare the existing active-request measurements without
  interpreting local timing as capacity. Run affected typechecks, lint and both
  reviewers, remove displaced paths, stop resources and commit the coherent slice.

Preparation has no authority to publish. A passing overlap witness does not
establish parallel command execution, whole-request deadlines, full CE0 reference
equivalence or the final coordinated CE3 protocol.
