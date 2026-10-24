# Native Order Change cancellation workflow

## Status and scope

Private finite profile for `cancelOrderChangeWorkflow` over one existing pending
or requested Change. It uses the complete 23-model Order definition and separate
`flarex-order-change-cancellation` / `order.changeCancellation` capability. Only
the Change is mutable; parent Order reads support native eligibility and DTO
presentation. Creation, confirmation, Actions, finance, general metadata updates,
durable delayed compensation and public/hosted activation remain separate gates.

## Sources and native correction

Pinned Medusa 2.13.4 `48d5cc675e4e8bc821e22c20c88a751acc66fb5f` owns the
workflow, service guard, metadata preparation and module events. The
[Order foundation](./order-archive-foundation.md), accepted logical storage
design and atomic workflow host own installation, authority and settlement.
Original SQLite and ordinary-role PostgreSQL witnesses retain the upstream
failure: cancellation undo omits prior status, merges rather than restores
metadata, and can mutate the retained inverse object.

The approved native step now retains a detached cancellation preimage before
forward mutation and clones it for each inverse invocation. A named Order
`restoreOrderChangeCancellation` method updates existing rows through the native
internal service with `metadata: "replace"`. It restores status, canceled actor
and time, and metadata only when submitted to the forward workflow. It never
upserts, recreates a missing Change or applies the forward active-status guard.

The optional native DAL update option preserves ordinary merge behavior by
default. Explicit replacement skips metadata preparation and asks the Mikro
repository to assign metadata exactly; all other object fields retain their
ordinary assignment behavior. Drizzle already replaces JSON assignments. This
is an authorized fork correction, authenticated by exact source guards, rather
than an adapter copy of the merge algorithm.

## Profile behavior and authority

Input admits ID, optional canceled actor and optional JSON object/null metadata.
Native forward behavior preserves omission, clears null/empty objects in the
selected Drizzle mutation lane, shallow-merges nonempty metadata and interprets
empty-string patch values as deletion. The inverse restores the exact prior
JSON, including legitimate empty strings, removed keys and nested values.
Own `__proto__` properties remain outside the supported native assignment domain;
ordinary `constructor` and `prototype` business keys are admitted.

The profile uses native nullable statuses for preimage retrieval so terminal
Changes reach the genuine invalid-data guard. A successful retained inverse
admits only prior pending/requested status. Selected reads can observe a Change
whose parent is historical; the native default full-row lookup excludes that
parent and the mutation fails. Complete rows are checked before projection.
The portable DTO includes the required owning Order reference, following the
existing PostgreSQL presentation profile. It does not claim identical raw
SQLite/Drizzle presentation or Mikro dirty checking.

The logical profile captures `order.order-change.updated` for each actual Change
write; the root returns null and emits no workflow messages or hooks. Repeated
inverses retain exact business fields while managed
`updated_at` advances under ordinary write semantics. Replay returns the
checked committed result without repeating writes or events. The existing
queued workflow command owner serializes admitted methods through receipt
validation. No new SQL lifetime, queue, finalizer or raw database capability is
introduced; the trusted outer owner alone settles.

## Remaining gates

The native physical Mikro PostgreSQL witness restores the persisted Change but
records no update event for either cancellation or its inverse. Both native
methods place the event wrapper inside the transaction wrapper, before the
owning transaction flush. Their event ordering needs a separate native owner
correction and both-driver validation. Logical-profile event coverage does not
establish native physical event parity; the Decline correction does not change
these cancellation methods.

General Change metadata updates still use their ordinary native merge inverse
and remain unadmitted. This named cancellation restoration does not fix or
activate that separate workflow branch. Broader Order business workflows and
production activation require their own connected dependency and authority
profiles.
