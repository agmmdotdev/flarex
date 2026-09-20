# Independent First-Insert Execution

Status: bounded independent first-insert execution implemented under standing
core approval; complete-request CE0 acceptance remains open.

## Outcome And Ownership

Replace the test reference's use of the production CMS document working set and
closure with a private first-insert executor. It admits only generated scalar
title documents in the already selected zero/one/eight/thirty-two command. Keep
the same request identity, authority acceptance, physical transaction and result
recovery. This advances the independent request comparison required by CE0;
it does not authorize a second runtime or a generic CRUD reference.

The executor independently owns pending inserts, random identity collision
checks, creation-time progression, eager uniqueness decisions, capture/accounting
order and final sorted changes. Shared components remain timed and disclosed:
canonical codecs, the schema validator, bounded current-row and unique-slot
readers, the bounded lifetime, admission/build/candidate authority and physical
settlement/recovery. No independent cost conclusion follows for those owners.

## Design Challenge And Cutover

Sharing the whole document API would leave its orchestration cost unexamined.
A bare row constructor would omit identity collisions, malformed unique owners,
schema enforcement and resource limits. Use a fixed first-insert owner over the
existing authenticated readers, with no arbitrary callbacks, edits, deletion
tokens or caller-authored changes. Require admitted Payload write ownership and
an active request at entry; close once only after lifetime sealing. Derive all
final changes internally and preserve successful-attempt accounting.

Load committed unique owners through the same bounded reader and verify their
canonical key before reporting a business conflict. Missing/tombstoned or
misbound owners remain corruption. Preserve first-failure order and pending
identity/unique collisions. Retain schema validation and byte accounting inside
each lifetime operation so failure remains sticky until the outer owner exits.

Remove document factory/closure/contribution imports from the request reference;
do not retain a selector or fallback. The production CMS owner, public APIs,
persisted schemas and durable data do not change. Keep the existing zero-row
participant validation and nonempty independent materializer.

## Validation And Completion

Run existing zero/one/eight/thirty-two differential evidence, real readback,
request replay and ordinary-role PostgreSQL settlement/concurrency. Add focused
PGlite/PostgreSQL witnesses for committed and pending generated-identity
collisions, malformed committed unique ownership and resource-limit refusal,
requiring complete rollback. Restore all injected random and stored state.
Run affected types/lint and both reviews; reconcile common-component statements,
remove displaced reference plumbing, stop owned resources and commit.

The [standalone read reference](./53-ce0-standalone-read-reference.md) now covers
empty and bounded point readback. Duplicate titles from a caller-selected list,
broader schema/lifecycle refusal profiles, updates/swaps/relations, native OCC
and timing acceptance remain subsequent work. The fixed measured command generates distinct
titles; that is a stated profile boundary, not a general uniqueness proof.

## Integrity Witness Boundary

The unique family has a row-identity foreign key and one claim per owner. The
corruption witnesses preserve both physical constraints: mutate the owner to a
different valid canonical title (including its new hash), or to a valid physical
tombstone while retaining the claim. Both implementations must refuse the
mismatched logical ownership as corruption and leave the damaged fixture
unchanged until the test restores it. Tests do not disable constraints to create
unreachable missing-owner states.
