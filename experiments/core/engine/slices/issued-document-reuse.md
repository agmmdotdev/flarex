# Issued document reuse

Status **Implemented.** Flarex baseline `2e8e5e354`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`.

Mechanism and its difference from Convex:
[reuse of issued document roots](../divergences/issued-document-reuse.md).

## Independent challenge

One read-only challenger inspected current Core, the protocol package and pinned Convex.

| Proposal | Outcome |
| --- | --- |
| Return an issued root without another walk | Selected from the third capture on: the second capture is the proving walk, and its output is what later captures return. |
| Report binary leaves from the runtime normalizer | Rejected. `value-runtime-core.ts` is embedded in generated runtimes whose hashes are code identity, and the result type is a V1 contract. The check lives in `document-value.ts`. |
| Measure strings without encoding them | Deferred for the same reason. |
| Reuse trees with binary leaves | Rejected. `ArrayBuffer` contents stay mutable. |
| Trust a root from issuance | Rejected in review. A forged `ArrayBuffer` subclass can plant an unvalidated leaf, a Proxy or a shared subtree through its own `slice`. Only the codec's output for a later walk of scalar-only input is reused. |
| Fix the forged `slice` in the runtime codec | Not done. It changes generated runtime identity and needs its own authorization. |

Identity consumers in `core/transaction.ts` (`documentSizes`, `nativeActivityRows`,
changed-document comparison) depend only on content or benefit from stable identity.

## Measured outcome

Product create on ordinary-role PostgreSQL, one local host, 16 callers, CPU profile of
192 operations.

| Measure | Before | After |
| --- | --- | --- |
| Runtime normalizer, per create | 4.25 ms | 2.87 ms |
| Shape check, per create | none | 0.07 ms |

Alternating timing rounds cannot resolve a change of this size on the loaded host.

Remaining walks are new roots built by spreading a captured document and nested values
passed to index encoding.
