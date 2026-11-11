# Bounded fixed query targets

Design status: **Selected for the authorized old-core caller migration**.
Implementation status: **Core and Application source correction; consumer cutover open**.
Measurement status: **Unmeasured**.
Owner: [translated-Core source contract](../../../../roadmaps/query-sync-engine/preflight/16-translated-core-source-retirement.md).

## Pinned mechanism

Convex `db914cf06e2b06ee985646611b9e12ed7a770318`'s
`crates/database/src/write_log.rs` captures a fixed write-log snapshot for token
refresh, validates its maximum and purged timestamp, and reports overlapping
indexed writes. A token advances only over a complete retained interval.
Subscriptions process timestamp intervals rather than assuming dense timestamps.

The translated Core already has immutable write-log snapshots and exact index
interval dependencies. Reuse those owners; do not create a second log, a dense
counter, a durable commit-receipt chain or an equality-key approximation.

## Runtime adaptation

The initial trusted in-process source uses a scoped `withQueryTarget` callback.
It captures published data, registry, resident view and write log together.
Every borrowed query reads that exact timestamp, even if later writes cause
the ordinary snapshot cache to prune its entry. A target holds no physical
transaction over Worker execution.

The callback has an explicit 1–10,000 millisecond deadline and the owning Core
defaults to at most 64 concurrent targets. These bounds protect the TypeScript
owner's captured state; they are not a new commit clock or subscriber lease.
Release revokes the capability and aborts/drains unfinished queries. Deadline,
owner closure, retention and current metadata are rechecked before disclosure.
The configured query runner authenticates the target's issuing Core before
using it, including when another target has identical source/profile metadata.

Read-token issuance remains inside Core. Detached byte views cannot erase its
tracked dependencies. Refresh accepts only that owner's completed tokens and
rejects timestamps beyond the captured target. A dependency overlap returns
ordinary `None`; missing retained evidence fails explicitly. Cold owner tokens
are foreign evidence, rather than permission to infer clean history from rows.

Current code/schema/source authorization is separate from historical data
validity. Application completion derives metadata dependencies against its
evaluation registry, retains their actual frontiers and validates current and
pending metadata. Successful complete refresh advances validated metadata
frontiers with the result token. Later ordinary data writes outside the chosen
interval do not invalidate a result at the fixed target. A changed program may
still be visible inside the old snapshot, but its result cannot pass the current
metadata fence.

## Consumers and removal

The existing Application evaluator borrows this source capability; its Worker
execution, read-session drain, argument/result validation and read-only boundary
remain with their current owners. The authoritative evaluation codec admits
physical 16-byte index identities and exactly the Core-owned `fe`/`ff` 17-byte
virtual metadata identities. It does not omit metadata evidence for transport.

This is the necessary Core source correction before the accepted fixed-target
live-query replacement. It does not activate subscriptions or retire the dense
private catch-up host/state by itself. The source contract names that remaining
caller; standalone service/session/state gates remain open. No durable table or
deployed data conversion is introduced by this adaptation.

Paired owner and actual Worker scenarios cover fixed data, dependency refresh,
metadata fencing, escaped/foreign capabilities, retention, deadline and cleanup.
They establish local PGlite and ordinary-role PostgreSQL behavior, not deployed
Cloudflare, arbitrary retained-history reconstruction or performance.
