# Entry Points And Execution Ownership

## The Reader's Model

There are three entry points: Medusa, Payload and Flarex Application. They reuse
framework behavior and storage, but the outer operation determines completion.

| Entry point | Business operation | Execution ownership |
| --- | --- | --- |
| Medusa | Direct service read | Its admitted read owns completion and snapshot |
| Medusa | Direct service write | Its admitted command owns commit and recovery |
| Medusa | Supported finite workflow | One atomic root owns its admitted operations |
| Payload | Direct Local API read | Its admitted read preserves native visibility |
| Payload | Direct Local API create/update/delete | Its supported command owns commit; native validation/access/hooks remain Payload-owned |
| Application query | Application and admitted framework reads | One query owner must define consistent snapshot and dependencies; cross-framework composition is a remaining capability |
| Application mutation | Application and admitted framework operations | One logical attempt owns pending changes, conflict checks, retry and settlement |
| Durable workflow/task | Independently committed steps, waits, external work | Durable execution owns progress/recovery; each database step has its own settlement |

`Standalone` means independently executed. `Mixed` means more than one participant.
Neither is an additional fundamental operation type. A finite workflow can be
atomic; a workflow that waits or performs external work is not automatically one
database transaction. Direct framework support does not automatically admit the
same operation inside an Application query or mutation.

## Dependency And Folder Direction

This is a target responsibility map, not a claim that all moves are complete.

```text
Medusa adapter                 Payload adapter
  native services                native Local API
  direct bindings                direct bindings
  participant bindings           participant bindings
  finite workflow binding        request/access/hook lifecycle
             \                   /
       explicit trusted capabilities
                      |
Application executor: query / mutation / participant orchestration
                      |
Postgres persistence: admission / reads / pending state / commit / recovery
                      |
             authoritative database

Host adapters own transport, connection and runtime wiring.
Installation owns protected database structure and maintenance.
Test support owns fixtures, fault injection and conformance instrumentation.
```

The Application executor need not sit between a direct native operation and
persistence. It coordinates Application execution and its participants. Shared
lower owners enforce database rules for both direct and composed execution.

| Existing owner | Organization direction |
| --- | --- |
| `packages/medusa-adapter` | Keep native modules, query/repository integration and workflow composition together; distinguish direct bindings from borrowed participant bindings |
| `packages/payload-adapter` | Keep native Local API and request semantics; separate direct/borrowed construction and test-only profiles |
| `packages/executor` | Keep framework-neutral Application query/mutation execution, participant invocation and retry ownership |
| `packages/persistence-postgres` | Group transaction/admission, storage and settlement responsibilities; framework facades expose restricted capabilities |
| `packages/flarex-backend` and deployable hosts | Runtime/transport composition, without duplicate database or business rules |

First-slice folders inside persistence are `commerceTransaction/read/` and
`cmsTransaction/read/`. Shared command definitions, configuration and failure
projection live outside the read and write execution bodies. The existing
full-proof direct host still owns its genuine read/write profile. Renaming or
retiring that profile depends on its callers and installation cutover, not style.

Payload now separates `runtime/native.ts`, `direct/binding.ts`,
`participant/binding.ts` and `testing/`. Direct and borrowed calls use the same
native commands. The ordinary runtime supplies its participant binding; fixed
hooks, fault scenarios, counters and raw native inspection stay in test support.

## Reuse Rules

One Payload create implementation should supply native behavior for both direct
and admitted mutation calls. The bindings differ because their execution owners
differ. Apply the same rule to Medusa services and selected workflow participants.
Do not unify by executing the direct host inside a borrowed mutation.

Share authenticated metadata, logical storage, conflict evidence, publication
and recovery through their actual owners. A shared helper must remove duplicated
semantics, not conceal differences behind a mode flag or registry.

Read capabilities expose reads and close. Write-capable hosts expose their real
command/recovery operations. Only the outer owner receives settlement authority;
business code never receives SQL, a raw transaction or a finalizer.

## Capability Matrix

| Capability | Current coverage | Remaining gate |
| --- | --- | --- |
| Direct Medusa read/write | Selected private native operations; managed direct reads implemented | Broader native admission and hosted activation retain their gates |
| Direct Payload read/write | Selected private Local API profiles | Each query, hook and lifecycle profile retains its supported bounds |
| Direct Medusa workflow | Selected finite atomic workflows | Arbitrary upstream workflow support is not established |
| Application mutation with Medusa/Payload | Private isolated proofs for selected operations and finite workflows | Public API/hosted activation and broader methods remain deferred |
| Application query across all three | Target direction | Snapshot, dependencies, authorization and sandbox-connected proof required |
| Durable workflow/task | Separate existing domain | No claim that every Medusa workflow is integrated with durable execution |

Use the [mixed mutation roadmap](../mixed-mutation-core/README.md),
[workflow foundations](../workflow-foundations/README.md),
[Payload adoption](../flarexdb-framework-integration/07-payload-adoption.md) and
[standalone read preflight](../core-performance/standalone-read-redesign-preflight.md)
for exact admission and completion limits.
