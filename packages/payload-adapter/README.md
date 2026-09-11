# `@flarex/payload-adapter`

Private Payload compatibility and runtime composition over Flarex-owned CMS
capabilities. This package owns the exact Payload release profile, Local API
adapter boundary, request normalization, and response/error projection. It
does not own SQL, transaction settlement, Application materialization, commit
publication, or production routing.

The profile subpath also issues the opaque exact-content token required by
Payload lifecycle binding admission. That token carries no database, migration,
settlement, or publication capability.
