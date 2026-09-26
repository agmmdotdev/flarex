# Native PriceList creation on logical Pricing storage

Status: selected active override PriceList creation and calculation are implemented under the shared-storage completion goal. Broader PriceList CRUD and calculation parity remain gated.

## Connected outcome and owners

Admit native `PricingModuleService.createPriceLists` for a finite PriceList graph on the existing six-model logical Pricing source. Medusa owns PriceList normalization, rule construction, module events and override semantics. The generic graph writer and logical settlement own scoped rows, foreign keys, indexes, facts, rollback and replay. The selected atomic workflow creates a PriceSet and a PriceList in one outcome, then the native calculation reads the persisted list and its region rule.

The six-model source, calculated PriceSet query, exact numeric codec and shared transaction-time clock are already selected. The remaining gap was the PriceList repository's refusal of native creation. Reusing the existing graph capture and writer with a PriceList root avoids a second persistence path. A Medusa-specific table, raw SQL path or local adjustment to core limits would put storage authority in the adapter. No shared-core contract change is required for this finite graph.

## Contract and scope

The private Pricing command and repository contract now admits one active override list with one regional rule of at most two values and at most two prices. It refuses draft/sale lists, date windows and other rule shapes until their connected parity proofs. It authenticates the native PriceList, Price and PriceListRule created events against inserted logical rows. Unsupported shapes and unrelated PriceList methods remain refused. The public Medusa service method is unchanged; only the private selected command/workflow boundary broadens. There is no physical Pricing fallback or durable-data reset.

The connected witness covers native creation, one atomic PriceSet/PriceList workflow, replay, exact event set, a matching regional override, a rule mismatch or absent region returning the base price, and rollback on a duplicate list. Run it on PGlite and ordinary-role PostgreSQL, with typecheck, source guard, lint and both required read-only reviews. Remove any displaced refusal in this selected path in the same change.

The checked-in upstream SQL can retain a list price when no non-currency context is supplied, even if its list is inactive or has unmet rules; it can also bypass a price rule when an attached list has no rules. The selected logical row selector intentionally excludes those prices and requires the declared rule counts to match, including rejecting null counts as SQL does. The native service still owns final override/sale behavior, while eligibility must not price against an ineligible list. This is an intentional, bounded Medusa query-correctness divergence from the checked-in upstream query, not a new Flarex storage rule. The direct selector and connected missing-region witnesses guard it.

This does not claim arbitrary PriceList input, updates/deletes, PricePreference mutation, sale behavior, all date windows, pending calculation during a write or populated-source migration. Those retain the gates in [calculated Pricing](./48-calculated-pricing-query-cutover.md) and the completion plan.
