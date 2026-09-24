# Native SalesChannel Runner Cutover

Status: implemented under the approved shared-storage completion goal. The
Product–ShippingProfile router was the remaining named physical SalesChannel
consumer.

## Preflight And Decision

The selected SalesChannel commands and the Product/SalesChannel/Link workflow
already execute through shared logical storage. The promoted fourteen-case
native service suite still installed a separate Product+SalesChannel physical
schema only for its test runner. That installation generated fourteen endpoint
tables and could make compatibility appear to depend on per-deployment DDL.
The pinned SalesChannel model and promoted service tests are the behavior and
source evidence; the generated fixture is not a durable compatibility format.

Move the runner's six selected native operations to the existing admitted
SalesChannel logical source. Each write uses its own shared atomic owner, with
exact native event/row receipts; reads borrow the selected logical source.
Retain the original native tests, their case count and source guard. Remove the
standalone physical schema/profile functions and obsolete schema-only test.
The Product–ShippingProfile composed workflow remains a named physical consumer
until its two-link cutover; no named durable environment is reset or converted.

The native disabled-channel case exposed a shared relational-query gap: boolean
equality was rejected before its row predicate ran. The core reader now accepts
exact boolean membership while preserving the existing bounded complete-set
selection. This is correct for bounded selected work, but `is_disabled` alone
has no selective index and must not be claimed scalable across a large shop.
The selective-query package must either build a shared boolean access path or
establish a justified bound before broad activation. Do not add a Medusa SQL
shortcut or silently return incomplete pages.

## Completion Gate

Typecheck core and adapter; run core relational-query and promoted native
SalesChannel tests on PGlite and ordinary-role PostgreSQL, together with the
source guard and scoped lint. Review the final behavior/core change with both
read-only reviewers. Commit only after cleanup, exact staged checks and green
two-driver results. General ShippingProfile integration, advanced evolution,
public developer APIs and hosted activation remain outside this slice.
