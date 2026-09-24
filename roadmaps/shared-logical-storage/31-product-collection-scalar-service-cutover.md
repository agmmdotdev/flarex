# Native Collection scalar service cutover

Status: selected native scalar Collection service commands and reads run on
generic Product storage. Membership-bearing commands remain outside this
selected host and the full Product compatibility runner remains physical.

## Outcome and ownership

Select the existing native ProductCollection service for scalar create, update,
mixed create/update upsert, indexed and bounded list/count/retrieve, and hard
delete on the generic Product source. Preserve native service normalization,
unique handle claims, DTOs and module events. The Collection delete keeps the
core-owned nullable Product-reference transition introduced in the prior slice.

The pinned `ProductModuleService` delegates create/update/upsert to
`productCollectionService_.upsertWithReplace`, and `product_ids` additionally
replaces Product memberships. This slice admits the scalar form only. A
Collection command that changes Product rows must fail event or receipt
admission in this selected host; the full physical Product compatibility runner
remains the named consumer for its original membership behavior until a
connected logical replacement preserves all of its cases. The selected native Collection
membership workflow already has a separate logical path.

## Design challenge and breaking contract

The existing root-only Collection create validator does not cover mixed upsert
create/update events. Add a Collection-specific logical upsert validator at the
Medusa event boundary. It must authenticate one native write call, exact
Collection row insert/update attempts, and matching created/updated messages;
other tables, lifecycle observations or sealed transition intents refuse. Do
not broaden the generic core transaction contract or accept adapter-supplied
Product changes as a shortcut.

This selects a new private logical host path for existing native commands;
public Medusa method signatures and durable row format do not change. The
private test host's admitted event policy is intentionally narrower than the
full physical runner. No physical Product table is removed while that named
runner still exercises `product_ids` and other unported methods. The future
complete runner cutover must replace and retire its physical profile, fixture
and installer with an explicit durable-data disposition.

## Connected proof and completion gate

Exercise native create, update, mixed upsert and reads against installed shared
Product definitions on PGlite and ordinary-role PostgreSQL. Check selective
handle/ID reads, bounded page/count, root event receipts, exact shared row and
fact changes, rollback on a late invalid batch member, replay, active-handle
uniqueness, two-shop confinement and deletion with a Product reference. A
`product_ids` field, including an empty list, must refuse without publication
in the scalar host.
Keep work beyond declared query and command budgets atomic and explicit.
