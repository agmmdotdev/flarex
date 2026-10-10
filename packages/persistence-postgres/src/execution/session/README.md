# Session Execution

A Session connects a logical mutation attempt to its stored authority, snapshot
lease and execution claim. It does not own business publication. The
[point commit owner](../../commit/point/README.md) validates and commits the
completed attempt; the [journal owner](../journal/README.md) records its admitted
operations and pending changes.

## Choose The Entry

| Entry | Purpose |
| --- | --- |
| [api.ts](api.ts), `internal/session` | Consumer results, expected errors and inert recovery inspection |
| [construction.ts](construction.ts), `internal/session-construction` | Trusted factories for activation, loading, terminalization, claim acquisition and target construction |
| [database runner](../../database/locatedReadCommittedRunner.ts), `internal/located-read-committed-runner` | Generic native READ COMMITTED construction, also used outside Sessions |
| [kernelTestApi.ts](kernelTestApi.ts), `internal/system-test/session-kernel` | Restricted native transaction identities needed by connected system tests |

Consumer imports do not construct a database, issue an execution claim or lend a
transaction callback. A recovery handle contains admitted request evidence;
reading it neither renews authority nor permits execution. The read-syscall
callback remains package-local.

## Follow An Attempt

1. Trusted construction captures scope-resolution ports and the operation's
   configuration. [target.ts](target.ts) binds the exact database and physical
   locator to the native operation capabilities.
2. [activation.ts](activation.ts) captures the request and resolves preliminary
   authority. [durableActivation.ts](durableActivation.ts) creates or replays a
   durable attempt. [finiteActivation.ts](finiteActivation.ts) coordinates the
   finite Application entry and confirmed journal capture.
3. [claim acquisition](../claims/acquisition.ts) establishes the execution owner.
   [Claim liveness](../claims/transactionExecutionClaimLiveness.ts) supervises that
   owner; [renewal](../claims/renewal.ts) performs native renewal under the actual
   located target.
4. [attemptLoad.ts](attemptLoad.ts) loads and authenticates the exact running
   attempt. [attemptKernel.ts](attemptKernel.ts) runs a bounded native callback
   with its final authority checks and original settlement/cleanup lifetime.
5. The executor runs Application code through restricted journal capabilities.
   Each native callback has its own bounded database lifetime. No database
   transaction stays open across untrusted Application execution.
6. Point publication settles successful work. [terminalization.ts](terminalization.ts)
   handles admitted abort/expiry transitions. Recovery resolves the existing
   durable outcome before selecting an authorized continuation or replacement.

Durable operations and finite roots retain different entry and replay contracts.
These owners share authenticated mechanics without becoming one universal
transaction profile.

## Supporting Responsibilities

| Owner | Responsibility |
| --- | --- |
| [contracts.ts](contracts.ts) | Consumer evidence, results and operation contracts; schema links are type-only |
| [errors.ts](errors.ts) | Singular nominal errors, typed failure unions and pure failure construction |
| [errorProjections.ts](errorProjections.ts) | Transaction/authority failure conversion and preservation of the full callback Cause |
| [inputCapture.ts](inputCapture.ts) | Detached input/evidence capture and exact anchor/encoding comparison |
| [attemptAuthority.ts](attemptAuthority.ts) | Shared clock, lease, session and journal-root authentication |
| [finiteSession.ts](finiteSession.ts) | Finite reservation, continuation/replacement and private transaction expectations |
| [recoveryCapture.ts](recoveryCapture.ts) | One private recovery registry, precise trusted issuance and inert detached inspection |
| [constructionContracts.ts](constructionContracts.ts) | Trusted target/configuration contracts and authentic operation symbols |
| [kernelContracts.ts](kernelContracts.ts) | Package-local native callback and exact attempt contracts |
| [database identity](../../database/locatedTransactionIdentity.ts) | Singular transaction symbols and exact target-to-database association |

The existing [claim error owner](../claims/transactionExecutionClaimErrors.ts)
owns acquisition and liveness error identities. Claim persistence, exact running
tail, finite anchor and metadata dependencies retain their own storage semantics.
The shared [renewal projection](../claims/renewalProjection.ts) owns the pure
lease/claim deadline verdict used by finite continuation and native renewal.
Lower owners import concrete leaves; they do not import the construction entry.

The [test map](../../../test/README.md#session-and-claim-lifecycle-tests) follows
the same responsibilities and identifies each real driver/resource owner.
