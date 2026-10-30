# Cloudflare PostgreSQL socket shutdown ownership

Design status: **Required host-driver correction within the actual-DO slice**.
Implementation status: **Versioned patch, controlled conformance and bounded actual-host proof implemented**.
Measurement status: **Unmeasured**.
Owner: [actual DO query composition](../slices/03-application-query-do-host.md).
This refines the [client lifetime](./postgres-client-lifetime.md); it does not
change database authority, publication, query semantics or retry eligibility.

## Pinned mechanisms and observed conflict

Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`
[connection.rs](../../../../../../crates/postgres/src/connection.rs),
`ConvexPgPool::create_connection`, owns the connection's `poll_message` future
and reports its errors. Closed/poisoned connections are not reused. The Rust
driver does not expose this work as an unowned JavaScript EventEmitter event.

The selected host executes `pg-cloudflare@1.4.0`, package source Git identity
`544b1ce8152bc280e398dc1e8a66920abe6a640e`. Its `workerd` entry executes
`dist/index.js`; the ESM entry delegates to that file. The source independently
starts the reader pump and observes `socket.closed`. It can emit terminal close
before a later reader error; rejection of `socket.closed` does not guarantee
close. Its `Socket.close()` promise is also unobserved. `pg` resolves client end
from the close path, allowing our client observer to detach too early.

The pinned local workerd trace confirms a client error after fulfilled client
end, with the same internal-error identifier as the runtime socket error. This
establishes the lifetime violation. It does not by itself prove the cause of
the outer Miniflare HTTP reset. Preserve that distinction in validation.

The pinned official `node:net.Socket` is not an automatically sound replacement:
its June implementation catches and ignores reader failures. A normal-query
probe cannot prove that owner preserves failure semantics. The September
implementation propagates reader failures, but selecting another transport or
runtime still requires its own supported profile and adversarial proof. Do not
substitute a transport that hides this witness merely to obtain a passing run.

## Necessary replacement at the actual owner

Persist a focused, versioned dependency patch; do not alter only the fixture
bundle, install a no-op listener, wait a guessed delay or retry failed requests.
Keep the existing driver, public stream API and normal SQL/transaction owners.

Own reader, pending write, cancellation, `Socket.close()` and `socket.closed`
outcomes for each socket generation. Terminal close must occur once, after
every task capable of emitting a driver event has settled. Report genuine
failures before that terminal event, including rejected closed promises.
Preserve the selected PostgreSQL transport's end contract. Pinned
`pg-cloudflare@1.4.0` closes its native socket after its final write; it does not
provide generic Node half-close or post-end peer-data delivery. Installed
node-postgres uses this end after sending Terminate. The
[PostgreSQL termination protocol](https://www.postgresql.org/docs/18/protocol-flow.html#PROTOCOL-FLOW-TERMINATING)
requires no termination acknowledgement. Normal end therefore drains accepted
writes, including Terminate, then explicitly cancels its reader and closes the
transport. Join all exposed outcomes before terminal close. This is transport
closure, not proof that any database transaction committed.

Destroy or genuine failure independently escalates an ordered transport end.
Request available native teardown without first waiting for pending writes, a
TLS transition or peer EOF; then join the exposed outcomes before terminal close.
Observe explicit reader cancellation and preserve errors already observed or
racing with shutdown. Keep ordered-end-started and forced-started state distinct.
Do not suppress arbitrary errors merely because shutdown was requested.

A generic writer-half-close branch was explored, but it is outside the recorded
PostgreSQL consumers and changes the upstream owner's contract. Remove that
branch and its exclusive writer-close classifier/tests rather than retaining an
unrequired second transport profile. Preserve required write ordering, callback,
failure, cancellation, TLS and terminal-barrier coverage.

The pinned native `Socket.close()` itself flushes writes before aborting. A
wrapper can request it promptly but cannot claim bounded destruction of a
genuinely stalled native write without a native-host witness. No guessed timer,
retry or swallowed failure supplies that missing capability.

The pinned workerd native TCP reader differs from a JavaScript-created readable
stream: successful `reader.cancel(reason)` rejects a pending read while
`reader.closed` fulfills. Object reasons are cloned with their own data intact;
string reasons become new Error objects. Reference identity and error messages
therefore cannot identify the driver's own cancellation reliably.

Give each reader cancellation a private nonce-bearing object reason. Recognize
only that generation's exact nonce data at the `reader.read()` rejection
boundary, after its own cancellation has been requested. Keep data callbacks
outside that classification. This identifies an owned cancellation rather than
suppressing arbitrary errors during shutdown. Preserve unrelated read failures
and separately observe cancellation, native close and closed-promise failures.
Do not match error messages, codes or a general closing flag. Cover the native
clone behavior and a competing genuine failure; retain a bounded actual-workerd
TCP witness so runtime changes cannot silently invalidate this adaptation.
The marker remains private to its reader generation; another generation's marker
or a matching-looking rejection from another operation is still a failure. This
preserves outcomes exposed by the native API; it cannot reconstruct a competing
failure that the native API itself replaced before exposing it.

Respect Node's `write(data, callback)` overload as well as the encoding form;
the PostgreSQL graceful-end callback must execute. `_listenOnce` must handle
`done` without constructing a buffer from an absent value. STARTTLS retires the
old socket/reader and creates a new generation; joining or closing the retired
generation must not terminate its replacement or discard a real failure.

Preserve node-postgres's direct TLS negotiation as well as its PostgreSQL `S`
response handshake. Direct negotiation calls `startTls()` synchronously from
the connection callback, before any plaintext response exists. Start the initial
negotiation read only after those callbacks have selected the transport. A direct
upgrade retires a reader that has not started; the `S` mode still joins its actual
negotiation read. Never wait for nonexistent plaintext bytes or cancel the old
socket to simulate TLS handoff. Shutdown must settle in either ordering.

Core query/transaction logic remains unchanged. The existing invocation observer
stays installed until this actual shutdown barrier, then performs its normal
failure/cleanup propagation. No extra transaction, SQL probe, end retry, global
error handler or second completion owner is introduced.

The patched owner is `CloudflareSocket`: `_openGeneration` owns stream tasks,
`_track` retains their outcomes, and `_finish` joins them before terminal close.
`_read` alone classifies the private cancellation acknowledgement through
`_isCancellation`; `_pump` decodes and dispatches data outside that catch.
The checked-in patch includes TypeScript source, executable CommonJS output and
the declaration companion for the existing ESM entry. Both the executor and
node-postgres resolve that same patched dependency.

## Required conformance and removal

Exercise the actual patched implementation with controlled socket tasks:
Terminate/write ordering before end; ordered end to forced escalation; held
writes; active-query destruction; delayed reader failure; rejected
closed/close/cancel/write outcomes; two write overloads; direct and `S` TLS
handoff; destruction during transition; and exactly one final close with no later
driver events. Fakes may supply primitive socket I/O and peer outcomes; they
must not implement the driver's state machine.

The earlier query-only DO scenario at Flarex 22930f93c exercised normal shutdown,
idle disconnect, complete failure Causes and cold reconnect. Its
[shared app successor](../../../../apps/executor/test/applicationDO.postgres.test.ts)
has its own scope in slice 06c; earlier evidence is not automatically a new-core
certificate. The separate
[STARTTLS scenario](../../../../apps/executor/test/pgCloudflareSocket.postgres.test.ts)
uses that database's TLS listener and the actual Cloudflare socket, without
Hyperdrive's Node TLS proxy. Explicit fixture CA trust belongs only to the
runtime's loopback network service. Empty trust fails before application SQL;
successful trusted connections before and after provide the positive controls.
The native API exposes a generic network failure, so the test retains its full
Cause rather than inventing certificate-specific public error semantics.

Direct TLS negotiation remains controlled-primitive coverage. Hosted Hyperdrive,
native stalled-write destruction bounds and the precise cause of the earlier
June access violation remain unproved. Both mandated reviewers inspect the
patch, source/dist correspondence, package integration and final runtime
evidence; validation receipts belong in Git.
