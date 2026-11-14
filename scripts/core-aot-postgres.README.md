# Local PostgreSQL for Core AOT requests

Use PowerShell 7.2 or newer, the workspace Node runtime, and PostgreSQL **18.7** Windows x64 server
binaries from the [official PostgreSQL Windows download page](https://www.postgresql.org/download/windows/)
and its linked [EDB binary archive](https://www.enterprisedb.com/download-postgresql-binaries).
Extract the archive; no installer or Windows service is needed. The default
binary directory is `work/tools/postgres/server-18.7/pgsql/bin` in this checkout.

From the repository root:

```powershell
./scripts/core-aot-postgres.ps1 -Action Start
# Or point at another extraction of the same pinned binaries:
./scripts/core-aot-postgres.ps1 -Action Start -BinDirectory C:/path/to/pgsql/bin
```

The script creates an owned cluster in `work/validation/core-aot-postgres`,
listens only on `127.0.0.1:55432`, and exports these variables into the current
PowerShell process:

- `FLAREX_POSTGRES_DATABASE_URL`: ordinary `flarex_aot_runtime` request role.
- `FLAREX_POSTGRES_PROVISIONING_DATABASE_URL`: separate cluster administrator.

Both use the disposable `flarex_core_aot` database. The request role has no
superuser, RLS bypass, database creation, role creation or replication privilege.
Core fixtures still create, grant and clean their own unique namespaces through
the separate provisioning pool. SCRAM authentication uses random per-cluster
passwords. `fsync`, `synchronous_commit` and `full_page_writes` remain enabled.
No global PostgreSQL configuration, system service or existing database changes.

The ignored state directory retains owner metadata, private credential-bearing
`endpoints.json`, initialization/startup logs and the cluster data. Do not copy
the endpoint file into reports or commits. Credentials are never printed by the
script. Start reuses only matching, complete owned state; it refuses unrelated
or partially initialized directories and never resets data.

```powershell
./scripts/core-aot-postgres.ps1 -Action Status
./scripts/core-aot-postgres.ps1 -Action Stop
./scripts/core-aot-postgres.ps1 -Action Start
```

`Status` exports endpoints when the exact owned server is running; it can be
used in a fresh PowerShell process before running a benchmark. Use identical
`-BinDirectory`, `-StateDirectory` and `-Port` values on later invocations if
the defaults were overridden. `Stop` checks ownership, the postmaster data and
port, the actual live process's binary, creation epoch and exact `-D` data
argument before stopping only that cluster. Missing or ambiguous OS identity
fails closed. A live process handle remains held during control. Data and logs
are retained. Stop the cluster after validation and measurement work finishes.

Run quiet requests separately from builds, profilers and tests. A local server
alone does not establish query, transaction, scale or production acceptance.

`core-aot-postgres-tool.mjs` directs native stdout/stderr into files. This avoids
waiting for pipe EOF when Windows `pg_ctl` descendants inherit the handles.
Run its process-lifecycle regressions separately from quiet measurements:

```powershell
node --test scripts/core-aot-postgres-tool.test.mjs
```

The identity regression checks quoted/unquoted argv and ambiguous refusals, then
uses two additional owned clusters on ports 55433/55434 to prove that a stale
PID naming another same-binary server cannot stop or adopt it. The main 55432
cluster stays running. Run it only outside quiet measurements; it retains logs
and stops both additional clusters:

```powershell
./scripts/core-aot-postgres-regression.ps1 -ParserOnly
./scripts/core-aot-postgres-regression.ps1
```
