# Pending Unique Conflict Equivalence

Status: bounded pending-uniqueness comparison implemented; complete-request
CE0 acceptance remains open.

## Outcome And Owners

Extend the fixed scalar insertion command with an explicit zero-to-thirty-two
title list. Keep the generated zero/one/eight/thirty-two input used by current
measurement and settlement consumers. Both inputs use the same private command
identity and canonical request evidence, one reference execution owner and the
existing physical settlement/recovery owners. No arbitrary callback or generic
CRUD reference is introduced.

This closes the pending-duplicate gap in the selected first-insert comparison.
Exercise early and late duplicates, empty strings, committed ownership after
pending work, and a duplicate preceding a later oversized document. Preserve
the constraint identity, first-failure order and complete rollback. Successful
explicit lists retain real readback, dense publication and cross-engine replay;
changed ordering or input form cannot reuse a committed request key.

Identity-allocation observations retain the native random implementation and
prove execution reaches the conflicting second or thirty-second insert. They
also prove that a later oversized document does not replace the first unique
refusal. Positive materialization controls make zero observed steps on refusal
meaningful. Explicit lists also cover a successful two-row request outside the
generated profile's fixed cardinalities.

## Design Challenge And Cutover

Do not pre-deduplicate or reject duplicate titles in the command decoder. The
real and independent document owners must enforce eager scoped uniqueness.
Decode bounded input shape using Schema, then retain per-document execution
inside the existing lifetime. Reuse the existing fixture inventory/assertion
owner for caller-selected titles rather than copy publication checks.

A second mutation reference or callback-driven execution registry would duplicate
or broaden the selected owner. Extend the existing fixed input union instead.
The generated shape is retained for its named measurement, settlement and budget
consumers. No runtime selector, compatibility engine, production schema, public
API or durable-data migration changes. Remove stale generated-only scope notes.

The private input decoders now reject excess or mixed-shape fields. Existing
generated consumers use exactly count/prefix and require no compatibility path;
the list shape has exactly titles. Raw captured input remains part of canonical
request identity, including its ordering, before outcome resolution.

The reference's explicit unsupported-input boundary remains distinct from the
production command's input-error projection; comparison here concerns admitted
input profiles and their execution failures. Broader authority/refusal precedence
and complete-request equivalence remain open before reference timing.

## Validation And Completion

Run shared PGlite and ordinary-role PostgreSQL witnesses, existing zero/first-insert
and budget regressions affected by the decoder/loop extension, and PostgreSQL
settlement/concurrency coverage. Assert no materialization on eager refusal,
unchanged full inventories, fresh-key recovery after confirmed rollback and
replay without execution. Validate type/lint, both read-only reviews, stop owned
resources, reconcile roadmaps and commit. No scale or timing claim follows.
