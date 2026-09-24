# Native Collection reference cutover

Status: selected native logical Collection deletion uses the shared bounded
`set null` transition. Native two-shop, high-fan-out, rollback, replay and
multi-root witnesses are present on both database drivers. The full physical
Product runner remains a named unported consumer.

## Outcome and owners

Move the existing native `deleteProductCollections` command on the selected
logical Product source to the core-owned, bounded `set null` transition. The
pinned Product model declares nullable `Product.collection_id` pointing to
`ProductCollection.id`; the native service deletes the Collection and emits
only its root deletion event. The shared relational owner must select and
detach every matching Product under publication exclusion, maintain its row,
index, revision and fact evidence, and settle the root, event and outcome once.

The logical adapter may select the declared relationship and root. It must not
enumerate Product rows or supply a derived mutation list. The existing physical
Product runner remains the named unported consumer of its physical lifecycle
path until its full logical cutover. This slice does not add a new storefront
operation, change Medusa's public service contract, or expand pending reads
after a sealed plan.

## Design challenge and contract

The former logical Collection delete read at most one bounded Product page and
also spends the working set's 128 observed-identity budget. Raising either
limit or splitting the delete into commits would keep the wrong owner and
could publish partial detachment. A second adapter SQL update would bypass
generic revision, index, fact and recovery writers. Reuse the authenticated
nullable-FK intent and paged materializer established by the Type cutover.

The selected logical command replaces the private behavior that exposed
Product patch attempts to Collection deletion: it seals a declared
`Product.collection_id -> ProductCollection.id` intent after root deletion.
The Collection event policy authenticates the root deletion, one intent
per deleted Collection and the root-only native event. Core derives all
Product changes. Existing Type and other logical policies keep rejecting
unadmitted intents. No durable data format or public Medusa API changes.

## Validation and completion gate

The selected existing native Collection service exercises one logical host
with 160 referencing Products. Its witness proves exact null detachment,
complete same-sequence row facts and revision/index changes, root-only event,
idempotent replay, failed receipt rollback and two-shop confinement on PGlite
and ordinary-role PostgreSQL. A two-root command also seals two intents in
one publication. Reuse the Type cutover's ordinary-role
concurrent-insert witness for the shared selector, and add a Collection-specific
one if the command changes its lock order or admission timing. Work above the
explicit transition budget must fail
atomically; this does not promise arbitrary fan-out or throughput.
