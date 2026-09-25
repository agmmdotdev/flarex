# Pricing Physical Fixture Retirement

Status: selected cutover implemented under the shared-storage completion goal.

## Decision And Scope

The selected native base-price command and reads already execute on the
joint logical Pricing source, including nested exact amounts and native event
publication. The two remaining physical Pricing suites are the only callers
of `prepareProductVariantPricing`. Move their unchanged native test bodies and
focused admission/rollback checks to that source, then delete the generated
18-table artifact/profile builder and its test-only installation path. Keep
the Link definition compiler and shared workflow resource budget used by the
logical Product/Variant/Pricing workflow.

This retires a private development fixture contract, not a durable data
format. No named physical Pricing environment is reset or converted. The
full six-model Pricing source, calculated-price query, and advanced evolution
remain behind their existing gates; this slice does not grant those operations.

## Proof And Completion Gates

Use the pinned native Pricing seed and three unchanged test bodies. Preserve
the focused scalar/array/empty shape, exact numeric pairs, normalized prices,
count projection, refused fields and unsupported calculator rollback. Check
logical rows, indexes, outcomes and events for no durable work on refusal,
and compare committed native events with the selected command's inserts. The
connected logical Product/Variant/Pricing workflow also proves that a caught
unselected `createPriceLists` call fails the root without durable changes.
Exercise PGlite and ordinary-role PostgreSQL, typechecks, source guards,
lint and both read-only reviews. Remove the obsolete builder, imports and
stale physical-fixture claims in the same commit. The broader Product runner
and other physical consumers retain their own named cutover gates.
