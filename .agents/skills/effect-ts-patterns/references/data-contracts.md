# Data Contracts: Schema, Result And Effect

## Choose the claim first

Schema defines validity; Result/Effect carries the verdict. These owners differ:

| Boundary | Owner |
| --- | --- |
| Unknown request/event/file/JSON | Domain decoder; map parse issues once to input error |
| Stored row after driver normalization | Persistence/domain decoder; invalid data is corruption |
| Stable configuration | Schema with deliberate startup/Result/Effect interface |
| Established decoded value | Existing type; redecode only for a new boundary/mutation |
| Authoritative metadata | Compile once at stable owner, adding admitted policy only |
| Current authorization/lease/epoch/pins/membership | Contextual operation after structural decoding |
| Opaque reference/capability | Issuer registry/identity, not structural lookalikes |
| Capture with getter/prototype/cycle/alias/key concerns | Dedicated bounded inspection |

SQL constraints enforce database invariants independently; Drizzle types/assertions
are not foreign-row decoders. Reuse an existing validated row owner.

## A schema owns structure and intrinsic value rules

Declare required primitives before refinement: regex alone coerces missing input
into a string. Prefer tagged unions for distinct states (claimed owner/lease
versus terminal settlement evidence); stable within-record relations may be
refinements, while current lease validity needs database time.

Derive types from their authoritative schema. If DTO/protocol types own the shape,
prove decoder agreement; keep encoded/decoded forms distinct. Do not maintain an
interface, repeated field predicate and Schema for one contract, derive Schema
from permissive assertions, or give raw JSON a caller-selected success type.

## Select the decoding API

| API | Intended contract |
| --- | --- |
| decodeUnknownEffect | Parsing directly in E |
| decodeUnknownResult | Pure verdict reused as data; enter Effect once with fromResult |
| Schema.is | Membership only; no transformed value/useful error channel |
| Throwing decoder | Explicit unchecked startup/framework/compatibility edge using the same decoder/error |
| Optional decoder | EVERY rejection deliberately means absence; otherwise retain reason |

Verify installed names/options: is and decode APIs can differ in parse options/
transform semantics. Predicates cannot authenticate forged capabilities.
Hoist static compilers; compile dynamic metadata once at its stable factory,
not per request with current authority pins captured into a schema.

## Preserve semantics when replacing manual code

Preserve/test the relevant details:

- Required/optional, absent/undefined/null/empty; excess keys, symbols, prototypes
  and accessors.
- Coercion/defaults, lexical/canonical spelling, numeric finiteness/integer/safe
  range/precision.
- Dense arrays, recursion/cycles, byte/resource limits, validation order and
  first error.
- Detachment, aliases, identity and runtime mutation.

A JSON Schema decode does not prove all of these. Preserve canonical codecs and
bounded no-getter capture when they own those guarantees; decode owned captured
data where needed rather than casting or invoking getters. Distinct trust or
representation boundaries may justify repeated decoding; otherwise retain the
decoded value. Schema does not deep-freeze it.

## Error ownership

Malformed request data maps to input error; malformed stored data maps to domain
corruption. Retain/redact parse issues under the diagnostic owner. Admission,
policy, clock and identity refusal remain distinct, not all invalidSchema.
Data.TaggedError fits in-process failures; Schema-backed errors fit validated
encoded error payloads. Never expose arbitrary causes on the wire.

## Review evidence

Name the Schema/authoritative decoder or custom-capture reason for each changed
boundary. Classify scoped fixes versus compatibility/authority exceptions or
separate owner decisions. Test actual omissions, stored states and coercions;
Schema-call counts do not prove semantic agreement.
