# P21 Local Facet Finalizer Proof

Status: implementation, local runtime proof, deployment dry-runs, and both
mandatory final reviews complete on 2026-07-19.

## Implemented Boundary

The new `facet_finalizer_invoke` candidate uses a distinct
`invoke-finalizer-v1` code identity. SessionDO acquires the same trusted
synthetic snapshot as the retained `facet_executor_invoke` control and loads an
attempt-scoped Dynamic Worker facet with exactly one injected
`EXECUTOR_FINISH.finish` capability.

Inside platform-owned facet shell code, the candidate:

1. fences one exact request in facet SQLite;
2. verifies the supplied snapshot;
3. writes, synchronizes, and reads back its logical read set, journal, seal,
   result, and commit intent;
4. moves the synthetic attempt from `running` to `finishing`;
5. invokes the narrow finish capability once and strictly verifies the combined
   MockFinish/SyncDO receipt;
6. stores a byte-replayable response while moving to `committed`; and
7. returns that response to SessionDO.

SessionDO does not call MockFinish on this path. It strictly correlates the
facet response to its admitted request, records the completed outer response,
and retains lifecycle and cleanup ownership.

## Local Evidence

Focused protocol tests accept only a committed candidate with exactly one
finish call and the exact attempt identity. Zero calls, forged attempt identity,
wrong source profile, mismatched snapshot, or changed intent evidence fail
closed. Non-finalizer scenarios must remain `sealed`, report zero finish calls,
and carry no embedded finish receipt.

The Miniflare proof executes the real bundled Worker graph and observes:

```text
external_request
  gateway_session_rtt
    session_snapshot_read_rtt
    session_facet_rtt
      facet_snapshot_read
      facet_journal_io
      facet_atomic_commit_rtt
        mock_sync_wake_rtt
          sync_cursor_io
```

It verifies executor host `facet-finalizer`, zero facet read calls, one facet
finish call, zero SessionDO finish duration, a committed embedded receipt, one
applied SyncDO cursor advance, byte-identical completed replay, changed-request
conflict, exact equality between embedded and outer finish receipts, and no
second cursor advance. The generated facet source has outbound
networking disabled, contains neither `MOCK_FINISH` nor `PROBE_SYNC`, and is
injected only with the narrow `EXECUTOR_FINISH` binding.

Failure injection also applies the SyncDO wake and then throws before the
finish receipt returns. SessionDO retains the facet, durably fences the outer
attempt as `finishing`, returns `facet_finalizer_outcome_uncertain`, rejects an
exact retry as busy, and observes the single applied cursor. It does not record
that outcome as an ordinary replayable failure or destroy the recovery evidence.
The public gateway preserves this as distinct non-retryable
`outcome_uncertain` evidence. The resumable purge deletes the retained facet,
clears probe data, retains the completion tombstone, and replays idempotently.
By contrast, a strictly decoded `gap` or `stale` receipt is known-settled and is
durably replayed as the exact 409 rather than relabeled uncertain.

The 12 matched pairs are parity-counterbalanced: odd pairs run the control
first and even pairs run the candidate first. An exact matrix regression test
pins all 24 runs, 28 executions, four warmups, dimensions, arm order, IDs, and
budget totals.

The current local receipt is:

- package typecheck green;
- all 27 Vitest files and 247 tests green;
- sync, mock, gateway, gateway-teardown, and sync-teardown Wrangler dry-runs
  green; and
- focused candidate protocol and end-to-end Miniflare tests green.

Both final TypeScript/Effect and systems-quality reviews reported no actionable
findings. Production evidence is not claimed here.

## Explicit Non-Proof

The candidate still calls MockFinish and synthetic SyncDO. It does not show that
Hyperdrive can preserve a Postgres transaction across Worker RPC, and it does
not test real OCC, SQL compilation, database credentials, application writes,
or authoritative outcome lookup. Facet SQLite cannot resolve the uncertain
window after an external commit but before local response persistence; a real
implementation must resolve that from the attempt outcome stored atomically in
Postgres.
