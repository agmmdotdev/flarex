# P35 SessionDO-Owned Postgres Teardown

Status: complete on 2026-07-20. The publishable final campaign and every prior
non-publishable attempt were sealed or reconciled before all external and local
credential resources were removed.

Cleanup completed in this order:

1. seal and purge the corrected-but-version-mixed `v3` campaign;
2. complete, seal, persist, and application-purge the fresh 32-sample `v4`
   campaign;
3. deploy deleted-class migrations and delete both `v4` and `v3` Workers;
4. delete the cache-disabled Hyperdrive configuration;
5. drop the isolated Neon schema and generated role through the owner
   connection;
6. remove generated runtime config, recovery state, bearer token, disposable
   local PostgreSQL state, and the Windows user-scoped owner URL; and
7. independently recheck Cloudflare, database, filesystem, environment, and
   repository-secret absence.

## Absence Proof

- Both `flarex-runtime-topology-probe-session-postgres-v3` and `-v4` return
  Cloudflare API code 10007, Worker does not exist. Earlier generations were
  already absent under the preceding P35 checkpoint.
- `wrangler hyperdrive list` returns no configurations.
- The owner-authorized catalog query returns schema count 0 and generated-role
  count 0.
- The generated Postgres recovery state, bearer token, Hyperdrive runtime
  config, and disposable local PostgreSQL directory are absent.
- `RUNTIME_TOPOLOGY_PROBE_OWNER_DATABASE_URL` is absent from the Windows user
  environment.
- The supplied Neon host and password fragments are absent from every source,
  configuration, documentation, and test file under the app.

Ignored, secret-free local evidence may remain for reproducibility. It is not a
live credential or Cloudflare resource and is not staged for Git.

P35 closes the production experiment. No probe Worker, live Durable Object
class, Hyperdrive configuration, Neon schema, Neon role, or live local
credential remains.
