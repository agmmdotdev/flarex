# Native Cart creation generation records

Status **Implemented. PGlite and ordinary-role PostgreSQL verification passed.**

Convex allocates a new document identity on insert and stores successful root
outcomes for same-request replay. Medusa Cart creation supports retained
compensation in a later root. The later root may encounter a different Cart
or Address with the same native business ID, or an operation whose compensation
has already succeeded.

The authenticated Cart source includes the existing native creation operation,
Cart claim and Address claim as three logical records. The genuine Cart
lifecycle removes claims child-first before a business ID can be reused.
Retain the operation's compensation state so a new request can distinguish
an already compensated handle. Core's committed outcome serves same-key replay.
The existing [scope exclusion](./native-scope-exclusion.md) and
[foreign-key owner](./native-relational-foreign-keys.md) protect the root
through settlement and retain their existing ordering.

The paired proof showed removal of a prior claim before same-root replacement,
independent reverse observations for both Address references, and the distinct
stale-handle, already-compensated and callback-free replay outcomes. Reassess
the private records if the native retained handle gains an equivalent
generation contract.
