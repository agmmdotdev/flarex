# Direct Commerce Execution

This folder owns trusted persistence capabilities used by direct Medusa calls.
Native service behavior stays in `@flarex/medusa-adapter` and the native modules.

| Start here | Responsibility |
| --- | --- |
| [read/host.ts](read/host.ts) | Construct a managed reader exposing `read` and `close` |
| [read/configuration.ts](read/configuration.ts) | Exact trusted installation and source selection for that reader |
| [host.ts](host.ts) | Existing full-proof direct read/write host, including replay and initialization |
| [hostConfiguration.ts](hostConfiguration.ts) | Trusted deployment capabilities shared with related Commerce construction |
| [commands.ts](commands.ts) | Authenticated command tokens and the native command context |
| [logicalParticipant.ts](logicalParticipant.ts) | Bind logical storage to the admitted direct operation |
| [borrowedLogicalAttempt.ts](borrowedLogicalAttempt.ts) | Participate in the outer Application mutation without independently committing |
| [publication.ts](publication.ts) | Direct Commerce settlement integration |

Both reader profiles invoke the existing native commands. The managed reader
uses the shared standalone read transaction and cannot initialize or write.
Passing a write token to its `read` still fails authority checks.

Atomic Commerce and finite workflows have their existing outer owner in
`../atomicCommerce`. They are not implemented by nesting a direct host. The
[execution architecture roadmap](../../../../roadmaps/execution-architecture/README.md)
owns later orchestration placement and cleanup; this folder name does not imply
that every execution path has already been consolidated.
