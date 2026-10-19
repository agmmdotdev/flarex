# Native Shipping Option physical reference detachment

Status: implemented. The selected private fresh
twelve-table profile preserves the unchanged default native PostgreSQL physical
Option/Zone/Set deletion and retained inverses. Direct Option behavior also
agrees with Drizzle. The observed Drizzle parent-cascade refusal remains a
separate comparison limit; no Drizzle-cascade parity is claimed.
Public/hosted activation and populated source upgrades remain unadmitted.

## Native outcome and evidence

Authority remains Medusa 2.13.4, pinned revision
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The preceding
[Fulfillment creation preflight](./141-native-fulfillment-creation.md) records
six unchanged-native direct Option deletion cases. Both backends physically
delete the selected Option, clear dependent `Fulfillment.shipping_option_id`,
preserve all Fulfillment timestamps and deletion state, and emit only the
Option deletion event. Unrelated graphs remain intact. PostgreSQL uses its
native `SET NULL` constraint; Drizzle's `detachDeletedRelations` supplies the
same direct-root behavior independently of SQLite's `NO ACTION` FK.

The additional unchanged-native cascade matrix contains eight cases per
backend: Zone/Set deletion with active Fulfillment, historical Fulfillment,
historical Option, and an unlinked control. PostgreSQL succeeds in all eight;
Drizzle rejects all six linked cases with `FOREIGN KEY constraint failed` and
rolls back, while its two unlinked controls succeed. Successful linked cases
clear only the target Fulfillment FK, preserve timestamps and all other source
fields, remove the native target cascade, protect the separate unrelated graph,
and emit exactly one root deletion event. Rejections change no rows or events.
Direct Option agreement therefore does not prove Set/Zone cascade agreement.

The external packet is
`%TEMP%/flarex-141-native-fulfillment-create-witness`. Full cascade indices:

- `unchanged-native-cascade-foreign-keys-postgres-v2-runs/2026-10-18T17-58-02.223Z-3868/report.json`
- `unchanged-native-cascade-foreign-keys-drizzle-v2-runs/2026-10-18T17-58-02.229Z-14688/report.json`

All sixteen artifact hashes were checked and owned fixtures cleaned. Native
DTOs, raw rows, errors, events and constraints are retained. The PostgreSQL
forward logger records transaction boundaries and snapshot SQL but omits the
ORM mutation statements; the actual catalog, observed rows and pinned native
repository source establish its behavior. Do not claim a captured DELETE SQL
trace where none exists.

The original v1 cascade runners failed bootstrap by assuming a public
`softDeleteFulfillments` method. Their immutable reports are harness failures,
not business outcomes. The genuine module intentionally excludes Fulfillment
from generated public methods. V2 arranges source history through the actual
injected `fulfillmentService` singleton's native `softDelete`, verifies its
identity against `fulfillmentService_`, and checks the stored history/FK before
executing the unchanged target method. No replacement public method, SQL repair
or lifecycle shim is used.

## Owner gap and selected correction

The preserved portable witness executes the genuine Option forward root,
captures its actual retained callback inputs, commits a genuine Fulfillment
referencing the returned Option, then invokes the real Link/Pricing/Option
inverse callbacks. Both Flarex database lanes reach the positive stored-source
assertion and refuse the inverse at final incoming-reference validation
(`invalidInput`, from internal `documentInvalid`). Expected native behavior is
successful deletion with the surviving FK null and unchanged source timestamps.
This is the shared relation-transition gap, not a malformed native payload or
test bootstrap failure. The witness lives in
`logical-shipping-option-reference-detachment.test.ts`; its original failing
logs remain outside the repository under the 142 baseline packet names.

The shared Medusa physical lifecycle traverses cascade FKs and its physical
receipt authenticates that delete closure. It lacks native metadata-derived
nullable reference detachment. The selected Option participant must explicitly
admit the fresh twelve-table source and exact Fulfillment detachment; installing
twelve tables alone grants no additional mutation capability. Existing named
eight-table consumers retain their selection.

The existing core `planSetNull` is a terminal settlement plan. It already
supports committed historical sources and preserved timestamps, but deliberately
refuses pending/borrowed source changes and subsequent operations. Those guards
are valid for existing Product and Shipping Profile consumers. Relaxing them
does not supply an operation-visible native transition.

Add a separate eager nullable-reference operation at the borrowed logical
working-set owner. It authenticates an actual current pending target deletion
and a participant-admitted scalar nullable FK, selects the complete indexed
source cohort including its current overlay, and records exact FK-to-null
patches through existing row normalization with managed updates preserved.
Use the existing manager, identity, lifetime, selection/resource accounting,
attempts, settlement, indexes, history and facts. No SQL handle, extra
transaction, timestamp patch capability or deferred publication stream is
introduced. Existing terminal set-null modes remain unchanged.

Require deletion and detachment within one native outer module call for this
first profile. Record causal evidence from each patch to the real target delete
attempt, and rebase that reference with call-local attempt ordinals. Validate
the exact FK-only delta and genuine deletion, rather than requiring final target
absence: later compensation may recreate the target ID without relinking the
already detached source. Later native reads, cancellation, repointing and
ordinary source updates must observe the eager transition.

The shared Medusa lifecycle derives the admitted edge from checked native
non-cascading `hasMany` metadata; generic nullable `NO ACTION` FKs alone do not
authorize native cleanup. Its physical receipt correlates the complete source
selection, exact preserved preimages/deltas, target deletion and native root-only
events. The module exposes no arbitrary Fulfillment update/create/cancel grant
through this physical-delete profile.

Genuine same-root create/cancel plus retained Option inversion additionally
requires one explicitly named combined native preparation. It reuses the same
`defineFulfillmentPersistenceModule` constructor, prepared Option/Fulfillment
repositories and authenticated call receipts. Every repository borrows the same
existing `commerceRepositoryContext` bridge and mutation-event owner; two
independent bridges would reject one another's native manager tokens. Exact
combined method admission belongs to that preparation. Standalone physical
profiles retain their smaller callable set. Alias-based container routing or
two separately constructed services do not establish this native composition.

## Implemented scope and acceptance boundary

1. Preserve a failing portable direct-Option retained-inverse witness with a
   real Fulfillment reference. Demonstrate the terminal-plan pending-source and
   later-read restrictions independently of the adapter.
2. Implement the neutral identity-bound eager operation and causal receipt
   evidence at core. Keep independent durable execution explicitly unadmitted
   until its journal/lifetime proof exists.
3. Extend the shared Medusa lifecycle/physical receipt and explicitly named
   twelve-table Option/Zone/Set participants. Reuse their actual native creation
   inverses; preserve current forward behavior, existing limits and complete
   bounded selections. Existing named eight-table participants retain their
   selection. This new profile follows the default PostgreSQL native outcome;
   comparison-only Drizzle refusal is retained without modifying its backend.
   Overflow refuses the whole root rather than truncating dependents.
4. Validate active and historical sources, pending insert/patch/repoint/delete,
   born/deleted and later-recreated targets, later native read/cancel/update,
   unrelated graphs, timestamps, facts and event order. Reject forged/missing
   causal evidence, wrong participants/FKs, incomplete cohorts, scope/lifetime
   escape and resource overflow. Exercise late failure, caught refusal and replay.
5. Run neutral owner and actual Option/Zone/Set retained-inverse witnesses
   separately on PGlite and ordinary-role PostgreSQL. Regress Product advance and Shipping
   Profile preserve terminal modes, their negative boundaries, existing physical
   graph receipts, Option profiles and Fulfillment creation/cancellation. Finish
   affected types/builds, provenance, portability, lint and both required reviews,
   then commit the complete scoped outcome.

No native module business body or Drizzle cascade algorithm is changed. The
named profile's default-PostgreSQL baseline follows the existing comparison
boundary in 141 and keeps original comparison outcomes visible. This is a
shared-owner correction under the user's existing core-change authorization,
not an attempt to establish universal backend semantics. Chunked Product file
import and Product export remain deferred.

The named Option, Zone and Set preparations admit the eager operation while
existing eight-table preparations retain their original identity and method
surface. The combined Option/Fulfillment preparation shares one native module,
manager bridge, Promise owner and event owner, and delegates DTO conversion to
the existing model serializers. Physical receipts distinguish mutation
preimages from final observed rows and authenticate each surviving source
against its exact causal FK-only patch.

The core operation uses the existing insertion-order evidence issuer and
ordinary row, index, history and fact publication. Its identity-bound profile
requires the target delete and detachment within the same call, authenticates
both operation ordinals, and retains that evidence across call rebasing. Later
target recreation does not reattach a source. Independently durable borrowing
does not admit this operation. Existing terminal set-null policies and all
other resource profiles retain their contracts.
