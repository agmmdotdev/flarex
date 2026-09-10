# Data Contracts: Schema, Result And Effect

## Choose the claim first

Schema describes a reusable runtime data contract. Result and Effect describe
how decoding succeeds or fails. They are complementary.

| Boundary | Recommended ownership |
| --- | --- |
| Unknown request, event, file or foreign JSON | Domain Schema decoder; map parse issues once to the boundary error |
| Stored row after driver normalization | Persistence/domain Schema; malformed data becomes stored corruption |
| Stable program configuration with fields and bounds | Schema plus a deliberate startup/Result/Effect interface |
| Internal already-decoded value | Operate on the established type; validate again only when a new boundary or mutation requires it |
| Authoritative schema supplied as metadata | Compile that metadata once at the stable owner, adding only admitted policy |
| Current authorization, lease, epoch, expected pins or subscriber membership | Explicit contextual operation after structural decoding |
| Opaque capability or reference | Issuer identity/registry check; a structural lookalike is insufficient |
| Safe unknown-object capture | Dedicated bounded inspection when getters, prototypes, cycles, aliases or keys matter |

A SQL constraint, Drizzle inferred type or TypeScript assertion is not a general
foreign row decoder. Reuse an existing validated row owner when present. Keep
database constraints as independent database enforcement.

## A schema owns structure and intrinsic value rules

Declare required fields and primitive types before refinement. For example, a
regular expression alone coerces undefined to the string "undefined"; it does
not establish that a required name exists.

Prefer a tagged union for meaningfully different state shapes. A delivery
record's claimed state can require owner/lease fields, while a terminal state
requires settlement evidence. Stable relationships between its own fields may
be refinements. Whether its lease is still valid relative to database time is
a separate contextual check.

Derive the decoded type from the schema when it owns that type. Where an
external DTO/protocol already owns the type, prove the decoder agrees with it
without creating competing contracts. Keep encoded and decoded types distinct
when transforms exist.

Avoid a manual interface, a separate repeated field predicate, and a schema all
describing the same runtime object. Do not generate a schema from a permissive
type assertion or call a raw JSON reader with a caller-selected success type.

## Select the decoding API

- decodeUnknownEffect: parsing belongs directly in an Effect failure channel.
- decodeUnknownResult: a pure decoder is deliberately reused as data; enter
  Effect once with Effect.fromResult when needed.
- Schema.is: membership alone is the intended boolean contract. It does not
  provide a transformed result or useful parse-error channel.
- Throwing decode: only an explicit unchecked startup/framework/compatibility
  edge. Reuse the same schema/decoder implementation and preserve its error.
- Optional decoding: only when every rejected input deliberately means absence;
  otherwise preserve the failure reason instead of returning None.

Verify these names and parse options against the installed major version.
Schema.is and decode APIs may not accept the same options or have the same
transformation semantics. A type predicate never makes a copied or forged
capability authentic.

Hoist static compilers. Dynamic metadata deserves one stable factory/compiler,
not a newly captured schema for each request's current authority pins.

## Preserve semantics when replacing manual code

Decide and test the relevant contract, not only the happy-path type:

- Required versus optional keys; absent, explicit undefined, null and empty.
- Unknown/excess keys, symbols, prototypes and accessors.
- Coercion/defaults, exact lexical spelling and canonical encodings.
- Numeric finiteness, integer/safe range and precision.
- Dense arrays, recursive limits, cycles and byte ceilings.
- Validation order and first reported failure.
- Detached ownership, identity-sensitive values and runtime mutation.

A generic JSON schema decode is not proof of all of these guarantees. Preserve an
existing canonical codec or bounded no-getter capture algorithm if those are its
real contract. Decode the resulting owned data through the domain schema where
needed; do not replace capture with an unchecked cast or silently invoke getters.

Repeated decoding can be justified at distinct trust boundaries, or by capture
changing representation. Identify each claim. Avoid discarding a decoded value
and checking it again solely to obtain a type when one owned decoder can suffice.
Schema parsing does not itself deep-freeze values.

## Error ownership

Translate malformed request data to the request domain's input error; translate
malformed stored data to that persistence domain's corruption error. Retain parse
issues/cause according to the owner's diagnostic/redaction policy.

After decoding, keep policy/admission/clock/identity failures distinguishable.
Do not collapse them all into invalidSchema. A Data.TaggedError is sufficient
for an in-process failure. A Schema-backed error is useful when the error itself
crosses a validated encoded boundary; do not put arbitrary causes on the wire.

## Review evidence

For each materially changed data boundary, name its schema/authoritative
decoder or custom-capture reason. Classify a gap as a bounded fix, a necessary
compatibility/authority boundary, or a separate owner decision. Test concrete
malformed inputs and invariants. A required-string omission, a changed stored
state, or an unintended coercion is stronger evidence than counting Schema calls.
