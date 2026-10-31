# Authenticated native table write ownership

Status: **Required native extension implemented for the fresh selected scalar consumer; wider native and retained-data gates open.**

## Why the source mechanism needs an extension

Pinned Convex table namespaces/mappings supply table identity and access context.
They do not implement Payload-managed lifecycle policy. The selected existing CMS
consumer requires writes through its native command lane; ordinary Application
writers cannot bypass Payload access, validation or hooks. A namespace label or
compiled producer digest cannot grant that authority.

This is a required native-behavior extension, not a DO limitation. The current
`requireCoreApplicationSchemaSupport` refusal is correct until the extension is
connected; removing its version check would erase native requirements.

## Selected replacement boundary

Carry authenticated producer/configuration and explicit read/write exposure with
stable scoped table identity through the existing shared proposal/build/activation
owner. Reserve ownership during fresh admission, including Source implicit-create
races. Atomically recheck identity/data/policy before activation; refuse an existing
Application-owned target even when empty. Same-source idempotent replay is distinct
from an ownership transfer.

The shared transaction/document owner enforces the active policy on name, known-ID,
query and maintenance paths. Trusted native capabilities bind the selected root,
scope/fence and policy version; untrusted code receives neither raw database nor
settlement capability. Enforce configured read exposure before disclosure, and
deny ordinary Application writes to CMS-managed records.

Private policy/catalog state stays logical over the five physical tables, with
one authoritative settlement/publication/cache invalidation path. Derive exact
record/API shapes during the coordinated implementation; no generic registry,
adapter SQL enforcement or additional physical family is justified here.

The selected implementation stores reserved/active policy through existing
schema/database owners and logical `_tables`/`_schemas` records. The transaction
owner checks Application access by name, ID and query. Database-owned native
bindings check producer/configuration, table/index generations, active schema
and authority epoch before fresh disclosure and final acceptance. Native commands
use tagged identities through the shared claim/outcome owner; trusted command
registration does not reinstall schema. See the
[executing owners and retained consumers](../slices/10-payload-native-core-cutover.md#executing-replacement-and-retained-consumers).

## Required proof and retirement

See [the selected slice](../slices/10-payload-native-core-cutover.md). Cover forged,
foreign, stale and closed capabilities; known-ID and implicit-create bypasses;
competing admission/activation; retained old roots and invalidating writers;
unsupported transitions preserving the ready combination; and genuine native
access/hooks. Trace all writers before claiming enforcement or cache eligibility.
Replace selected old admission/session plumbing when callers migrate. Other native
targets remain named migration inputs, with no runtime fallback on new bindings.
