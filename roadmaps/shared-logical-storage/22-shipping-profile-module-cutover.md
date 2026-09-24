# ShippingProfile Module Cutover

Status: implemented under the approved shared-storage completion goal. The
Product–ShippingProfile composed workflow still owns a named physical profile
until its Product–ShippingProfile Link and router move together.

## Preflight And Owner

The pinned Fulfillment model inventory contains twelve tables, but the current
admission selects only `shipping_profile`. That model declares an ID primary
key, native defaults and timestamps, nullable metadata, and a unique active
`name` index. Its `shipping_options` inverse relation is metadata only: this
selected service cannot hydrate or mutate ShippingOption. Native service
creation, events and error behavior remain with Medusa. Flarex owns scoped
logical rows, indexes, unique claims, bounded reads and atomic publication.

The old standalone ShippingProfile test installed a seventeen-table physical
Product/SalesChannel/ShippingProfile/Link schema solely to run selected native
service methods. Its generated names and local profile are private test
machinery, not a durable format or reason to keep per-deployment DDL. The
separate composed workflow still consumes that physical schema and is not
silently converted by changing standalone admission.

## Connected Replacement

Compile the selected pinned ShippingProfile model into one logical source.
Preserve the active-name unique constraint and add a derived shared text
equality access path for the native `type` filter; the model declares no
physical type index. The selected native create/list/count/retrieve operations
borrow this source. A shared atomic root matches the module's emitted creation
IDs to exact logical insert attempts before publication. Move the standalone
native behavior and two promoted creation/event assertions to this host;
remove its displaced physical profile and seventeen-table fixture. Prove
defaults and metadata, exact active-name uniqueness, indexed name/type reads,
replay, invalid input and hydration refusal, sticky caught native failure,
event publication, and physical table-count invariance on both drivers.

The retained physical workflow witness must keep running during this cutover.
Its test harness previously accumulated prepared workflow hosts across cases
until the shared runtime correctly refused more payload capacity. Release each
case's hosts at the test lifetime instead of raising runtime limits or weakening
the workflow assertions.

This breaks the private `prepareLocalShippingProfile` physical profile and
fixture, with no named durable environment reset or converted. The physical
Product–ShippingProfile workflow retains its named consumer and removal gate;
its four participants, two Links, pending graph reads and recovery must move
as one connected follow-on. General Fulfillment models, cross-framework
relations, developer APIs, hosted activation and advanced populated-data
evolution remain outside this slice.

## Completion Gate

Run the focused native ShippingProfile suite on PGlite and ordinary-role
PostgreSQL, affected typechecks, source guard and lint. Have both required
read-only reviewers inspect the final staged behavior, data and cleanup
checkpoint. Commit only after all checks pass.
