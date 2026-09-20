# Zero-Row Request Reference

Status: bounded zero-row reference implemented under standing core approval.
Complete-request CE0 acceptance remains open.

## Outcome And Boundaries

Implement a test-only request reference for the existing `measuredInsert`
command with `count: 0`. It must publish a dense empty commit and replay the
real host's outcomes, and the real host must replay its outcomes. This tests the
identity and durable result contract across independent request orchestration
and explicit publication SQL, rather than comparing only returned `[]` values.

Keep real target/binding admission, definition preparation and acceptance,
candidate-schema validation, bounded request lifetime, canonical codecs, outcome
resolver, failure projection and physical settlement/recovery as common components. They remain
inside each request boundary. In particular, an empty delta still enters the
Application participant and lowers through its candidate guard. This slice does
not independently compare those common components or nonempty materialization.
The reference does not call the production CMS host or its publication wrapper.

Support exactly the scalar fixture without relations, lifecycle preferences or
commerce. Reject other profiles explicitly. Do not issue fixture-authorized
success, add a runtime selector, expose a new production API or treat this first
profile as full request-reference acceptance. Standalone reads, nonempty rows,
unique transitions, relations and native OCC need further profiles and proofs.

## Design Challenge And Cleanup

Reusing the whole host with a substituted publisher would only compare a
component. Omitting admission or empty-delta checks would compare different
guarantees. Use a fixed-operation test reference with independently assembled
request evidence and publication contribution, while disclosing every common
owner above. Reuse the existing explicit SQL publication reference instead of
creating another publisher or physical transaction owner.

No production contract, schema, persisted format or runtime consumer changes.
Expose the existing measurement fixture's composition input for differential
construction; retain one setup and inventory owner. No displaced production path
exists to retire. The new reference stays under `test/` and is not timed yet.

## Validation And Completion

The shared differential scenario runs in PGlite and ordinary-role PostgreSQL:
both publication directions, unchanged row/index/claim/build state, changed
request input/policy, corrupted and expired results, late publication failure
and complete rollback, fresh request reuse after confirmed rollback, and live
authority refusal. PostgreSQL adds lost COMMIT acknowledgement through the real
physical driver, one callback plus cross-host replay, cancellation after the
complete publication prefix versus after actual COMMIT, and mixed core/reference
duplicate-key contention. Pre-commit cancellation rolls back the prefix; after
COMMIT the interrupted caller can replay the authoritative outcome.

The tests preserve current refusal classification: damaged binding evidence is
projected as `invalidAuthority`, damaged result evidence as `storedCorruption`,
and unexpected publication-hook failures remain defects. Cross-scope reference
isolation, stale definition/fence transitions and absent-outcome ambiguity remain
additional differential witnesses. Common owner tests do not substitute for
those reference acceptance gates. Affected types, lint and both project reviews
remain mandatory before committing each implementation slice.

The zero-row profile supplies no claim about independent admission cost, insert
performance, many-shop capacity or full CE0 equivalence. Timing remains gated by
the complete-request comparison contract and additional differential profiles.
