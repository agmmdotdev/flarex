# Medusa-origin reference to an Application identity

Status: implemented for a native Product source and Application document-ID
target under the standing shared-storage approval. General relation traversal,
joint parent/child settlement and other source profiles retain their gates.

The shared publisher already enforces Product targets for Application and
Payload sources. The next connected proof reverses direction: a native Medusa
Product writes a declared reference to an Application `users._id`, and a native
Application point deletion must respect that Product's liveness. This is a
supported `strongReference` candidate, not a new adapter relation API.

## Core correction

An Application document's `_id` is its scoped row identity, not a field in its
stored JSON value. The validator currently decodes the document ID to locate
the target, then compares the JSON `_id` field with the source value; that
comparison always rejects a genuine target. On target deletion it likewise
tries to read `_id` from JSON. The shared validator must derive the canonical
document ID from the authenticated table/row identity in both directions.
Relational text primary keys continue to use their stored field and unique
slot. No framework adapter may synthesize a target field or bypass the check.

This corrects an internal runtime contract without changing stored data or
public APIs. The admitted candidate version and physical schema do not change.
The active binding's target-identity projection already distinguishes document
ID from relational text primary key, so no compatibility reader is needed.

## Connected evidence and remaining boundary

The Medusa-owned Product extension and its reverse index compile through the
existing logical candidate/build/activation path. A native Application target
is published first. Native Product creation with that document ID succeeds and
replays; Application deletion is rejected while Product is live. Product soft
deletion releases the restriction. Restoration after target deletion fails and
leaves Product deleted. A second deployment/scope cannot use the first scope's
target ID; two scopes sharing one deployed table identity remain a separate
isolation proof.
The connected case runs on PGlite and ordinary-role PostgreSQL with native
Product commands and a standalone Application point journal.

Generic row/index/unique and one-publication owners are retained. No
test-only bypass, new physical Product table or migration path is introduced.
Cross-framework traversal, same-settlement parent/child ordering, uncertain
COMMIT and populated-source evolution retain their separate gates.
