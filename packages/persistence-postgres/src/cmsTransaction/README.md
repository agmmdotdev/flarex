# Direct CMS Execution

This folder owns trusted persistence capabilities used by Payload. Native Local
API access, validation, hooks and results stay in `@flarex/payload-adapter`.

| Start here | Responsibility |
| --- | --- |
| [read/host.ts](read/host.ts) | Construct a managed reader exposing `read`, `close` and its budget |
| [read/configuration.ts](read/configuration.ts) | Independent trusted read configuration |
| [host.ts](host.ts) | Existing full-proof direct read/write host and its settlement lifecycle |
| [commands.ts](commands.ts) | The single authenticated command registry and command context |
| [failure.ts](failure.ts) | Shared request-error projection, preserving causes |
| [context.ts](context.ts) and [lifetime.ts](lifetime.ts) | Owned request capabilities, nested calls and closure |
| [documents.ts](documents.ts) | Admitted document operations |
| [borrowedLogicalAttempt.ts](borrowedLogicalAttempt.ts) | Borrow the Application mutation's snapshot and pending changes |
| [publication.ts](publication.ts) | Direct CMS settlement integration |
| [testSupport.ts](testSupport.ts) | Explicit persistence test instrumentation contracts |

Payload's `bindRead` constructs the read capability. Its `bind` constructs the
existing write-capable profile. Both share native operations and the scoped
Payload instance. A borrowed operation does not call either direct host to
settle: the Application mutation remains the outer owner.

The [execution architecture roadmap](../../../../roadmaps/execution-architecture/README.md)
owns later runtime/test separation and orchestration placement. Broader Payload
operation support remains subject to the existing admission contracts.
