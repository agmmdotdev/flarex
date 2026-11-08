# Native root admission

Status **Implemented, off by default.** Flarex baseline `2cefaaa73`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`.

Mechanism and its difference from Convex:
[bounded admission at the Core application owner](../divergences/native-root-admission.md).

## Independent challenge

Two read-only challengers inspected current Core and pinned Convex.

- `maximumRequests` is a retention and unresolved-census bound. Raising it alone
  would not bound work, and 32 is a fixture value.
- Admission belongs inside the owner, before a generation is selected and before
  any claim or snapshot exists.
- Nested roots must not wait, and refusals must not retry automatically.
- `commerceTransaction/nativeHost.ts` omitted the admission deadline that
  `atomicCommerce/nativeHost.ts` passes, so a root could wait past its lifetime.

## Dispositions

| Item | Outcome |
| --- | --- |
| Limiter | Moved to `core/admission.ts`; the Application admission composes it. No duplicate. |
| Owner | `admission` is optional. `use` takes a kind, and an omitted kind is a mutation. |
| Commerce reads | `makeNativeOwnerHost` reads take the query channel. |
| Census | Check and reservation are synchronous. |
| Admission deadline | `beginNativeRoot` in the commerce host now passes the lifetime deadline. |
| Limiter lifetime | One per owner rather than per generation; see the divergence record. |
| Production host | Not adopted, and no capacity is selected. |

## Measured outcome

Product create, 64 closed-loop callers, 512 operations, ordinary-role PostgreSQL on
one local host, 16 mutation permits against a request census of 32.

| Admission | Failures | Throughput | Median | p95 |
| --- | --- | --- | --- | --- |
| Off | 480 of 512 | 14 per second | 2.2 s | 2.4 s |
| On | 0 of 512 | 14 per second | 4.5 s | 5.1 s |

The queue converts refusals into waiting and adds no capacity. Throughput is limited
by CPU per request, and queue wait grows with the backlog. Latency counts successes
only, so the "off" row describes just the 32 requests that were admitted.
