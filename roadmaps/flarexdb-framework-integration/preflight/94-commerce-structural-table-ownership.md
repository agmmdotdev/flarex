# Commerce structural-table ownership

Status: complete; shared correction implemented.
This is the structural-ownership prerequisite for preflight 93B.

## Outcome and boundary

Permit a private commerce profile to own an explicitly selected structural table
for FK-closure validation without acquiring any command-level row capability.
Pricing can then own the PriceList dependency alongside PriceSet, Price and
PriceRule while PriceList reads, writes, lifecycle and service methods remain
unadmitted. Product, Pricing and Link retain separate profiles and one trusted
outer settlement. The eighteen-table installation and 128-call limits from
preflight 93 remain unchanged.

Owners are the source-private commerce profile issuer and framework commerce
binding validator in persistence-postgres. The Medusa adapter only declares the
actual native dependency. This does not admit cross-profile FKs, a grant union,
PriceList business operations, schema upgrades, public routing or production use.

## Reproduced scenario and correction

Preflight 93 requires PriceList to remain structural-only with no granted writes.
The pinned Price model declares a nullable `price_list_id` FK to PriceList. The
schema therefore contains all four Pricing tables, but the three workflow
profiles grant Product's thirteen tables, three writable Pricing tables and the
Variant-PriceSet Link respectively.

The previous `validateCommerceProfileSet` in
`frameworkSchema/binding/commerceBinding.ts` built its ownership map solely from
`descriptor.tables`. For the Price-to-PriceList FK,
the source has a Pricing owner and the target has none; the validator rejects the
binding with `DataBindingError`, reason `unsupportedProfile`, before activation.
The connected witness is
`packages/medusa-adapter/test/product-variant-pricing-workflow.test.ts`.

`commerceTransaction/profile.ts` retains its `scalar`, `readInsert` and
`readInsertUpdate` data capabilities. The local issuer now captures a separate
structural-table identity selection; only a nonempty selection uses profile
contract encoding 7. Empty and omitted selections retain existing encodings.
`registerCommerceSchemaProfile` remains an installation token, not a member of
an execution-profile binding.

The connected acceptance test retains its successful-workflow expectation.
Structural selection participates in authenticated ownership and complete FK
closure, while store construction still uses data capabilities alone. Pricing's
connected acceptance and native-test admission remain preflight 93B gates.

## Recommended correction

Extend the existing private local profile construction with an optional explicit
set of schema-only table identities. Capture it into the authenticated profile
descriptor and contract digest separately from data capabilities. These tables
must exist in the exact captured layout; reject duplicates, overlap with data
capabilities, wrong artifacts, forged descriptors and conflicting ownership.
Keep the existing bounded table budget across data and structural selections.
Require at least one data capability; this proposal adds no data-free execution
profile. Treat an omitted or empty structural selection as the existing contract
without introducing a second identity for the same old capability set.

The binding validator should compute ownership from both explicit selections,
then apply its existing FK-confinement rule. An FK may not cross owners, and an
undeclared dependency must still fail. A schema-only selection must not enter
the scoped store's table-capability lookup, authorize a seed, or permit read,
insert, update, delete, restore, upsert, observation or publication.

The current validator returns early for a singleton profile. For a new profile
with a nonempty structural selection, validate its complete declared FK closure
at issuance as well as ownership conflicts at binding. A structural FK chain
must not leave that owner, including singleton use. Preserve legacy singleton
behavior for old contract forms rather than silently changing supported profiles.

Zero access means no command-level row capability. Existing trusted constraint
checks may still inspect layout dependencies: the scoped store's reverse-FK
probe refuses unobserved cascades and must remain active. A delete of an admitted
parent with existing schema-only dependent rows must fail without changed data
or facts. No new cascade engine or store grant is needed for that check.

Only profiles using the new declaration receive a new canonical contract form.
Keep all existing profile bytes/digests and old request/profile mismatch checks
unchanged. Declare PriceList through the new explicit construction seam and
resume preflight 93B's existing implementation and acceptance gates.

## Alternatives challenged

- Granting PriceList `readInsert` violates the approved capability boundary even
  if the current adapter happens to refuse its service methods.
- Ignoring every unowned FK target weakens binding validation implicitly and
  conceals missing dependency ownership.
- Removing the native FK, creating another installation, or merging all module
  grants changes the approved schema or transaction contract.
- Passing an installation-only token as an execution member confuses the
  existing nominal authority families.

An explicit zero-access ownership declaration preserves the current separation
between schema presence, profile ownership and row capabilities.

## Validation, compatibility and cleanup

Use a neutral parent/child/independent-table fixture before the Pricing consumer.
Prove explicit structural ownership succeeds; undeclared targets, duplicate or
cross-profile ownership, malformed identities and FK chains leaving the owner
fail. Attempt every row capability against the schema-only table and verify zero
facts/events or durable data changes, including caught failures and escaped
handles. Check binding preparation, activation, restart/restoration, revocation
and request replay/profile mismatch against the exact authenticated contract.

Run fast PGlite and focused ordinary-role PostgreSQL lanes. Rerun existing
commerce-profile binding and atomic-participant regressions, affected typechecks,
lint, both project reviewers and staged lint. Existing Currency, Product, Link
and ShippingProfile profiles must retain their identities and behavior.

Retain the old contract encodings because supported independent profiles and
retained outcomes use them. Extend the existing profile and binding owners in
place; add no alternate binding validator or adapter-local closure engine.
Remove any diagnostic-only scaffolding after the neutral and connected tests
pass. Complete the shared correction in one scoped verified commit, then finish
and separately commit preflight 93B, including its maximum resource/recovery
envelope and unchanged native-test admission.
