# Category/Currency Logical Composition Cutover

Status: selected mixed command and fixture use two logical sources. The
connected PGlite and ordinary-role PostgreSQL gates, cleanup and review are
complete; broader Product retirement remains separate work.

## Outcome and evidence

The private `createCategoryWithCurrency` command calls the pinned internal
Category service twice, writes Currency between those calls, then reads the
pending Category tree, sibling count and Currency. Its current mixed fixture
selects the generated physical Product profile while Currency already selects
shared logical storage. The three mixed atomic suites still install physical
Product tables and assert physical row/fact identities. The selected Product
definition, logical Category repository, shared graph reads and single-source
Category creation already execute in other witnesses. This is the nearest
connected two-framework proof and retires a real remaining physical Product
consumer without changing native service behavior.

Select the existing Product logical source in the mixed atomic fixture and
authenticate the exact ordered Category/Currency transcript. The Product
participant owns only its framework calls and Category row/event receipt; core
continues to own source confinement, the transaction, logical row/index/unique
maintenance, one outcome/publication, rollback and uncertain settlement.
Internal Category service calls emit no module events. The logical receipt must
prove their root IDs, parent relationship and bounded row attempts without
admitting an unrelated Category or Product mutation. Reads must be mutation-
and event-free. Pending tree and graph reads must use the same logical source.

## Breaking changes, alternatives and cleanup

The private fixture and selected atomic participant preparation break from
`CommerceProfile` and installation references to the already admitted logical
Product source. No public Medusa DTO, event, durable logical row identity or
Application/Payload contract changes. Do not retain a parallel physical
Category/Currency fixture as a fallback. Migrate the three suites' shared
behavioral assertions to logical rows/facts. Physical installation-history,
binding-removal and physical statement-budget checks are platform-specific;
move them to their core owner only if their distinct durable obligation is not
already covered, with an explicit removal gate. Retain the separate physical
Product compatibility runner for its named unported native methods, not for
this command.

Reusing the physical mixed host would leave a generated-table consumer in the
cutover path. Duplicating the Category service or issuing adapter SQL would
split behavior and authority. A test-only second logical Category algorithm
would not prove the pinned service. Reuse its existing logical repository and
correct the shared owner if a reproducible indexed selection, rollback or
readiness gap appears.

## Completion gate

Prove exact parent/child values, pending tree and Category/Currency graph reads,
single commit and no physical Product table creation; replay, cancellation,
rollback-only failures, publication-stage rollback, source confinement and
ordinary-role PostgreSQL contention/recovery on PGlite and PostgreSQL where
applicable. Preserve the original suite's distinct boundary assertions or
record their core-owned replacement before deleting them. Verify source guard,
typechecks, lint and both required read-only reviews, then remove displaced
fixture imports and setup in one scoped commit. This does not grant general
Product or Category serving readiness, unbounded tree population or hot-shop
performance.

## Selected result

The mixed command keeps the pinned internal Category service and native
Currency command. Both participants now enter as logical sources under the
same atomic root. Category creates carry a private ordered attempt receipt
because those internal calls emit no module event. The three mixed suites
inspect committed logical rows and Category projections, including pending
tree reads, graph reads, rollback, replay and PostgreSQL recovery. The physical
Product installation/binding setup is removed from this fixture.

The obsolete mixed physical statement-budget assertion is covered by the
shared physical command-budget test in
`packages/persistence-postgres/test/frameworks/commerceTransaction/commerceAdmittedWrites.test.ts`.
The physical fact/binding-removal witness moved to the shared installation
test in `packages/persistence-postgres/test/frameworks/atomicCommerce/atomicCommerceSharedInstallation.test.ts`.
Its durable obligation belongs to physical installation history, not to the
logical Category/Currency command. The separate physical Product runner remains
for its named unported methods. This selected composition is bounded and does
not establish full Product serving readiness or broad scalability.
