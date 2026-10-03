# Core performance

The daily performance loop runs actual Payload Local API operations, native
Medusa workflows and Flarex execution/persistence owners directly in Node.
It uses ordinary-role PostgreSQL and real transaction settlement. It does not
start Workerd, Miniflare or an HTTP server.

From the workspace root, with `FLAREX_POSTGRES_DATABASE_URL` configured for the
existing isolated PostgreSQL test environment:

```sh
pnpm perf:core --scenario payload-create
pnpm perf:core --scenario medusa-workflow
pnpm perf:core --scenario mixed-product
pnpm perf:core --scenario mixed-payload --sql
pnpm perf:core --scenario mixed-workflow
pnpm perf:core --all --full
```

The environment must have the test fixture's existing provisioning permissions;
request execution uses its ordinary runtime roles. Do not point this harness at
an application database. Credentials are supplied by the caller, not saved in
the reports or command examples.

The default scenario is Payload create. A short series is for iteration, not
tail-latency acceptance. `--full` selects the larger warm sample set; `--sql`
adds a separate diagnostic invocation before quiet warmup and timing, rather than
tracing every timed request. Its SQL count describes that first diagnostic request,
not a warmed SQL distribution.
Failed operations are reported as failures and the command exits unsuccessfully.
With `--all`, independent scenarios still run so one failure does not hide the
other results.

## What is measured

- `payload-create`: native Payload create through the preference-enabled CMS
  host, with committed readback and cleanup outside the request timer.
- `medusa-workflow`: the actual Product/Pricing/Link/Tag launch workflow through
  the independently settling Flarex workflow host.
- `mixed-product`: Application mutation plus Product update/read operations,
  including admission, journal, OCC and publication.
- `mixed-payload`: the same mixed graph plus Payload create/read/update hooks.
- `mixed-workflow`: Application, Product/Pricing/Link/Tag workflow and Payload
  under the existing mixed outer owner.

There is no standalone Application-only scenario in this initial suite;
`mixed-product` must not be reported as one. Existing standalone read/native
comparison suites keep their own business graphs and acceptance gates.

Preparation is reused only within the existing bounded host lifetime. Every
request receives fresh request/attempt state; authority checks and commits are
not cached or replaced by a test-wide rollback. Reports separate request samples
from setup, seeding, verification and cleanup, and include overall runner cost.
SQL diagnostics count observed client dispatches, not nested PostgreSQL statements
or the standalone historical Payload benchmark's `pg_stat_statements` metric.

## Host integration and ownership

The direct driver is a trusted test runner at the portable execution boundary.
It does not prove Worker isolation, deterministic globals, service-binding
transport or hosted cancellation. Backend Worker integration tests retain their
explicit host adapter and consume the shared scenario assembly. Full historical
benchmark reports remain evidence of their original execution boundary.

Framework behavior stays in its adapter, database mechanics in persistence, and
mixed composition in executor test support. No production dependency on Payload
or Medusa is added to executor or persistence. See the
[approved harness preflight](../../../../roadmaps/mixed-mutation-core/21-core-performance-harness-preflight.md)
for replacement and completion gates, including the owner's authorized follow-up
to correct the reproduced mixed admission failures and measured harness costs.
