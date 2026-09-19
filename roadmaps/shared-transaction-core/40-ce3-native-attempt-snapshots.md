# Native Attempt Work Alongside CMS Snapshots

Status: implemented for native attempt persistence and active selection. Full
Workerd invocation overlap, concurrent writers and broader CE3 remain open.

## Outcome And Corrected Distinction

The native publication cutover leaves attempt preparation behind `FOR UPDATE`.
Native session activation, journal writes/sealing, claim acquisition/renewal,
replacement, recovery, finishing and terminalization change attempt-owned rows;
they do not change scope identity, authorization epoch or retained history.
Separate attempt lifecycle from scope lifecycle. Preserve the latter's strong
exclusion, while permitting a CMS snapshot to coexist with the former.

Use `FOR NO KEY UPDATE` for ordinary scope-bound writes, including attempt work
and publication. It still excludes other writers and shared clock reads, so
sequence allocation, current-state decisions, lock order and same-attempt
serialization are unchanged. `FOR KEY SHARE` snapshot readers may overlap it.
Scope authority, retention and catalog transitions retain `FOR UPDATE`.

## Owners And Breaks

Rename the shared publication-only helper to ordinary-write protection and
migrate CMS publication and relation lowering. This names the broader invariant
without creating an alias or parallel lock owner. `ScopeExecution.runWrite`
requires an explicit ordinary-write or scope-transition selection; migrate its
two native activation callers and all test callers. Read capabilities and opaque
scoped transaction ownership remain unchanged.

The private session clock owner uses shared protection for its named read lane
and no-key-update for its attempt-write lane. Its five operation groups are
activation, exact attempt work, claim acquisition, claim renewal and terminalization.
It never updates the clock. The point-commit owner's other four callers likewise
operate on attempts, so remove the temporary publication/attempt lock selector:
all five use ordinary-write protection. Preserve the exact decoders and failure
projections at both native owners.

No public API, schema, codec, durable-data migration, new integration or automatic
retry is introduced. This does not permit overlapping writers or move material
application before sequence assignment. It does not establish hosted throughput.

## Connected Proof And Completion

Hold a real CMS snapshot and prepare a native attempt through real signed-grant
activation, indexed read, audit insertion, sealing, finishing and final publication
before releasing it. Keep the prepared-native publisher-first witness. Add a
scope-owner witness that ordinary write protection overlaps a key-share snapshot
but an explicit scope transition remains excluded; verify rollback and opaque
capability cleanup under both profiles.

Run affected activation, journal, claim, replacement/terminalization and native
publication regressions in PGlite and ordinary-role PostgreSQL, including
revocation/fence changes, duplicate requests, conflict/recovery and interruption.
Run affected types/lint and both final reviews, remove displaced helpers/selectors
and stale test assumptions, stop owned resources and commit. Broader capacity,
full Workerd invocation overlap and commerce cutover retain their own gates.

The connected witness exposed two exclusive clock reads before activation: the
active relation readiness read and active selection read. Both consume immutable
readiness and current head evidence without writes. Use shared clock protection
there, matching the legacy active-read path, while retaining exclusive protection
for readiness settlement, activation and scope transitions. The held CMS snapshot
plus complete native preparation is the regression witness for this correction.
