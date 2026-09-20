# Indexed Payload Queries And Pending Membership

Status: implemented for the bounded scalar collection profile. General indexed
framework query support and the remaining completion-plan packages remain open.

## Outcome And Owners

Compile native scalar `index: true` and collection compound `indexes` into
authenticated Application logical index declarations and execute them through
real Payload find/count. Support equality prefixes and numeric ranges on the
next indexed field, preserving native ID pagination order and exact bounded
counts. This is a connected compiler, admission, query and settlement change.

Reuse Application schema authoring, physical requirement/build readiness,
ordered-index value/bound/key codecs and current index persistence. CMS owns
its relational request working set and exact range observations. Payload owns
native configuration sanitation, value/operator admission and Local API behavior.
No adapter SQL, separate index store, extra transaction or fallback query engine.

The executing pinned Payload collection contract defines scalar index options
and compound `{ fields, unique? }` declarations. This slice admits ordinary
indexes; existing single unique-text fields remain supported. Compound uniqueness,
localization, optional-field/null policies beyond current scalar contracts,
arbitrary Boolean expressions, custom sort, unbounded aggregate queries, Pricing
and generic commerce remain outside this slice.

## Query And Concurrency Contract

Select only an authenticated, freshly admitted developer index. Compile equality
prefixes and one following range with the existing ordered codec. Complete the
selected range within the request's identity/byte budget; exceeding its matched
membership budget refuses without scanning unrelated collection rows. Do not
describe this bound as an unbounded count or production scale claim.

Hydrate selected identities through the document owner and verify committed base
membership against the selected encoded keys. Merge local insert/edit/delete
state with captured membership; an indexed value moved from 10 to 20 disappears
from its old range and appears in its new one before commit. Cache identical
range observations, preserve prior scan semantics, and reject torn membership.

At settlement under the existing publication owner, re-read the exact range and
compare membership, while existing point dependencies protect row decisions.
Insertions into an observed empty range conflict; unrelated range writes may
settle. Keep all observations even when later writes coalesce away. Never hold
an extra lock or retry a framework callback to manufacture consistency.

## Replacement And Completion Gates

Add optional authenticated index metadata and verify it agrees with analyzed
schema declarations. Replace the compiler's unconditional empty-index output and
query decoder's unique-only restriction for the admitted indexed grammar.
Replace indexed collection scans with the shared range reader. Migrate affected
fixtures and consumers in this slice; preserve existing broad-query bounds.
No physical family/schema reset, data deletion or compatibility wrapper is needed.

Numeric equality in the CMS working set now follows the shared ordered float
domain, including distinct signed zero. Payload's existing field/predicate
translation canonicalizes numeric zero after native validation, so its persisted,
pending and scanned numeric semantics agree. This changes the previous handling
of Payload negative-zero writes. No named durable deployment obligation is known;
this development cutover does not migrate retained negative-zero rows. An affected
retained environment must refuse activation until its data is audited and converted
and affected indexes rebuilt under an approved migration. Never silently reinterpret
or reset such data. The strict negative-zero default refusal remains unchanged.

Prove native declaration sanitation and schema integrity; real Local API equality,
range, compound-prefix, pagination/count and pending updates over a collection
larger than the scan budget; deletion/key movement, nested requests, rollback and
replay; scope isolation and distinct-connection range conflicts versus unrelated
progress. Validate PGlite and ordinary-role PostgreSQL separately, inspect the
selected query plan, run affected types/lint, obtain both reviews, remove displaced
paths and commit one coherent slice. Performance evidence remains bounded.
