# ShippingProfile Workflow Resource Admission

Status: approved and implemented for the private connected ShippingProfile
workflow. Four fresh named profiles and their trusted root select 128 calls;
existing default profiles retain 64 calls and their canonical identities.

## Reproducible boundary and owner

The connected `productShippingProfileWorkflow` creates one ShippingProfile, one
Sales Channel and one to four simple Products, associates both Link families,
then reads five pending scalar roots before one settlement. Both the minimum
one-Product input and the four-Product input reach `limitExceeded`, surfaced as
`rollbackOnly`, on PGlite and ordinary-role PostgreSQL.

The minimum input reaches both native Link writes and the Product and Sales
Channel reads. It exhausts the 64-call contract on entry 65, during the first
storage read for `productSalesChannelLinkCount`. The ShippingProfile and shipping
Link pending reads have not run. The request is therefore not rescued by merely
lowering the Product count. The separate rollback witness requires unchanged
data, commits, facts, events and deliveries; success assertions remain required.

`commerceTransaction/model.ts` owns the default 64 calls.
`boundedRequestLifetime.ts` enforces that shared request budget and latches the
first failure. `atomicCommerce/configuration.ts` caps the trusted root's
`requestCallLimit` by every participant's resource contract. Workflow captures,
participant entries, borrowed native operations, events and storage operations
consume the same budget. This evidence establishes an admission mismatch, not a
defect in the existing limit enforcement or the completed installer.

## Recommended direction

Admit an explicit bounded resource contract for this private connected workflow,
using the existing trusted profile registration and root-selection APIs. Use
128 calls as the approved ceiling, with the one-to-four Product
input contract retained. Keep all other byte, row, fact, event, time and SQL
budgets unchanged. A successful run under 128 alone is insufficient: account for
the complete maximum envelope and its required failure/recovery paths.

The resources belong to the named installed Product, Sales Channel, ShippingProfile
and two-Link profile selection, plus the trusted atomic root. Construction must
bind their agreement; business input must not select a budget. The existing
participant minimum remains authoritative. Opaque capabilities, borrowed
lifetimes, rollback-only behavior and the single settlement owner remain intact.

This changes private profile/policy identities under the explicit approval of
this record, beyond preflight 66's prohibition on raised limits. Use fresh selected
profiles and their normal binding admission. It is not an installed-schema
migration, default-resource change, public API, production route or general
Fulfillment activation. No persistence or workflow-engine correction is currently
justified by the witness; a newly demonstrated shared-owner defect retains the
repository's separate correction gate.

## Alternatives and cleanup

- **Retain:** existing default profiles, canonical identities, 64-call enforcement,
  independent ProductSalesChannel proof, all native steps and all five pending
  reads. Existing callers have no demonstrated migration requirement.
- **Extend:** the named ShippingProfile workflow's trusted installation and
  execution selection through existing resource contracts, with a coherent small
  construction API and exact identity/replay evidence.
- **Reject:** raising a test-only/root-only limit, changing global defaults,
  suppressing call accounting, removing validation or pending reads, splitting
  commits, or claiming that a smaller Product count clears the observed boundary.
- **Delete after resolution:** temporary call-attribution instrumentation. Retain
  the 64-call refusal witness as a default-profile isolation regression and keep
  successful connected acceptance separate.

## Completion gates

1. Trace complete call use through native steps, captures, participant events and
   five pending reads for one and four Products. Preserve the failure at 64 and
   verify every profile cap and root selection, including mismatches.
2. Verify the approved ceiling without changing other budgets. If 128 is
   insufficient, stop with the measured boundary; do not silently increase it.
3. Prove new private identity/revision refusal and exact replay, single commit,
   atomic late/caught failure, cancellation, escaped-resource refusal, subscriber
   failure and uncertain settlement. Native PostgreSQL evidence must use actual
   restricted roles and distinguish host serialization from physical contention.
4. Complete preflight 66's native construction, source/browser closure, retained
   compatibility tests, both Link families, lifecycle and connected gates. Run
   unchanged ProductSalesChannel and other affected shared-owner regressions.
5. Complete affected typechecks/builds, provenance guards, core/diff/staged lint,
   both project reviews and scoped cleanup. Reconcile current roadmaps and commit
   only when the whole approved slice passes. Exact logs belong in artifacts and
   Git rather than this roadmap.

## Retained implementation

`prepareProductShippingProfile` prepares the fresh selected schema and the four
named profiles from one shared resource declaration. The named workflow facade
selects the same root ceiling. Business input cannot choose resources; existing
atomic configuration still validates the root limit and caps it by every
participant. A default-profile substitution changes identity and retains its
64-call refusal, including when all other participants admit the larger ceiling.

The complete one-to-four Product envelope retains native creation, both Link
families, all five pending roots, event capture and final output capture. The
maximum batch also exercises generated IDs, late failure, output rejection,
cancellation, uncertain settlement and subscriber failure. Full call attribution
and exact driver results remain validation artifacts. No instrumentation,
default-limit change, adapter bypass or new settlement path is retained in the
runtime. The private construction and refusal surfaces remain those in record 66.
