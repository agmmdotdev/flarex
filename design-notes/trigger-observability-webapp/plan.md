# Trigger Webapp Preservation And Flarex Observability Extraction

Status: source-preservation boundary approved; active Flarex extraction remains
a separately approved capability

Last reviewed: 2026-08-02

## Purpose

Flarex needs task and run observability without rebuilding every operational
interaction from first principles. Trigger.dev already contains mature run
lists, trace timelines, log and error views, retry/cancel/replay controls,
realtime refresh behavior, presenters, operational administration, and the glue
that turns run-engine events into user-visible state.

This note owns the boundary for preserving that implementation as evidence and
for extracting it into a future Flarex-native observability product. It does not
accept the Trigger web application as a Flarex runtime, data model, public API,
identity system, or deployment architecture.

The pinned source is preserved at:

```text
third_party/trigger.dev/upstream/apps/webapp
```

Its provenance is owned by
`third_party/trigger.dev/SOURCE.json`,
`third_party/trigger.dev/SOURCE_SHA256SUMS`, and
`third_party/trigger.dev/NOTICE.md`.

## Approved Outcome Of The Preservation Slice

The complete `apps/webapp` tree from Trigger.dev commit
`f10bc23785e569e5d917318cf2033aabdbe96a0b` is retained unchanged beside the
existing run-engine and supervisor compatibility source.

The preserved application is:

- source-only reference material;
- excluded from Flarex's root pnpm workspace;
- excluded from the compatibility island's nested build workspace;
- never started by a Flarex command or CI job;
- unable to own Flarex routes, authentication, tenants, database state,
  artifacts, scheduling, compute, or billing;
- protected by the same source checksum, Git path, mode, and symlink
  verification as the existing compatibility island; and
- inaccessible from active Flarex packages through the repository's Trigger
  compatibility boundary check.

This slice intentionally preserves complete context instead of prematurely
copying isolated React components whose behavior depends on server loaders,
presenters, services, identity, realtime delivery, and run-engine events.

### Relationship To The Durable-Execution Proposal

This preservation decision refines the earlier proposal's blanket exclusion of
the complete Trigger webapp. The product-level decision has not changed:
Flarex will not adopt or activate that application wholesale. The narrower
decision here is to retain its complete pinned source as inert evidence so the
future Flarex observability work can extract bounded behavior without losing
the route-to-service and event-to-presentation context.

## What The Trigger Webapp Actually Contains

The upstream directory is a complete Node control-plane application, not a
frontend-only package. Its major responsibilities include:

1. React and Remix routes for tasks, runs, schedules, deployments, settings,
   logs, errors, and administration.
2. Run-list and run-detail components, trace trees, execution timelines, span
   inspection, structured logs, payload/output display, replay, and
   cancellation interactions.
3. Remix loaders/actions and API/resource routes that read or mutate Trigger
   state.
4. Presenter and repository layers that combine PostgreSQL/Prisma records with
   ClickHouse event and trace data.
5. Realtime run, batch, session, and stream delivery through WebSockets,
   Socket.IO, server-sent events, Redis-backed coordination, and change
   notification services.
6. Run-engine event handlers that complete observability events, publish
   realtime changes, evaluate alerts, meter usage, and project terminal state.
7. OTLP ingestion and transformation, OpenTelemetry setup, source-map handling,
   log filtering, retention enforcement, and error grouping.
8. Trigger authentication, sessions, RBAC, SSO, organizations, projects,
   runtime environments, invitations, impersonation, and API authentication.
9. Build, deployment, worker-version, artifact, container-registry, and compute
   administration.
10. Billing, limits, quotas, usage, alerts, support, analytics, and internal
    recovery tools.

The webapp therefore provides useful product behavior and architectural
evidence, but it also demonstrates why activating it directly would create
duplicate Flarex authorities.

## Authority Boundaries

The following Flarex owners remain authoritative:

| Concern | Flarex owner |
| --- | --- |
| Public task and observability APIs | Flarex SDK and generated references |
| User, membership, app, and environment identity | Flarex control plane |
| Deployment and immutable artifact identity | Flarex analysis, push, and artifact owners |
| Committed application data and OCC | FlarexDB and the trusted Postgres executor |
| Durable run mechanics | Future Flarex-owned Trigger-derived engine |
| Compute placement and bootstrap | Flarex runtime adapters, including future AgentOS support |
| Customer authorization and redaction | Flarex control plane and observability API |
| Dashboard routes and presentation | Future Flarex dashboard |
| Internal cross-tenant operations | Future Flarex internal operations console |

The preserved Trigger source has no authority in any of these domains.

## Source Classification

### Keep As Frozen Evidence

Keep the complete upstream application unchanged in `third_party` so later
work can inspect interactions across route, component, presenter, service, and
engine-event boundaries.

This frozen copy is not gradually edited into Flarex. Derived Flarex code moves
to Flarex-owned packages and applications with attribution where required.

### Port

The leading candidates for bounded behavioral or visual porting are:

- task and run tables;
- status and duration presentation;
- run detail layout;
- trace/span tree and timeline interactions;
- structured log table and filters;
- payload, metadata, output, and error inspectors;
- retry, cancel, replay, and reschedule interaction design;
- task, schedule, queue, and concurrency views;
- error grouping and failure navigation;
- live-refresh interaction behavior;
- internal run-debugging and recovery views; and
- focused upstream tests that describe these user-visible behaviors.

A port means preserving useful behavior through Flarex-owned contracts. It does
not mean importing `apps/webapp` or its package name from active code.

### Rewrite Against Flarex Owners

These areas contain useful logic but must be rewritten at their authority
boundary:

- presenters and repositories must query a Flarex run/event read model;
- route loaders and actions must use Flarex identity and authorization;
- realtime subscriptions must use a Flarex-owned transport;
- run-engine event handlers must become a backend execution-event processor;
- alerts must consume Flarex run events and Flarex notification integrations;
- usage must meter Flarex compute and retention policy;
- deployment and worker views must consume Flarex artifact and runtime state;
  and
- source-map lookup must use Flarex build and artifact metadata.

### Do Not Port As Product Architecture

Do not adopt:

- Trigger organizations, projects, runtime environments, or API keys;
- Trigger authentication, SSO, session, or impersonation authority;
- Trigger public SDK and task-registration globals;
- Trigger billing plans and cloud limits;
- Trigger deployment APIs, OCI assumptions, AWS ECR/S3, or Depot ownership;
- Trigger branding and product navigation;
- Trigger Prisma schema as Flarex platform authority; or
- a second writable run, tenant, artifact, or billing system.

Vendor integrations may still provide implementation evidence, but each future
Flarex integration requires its own owner and capability decision.

## Rejected Direct Activation

Moving the upstream application to `apps/webapp` or adding it to either pnpm
workspace is rejected for this preservation slice.

Direct activation would immediately couple Flarex to:

- Remix 2 and an Express/Node cluster server;
- the pinned app's React and Vite versions;
- Trigger workspace packages that are intentionally absent;
- Prisma and Trigger database models;
- Redis, Socket.IO, ClickHouse, and OTLP infrastructure;
- Trigger tenancy and route authorization;
- Trigger deployment and billing services; and
- a large set of environment variables and provider credentials.

Making that application start is not equivalent to integrating observability.
It would prove only that a second Trigger control plane can run beside Flarex.

## Target Flarex Decomposition

The likely long-term responsibility map is:

```text
apps/
  dashboard/                   customer-facing Flarex application
  internal-ops/                privileged cross-tenant operations
  control-plane-api/           identity, authorization, run control
  telemetry-ingest/            logs, traces, metrics, source-map association

packages/
  observability/               Flarex run/event presentation contracts
  observability-read-model/    queries, filters, pagination, projections
  execution-event-processor/   engine event to trace/realtime/alert projection
  realtime/                    authorized change delivery
  alerts/                      alert policies and notification dispatch
  usage-metering/              compute, log, trace, and retention accounting
```

Names are provisional. A package should be created only when its authority and
dependency direction are proven by the active slice.

## Proposed First Active Slice

The first active observability capability should be read-only and independently
runnable.

A proportional implementation preflight should decide final naming and
framework placement, but the proposed outcome is:

- one Flarex-owned observability contract;
- one provider/reader boundary;
- one run-list screen;
- one run-detail screen;
- one trace/span timeline;
- one log and error inspector;
- representative queued, running, retrying, completed, failed, and canceled
  fixtures;
- navigation from list to detail;
- build, typecheck, and focused behavioral tests; and
- no import from `third_party/trigger.dev`.

A possible provider seam exposes `listRuns`, `getRun`, and `listRunEvents`
operations over Flarex-owned query and result types. The separately approved
implementation preflight must choose the concrete Effect service/Layer and
framework bridge. It must model not-found, authorization, transport, storage,
and cancellation outcomes explicitly instead of fixing the domain contract to
bare `Promise` rejection or ambiguous nullability here.

The first implementation may use immutable fixtures so the UI and contracts can
be proven before Flarex has an accepted durable-run persistence API.

```text
Flarex observability UI
  -> Flarex ObservabilityReader
  -> fixture adapter
```

A later approved slice replaces only the adapter:

```text
Flarex observability UI
  -> Flarex ObservabilityReader
  -> authorized observability API
  -> Flarex run/event read model
  -> Trigger-derived engine events
```

The fixture boundary must be visibly identified and have a deletion gate. It
must not become a second source of runtime truth.

## Later Extraction Order

1. Preserve and inventory the upstream source.
2. Implement the read-only Flarex observability contract and runnable fixture
   application.
3. Define Flarex run, attempt, event, span, log, and artifact identities.
4. Define the engine-event processor and durable observability projection.
5. Connect an authorized read API without activating run mutations.
6. Add live updates through a Flarex-owned realtime transport.
7. Add cancel, replay, retry, and reschedule commands after their durable engine
   semantics are accepted.
8. Add alerts, retention, usage metering, and source-map processing.
9. Add the internal operations console with separate authorization and audit
   policy.
10. Remove every temporary fixture or compatibility adapter after its real
    replacement proves parity.

## Security And Privacy Gates

Before real run data is exposed, the Flarex API must define:

- tenant/app/environment authorization;
- internal-versus-customer role separation;
- payload, output, and metadata redaction;
- environment-variable and secret suppression;
- sensitive HTTP header filtering;
- stack-trace and source-map access policy;
- AI prompt, model output, tool argument, and token-usage policy;
- retention and deletion;
- audit records for privileged inspection and run-control commands; and
- bounded pagination, search, and export behavior.

The internal console may inspect cross-tenant operational state only through a
separately authorized path. Customer dashboard code must never rely on UI
filtering as its tenant boundary.

## Preservation Validation

The source-preservation PR is complete only when:

- every regular imported file matches `SOURCE_SHA256SUMS`;
- the webapp symlink target and executable mode match the pinned Git tree;
- the Git index contains exactly the imported source set;
- the Flarex root boundary rejects active imports or file dependencies into the
  compatibility island;
- the existing nested run-engine/supervisor install, typecheck, and test
  commands remain unchanged by the source-only webapp addition;
- roadmap and island documentation state that the webapp is inert; and
- the required repository reviewers report no unresolved findings.

Building or starting the original Trigger webapp is not a preservation exit
criterion. A future decision to make the original application buildable would
require importing its exact workspace dependency closure and proving its
external service requirements; that is not the recommended Flarex integration
path.

## Open Decisions For The Active Slice

The next preflight must decide:

1. Whether the first application is named `dashboard`, `observability`, or a
   deliberately temporary lab.
2. Whether it is a Vite SPA, a Cloudflare-hosted server-rendered application,
   or another existing Flarex-compatible host.
3. Which portions of Trigger's visual design are ported versus redesigned.
4. The exact Flarex run/event read contract and its forward compatibility.
5. Whether logs and spans share one ordered event stream or separate stores and
   projections.
6. The initial realtime transport.
7. Which run fields are customer-visible, internal-only, or redacted.
8. The point at which fixture data is replaced by an actual Flarex run
   projection.
9. Whether the internal operations console shares components with the customer
   dashboard or only lower-level presentation packages.
10. The exact attribution required in derived source files.

Until that preflight is approved, the only accepted behavior is preservation of
the pinned upstream webapp as inert source evidence.
