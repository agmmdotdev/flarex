# Mechanism: issued commerce row decode

Design status: **Accepted**.
Implementation status: **Implemented**.
Measurement status: **Required gates unmet**; local load only.

## Ownership and decision

- Owning slice: [Native write round trips](../slices/native-write-round-trips.md), per-write CPU.
- Owner: `commerceRowDecoder` in `packages/medusa-adapter/src/value/decoder.ts`.
  Issuance stays with `capturePrivateJsonData` (`values/privateJsonData.ts`).
- No guarantee, durable data, byte charge or refusal changes.

## Pinned Convex mechanism

- Revision: `db914cf06e2b06ee985646611b9e12ed7a770318`.
- `npm-packages/convex/src/server/impl/registration_impl.ts`: every function boundary
  re-validates its arguments from text; a validated value is never reused.

## Flarex mechanism and difference

- A row whose root object the capture owner issued is recognised by object identity.
  Its members are frozen JSON by construction, so only the field allowlist is checked
  and the row is returned as a fresh mutable record with the same members.
- Any other input, an issued array, and an issued root with a key outside the
  allowlist take the complete Schema decode.

## Why a difference is necessary

The adapter captures a value and decodes it in the same realm with nothing untrusted
in between; the Schema JSON predicate walked each nested subtree once per row level.
Rejected: structural look-alike checks, trusting clones or thawed copies, a second
registry.

## Preserved and changed guarantees

- Allowlist, excess-key refusal and its cause, key order, output shape and
  mutability, and failure reason are unchanged.
- No byte charge, authority or storage claim is involved.

## Required witnesses and remaining limits

- `packages/medusa-adapter/test/commerce-row-decoder.test.ts`: an issued root is
  decoded without the walk and equals the Schema-only output; a structured clone, a
  deep-frozen clone and a frozen look-alike take the full Schema walk and fail as
  before.
- Generic `commerceDecoder` schemas containing `Schema.Json` are unchanged.
