# Native Shipping Profile Deletion Workflow

## Status And Authority

Status: implemented within the bounded private Shipping Profile deletion profile.
Authority is the accepted architecture, Medusa adoption roadmap and pinned Medusa
2.13.4 fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.
The native root is `shipping-profile/workflows/delete-shipping-profile.ts` in
core-flows; its singular export is `deleteShippingProfileWorkflow`.

## Mandatory Native Closure

The root first runs Query on `product_shipping_profile`, selecting `product_id`
and `shipping_profile_id` for the raw requested profile IDs. The pure native
validation rejects any active matching Link before resolving Fulfillment.
Its existing error says shipping profiles but lists Product IDs, in native order;
endpoint hydration is not part of this check.

The genuine `deleteShippingProfilesStep` then calls `softDeleteShippingProfiles`.
Its Fulfillment override always lists active profiles with
`relations: ["shipping_options.id"]` and rejects associated active Options.
The pinned DAL receives no explicit fields and returns complete scalar Profile
and Option bodies; the nested `id` suffix does not project child rows.
Deleted Options do not block. Active Options on already-deleted profiles are
excluded by the native active-root selection.

Finally the genuine `removeRemoteLinkStep` calls Link.delete with
`fulfillment.shipping_profile_id`. All three resource paths remain present for
empty IDs; only the native Link router skips service dispatch for an empty
endpoint array. There is no provider invocation, remote effect, hook, child
workflow, pause or native Locking dependency.

## Schema And Authority

Deletion requires an explicit fresh six-table Fulfillment schema: shipping_profile,
shipping_option, service_zone, fulfillment_set, shipping_option_type and
fulfillment_provider. These are the complete native ShippingOption FK target
closure. Preserve all five FKs, native indexes, columns and relationship metadata.
The existing scalar Shipping Profile schema remains unchanged. This composition
does not implement a populated installation upgrade or authorize durable resets;
advanced schema evolution retains its separate gate.

Reuse the genuine twelve-model constructor and shared metadata-derived row
decoders, relation population, lifecycle and receipt owners. Only Profile
softDelete/restore and the exact internal Option validation read are admitted.
Sibling repositories, Option writes and provider operations remain denied.
ShippingProfile has no cascade-delete children; no Options, FK parents, Product
endpoints or other Link families are changed by its lifecycle.

Query and Link select the real installed ProductShippingProfile service through
its native joiner identity. A separate shipping-profile-deletions Link profile
admits grouped endpoint deletion/restoration and complete historical cohorts.
Router errors-as-data must refuse before the common step observes success.
No ProductSalesChannel resource or fake empty Link service substitutes for this
mandatory closure. Fixture Option/FK-parent rows are canonical initial state;
they do not establish native ShippingOption create/provider support.

## Native Inverses And Finite Admission

The Profile inverse retains raw IDs and restores all selected historical roots,
including previously deleted rows. It skips absent/empty IDs before Fulfillment
resolution. Restore does not rerun the deletion Option guard and can fail active
name uniqueness. Missing IDs remain absent; already-active restore follows the
native timestamp/event behavior.

Link inverse always restores the retained grouped endpoint selector, including
empty arrays. It may restore old Link tombstones that forward deletion did not
change. Native compensation invokes Link inverse before Profile inverse; retain
and prove this order and the actual shared reference behavior. Exact failed-root
rollback is separate from these broad retained native inverses. Persisted or
external saga undo is not claimed.

Admit zero to four raw Profile IDs, preserving duplicates/missing/deleted IDs,
and at most four historical roots. Bound the complete active Query cohort and
matching Link history to eight rows, and active Options across selected active
profiles to eight. Refuse excess sets before mutation without truncation.
The complete maximum graph and retained historical Link roundtrip use the
default optimistic atomic profile and unchanged 64-call/event allowances.

## Executed Read Evidence And Remaining Scope

The adversarial empty-selector witness exposed a shared call-evidence gap:
observed rows alone cannot distinguish the requested empty selection from a
native repository call redirected to a different empty selector. Expected:
successful Query proves the requested complete active Link cohort. Actual:
an observation-only receipt could accept an unrelated empty read and bypass the
native Product-link blocker. The shared-owner correction authenticates actual
successful selections, including empty reads.

The [shared correction](../../shared-logical-storage/64-executed-relational-read-evidence.md)
belongs to logical working-set activity and its commerce
projection: retain inert evidence of actual successful relational selections,
including empty results, original admitted query, total and returned count,
with per-call cursor/source isolation. The adapter authenticates its exact
query through the existing repository planner and retains full-row/output
receipts. No second query, SQL enforcement, capability grant or durable schema
change substitutes for this proof. Neutral owner and existing consumer
regressions retain their separate contracts.

The same execution proof is required for the retained Link lifecycle. An empty
result and empty row observations cannot establish that the broad historical
selector ran. Expected: historical matching Links are selected and restored, or
the inverse refuses before Profile restoration. An observation-only lifecycle
receipt could accept a skipped or redirected empty restore. The shared Link
lifecycle planner/receipt authenticates the actual complete selection for
both Shipping Profile and its existing Inventory Item consumer, without adding
queries or changing native selector, event or compensation order.

Prove four real roots, eight historical Links, native forward and retained
inverse order, exact Product-link/Option blocker precedence and error messages,
real full Option hydration, deleted/missing/raw/empty behavior, lifecycle maps,
timestamps/events, restore uniqueness, unaffected neighbors, exact rollback,
forged observations/results/events, sibling denial, cancellation/revocation,
replay and scope isolation. Preserve complete failure Causes.

Validate PGlite and ordinary-role PostgreSQL separately, including genuine
optimistic competitors for deletion and endpoint insertion, without claiming
pre-callback exclusion. Regress affected Shipping Profile creation/update and
Product/Link workflows. Require native source/emitted-program/type guards,
affected types/builds, browser portability, lint and both read-only reviews.
Wider Fulfillment/provider execution, physical deletion, hosted activation,
populated schema evolution, chunked File import and Product export remain
separately scoped or deferred.
