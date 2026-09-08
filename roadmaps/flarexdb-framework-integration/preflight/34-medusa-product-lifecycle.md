# Product Lifecycle Milestone

## Status And Outcome

Preflight only; implementation is not admitted. This follows the completed
50-case Product mutation profile in records 32 and 33. Deliver all five remaining
lifecycle originals together, bringing the two-file inventory to **55 admitted,
one blocked scale case and one upstream performance skip** on both drivers.
Keep the original assertions and service behavior. The exact full identities
are the five `lifecycle` entries in `product-upstream-coverage-plan.json`.

| Original coverage | Capability |
| --- | --- |
| Cascade soft-delete event | Seven actual entity messages for a nested Product |
| Base-service delete events | Physical deletion of Product, tag, type, root category and collection |
| Soft-delete cascade | Product, variants, options, option values and images retain rows with managed deletion timestamps |
| Deleted-row filter | `withDeleted` and the original `deleted_at` comparison |
| Restore cascade | Reactivate the retained Product graph with correct relation visibility |

## Source And Existing Seams

Authority remains fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.
The unchanged `medusa-utils/src/modules-sdk/medusa-service.ts` delegates
softDelete/restore to the internal service and maps the returned cascade map to
linkable keys. Reuse that result path, event subscriber and message aggregator.
The internal service dispatches physical-delete events only for returned root
IDs; soft-delete/restore events come from lifecycle mutation callbacks.

The pinned Drizzle `medusa.ts` lines 684-810 and 1867 onward own the behavioral
reference for managed transitions, recursive DML cascade selection and visited
row identity. Product DML cascades to variants, options and images; option DML
cascades to values. Follow checked `cascadeDelete` relationships with owned FKs,
not every reachable relation. Shared tags, types, collections and categories
must survive Product lifecycle changes. Pivots and explicit variant-image rows
need their actual declared behavior, not a blanket recursive deletion rule.

Current Flarex seams deliberately refuse this capability: Product repository
`delete`, `softDelete` and `restore` are inert, normal query predicates always
exclude deleted rows, and ordinary core updates protect managed lifecycle
columns. Existing physical declared-key removal and bounded RETURNING kernels
are reusable; they do not authorize arbitrary writes to `deleted_at`.

## Proposed Shared-Core Contract

Add an explicit trusted local-table lifecycle permission for captured managed
soft-delete columns. Hash it into a new canonical compatibility contract while
preserving all existing declaration bytes. Add one operation-specific store
facade accepting declared keys and `softDelete` or `restore`; the core chooses
managed timestamps, scopes SQL and returns bounded actual changed-row evidence.
Do not expose arbitrary column updates or allow command data to select SQL.

Retain relational `update` facts for soft-delete/restore. Authenticate the
specific lifecycle transition with ephemeral operation evidence bound to table,
key, command and actual before/after deletion state. Local event validation
must use that evidence to distinguish deleted/restored messages from ordinary
updates. Do not persist a second fact table or accept an adapter-asserted event
as proof of a database transition. Ordinary physical deletes keep delete facts.

Preserve one transaction, complete facts/result/wake publication, all existing
limits and deadlines, and rollback after later cascade or publication failure.
If actual original costs exceed those bounds, report measured evidence before
changing an owner or increasing limits. Record 33 is not blanket authority for
future budget changes.

## Adapter Work In The Same Milestone

- Expose the five original root deletion methods and Product softDelete/restore
  through explicit commands. Reuse existing internal services and serializers.
- Build the bounded cascade from checked DML metadata and operation-local rows.
  Preserve root versus dependent event behavior; complete physical removal must
  record dependent and pivot facts even when the original service emits only a
  root event. Keep that event exception command/model specific.
- Add checked active/all-deleted visibility and the original timestamp filter.
  Propagate `withDeleted` through nested relation reads; count and page the same
  visible set. Caller flags never bypass scope or table authority.
- Preserve pinned restore behavior, including its root selection and cascade
  rules. Resolve already-deleted children, repeated soft delete, restore of an
  active row, and mixed states from the pinned implementation rather than
  assuming every lifecycle call is a no-op. Verify event actions against the
  unchanged subscriber's before/after interpretation.
- Prove active unique-index conflicts on restore, shared-reference survival,
  pivot retention and category root/sibling behavior. Use physical FK policies
  and the existing explicit removal guard; no invisible cascades or arbitrary
  category reparenting are included.

## Acceptance And Test Cost

Run all 55 originals once per driver at the final milestone checkpoint, plus
focused authored cases for complete cascade facts, exact event shapes, repeated
transitions, active/deleted nested reads, restore uniqueness rollback,
wrong-scope/foreign identities, replay, cancellation and late failure. Use one
installed fixture per driver/process and serial heavy setup. Keep pure metadata,
filter and event-policy cases outside database fixtures. Preserve Currency and
the existing 50 Product cases; run strict checks, source/hash/browser guards,
scoped lint and both standing reviewers before committing.

The 1000-image ordering case remains a separate scale preflight: its original
input exceeds current command row/fact limits and requires a measured complete
batching/transport contract. The original upstream performance skip remains.
Durable events/dispatch, query sync, workflow execution, OCC migration, stored
Module Links, public serving and other Product test files are outside this
lifecycle milestone.
