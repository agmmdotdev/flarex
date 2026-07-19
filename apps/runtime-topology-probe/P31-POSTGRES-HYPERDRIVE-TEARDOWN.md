# P31 Postgres And Hyperdrive Teardown

Status: complete on 2026-07-19. Production evidence was sealed before every
external and local credential resource was removed.

The two campaign artifacts were persisted before cleanup. Both campaign state
machines reached `purged`. Because this slice did not add a Postgres purge RPC,
the terminal probe rows remain until the isolated schema is dropped. This is a
recorded P28 gate miss, not hidden cleanup success.

Cleanup completed in this order:

1. deploy the gateway deleted-class migration and delete the gateway Worker;
2. delete the mock and Postgres Workers so they release SyncDO/Hyperdrive
   bindings;
3. deploy the SyncDO deleted-class migration and delete the sync Worker;
4. delete Hyperdrive;
5. use the owner connection locally to drop the entire isolated schema and
   generated role;
6. delete the ignored local token/runtime state; and
7. prove absence through Worker, Hyperdrive, database, environment, and Git
   checks.

The first attempted SyncDO deleted-class deployment was correctly refused while
the mock and Postgres Workers still referenced that class. After deleting those
dependent Workers, the same migration succeeded. This validates the dependency
ordering instead of bypassing it.

## Absence Proof

- Cloudflare deployment lookups for gateway, mock, Postgres, and sync each
  returned API code `10007`, “Worker does not exist.”
- `wrangler hyperdrive list` returned no configurations.
- An owner-authorized Postgres catalog query returned schema count zero and
  generated-role count zero.
- The ignored generated Hyperdrive config, generated-role state, and local
  bearer-token file are absent.
- The owner database URL environment variable is absent.
- Only secret-free ignored raw/summary/checkpoint evidence remains locally.

P31 closes the isolated production goal. No probe Worker, Durable Object class,
Hyperdrive configuration, Neon schema, Neon role, or live local credential
remains.

Post-evidence review hardened future interrupted cleanup. Provisioning writes
progressive recovery state before external mutation; teardown strictly
validates it, journals create-attempted before Wrangler, checks the generated
config, and uses bounded repeated name lookups when creation completed before
its ID was journaled. It tolerates already-absent Cloudflare state, uses
idempotent database drops, and removes the recovery journal only after cleanup
succeeds.
Every recovery-state replacement is flushed to a restrictive temporary file
and atomically renamed; an interrupted publication retains the last valid
journal instead of truncating the only cleanup authority.
The generic local-secret cleanup cannot delete that Postgres recovery journal.
