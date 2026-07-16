# Encoded Data And Database Codecs

Status: active cross-cutting implementation guidance.

Evidence basis: Effect `4.0.0-beta.90`, Drizzle ORM `0.45.2`, the accepted
FlarexDB replacement direction, and representative protocol and persistence
flows inspected on 2026-07-16. Re-check installed APIs before implementation.

## Decision

Do not ban `Number`, `String`, `BigInt`, `TextEncoder`, `TextDecoder`, or
`Uint8Array`. Classify the representation boundary first.

Decode and validate once when unknown or foreign data enters an owned domain,
keep a branded or otherwise precise domain value internally, and encode once
when that value leaves for SQL, JSON, bytes, or a wire protocol. A total pure
conversion remains ordinary TypeScript. A conversion that can reject input or
lose information needs an explicit `Schema`, `Result`, or typed Effect
boundary.

`pipe` is composition syntax, not proof that a conversion is safe. Effect
wrappers must not hide coercion, precision loss, permissive decoding, or an
incorrect physical database representation.

## Representation Matrix

| Boundary | Preferred representation | Rule |
| --- | --- | --- |
| Unknown text to a number | Effect Schema transform | Validate lexical form, finiteness, integer/range rules, and brand after decoding. |
| Postgres `bigint` or exact numeric text | `bigint`, `BigDecimal`, or validated text | Do not convert to `number` without an explicit safe and exact range proof. |
| Domain value to SQL parameter | One persistence encoder or driver codec | Do not scatter `String(...)`, byte encoding, or timestamp construction across queries. |
| SQL row to domain value | Hoisted row decoder | Treat driver output as an encoded persistence shape; map invalid stored data once to typed corruption. |
| UTF-8 text to bytes | Shared pure `TextEncoder` | Encoding a JavaScript string is total and does not need an Effect wrapper. |
| Unknown bytes to text | Fatal decoder or owned Schema transform | Reject malformed UTF-8; do not accept replacement characters silently. |
| Base64, base64url, or hex to bytes | Effect `Encoding` plus `Result`, or a Schema transform | Use `Result` for a pure parse result and Schema when encoded/decoded forms are a contract. |
| Canonical Flarex evidence | Project-owned canonical codec plus Schema brands | General encoding validity does not prove canonical padding, alphabet, case, pad bits, size, or semantic form. |
| Existing bytes to owned bytes | Defensive `Uint8Array` copy | Preserve copies where ownership or mutation isolation requires them. |

## Numeric Text Is A Data Boundary

JavaScript coercion accepts representations that are often inappropriate at a
database or protocol boundary. `Number(" ")` is `0`, exponent notation is
accepted, and integers above the safe range lose precision. `String(null)` and
`String(object)` can similarly manufacture text that looks usable while
erasing the original type error.

Effect Schema helps only when the complete contract is declared.
`Schema.NumberFromString` in the installed Effect version deliberately uses
JavaScript number coercion. Prefer `Schema.FiniteFromString` when only
finiteness is required, `Schema.BigIntFromString` for exact integer text, or a
lexically constrained transform for a stricter database representation.

For example, database epoch milliseconds can reject whitespace, exponent
notation, leading signs, zero, fractions, unsafe integers, and malformed rows:

```ts
import { Schema, SchemaTransformation } from "effect"

const DatabaseEpochMillisecondsSchema = Schema.String.check(
  Schema.isPattern(/^[1-9][0-9]*$/),
).pipe(
  Schema.decodeTo(
    Schema.Int.check(Schema.isGreaterThan(0)),
    SchemaTransformation.numberFromString,
  ),
  Schema.brand("FlarexDB/DatabaseEpochMilliseconds"),
)

const decodeDatabaseEpochMilliseconds =
  Schema.decodeUnknownEffect(DatabaseEpochMillisecondsSchema)
```

Keep the decoder hoisted. Inside Effect-native persistence, translate its
`SchemaError` once to the owning stored-corruption error. Do not convert the
failure to `Option.none`; missing data and malformed stored data are different
states.

Use `BigInt(value)` directly only after the input type and lexical form make
the call total. When the input is unknown, prefer `Schema.BigIntFromString` or
the installed `BigInt.fromString` `Option` for a pure absence-only probe. At a
database authority boundary, Schema or `Result` is normally better because a
corruption reason must not disappear.

## Text And Byte Ownership

A module-level encoder is an ordinary pure utility:

```ts
const UTF8_ENCODER = new TextEncoder()

const encodeUtf8 = (value: string): Uint8Array =>
  UTF8_ENCODER.encode(value)
```

Do not wrap this in `Effect.sync` merely to display Effect syntax. Hoist the
encoder to avoid repeated construction and keep the owning codec named.

Decoding unknown bytes is different. A default `TextDecoder` replaces invalid
UTF-8. Use `new TextDecoder("utf-8", { fatal: true })` and map its throw at the
narrow decoder boundary, or define a reusable Schema transformation when
UTF-8 bytes and decoded text are a stable encoded/decoded contract.

`new Uint8Array(existingBytes)` is often a defensive copy. Keep it when the
caller, database driver, Web Crypto API, or another component could retain a
mutable alias. Schema validation and branding do not provide ownership or
immutability by themselves.

## Effect Encoding Versus Canonical Protocol Encoding

The installed Effect v4 `Encoding` module exposes pure encoders and safe
decoders such as `encodeHex`, `decodeHex`, `encodeBase64`, and `decodeBase64`.
Decoders return `Result<Uint8Array, EncodingError>` and can enter an Effect
flow through `Effect.fromResult`.

Use the corresponding Schema transforms, including
`Schema.Uint8ArrayFromHex`, `Schema.Uint8ArrayFromBase64`, and
`Schema.Uint8ArrayFromBase64Url`, when encoded and decoded forms belong to a
larger Schema contract. Encode validated domain values with
`Schema.encodeEffect` when the transformation or encoder can fail.

General validity is not Flarex canonicality. Before replacing a project codec,
compare requirements for:

- standard versus URL-safe alphabet and required padding;
- canonical unused pad bits;
- lowercase hexadecimal form;
- exact and maximum byte lengths;
- UTF-8 fatality and Unicode well-formedness;
- canonical JSON field order and number representation; and
- byte-for-byte re-encoding equality.

Preserve the Flarex value codec and other Convex-compatible canonicalization
algorithms when those rules are stricter than Effect's general-purpose
encoding helpers. Effect should type, compose, and report those operations; it
must not silently redefine their public bytes.

## Database Parameter And Row Cutline

The intended persistence flow is:

```text
unknown request or stored representation
  -> Schema decode
  -> branded domain value
  -> domain and transaction logic
  -> persistence encoder or Drizzle codec
  -> driver parameter

driver row
  -> driver codec normalization
  -> persistence row Schema
  -> branded domain record
```

Driver codecs and Effect Schema have different jobs. A Drizzle codec may
normalize a Postgres `bigint` string to `bigint`, a timestamp to a driver time
value, or `bytea` to `Uint8Array`. It does not prove Flarex positivity, range,
canonical evidence, authorization, or cross-field invariants. Drizzle
`.$type<Brand>()` improves compile-time agreement but is not a substitute for
decoding unknown or corruption-sensitive rows.

While Flarex remains on Drizzle 0.45, keep one narrow Promise/driver adapter
and named persistence codecs. Do not imitate Drizzle v1 codec APIs before the
approved migration gate in `09-drizzle-effect-postgres.md`. After a future
upgrade, keep driver normalization and Flarex domain validation explicit even
if generated database Schemas reduce duplicated row shapes.

Prefer physical columns that match their domain. Do not preserve an obsolete
`integer -> decimal string -> UTF-8 bytea` path merely by wrapping it in an
Effect Schema. The legacy `documents` and `indexes` tables are unshipped
prototype evidence: port intended semantics and tests, switch callers to the
accepted FlarexDB target, then delete the obsolete encoding path.

## JSON And Stored Data

Do not use `JSON.parse(text) as DomainType` at a trust boundary. Decode JSON
syntax and the resulting value through one owned Schema, for example with
`Schema.fromJsonString(domainSchema)` when its exact installed behavior fits.
If storage uses UTF-8 bytes, compose fatal UTF-8 decoding with JSON Schema
decoding rather than scattering `TextDecoder`, `JSON.parse`, and assertions.

Keep size limits outside or ahead of parsers that do not enforce a byte bound.
Schema proves only the properties represented by the Schema; it does not
prove database authority, cryptographic authenticity, freshness, or canonical
semantic equivalence.

## Current Flarex Evidence

Classify representative current patterns as follows:

- **Keep/port:** `packages/flarex-protocol/src/value.ts` hoists UTF-8 tools,
  uses fatal decoding, enforces project canonical rules, defensively copies
  evidence, and brands validated bytes.
- **Bounded target refactor:** target persistence flows repeat
  `sql<string>` plus `Number(...)` and manual database-clock checks. Introduce
  one strict database-time codec when an approved slice touches that flow.
- **Bounded target refactor:** manual lowercase SHA-256 hex loops can use
  Effect `Encoding` after the Flarex lowercase/exact-length Schema remains the
  authority.
- **Keep where ownership requires it:** defensive `new Uint8Array(...)`
  copies around stored evidence and Web Crypto calls.
- **Rewrite/delete:** legacy `documents.ts` and `indexEntries.ts` use repeated
  text codecs, permissive decoding, assertions, and byte-encoded numeric IDs.
  Do not invest in a standalone Effect migration of an unshipped path.
- **Not automatically debt:** `String(...)` used to format a known constant or
  diagnostic, and `BigInt(...)` after an exhaustive type and lexical guard.

This is pattern evidence, not authorization for a package-wide refactor.

## Review Checklist

For every touched transformation or persistence flow, ask:

1. What are the encoded and decoded types, and which side is unknown?
2. Can the conversion reject input, lose precision, normalize spelling, or
   silently replace invalid data?
3. Is a native conversion total under an already-proven type?
4. Does numeric text require exact integer, safe-range, sign, or lexical
   constraints beyond `Schema.NumberFromString`?
5. Should a pure parse result be `Result`, or should failure remain in an
   Effect error channel?
6. Are stable encoders, decoders, and Schema compilers hoisted?
7. Does a driver codec normalize representation without pretending to prove
   domain invariants?
8. Is canonical protocol behavior preserved exactly?
9. Is a byte copy enforcing ownership rather than performing validation?
10. Is invalid stored data mapped once to a typed corruption error without
    swallowing defects?
11. Is the touched path target architecture, a temporary bridge, or legacy
    code that should be ported and removed?
12. Do tests cover malformed text, precision boundaries, invalid UTF-8,
    canonical encoding, exact byte lengths, and driver differences?

## Primary References

- [Effect Schema API](https://effect-ts.github.io/effect/effect/Schema.ts.html)
- [Effect Encoding API](https://effect-ts.github.io/effect/effect/Encoding.ts.html)
- [Drizzle custom types](https://orm.drizzle.team/docs/custom-types)
- [Drizzle codecs](https://orm.drizzle.team/docs/codecs)
- [`09-drizzle-effect-postgres.md`](./09-drizzle-effect-postgres.md)
- [`11-data-validation-and-trust-boundaries.md`](./11-data-validation-and-trust-boundaries.md)
- [`../flarexdb-foundation/README.md`](../flarexdb-foundation/README.md)
