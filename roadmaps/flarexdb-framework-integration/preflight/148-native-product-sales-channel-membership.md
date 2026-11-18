# Native Product and Sales Channel membership preflight

Status: implemented as a private bounded finite atomic root. This root manages
membership of existing endpoint identities. The
earlier authored endpoint-creation milestone remains a separate consumer.

## Authority and complete dependency closure

Authority is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
`third_party/medusa/SOURCE.json`. Paths below are relative to
`third_party/medusa/upstream/`.

- `packages/core/core-flows/src/sales-channel/workflows/link-products-to-sales-channel.ts`
  owns `link-products-to-sales-channel`, maps optional raw Product IDs to Link
  definitions, and declares association before detachment.
- `packages/core/core-flows/src/sales-channel/steps/associate-products-with-channels.ts`
  calls the genuine Link create method and retains submitted definitions. Its
  inverse dismisses those definitions, including the empty retained array.
- `packages/core/core-flows/src/sales-channel/steps/detach-products-from-sales-channels.ts`
  calls genuine Link dismiss and retains submitted definitions. Its empty
  forward and inverse branches skip Link calls; its nonempty inverse creates
  the submitted definitions.
- The existing Product–Sales Channel Link definition, router, generated native
  service and repository own pair identity, upsert, tombstones and events.

The complete root needs only the existing selected Link family's create and
dismiss methods and internal module-event handling. It requires no Product or
Sales Channel read/mutation capability, Query, Pricing, Inventory, Region,
File, provider, Locking, external effect or new table. Native Link does not
validate endpoint existence or liveness; fixture endpoint construction is not
a runtime dependency or an added validation contract.

## Immutable native evidence and limitations

The external packet is
`%TEMP%/flarex-148-native-product-sales-channel-workflow-witness`.
Executed `run.postgres.v1.mjs` has SHA256
`126b01b5099cfca28bd3311e1cf455dfdc889dd0020a7ed9281f101e41d1c4c3`.
The full report is
`unchanged-native-product-sales-channel-postgres-runs/2026-10-19T17-25-18.795Z-10128/report.json`.
Its SHA256 is
`855af1074e62b2bb3c0a13282ef030cbeb6f87acc964c16b861ba4bf36163c72`.
All 32 artifact hashes/byte lengths and 96 owned-schema absence proofs hold;
the 292 source hashes and actual emitted-code hashes match the packet.
It preserves 32 actual native workflow cases, original SDK scheduling and
cancellation, original Link callbacks, default MikroORM and ordinary-role
PostgreSQL. Native errors and incomplete inverses are characterized outcomes,
not successful restoration claims.

The matrix covers omitted/empty arrays; singleton and four-add/four-remove
graphs; repeated attachment and tombstone ID replacement; duplicate raw input;
intersections; absent and genuinely historical endpoints; late-parent failure;
actual repeated scheduler cancellation; and protected unrelated membership.
Forward mixed calls are create then dismiss; inverse mixed calls are create
then dismiss. Module events remain batched per native call with actual IDs.

Cancellation is not a snapshot restore. Dismissing an absent/tombstoned pair can
create it during inverse execution. Associating an existing pair replaces its
Link ID; cancellation then dismisses that submitted pair. Duplicate additions
fail native batch upsert. Duplicate removals can succeed forward while their
retained inverse fails duplicate upsert. Added/removed intersections preserve
native call order and resulting tombstones. No deduplication, endpoint lookup,
preimage substitution or native compensation correction is selected.

The packet's `resolutions` arrays are incomplete instrumentation: native
orchestration copies the supplied container and installs its own resolver,
discarding the fixture's instance wrappers. They do not prove an absence of
resolution attempts. Original callback source, actual recorded Link router
calls, and the narrow root registrations establish the dependency closure;
the empty association inverse's actual `dismiss([])` is separately observed.
The recording event sink observes native emission, not durable delivery.
This packet proves neither Flarex parity nor restart, Redis, hosted activation
or scale.

## Private implementation and admission

The genuine root and detachment step use the accepted finite workflow recipe:
narrow leaf imports, explicit void WorkflowResponse and transaction-covered
compensation metadata. The association step's optional input typing changes
only its erased contract; both native guards remain intact. The existing
provenance guard freezes complete transformed callback bodies and public input
declarations while retaining original source hashes.

The existing Product–Sales Channel Link constructor binds its already owned
dismiss command to the workflow module using the same argument/result decoders
and detached-event policy. No second Link construction or lifecycle owner is
introduced. The new facade accepts one channel ID and zero to four raw add IDs
plus zero to four raw remove IDs. It preserves order and duplicates,
authenticates the installed Link module, grants only create/dismiss with graph
access off, and translates native void to the existing null result boundary.

PGlite and ordinary-role PostgreSQL cover the genuine callback results and
retained definitions, protected endpoint/unrelated membership data, native
events, capture/refusal, budgets, replay and uncertain-outcome recovery.
Barrier-controlled PostgreSQL contention retains overlapping default callbacks
and rejects the stale same-pair writer. No scope-exclusive profile is selected.
Cancellation after pending writes fences late completion; caught resource
refusals keep the root rollback-only.

Failed finite roots publish no staged rows, history, facts or events through
the existing atomic settlement owner. That guarantee is distinct from native
independently committed cancellation residuals. Executing genuine retained
callbacks under an active finite owner proves callback behavior, not admission
of a durable scheduler or external cancellation of a previously committed root.

The normal 64-call/64-event profile, byte limits and deadline remain unchanged.
No durable scheduler, delayed compensation, arbitrary endpoint set, Product
chunked file import, Product export or public/hosted activation is admitted.
