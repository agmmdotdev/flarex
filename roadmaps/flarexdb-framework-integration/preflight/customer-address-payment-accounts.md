# Customer Address management and payment accounts

Status: implemented for bounded Customer Address and local System account/session
profiles. Existing checkout Customer identities and Cart Address copies remain
admitted separately. This slice follows the pinned
Medusa 2.13.4 Customer Address roots and System-provider account/session branch,
using the genuine Customer-AccountHolder stored Module Link.

The native Address create/update roots own replacement of default billing and
shipping flags. Native physical deletion retains complete Address rows for its
creation inverse. Customer groups, remote providers, payment methods and general
Customer CRUD are outside this profile. Postgres remains the single settlement
owner; retained callbacks do not independently commit.

## Selected implementation boundary

The three Address roots execute the genuine create, update and physical-delete
steps, both native default-unsetting helpers and native hooks. Address operations
reuse scalar storage, the native scalar creation planner, native metadata merge
and the existing event/receipt owners. Complete Address rows authenticate
mutation preimages and results; partial list projections retain native primary
keys. Each input and indexed dependency cohort is bounded to four Addresses.
The two native Boolean uniqueness predicates and required Customer foreign key
remain storage obligations, including at final settlement.

The Customer-aware Session root is a separate three-source profile: native
Customer, native Payment and the genuine Customer-AccountHolder Link. It reuses
the existing Customer scalar read owner and adds authenticated local Address
and stored AccountHolder graph paths. The native root owns default-billing or
first-Address selection, account creation/reuse, Link creation and pending
Session replacement. Customer email is required by this selected native Query
view. Account creation/deletion uses the real local System provider; remote
providers and saved payment-method operations are not admitted.

The ordinary Customerless Session profile retains its input/resource boundary.
The Customer-aware profile selects the existing 512-call Payment allowance in
the trusted outer owner; defaults and byte, event, row and physical-participant
ceilings remain unchanged. The native `noCompensation` declaration is retained:
failed outer executions still roll back AccountHolder, Link and Session writes
atomically. Reused accounts retain the native null deletion marker.

The separate [Customer-context checkout profile](./checkout-customer-context.md)
uses this native Customer graph and the genuine stored Link in its nineteen-
source complete-Cart and retained Payment recreation closure. This three-source
Session profile retains its own exact account-Link router and ordinary identity
encoding. Cart context creation, Customer Groups, production routes and external
payment gateways remain separately gated.

## Native Address metadata correction

Owner: native `customer/steps/update-addresses.ts`. The pinned step selected
`metadata.nested.replacement` for a nested patch, losing the complete JSON
preimage. The approved correction uses the existing selector helper's
`objectFields: ["metadata"]` option to retain scalar metadata.

The pinned inverse also passed prior JSON through ordinary native merge, leaving
newly added keys behind. Native Customer Address update now forwards the existing
`DAL.UpdateOptions` to its internal service. The retained compensator requests
`metadata: "replace"` only when its preimage contains metadata. Forward updates
retain native merge semantics; unrelated scalar inverses omit replacement.
The finite workflow method admits only that exact replacement option and keeps
the positional context slot undefined. Receipt validation authenticates the
selected merge/replacement behavior through the same native metadata owner.
Regressions retain added/deleted keys, nested values, empty strings, empty
objects and null, including inverse rollback and replay.

## Native default-selector correction

Owner: native `customer/steps/utils/unset-address-for-update.ts`. The pinned
helper unset selected defaults before the root reused their selector, producing
an empty successful update. False selectors also expanded when a competing
default became false. The native root now selects the original Address IDs
before either helper and uses that exact ID selector throughout the update.
The helpers unset only competing default IDs. Their compensation markers contain only
those changed IDs. Billing and shipping selectors remain stable; the native
Boolean uniqueness constraints still refuse multiple new defaults. No adapter
selector rewrite or relaxed receipt is admitted.

Complete typed and emitted source guards cover both corrections, the native
Customer service forwarding seam and its public method signatures. Neighboring
Customer methods and unselected source pairs remain outside this admission.
