# Full Pricing source cutover

Status: selected-source cutover implemented under the standing shared-storage
completion goal. The complete Pricing source serves the existing native
PriceSet consumer; calculated Pricing remains the next service gate.

## Outcome and owner

The pinned Pricing manifest has six models. The shared JSON containment family
now admits its `PriceListRule.value` index, but the composer and the native
PriceSet host still select a four-table subset. Select the complete pinned
definition at the schema composer and Pricing host, retain the existing native
PriceSet create/read/workflow behavior, and retire the base-only compiler,
source key and fixture path. The source key becomes `medusa.pricing` with write
profile `medusa.pricing`; its relational table identities keep the existing
`commerce.pricing/<table>` spelling. Pricing business behavior stays with the
pinned service, and shared storage continues to own admission, indexes,
transaction settlement, publication and recovery.

This is a breaking source contract for a previously prepared four-table
candidate. The repository's affected hosts are disposable development
fixtures. No named database is reset or modified by this cutover. A populated
four-table installation cannot be reinterpreted as the new six-table source;
activation must refuse until the separately gated structural conversion or
explicit reset decision is made. The retained committed data remains intact.

## Why now and alternatives

The full schema is already normalized and exercised through a generic
PriceListRule write/query witness on both database drivers. Keeping two
Pricing source contracts after this point makes the native calculated-price
implementation target the wrong selected schema. A dual source or alias would
hide the ownership transition, and adding PriceListRule only to a test-local
candidate would leave the native consumer on the obsolete subset.

## Completion gates

1. The composer, Pricing metadata capture, native host and affected workflow
   fixtures select one complete pinned source. Remove the base-only compiler,
   key and test assertions; do not introduce a compatibility alias.
2. Run the unchanged native PriceSet creation, nested price/rule reads,
   workflow/Link path, replay, rollback and no-module-table evidence against
   the six-table candidate on PGlite and ordinary-role PostgreSQL. Keep
   PriceList and calculated-price methods refused until native contracts land.
3. Verify source/provenance guards, affected typechecks, lint and both required
   read-only reviews. Commit the coherent cutover and record the remaining
   calculated Pricing and populated-source migration gates.

## Connected readiness witness correction

The broader schema-composition witness exposed a retained Currency fixture
that wrote raw row revisions before search coverage was prepared. That fixture
must prepare the complete source's empty search coverage before synthetic
writes and call the shared search maintenance owner in the same transaction as
each raw revision. Its later logical materialization must carry the same
prepared search definitions. The core maintenance input should express only
the row identity and document it reads, without requiring an Application point
commit command. The Product foreign-key witness must check bounded and complete
replacement pages against the current core limit, not the retired fixed
14-row split. Validate both witnesses on PGlite and ordinary-role PostgreSQL.
