import { describe, expect, it } from "vitest";

import { h05CloudflareAccountIdSha256 } from "../h05/controlPlaneEvidence";
import type {
  H05CloudflareReadApi,
  H05CloudflareReadResult,
} from "../scripts/cloudflareReadApi";
import {
  collectH05ControlPlaneEvidence,
  decodeH05ExpectedPostgresTarget,
  type H05ControlPlaneCollectorOptions,
  type H05ExpectedPostgresTarget,
} from "../scripts/h05ControlPlaneCollector";

const accountId = "a".repeat(32);
const hyperdriveId = "b".repeat(32);
const firstZoneId = "c".repeat(32);
const secondZoneId = "d".repeat(32);
const observedAt = "2026-07-11T10:00:00.000Z";

interface FixtureOverrides {
  readonly accountSubdomainDrift?: boolean;
  readonly cachingDisabled?: boolean;
  readonly closingCachingDisabled?: boolean;
  readonly closingTracePersisted?: boolean;
  readonly closingZoneDrift?: boolean;
  readonly directStatus?: number;
  readonly domainTotalPages?: number;
  readonly domainUnfilteredTotalCount?: number;
  readonly duplicateZone?: boolean;
  readonly emptyZones?: boolean;
  readonly executorDeploymentDrift?: boolean;
  readonly hyperdrivePassword?: string;
  readonly multiPageZones?: boolean;
  readonly originUser?: string;
  readonly probeCompatibilityFlags?: readonly string[];
  readonly routeTarget?: boolean;
  readonly secretText?: string;
  readonly serviceEntrypoint?: string;
  readonly serviceEnvironment?: string;
  readonly sparseZonePages?: boolean;
  readonly settingsCompatibilityDate?: string;
  readonly unsupportedBindingType?: string;
  readonly zoneTotalCountDrift?: boolean;
}

describe("H05 Cloudflare control-plane collector", () => {
  it("retains the collector canonical timestamp diagnostic", async () => {
    const fixture = fixtureApi();

    await expect(collectH05ControlPlaneEvidence({
      ...collectorOptions(fixture.api),
      now: () => "2026-07-11T10:00:00.000+00:00",
    })).rejects.toThrow("must be a canonical UTC ISO timestamp");
  });

  it("projects a complete sanitized preflight and paginates every visible zone", async () => {
    const fixture = fixtureApi();
    const evidence = await collectH05ControlPlaneEvidence(
      collectorOptions(fixture.api),
    );

    expect(evidence.accountIdSha256).toBe(
      h05CloudflareAccountIdSha256(accountId),
    );
    expect(evidence.executor.privacy).toMatchObject({
      tokenScopeAttestation: "operator-attested-all-account-zones",
      opening: {
      customDomains: { filteredCount: 0, page: 1, totalPages: 1 },
      zones: {
        pageCount: 1,
        requestedTypes: ["full", "partial", "secondary", "internal"],
        zoneIds: [firstZoneId, secondZoneId],
      },
      routes: {
        checkedZoneIds: [firstZoneId, secondZoneId],
        inspectedRouteCount: 2,
        targetRouteCount: 0,
      },
      directRequest: { status: 404 },
      },
      closing: {
        zones: { pageCount: 1, zoneIds: [firstZoneId, secondZoneId] },
        routes: { checkedZoneIds: [firstZoneId, secondZoneId] },
      },
    });
    expect(evidence.executor.opening.version.versionBindings).toEqual([
      { type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" },
      {
        type: "hyperdrive",
        name: "HYPERDRIVE_CACHE_DISABLED",
        id: hyperdriveId,
      },
    ]);
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("db.example.test");
    expect(serialized).not.toContain("h05_private_db");
    expect(serialized).not.toContain("postgres-user");
    expect(serialized).not.toContain("unrelated.example.test");
    expect(serialized).not.toContain("unrelated/*");
    expect(fixture.calls).toContainEqual({
      path: "/zones",
      query: {
        "account.id": accountId,
        page: 1,
        per_page: 50,
        type: "full,partial,secondary,internal",
      },
    });
    expect(fixture.calls).toContainEqual({
      path: `/zones/${firstZoneId}/workers/routes`,
      query: undefined,
    });
    expect(fixture.publicOrigins).toEqual([
      "https://flarex-executor.example.workers.dev",
      "https://flarex-executor.example.workers.dev",
    ]);
  });

  it("supports an explicitly empty zero-page zone result after reading page one", async () => {
    const fixture = fixtureApi({ emptyZones: true });
    const evidence = await collectH05ControlPlaneEvidence(
      collectorOptions(fixture.api),
    );

    expect(evidence.executor.privacy.opening.zones).toMatchObject({
      pageCount: 1,
      zoneIds: [],
    });
    expect(evidence.executor.privacy.closing.routes).toMatchObject({
      checkedZoneIds: [],
      inspectedRouteCount: 0,
    });
  });

  it("retains unfiltered totals and accepts one complete multi-page zone transcript", async () => {
    const domainsFixture = fixtureApi({ domainUnfilteredTotalCount: 7 });
    const domainEvidence = await collectH05ControlPlaneEvidence(
      collectorOptions(domainsFixture.api),
    );
    expect(
      domainEvidence.executor.privacy.opening.customDomains
        .unfilteredTotalCount,
    ).toBe(7);

    const zonesFixture = fixtureApi({ multiPageZones: true });
    const zoneEvidence = await collectH05ControlPlaneEvidence(
      collectorOptions(zonesFixture.api),
    );
    expect(zoneEvidence.executor.privacy.closing.zones).toMatchObject({
      pageCount: 2,
      unfilteredTotalCount: 51,
    });
    expect(zoneEvidence.executor.privacy.closing.zones.zoneIds).toHaveLength(51);
  });

  it("rejects cache-enabled Hyperdrive and mismatched database targets", async () => {
    const cacheFixture = fixtureApi({ cachingDisabled: false });
    await expect(
      collectH05ControlPlaneEvidence(collectorOptions(cacheFixture.api)),
    ).rejects.toThrow("query caching must be explicitly disabled");

    const closingCacheFixture = fixtureApi({ closingCachingDisabled: false });
    await expect(
      collectH05ControlPlaneEvidence(
        collectorOptions(closingCacheFixture.api),
      ),
    ).rejects.toThrow("query caching must be explicitly disabled");

    const targetFixture = fixtureApi();
    await expect(
      collectH05ControlPlaneEvidence({
        ...collectorOptions(targetFixture.api),
        expectedPostgres: {
          ...expectedPostgresTarget(),
          database: "other_database",
        },
      }),
    ).rejects.toThrow("does not match the dedicated H05 database target");

    const roleFixture = fixtureApi({ originUser: "postgres" });
    await expect(
      collectH05ControlPlaneEvidence(collectorOptions(roleFixture.api)),
    ).rejects.toThrow("does not match the dedicated H05 database target");
  });

  it("fails closed if a Hyperdrive or secret response contains material", async () => {
    const hyperdriveFixture = fixtureApi({
      hyperdrivePassword: "must-never-escape",
    });
    await expect(
      collectH05ControlPlaneEvidence(
        collectorOptions(hyperdriveFixture.api),
      ),
    ).rejects.toThrow("Hyperdrive result unexpectedly contained secret material");

    const secretFixture = fixtureApi({ secretText: "must-never-escape" });
    await expect(
      collectH05ControlPlaneEvidence(collectorOptions(secretFixture.api)),
    ).rejects.toThrow("secrets[0] unexpectedly contained secret material");
  });

  it("rejects service binding environment and named-entrypoint selectors", async () => {
    const environmentFixture = fixtureApi({ serviceEnvironment: "staging" });
    await expect(
      collectH05ControlPlaneEvidence(
        collectorOptions(environmentFixture.api),
      ),
    ).rejects.toThrow("must not select a service environment or named entrypoint");

    const entrypointFixture = fixtureApi({ serviceEntrypoint: "Admin" });
    await expect(
      collectH05ControlPlaneEvidence(
        collectorOptions(entrypointFixture.api),
      ),
    ).rejects.toThrow("must not select a service environment or named entrypoint");

    const compatibilityFixture = fixtureApi({
      probeCompatibilityFlags: ["nodejs_compat"],
    });
    await expect(
      collectH05ControlPlaneEvidence(
        collectorOptions(compatibilityFixture.api),
      ),
    ).rejects.toThrow("must be empty for the H05 probe");
  });

  it("rejects deployment and non-versioned settings drift", async () => {
    const deploymentFixture = fixtureApi({ executorDeploymentDrift: true });
    await expect(
      collectH05ControlPlaneEvidence(
        collectorOptions(deploymentFixture.api),
      ),
    ).rejects.toThrow("active deployment changed during collection");

    const settingsFixture = fixtureApi({
      settingsCompatibilityDate: "2026-06-13",
    });
    await expect(
      collectH05ControlPlaneEvidence(collectorOptions(settingsFixture.api)),
    ).rejects.toThrow("settings do not match the active version runtime");

    const privacyFixture = fixtureApi({ closingZoneDrift: true });
    await expect(
      collectH05ControlPlaneEvidence(collectorOptions(privacyFixture.api)),
    ).rejects.toThrow("changed between its opening and closing sweeps");

    const traceFixture = fixtureApi({ closingTracePersisted: false });
    await expect(
      collectH05ControlPlaneEvidence(collectorOptions(traceFixture.api)),
    ).rejects.toThrow("must enable persisted traces at sampling rate 1");

    const accountSubdomainFixture = fixtureApi({ accountSubdomainDrift: true });
    await expect(
      collectH05ControlPlaneEvidence(
        collectorOptions(accountSubdomainFixture.api),
      ),
    ).rejects.toThrow("accountWorkersSubdomain changed during collection");
  });

  it("rejects ambiguous domain pagination, duplicate zones, public routes, and a live public origin", async () => {
    const domainsFixture = fixtureApi({ domainTotalPages: 2 });
    await expect(
      collectH05ControlPlaneEvidence(collectorOptions(domainsFixture.api)),
    ).rejects.toThrow("custom-domain inventory is incomplete");

    const zonesFixture = fixtureApi({ duplicateZone: true });
    await expect(
      collectH05ControlPlaneEvidence(collectorOptions(zonesFixture.api)),
    ).rejects.toThrow("repeated a zone ID");

    const sparseFixture = fixtureApi({ sparseZonePages: true });
    await expect(
      collectH05ControlPlaneEvidence(collectorOptions(sparseFixture.api)),
    ).rejects.toThrow("sparse H05 zone inventory page");

    const totalDriftFixture = fixtureApi({
      multiPageZones: true,
      zoneTotalCountDrift: true,
    });
    await expect(
      collectH05ControlPlaneEvidence(
        collectorOptions(totalDriftFixture.api),
      ),
    ).rejects.toThrow("zone pagination changed during collection");

    const routeFixture = fixtureApi({ routeTarget: true });
    await expect(
      collectH05ControlPlaneEvidence(collectorOptions(routeFixture.api)),
    ).rejects.toThrow("has a zone route target");

    const publicFixture = fixtureApi({ directStatus: 200 });
    await expect(
      collectH05ControlPlaneEvidence(collectorOptions(publicFixture.api)),
    ).rejects.toThrow("public-origin check returned HTTP 200");
  });

  it("does not interpolate a hostile unsupported binding type into errors", async () => {
    const marker = "LEAK_ME_BINDING_TYPE";
    const fixture = fixtureApi({ unsupportedBindingType: marker });
    const failure = collectH05ControlPlaneEvidence(collectorOptions(fixture.api));

    await expect(failure).rejects.toThrow("uses an unsupported binding type");
    await expect(failure).rejects.not.toThrow(marker);
  });

  it("decodes only a remote dedicated TLS PostgreSQL target", () => {
    expect(
      decodeH05ExpectedPostgresTarget({
        databaseUrl:
          "postgresql://postgres-user:secret@DB.Example.Test/h05_private_db?sslmode=require",
        expectedDatabaseName: "h05_private_db",
      }),
    ).toEqual({
      database: "h05_private_db",
      host: "db.example.test",
      port: 5432,
      scheme: "postgresql",
      tlsMode: "require",
      user: "postgres-user",
    });
    expect(() =>
      decodeH05ExpectedPostgresTarget({
        databaseUrl:
          "postgresql://postgres-user:secret@localhost/h05_private_db?sslmode=require",
        expectedDatabaseName: "h05_private_db",
      }),
    ).toThrow("must target a remote host");
    expect(() =>
      decodeH05ExpectedPostgresTarget({
        databaseUrl:
          "postgresql://postgres-user:secret@db.example.test/postgres?sslmode=require",
        expectedDatabaseName: "postgres",
      }),
    ).toThrow("must not target a default PostgreSQL database");
    expect(() =>
      decodeH05ExpectedPostgresTarget({
        databaseUrl:
          "postgresql://postgres-user:secret@db.example.test/h05_private_db?sslmode=require&application_name=leak",
        expectedDatabaseName: "h05_private_db",
      }),
    ).toThrow("may set only the validated sslmode query parameter");
  });
});

function collectorOptions(api: H05CloudflareReadApi): H05ControlPlaneCollectorOptions {
  return {
    accountId,
    allZonesTokenScopeAttested: true,
    api,
    expectedHyperdriveName: "flarex_executor_h05",
    expectedPostgres: expectedPostgresTarget(),
    hyperdriveId,
    now: () => observedAt,
    runId: "run_a",
    source: {
      commit: "e".repeat(40),
      worktreeClean: true,
      wranglerVersion: "4.100.0",
    },
  };
}

function expectedPostgresTarget(): H05ExpectedPostgresTarget {
  return {
    database: "h05_private_db",
    host: "db.example.test",
    port: 5432,
    scheme: "postgresql",
    tlsMode: "require",
    user: "postgres-user",
  };
}

function fixtureApi(overrides: FixtureOverrides = {}): {
  readonly api: H05CloudflareReadApi;
  readonly calls: Array<{
    readonly path: string;
    readonly query: Readonly<Record<string, string | number>> | undefined;
  }>;
  readonly publicOrigins: string[];
} {
  const calls: Array<{
    readonly path: string;
    readonly query: Readonly<Record<string, string | number>> | undefined;
  }> = [];
  const publicOrigins: string[] = [];
  let executorDeploymentReads = 0;
  let accountSubdomainReads = 0;
  let hyperdriveReads = 0;
  const scriptSettingsReads = new Map<string, number>();
  let zoneSweep = 0;
  const api: H05CloudflareReadApi = {
    async get(path, query) {
      calls.push({ path, query });
      if (path === `/accounts/${accountId}/hyperdrive/configs/${hyperdriveId}`) {
        hyperdriveReads += 1;
        return result({
          id: hyperdriveId,
          name: "flarex_executor_h05",
          origin: {
            host: "db.example.test",
            port: 5432,
            database: "h05_private_db",
            scheme: "postgresql",
            user: overrides.originUser ?? "postgres-user",
            ...(overrides.hyperdrivePassword === undefined
              ? {}
              : { password: overrides.hyperdrivePassword }),
          },
          caching: {
            disabled:
              hyperdriveReads > 1 &&
              overrides.closingCachingDisabled !== undefined
                ? overrides.closingCachingDisabled
                : overrides.cachingDisabled ?? true,
          },
          mtls: { sslmode: "require" },
        });
      }
      if (path === `/accounts/${accountId}/workers/subdomain`) {
        accountSubdomainReads += 1;
        return result({
          subdomain:
            overrides.accountSubdomainDrift === true &&
            accountSubdomainReads > 1
              ? "other-account"
              : "example",
        });
      }
      if (path.endsWith("/deployments")) {
        const executor = path.includes("/flarex-executor/deployments");
        if (executor) executorDeploymentReads += 1;
        const versionId =
          executor &&
          overrides.executorDeploymentDrift === true &&
          executorDeploymentReads > 1
            ? "executor-version-2"
            : executor
              ? "executor-version-1"
              : "probe-version-1";
        return result({
          deployments: [
            {
              id: executor ? "executor-deployment-1" : "probe-deployment-1",
              versions: [{ version_id: versionId, percentage: 100 }],
            },
          ],
        });
      }
      if (path.includes("/versions/")) {
        const executor = path.includes("/flarex-executor/versions/");
        const versionId = executor ? "executor-version-1" : "probe-version-1";
        return result({
          id: versionId,
          resources: {
            script_runtime: {
              compatibility_date: "2026-06-14",
              ...compatibilityFlags(executor, overrides),
            },
            bindings: workerBindings(executor, overrides),
          },
        });
      }
      if (path.endsWith("/settings") && !path.endsWith("/script-settings")) {
        const executor = path.includes("/flarex-executor/settings");
        return result({
          compatibility_date:
            overrides.settingsCompatibilityDate ?? "2026-06-14",
          ...compatibilityFlags(executor, overrides),
          bindings: workerBindings(executor, overrides),
          ...(executor ? { placement: { mode: "smart" } } : {}),
          observability: traceSettings(),
        });
      }
      if (path.endsWith("/script-settings")) {
        const reads = (scriptSettingsReads.get(path) ?? 0) + 1;
        scriptSettingsReads.set(path, reads);
        return result({
          observability: traceSettings(
            reads > 1 && overrides.closingTracePersisted !== undefined
              ? overrides.closingTracePersisted
              : true,
          ),
        });
      }
      if (path.endsWith("/secrets")) {
        const executor = path.includes("/flarex-executor/secrets");
        const names = executor
          ? ["FLAREX_EXECUTOR_TOKEN"]
          : [
              "FLAREX_EXECUTOR_TOKEN",
              "FLAREX_H05_PROBE_TOKEN",
              "FLAREX_H05_RUN_ID",
            ];
        return result(
          names.map((name, index) => ({
            type: "secret_text",
            name,
            ...(index === 0 && overrides.secretText !== undefined
              ? { text: overrides.secretText }
              : {}),
          })),
        );
      }
      if (path.endsWith("/subdomain")) {
        const executor = path.includes("/flarex-executor/subdomain");
        return result({
          enabled: !executor,
          previews_enabled: false,
        });
      }
      if (path === `/accounts/${accountId}/workers/domains`) {
        return result([], {
          count: 0,
          page: 1,
          per_page: 50,
          total_count: overrides.domainUnfilteredTotalCount ?? 0,
          total_pages: overrides.domainTotalPages ?? 1,
        });
      }
      if (path === "/zones") {
        const page = Number(query?.page);
        if (page === 1) zoneSweep += 1;
        if (overrides.emptyZones === true) {
          return result([], zonePageInfo(1, 0, 0, 0));
        }
        if (overrides.sparseZonePages === true) {
          return result(
            [
              {
                id: firstZoneId,
                account: { id: accountId },
                name: "unrelated.example.test",
              },
            ],
            zonePageInfo(1, 1, 2, 1),
          );
        }
        if (overrides.multiPageZones === true) {
          const allIds = multiPageZoneIds();
          const ids = page === 1 ? allIds.slice(0, 50) : allIds.slice(50);
          const totalCount =
            overrides.zoneTotalCountDrift === true && page === 2 ? 52 : 51;
          return result(
            ids.map((id) => ({
              id,
              account: { id: accountId },
              name: "unrelated.example.test",
            })),
            zonePageInfo(page, ids.length, 2, totalCount),
          );
        }
        const openingIds =
          overrides.duplicateZone === true
            ? [firstZoneId, firstZoneId]
            : [firstZoneId, secondZoneId];
        const ids =
          overrides.closingZoneDrift === true && zoneSweep > 1
            ? [firstZoneId, "f".repeat(32)]
            : openingIds;
        return result(
          ids.map((id) => ({
            id,
            account: { id: accountId },
            name: "unrelated.example.test",
          })),
          zonePageInfo(page, ids.length, 1, ids.length),
        );
      }
      if (path.endsWith("/workers/routes")) {
        return result([
          {
            id: "route-identifier",
            pattern: "unrelated/*",
            script: overrides.routeTarget === true ? "flarex-executor" : "other-worker",
          },
        ]);
      }
      throw new Error(`Unexpected fixture path: ${path}`);
    },
    async publicStatus(origin) {
      publicOrigins.push(origin);
      return overrides.directStatus ?? 404;
    },
  };
  return { api, calls, publicOrigins };
}

function workerBindings(
  executor: boolean,
  overrides: FixtureOverrides,
): readonly Readonly<Record<string, unknown>>[] {
  if (executor) {
    if (overrides.unsupportedBindingType !== undefined) {
      return [
        {
          type: overrides.unsupportedBindingType,
          name: "UNSUPPORTED_BINDING",
        },
      ];
    }
    return [
      {
        type: "hyperdrive",
        name: "HYPERDRIVE_CACHE_DISABLED",
        id: hyperdriveId,
      },
      { type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" },
    ];
  }
  return [
    { type: "secret_text", name: "FLAREX_H05_RUN_ID" },
    {
      type: "service",
      name: "FLAREX_EXECUTOR",
      service: "flarex-executor",
      environment: overrides.serviceEnvironment,
      entrypoint: overrides.serviceEntrypoint,
    },
    { type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" },
    { type: "secret_text", name: "FLAREX_H05_PROBE_TOKEN" },
  ];
}

function compatibilityFlags(
  executor: boolean,
  overrides: FixtureOverrides,
): Readonly<Record<string, unknown>> {
  if (executor) return { compatibility_flags: ["nodejs_compat"] };
  return overrides.probeCompatibilityFlags === undefined
    ? {}
    : { compatibility_flags: overrides.probeCompatibilityFlags };
}

function traceSettings(persist = true) {
  return {
    enabled: true,
    traces: {
      enabled: true,
      head_sampling_rate: 1,
      persist,
    },
  };
}

function multiPageZoneIds(): readonly string[] {
  return Array.from({ length: 51 }, (_value, index) =>
    (index + 1).toString(16).padStart(32, "0"),
  );
}

function zonePageInfo(
  page: number,
  count: number,
  totalPages: number,
  totalCount: number,
) {
  return {
    count,
    page,
    per_page: 50,
    total_count: totalCount,
    total_pages: totalPages,
  };
}

function result(resultValue: unknown, resultInfo?: unknown): H05CloudflareReadResult {
  return { result: resultValue, resultInfo };
}
