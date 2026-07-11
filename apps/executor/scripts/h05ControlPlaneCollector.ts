import { createHash } from "node:crypto";
import { isIP } from "node:net";

import {
  compileH05ControlPlaneEvidence,
  h05CloudflareAccountIdSha256,
  h05ControlPlaneEvidenceFormat,
  h05MaximumZonePages,
  h05ZoneTypes,
  type H05BindingEvidence,
  type H05ControlPlaneEvidence,
  type H05ControlPlaneSourceEvidence,
  type H05DeploymentEvidence,
  type H05ExecutorPrivacySnapshotEvidence,
  type H05ExecutorWorkerVersionEvidence,
  type H05HyperdriveSnapshotEvidence,
  type H05ProbeWorkerVersionEvidence,
  type H05SecretEvidence,
  type H05SubdomainEvidence,
  type H05TraceSettingsEvidence,
  type H05WorkerVersionEvidence,
} from "../h05/controlPlaneEvidence";
import {
  h05ExecutorWorkerName,
  h05ProbeWorkerName,
} from "../h05/receipt";
import {
  decodeH05ProofRunId,
  h05ProofIdentity,
} from "../h05/proofIdentity";
import type { H05CloudflareReadApi, H05CloudflareReadResult } from "./cloudflareReadApi";

export interface H05ExpectedPostgresTarget {
  readonly database: string;
  readonly host: string;
  readonly port: number;
  readonly scheme: "postgres" | "postgresql";
  readonly tlsMode: "require" | "verify-ca" | "verify-full";
  readonly user: string;
}

export interface H05ControlPlaneCollectorOptions {
  readonly accountId: string;
  readonly allZonesTokenScopeAttested: true;
  readonly api: H05CloudflareReadApi;
  readonly expectedHyperdriveName: string;
  readonly expectedPostgres: H05ExpectedPostgresTarget;
  readonly hyperdriveId: string;
  readonly now?: () => string;
  readonly runId: string;
  readonly source: H05ControlPlaneSourceEvidence;
}

export interface H05ExpectedPostgresTargetInput {
  readonly databaseUrl: string | undefined;
  readonly expectedDatabaseName: string | undefined;
}

const zonesPerPage = 50;

export async function collectH05ControlPlaneEvidence(
  options: H05ControlPlaneCollectorOptions,
): Promise<H05ControlPlaneEvidence> {
  const accountId = cloudflareAccountId(options.accountId);
  const accountIdSha256 = h05CloudflareAccountIdSha256(accountId);
  if (options.allZonesTokenScopeAttested !== true) {
    throw new Error(
      "H05 control-plane collection requires an operator attestation that the API token can read every account zone.",
    );
  }
  const hyperdriveId = exactHyperdriveId(options.hyperdriveId);
  const expectedHyperdriveName = hyperdriveName(options.expectedHyperdriveName);
  const expectedPostgres = validateExpectedPostgresTarget(options.expectedPostgres);
  const runId = decodeH05ProofRunId(options.runId);
  if (!runId.ok) throw new Error(runId.message);
  const identity = h05ProofIdentity(runId.value);
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();

  const hyperdriveOpening = await collectHyperdriveSnapshot({
    api: options.api,
    accountId,
    id: hyperdriveId,
    name: expectedHyperdriveName,
    postgres: expectedPostgres,
    now,
  });
  const accountWorkersSubdomainOpening = projectAccountSubdomain(
    await getAccountResult(options.api, accountId, "/workers/subdomain"),
  );

  const executorDeploymentBefore = await collectActiveDeployment(
    options.api,
    accountId,
    h05ExecutorWorkerName,
    now,
  );
  const probeDeploymentBefore = await collectActiveDeployment(
    options.api,
    accountId,
    h05ProbeWorkerName,
    now,
  );
  const executorSubdomainBefore = await collectSubdomain(
    options.api,
    accountId,
    h05ExecutorWorkerName,
  );
  const probeSubdomainBefore = await collectSubdomain(
    options.api,
    accountId,
    h05ProbeWorkerName,
  );
  const executorVersionOpening = await collectWorkerVersion(
    options.api,
    accountId,
    h05ExecutorWorkerName,
    executorDeploymentBefore.versionId,
    "executor",
  );
  const probeVersionOpening = await collectWorkerVersion(
    options.api,
    accountId,
    h05ProbeWorkerName,
    probeDeploymentBefore.versionId,
    "probe",
  );
  const executorSecretsOpening = await collectSecrets(
    options.api,
    accountId,
    h05ExecutorWorkerName,
  );
  const probeSecretsOpening = await collectSecrets(
    options.api,
    accountId,
    h05ProbeWorkerName,
  );
  const privacyOpening = await collectExecutorPrivacySnapshot(
    options.api,
    accountId,
    accountWorkersSubdomainOpening,
    now,
  );
  const privacyClosing = await collectExecutorPrivacySnapshot(
    options.api,
    accountId,
    accountWorkersSubdomainOpening,
    now,
  );
  const executorVersionClosing = await collectWorkerVersion(
    options.api,
    accountId,
    h05ExecutorWorkerName,
    executorDeploymentBefore.versionId,
    "executor",
  );
  const probeVersionClosing = await collectWorkerVersion(
    options.api,
    accountId,
    h05ProbeWorkerName,
    probeDeploymentBefore.versionId,
    "probe",
  );
  const executorSecretsClosing = await collectSecrets(
    options.api,
    accountId,
    h05ExecutorWorkerName,
  );
  const probeSecretsClosing = await collectSecrets(
    options.api,
    accountId,
    h05ProbeWorkerName,
  );
  const executorSubdomainAfter = await collectSubdomain(
    options.api,
    accountId,
    h05ExecutorWorkerName,
  );
  const probeSubdomainAfter = await collectSubdomain(
    options.api,
    accountId,
    h05ProbeWorkerName,
  );
  const executorDeploymentAfter = await collectActiveDeployment(
    options.api,
    accountId,
    h05ExecutorWorkerName,
    now,
  );
  const probeDeploymentAfter = await collectActiveDeployment(
    options.api,
    accountId,
    h05ProbeWorkerName,
    now,
  );
  const accountWorkersSubdomainClosing = projectAccountSubdomain(
    await getAccountResult(options.api, accountId, "/workers/subdomain"),
  );
  const hyperdriveClosing = await collectHyperdriveSnapshot({
    api: options.api,
    accountId,
    id: hyperdriveId,
    name: expectedHyperdriveName,
    postgres: expectedPostgres,
    now,
  });

  const compiled = compileH05ControlPlaneEvidence({
    format: h05ControlPlaneEvidenceFormat,
    accountIdSha256,
    source: options.source,
    window: { startedAt, finishedAt: now() },
    run: {
      runId: identity.runId,
      deploymentId: identity.deploymentId,
      projectId: identity.projectId,
    },
    accountWorkersSubdomain: {
      opening: accountWorkersSubdomainOpening,
      closing: accountWorkersSubdomainClosing,
    },
    hyperdrive: {
      opening: hyperdriveOpening,
      closing: hyperdriveClosing,
    },
    executor: {
      deploymentBefore: executorDeploymentBefore,
      opening: {
        version: executorVersionOpening,
        secrets: executorSecretsOpening,
        subdomain: executorSubdomainBefore,
      },
      privacy: {
        tokenScopeAttestation: "operator-attested-all-account-zones",
        opening: privacyOpening,
        closing: privacyClosing,
      },
      closing: {
        version: executorVersionClosing,
        secrets: executorSecretsClosing,
        subdomain: executorSubdomainAfter,
      },
      deploymentAfter: executorDeploymentAfter,
    },
    probe: {
      deploymentBefore: probeDeploymentBefore,
      opening: {
        version: probeVersionOpening,
        secrets: probeSecretsOpening,
        subdomain: probeSubdomainBefore,
      },
      publicOrigin:
        `https://${h05ProbeWorkerName}.${accountWorkersSubdomainOpening}.workers.dev`,
      closing: {
        version: probeVersionClosing,
        secrets: probeSecretsClosing,
        subdomain: probeSubdomainAfter,
      },
      deploymentAfter: probeDeploymentAfter,
    },
  });
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.value;
}

async function collectHyperdriveSnapshot(options: {
  readonly accountId: string;
  readonly api: H05CloudflareReadApi;
  readonly id: string;
  readonly name: string;
  readonly now: () => string;
  readonly postgres: H05ExpectedPostgresTarget;
}): Promise<H05HyperdriveSnapshotEvidence> {
  return projectHyperdrive(
    await getAccountResult(
      options.api,
      options.accountId,
      `/hyperdrive/configs/${segment(options.id)}`,
    ),
    {
      id: options.id,
      name: options.name,
      postgres: options.postgres,
      capturedAt: options.now(),
    },
  );
}

export function decodeH05ExpectedPostgresTarget(
  input: H05ExpectedPostgresTargetInput,
): H05ExpectedPostgresTarget {
  const rawDatabaseUrl = requiredValue(
    input.databaseUrl,
    "FLAREX_H05_POSTGRES_DATABASE_URL",
  );
  let url: URL;
  try {
    url = new URL(rawDatabaseUrl);
  } catch {
    throw new Error("FLAREX_H05_POSTGRES_DATABASE_URL must be a valid URL.");
  }
  const scheme = oneOf(
    url.protocol.replace(/:$/, ""),
    ["postgres", "postgresql"] as const,
    "FLAREX_H05_POSTGRES_DATABASE_URL scheme",
  );
  const user = decodeUrlComponent(
    url.username,
    "FLAREX_H05_POSTGRES_DATABASE_URL username",
  );
  if (user.length === 0) {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL must include the expected PostgreSQL role.",
    );
  }
  const host = normalizeHost(url.hostname);
  if (host.length === 0 || isLocalPostgresHost(host)) {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL must target a remote host, not loopback or an unspecified address.",
    );
  }
  if (url.pathname === "" || url.pathname === "/") {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL must name a dedicated staging database.",
    );
  }
  let database: string;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL must contain a valid encoded database name.",
    );
  }
  const expectedDatabaseName = requiredValue(
    input.expectedDatabaseName,
    "FLAREX_H05_EXPECTED_DATABASE_NAME",
  );
  if (database !== expectedDatabaseName) {
    throw new Error(
      "FLAREX_H05_EXPECTED_DATABASE_NAME must exactly match the database URL target.",
    );
  }
  if (["postgres", "template0", "template1"].includes(database)) {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL must not target a default PostgreSQL database.",
    );
  }
  const sslModes = url.searchParams.getAll("sslmode");
  const tlsMode = oneOf(
    sslModes.length === 1 ? sslModes[0]?.toLowerCase() : undefined,
    ["require", "verify-ca", "verify-full"] as const,
    "FLAREX_H05_POSTGRES_DATABASE_URL sslmode",
  );
  if (
    url.hash !== "" ||
    [...url.searchParams.keys()].some((name) => name !== "sslmode")
  ) {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL may set only the validated sslmode query parameter and no fragment.",
    );
  }
  const port =
    url.port === ""
      ? 5432
      : integerInRange(
          Number(url.port),
          1,
          65_535,
          "FLAREX_H05_POSTGRES_DATABASE_URL port",
        );
  return validateExpectedPostgresTarget({
    database,
    host,
    port,
    scheme,
    tlsMode,
    user,
  });
}

async function collectActiveDeployment(
  api: H05CloudflareReadApi,
  accountId: string,
  workerName: string,
  now: () => string,
): Promise<H05DeploymentEvidence> {
  const response = await getAccountResult(
    api,
    accountId,
    `/workers/scripts/${segment(workerName)}/deployments`,
  );
  const result = record(response.result, `${workerName} deployments result`);
  const deployments = array(result.deployments, `${workerName} deployments`);
  const active = deployments[0];
  if (active === undefined) {
    throw new Error(`Cloudflare returned no active deployment for ${workerName}.`);
  }
  const deployment = record(active, `${workerName} active deployment`);
  const versions = array(
    deployment.versions,
    `${workerName} active deployment versions`,
  );
  if (versions.length !== 1) {
    throw new Error(`${workerName} must have exactly one active version.`);
  }
  const version = record(versions[0], `${workerName} active version`);
  if (version.percentage !== 100) {
    throw new Error(`${workerName} active version must receive 100% traffic.`);
  }
  return {
    deploymentId: opaqueId(deployment.id, `${workerName} deployment ID`),
    versionId: opaqueId(version.version_id, `${workerName} version ID`),
    trafficPercentage: 100,
    observedAt: canonicalTimestamp(now(), `${workerName} deployment observation`),
  };
}

function collectWorkerVersion(
  api: H05CloudflareReadApi,
  accountId: string,
  workerName: string,
  versionId: string,
  role: "executor",
): Promise<H05ExecutorWorkerVersionEvidence>;
function collectWorkerVersion(
  api: H05CloudflareReadApi,
  accountId: string,
  workerName: string,
  versionId: string,
  role: "probe",
): Promise<H05ProbeWorkerVersionEvidence>;
async function collectWorkerVersion(
  api: H05CloudflareReadApi,
  accountId: string,
  workerName: string,
  versionId: string,
  role: "executor" | "probe",
): Promise<H05WorkerVersionEvidence> {
  const versionResponse = await getAccountResult(
    api,
    accountId,
    `/workers/scripts/${segment(workerName)}/versions/${segment(versionId)}`,
  );
  const version = record(versionResponse.result, `${workerName} version detail`);
  const returnedVersionId =
    version.id === undefined
      ? versionId
      : opaqueId(version.id, `${workerName} returned version ID`);
  if (returnedVersionId !== versionId) {
    throw new Error(`${workerName} version detail returned the wrong version.`);
  }
  const resources = record(version.resources, `${workerName} version resources`);
  const runtime = record(
    resources.script_runtime,
    `${workerName} version runtime`,
  );
  const versionBindings = projectBindings(
    resources.bindings,
    `${workerName} version bindings`,
  );

  const settingsResponse = await getAccountResult(
    api,
    accountId,
    `/workers/scripts/${segment(workerName)}/settings`,
  );
  const settings = record(settingsResponse.result, `${workerName} settings`);
  const settingsBindings = projectBindings(
    settings.bindings,
    `${workerName} settings bindings`,
  );
  const compatibilityDate = stringValue(
    runtime.compatibility_date,
    `${workerName} compatibility date`,
  );
  const settingsTraceSettings = projectTraceSettings(
    settings.observability,
    `${workerName} version settings observability`,
  );

  const scriptSettingsResponse = await getAccountResult(
    api,
    accountId,
    `/workers/scripts/${segment(workerName)}/script-settings`,
  );
  const scriptSettings = record(
    scriptSettingsResponse.result,
    `${workerName} script settings`,
  );
  const scriptTraceSettings = projectTraceSettings(
    scriptSettings.observability,
    `${workerName} script observability`,
  );
  if (role === "executor") {
    const compatibilityFlags = exactCompatibilityFlags(
      runtime.compatibility_flags,
      "executor",
      `${workerName} compatibility flags`,
    );
    if (
      settings.compatibility_date !== compatibilityDate ||
      !isExactCompatibilityFlags(settings.compatibility_flags, "executor")
    ) {
      throw new Error(
        `${workerName} non-versioned settings do not match the active version runtime.`,
      );
    }
    return {
      versionId,
      compatibilityDate,
      compatibilityFlags,
      placementMode: projectPlacement(
        settings.placement,
        "executor",
        workerName,
      ),
      versionBindings,
      settingsBindings,
      settingsTraceSettings,
      scriptTraceSettings,
    };
  }
  const compatibilityFlags = exactCompatibilityFlags(
    runtime.compatibility_flags,
    "probe",
    `${workerName} compatibility flags`,
  );
  if (
    settings.compatibility_date !== compatibilityDate ||
    !isExactCompatibilityFlags(settings.compatibility_flags, "probe")
  ) {
    throw new Error(
      `${workerName} non-versioned settings do not match the active version runtime.`,
    );
  }
  return {
    versionId,
    compatibilityDate,
    compatibilityFlags,
    placementMode: projectPlacement(settings.placement, "probe", workerName),
    versionBindings,
    settingsBindings,
    settingsTraceSettings,
    scriptTraceSettings,
  };
}

function projectBindings(value: unknown, path: string): readonly H05BindingEvidence[] {
  const projected = array(value, path).map((item, index) => {
    const bindingPath = `${path}[${index}]`;
    const binding = record(item, bindingPath);
    const type = stringValue(binding.type, `${bindingPath}.type`);
    const name = stringValue(binding.name, `${bindingPath}.name`);
    if (type === "hyperdrive") {
      return {
        type,
        name,
        id: exactHyperdriveId(binding.id),
      } satisfies H05BindingEvidence;
    }
    if (type === "secret_text") {
      assertNoSecretMaterial(binding, bindingPath);
      return { type, name } satisfies H05BindingEvidence;
    }
    if (type === "service") {
      if (
        (binding.environment !== undefined && binding.environment !== null) ||
        (binding.entrypoint !== undefined && binding.entrypoint !== null)
      ) {
        throw new Error(
          `${bindingPath} must not select a service environment or named entrypoint.`,
        );
      }
      return {
        type,
        name,
        service: stringValue(binding.service, `${bindingPath}.service`),
      } satisfies H05BindingEvidence;
    }
    throw new Error(`${bindingPath} uses an unsupported binding type.`);
  });
  return projected.sort((left, right) =>
    compareCanonicalStrings(bindingKey(left), bindingKey(right)),
  );
}

function projectPlacement(
  value: unknown,
  role: "executor",
  workerName: string,
): "smart";
function projectPlacement(
  value: unknown,
  role: "probe",
  workerName: string,
): "none";
function projectPlacement(
  value: unknown,
  role: "executor" | "probe",
  workerName: string,
): "smart" | "none" {
  if (role === "probe") {
    if (value !== undefined && value !== null) {
      throw new Error(`${workerName} must not configure placement.`);
    }
    return "none";
  }
  const placement = record(value, `${workerName} placement`);
  if (placement.mode !== "smart") {
    throw new Error(`${workerName} must use Smart Placement.`);
  }
  return "smart";
}

function projectTraceSettings(value: unknown, path: string): H05TraceSettingsEvidence {
  const observability = record(value, path);
  const traces = record(observability.traces, `${path}.traces`);
  if (
    observability.enabled !== true ||
    traces.enabled !== true ||
    traces.head_sampling_rate !== 1 ||
    traces.persist !== true
  ) {
    throw new Error(`${path} must enable persisted traces at sampling rate 1.`);
  }
  return { enabled: true, persisted: true, samplingRate: 1 };
}

async function collectSecrets(
  api: H05CloudflareReadApi,
  accountId: string,
  workerName: string,
): Promise<readonly H05SecretEvidence[]> {
  const response = await getAccountResult(
    api,
    accountId,
    `/workers/scripts/${segment(workerName)}/secrets`,
  );
  const secrets = array(response.result, `${workerName} secrets`).map(
    (item, index): H05SecretEvidence => {
      const secretPath = `${workerName} secrets[${index}]`;
      const secret = record(item, secretPath);
      assertNoSecretMaterial(secret, secretPath);
      if (secret.type !== "secret_text") {
        throw new Error(`${workerName} has a non-text H05 secret binding.`);
      }
      return {
        name: stringValue(secret.name, `${secretPath}.name`),
        type: "secret_text",
      };
    },
  );
  return secrets.sort((left, right) =>
    compareCanonicalStrings(left.name, right.name),
  );
}

async function collectSubdomain(
  api: H05CloudflareReadApi,
  accountId: string,
  workerName: string,
): Promise<H05SubdomainEvidence> {
  const response = await getAccountResult(
    api,
    accountId,
    `/workers/scripts/${segment(workerName)}/subdomain`,
  );
  const result = record(response.result, `${workerName} subdomain`);
  return {
    enabled: booleanValue(result.enabled, `${workerName} workers.dev enabled`),
    previewsEnabled: booleanValue(
      result.previews_enabled,
      `${workerName} preview URLs enabled`,
    ),
  };
}

async function collectExecutorPrivacySnapshot(
  api: H05CloudflareReadApi,
  accountId: string,
  accountWorkersSubdomain: string,
  now: () => string,
): Promise<H05ExecutorPrivacySnapshotEvidence> {
  const domainsResponse = await getAccountResult(
    api,
    accountId,
    "/workers/domains",
    { service: h05ExecutorWorkerName },
  );
  const domains = array(domainsResponse.result, "executor custom domains");
  if (domains.length !== 0) {
    throw new Error("The private executor has a custom domain target.");
  }
  const domainInfo = paginationInfo(
    domainsResponse.resultInfo,
    "executor custom-domain pagination",
  );
  if (
    domainInfo.page !== 1 ||
    domainInfo.count !== 0 ||
    ![0, 1].includes(domainInfo.totalPages)
  ) {
    throw new Error("The executor custom-domain inventory is incomplete.");
  }

  const zones = await collectAllZones(api, accountId);
  let inspectedRouteCount = 0;
  for (const zoneId of zones.zoneIds) {
    const response = await api.get(
      `/zones/${segment(zoneId)}/workers/routes`,
    );
    const routes = array(response.result, `routes for zone ${zoneId}`);
    inspectedRouteCount += routes.length;
    for (const route of routes) {
      const projected = record(route, `route for zone ${zoneId}`);
      const script = projected.script;
      if (
        script !== undefined &&
        script !== null &&
        typeof script !== "string"
      ) {
        throw new Error("Cloudflare returned an invalid Worker route target.");
      }
      if (script === h05ExecutorWorkerName) {
        throw new Error("The private executor has a zone route target.");
      }
    }
  }
  const executorOrigin =
    `https://${h05ExecutorWorkerName}.${accountWorkersSubdomain}.workers.dev`;
  const directStatus = await api.publicStatus(executorOrigin);
  if (directStatus !== 404) {
    throw new Error(
      `The private executor public-origin check returned HTTP ${directStatus}.`,
    );
  }
  return {
    customDomains: {
      filteredCount: 0,
      page: 1,
      totalPages: zeroOrOne(domainInfo.totalPages, "custom-domain total pages"),
      unfilteredTotalCount: domainInfo.totalCount,
    },
    zones: {
      requestedTypes: h05ZoneTypes,
      pageCount: zones.pageCount,
      unfilteredTotalCount: zones.unfilteredTotalCount,
      zoneIds: zones.zoneIds,
    },
    routes: {
      checkedZoneIds: zones.zoneIds,
      inspectedRouteCount,
      targetRouteCount: 0,
    },
    directRequest: { status: 404 },
    checkedAt: canonicalTimestamp(now(), "executor privacy observation"),
  };
}

async function collectAllZones(
  api: H05CloudflareReadApi,
  accountId: string,
): Promise<{
  readonly pageCount: number;
  readonly unfilteredTotalCount: number;
  readonly zoneIds: readonly string[];
}> {
  const zoneIds = new Set<string>();
  let page = 1;
  let totalPages: number | undefined;
  let unfilteredTotalCount: number | undefined;
  let pagesRead = 0;
  while (totalPages === undefined || page <= totalPages) {
    if (page > h05MaximumZonePages) {
      throw new Error("Cloudflare zone pagination exceeded the H05 safety bound.");
    }
    const response = await api.get("/zones", {
      "account.id": accountId,
      page,
      per_page: zonesPerPage,
      type: h05ZoneTypes.join(","),
    });
    const zones = array(response.result, `zones page ${page}`);
    const info = paginationInfo(response.resultInfo, `zones page ${page}`);
    if (
      info.page !== page ||
      info.perPage !== zonesPerPage ||
      info.count !== zones.length ||
      (totalPages !== undefined && info.totalPages !== totalPages) ||
      (unfilteredTotalCount !== undefined &&
        info.totalCount !== unfilteredTotalCount)
    ) {
      throw new Error("Cloudflare zone pagination changed during collection.");
    }
    if (
      info.totalPages === 0 &&
      (page !== 1 || zones.length !== 0 || info.count !== 0)
    ) {
      throw new Error("Cloudflare returned an invalid empty zone inventory.");
    }
    if (
      info.totalPages > 0 &&
      (zones.length > zonesPerPage ||
        (page < info.totalPages && zones.length !== zonesPerPage) ||
        (page === info.totalPages && info.totalPages > 1 && zones.length === 0))
    ) {
      throw new Error("Cloudflare returned a sparse H05 zone inventory page.");
    }
    totalPages = info.totalPages;
    unfilteredTotalCount = info.totalCount;
    pagesRead += 1;
    for (const item of zones) {
      const zone = record(item, `zone on page ${page}`);
      const zoneAccount = record(zone.account, `zone account on page ${page}`);
      if (zoneAccount.id !== accountId) {
        throw new Error("Cloudflare returned a zone from another account.");
      }
      const id = zoneId(zone.id, `zone ID on page ${page}`);
      if (zoneIds.has(id)) {
        throw new Error("Cloudflare zone pagination repeated a zone ID.");
      }
      zoneIds.add(id);
    }
    page += 1;
  }
  const stableUnfilteredTotalCount = unfilteredTotalCount ?? 0;
  if (stableUnfilteredTotalCount < zoneIds.size) {
    throw new Error(
      "Cloudflare zone pagination reported fewer total zones than were collected.",
    );
  }
  return {
    pageCount: pagesRead,
    unfilteredTotalCount: stableUnfilteredTotalCount,
    zoneIds: [...zoneIds].sort(),
  };
}

function projectHyperdrive(
  response: H05CloudflareReadResult,
  expected: {
    readonly capturedAt: string;
    readonly id: string;
    readonly name: string;
    readonly postgres: H05ExpectedPostgresTarget;
  },
): H05HyperdriveSnapshotEvidence {
  const result = record(response.result, "Hyperdrive result");
  assertNoSecretMaterial(result, "Hyperdrive result");
  const id = exactHyperdriveId(result.id);
  const name = stringValue(result.name, "Hyperdrive name");
  if (id !== expected.id || name !== expected.name) {
    throw new Error("Hyperdrive identity does not match the H05 configuration.");
  }
  const origin = record(result.origin, "Hyperdrive origin");
  const host = normalizeHost(stringValue(origin.host, "Hyperdrive origin host"));
  const database = stringValue(origin.database, "Hyperdrive origin database");
  const user = stringValue(origin.user, "Hyperdrive origin user");
  const scheme = oneOf(
    origin.scheme,
    ["postgres", "postgresql"] as const,
    "Hyperdrive origin scheme",
  );
  const port = integerInRange(origin.port, 1, 65_535, "Hyperdrive origin port");
  const caching = record(result.caching, "Hyperdrive caching");
  if (caching.disabled !== true) {
    throw new Error("Hyperdrive query caching must be explicitly disabled.");
  }
  const mtls = result.mtls === undefined ? undefined : record(result.mtls, "Hyperdrive TLS");
  const tlsMode = oneOf(
    mtls?.sslmode ?? "require",
    ["require", "verify-ca", "verify-full"] as const,
    "Hyperdrive TLS mode",
  );
  if (
    host !== normalizeHost(expected.postgres.host) ||
    database !== expected.postgres.database ||
    user !== expected.postgres.user ||
    port !== expected.postgres.port ||
    scheme !== expected.postgres.scheme ||
    tlsMode !== expected.postgres.tlsMode
  ) {
    throw new Error("Hyperdrive origin does not match the dedicated H05 database target.");
  }
  return {
    id,
    name,
    originScheme: scheme,
    originPort: port,
    cachingDisabled: true,
    tlsMode,
    originHostSha256: domainHash("origin-host", host),
    originDatabaseSha256: domainHash("origin-database", database),
    capturedAt: canonicalTimestamp(expected.capturedAt, "Hyperdrive capture time"),
  };
}

function projectAccountSubdomain(response: H05CloudflareReadResult): string {
  const result = record(response.result, "account Workers subdomain");
  const subdomain = stringValue(result.subdomain, "account Workers subdomain");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
    throw new Error("Cloudflare returned an invalid account Workers subdomain.");
  }
  return subdomain;
}

async function getAccountResult(
  api: H05CloudflareReadApi,
  accountId: string,
  suffix: string,
  query?: Readonly<Record<string, string | number>>,
): Promise<H05CloudflareReadResult> {
  return await api.get(`/accounts/${segment(accountId)}${suffix}`, query);
}

function paginationInfo(value: unknown, path: string): {
  readonly count: number;
  readonly page: number;
  readonly perPage: number;
  readonly totalCount: number;
  readonly totalPages: number;
} {
  const info = record(value, path);
  return {
    count: nonNegativeSafeInteger(info.count, `${path}.count`),
    page: positiveSafeInteger(info.page, `${path}.page`),
    perPage: positiveSafeInteger(info.per_page, `${path}.per_page`),
    totalCount: nonNegativeSafeInteger(info.total_count, `${path}.total_count`),
    totalPages: nonNegativeSafeInteger(info.total_pages, `${path}.total_pages`),
  };
}

function exactCompatibilityFlags(
  value: unknown,
  role: "executor",
  path: string,
): readonly ["nodejs_compat"];
function exactCompatibilityFlags(
  value: unknown,
  role: "probe",
  path: string,
): readonly [];
function exactCompatibilityFlags(
  value: unknown,
  role: "executor" | "probe",
  path: string,
): readonly ["nodejs_compat"] | readonly [] {
  const flags = role === "probe" && value === undefined ? [] : array(value, path);
  if (role === "executor") {
    if (flags.length !== 1 || flags[0] !== "nodejs_compat") {
      throw new Error(`${path} must contain only nodejs_compat.`);
    }
    return ["nodejs_compat"];
  }
  if (flags.length !== 0) {
    throw new Error(`${path} must be empty for the H05 probe.`);
  }
  return [];
}

function isExactCompatibilityFlags(
  value: unknown,
  role: "executor" | "probe",
): boolean {
  if (role === "probe" && value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return role === "executor"
    ? value.length === 1 && value[0] === "nodejs_compat"
    : value.length === 0;
}

function assertNoSecretMaterial(
  value: unknown,
  path: string,
): void {
  const forbidden = new Set([
    "access_client_secret",
    "client_secret",
    "key_base64",
    "key_jwk",
    "password",
    "plaintext",
    "private_key",
    "secret",
    "secret_value",
    "text",
    "token",
  ]);
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (Array.isArray(next)) {
      pending.push(...next);
      continue;
    }
    if (!isRecord(next)) continue;
    for (const [key, child] of Object.entries(next)) {
      if (forbidden.has(key.toLowerCase())) {
        throw new Error(`${path} unexpectedly contained secret material.`);
      }
      pending.push(child);
    }
  }
}

function bindingKey(binding: H05BindingEvidence): string {
  if (binding.type === "hyperdrive") {
    return `${binding.name}:${binding.type}:${binding.id}`;
  }
  if (binding.type === "service") {
    return `${binding.name}:${binding.type}:${binding.service}`;
  }
  return `${binding.name}:${binding.type}`;
}

function domainHash(domain: string, value: string): string {
  return createHash("sha256")
    .update(`flarex-h05-${domain}-v1\0${value}`)
    .digest("hex");
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cloudflareAccountId(value: string): string {
  if (!/^[a-f0-9]{32}$/.test(value)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be 32 lowercase hexadecimal characters.");
  }
  return value;
}

function hyperdriveName(value: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value)) {
    throw new Error("FLAREX_H05_HYPERDRIVE_NAME is invalid.");
  }
  return value;
}

function exactHyperdriveId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) {
    throw new Error("The H05 Hyperdrive ID must be 32 lowercase hexadecimal characters.");
  }
  return value;
}

function zoneId(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) {
    throw new Error(`${path} must be 32 lowercase hexadecimal characters.`);
  }
  return value;
}

function zeroOrOne(value: number, path: string): 0 | 1 {
  if (value === 0 || value === 1) return value;
  throw new Error(`${path} must be zero or one.`);
}

function opaqueId(value: unknown, path: string): string {
  const decoded = stringValue(value, path);
  if (
    decoded.length < 8 ||
    decoded.length > 128 ||
    /[\u0000-\u0020\u007f]/.test(decoded)
  ) {
    throw new Error(`${path} is not a bounded opaque identifier.`);
  }
  return decoded;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function normalizeHost(value: string): string {
  return value.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.+$/, "");
}

function isLocalPostgresHost(value: string): boolean {
  const host = normalizeHost(value);
  if (
    host === "localhost" ||
    host === "localhost.localdomain" ||
    host.endsWith(".localhost") ||
    host === "0" ||
    host === "0.0.0.0" ||
    /^127(?:\.|$)/.test(host)
  ) {
    return true;
  }
  if (isIP(host) !== 6) return false;
  const nonZeroHex = host.replaceAll(":", "").replace(/^0+/, "");
  if (nonZeroHex === "" || nonZeroHex === "1") return true;
  return /(?:^|:)ffff:(?:127\.|7f[0-9a-f]{2}:)/.test(host);
}

function validateExpectedPostgresTarget(
  value: H05ExpectedPostgresTarget,
): H05ExpectedPostgresTarget {
  const host = normalizeHost(stringValue(value.host, "expected PostgreSQL host"));
  if (isLocalPostgresHost(host)) {
    throw new Error("The expected H05 PostgreSQL target must be remote.");
  }
  return {
    database: stringValue(value.database, "expected PostgreSQL database"),
    host,
    port: integerInRange(value.port, 1, 65_535, "expected PostgreSQL port"),
    scheme: oneOf(
      value.scheme,
      ["postgres", "postgresql"] as const,
      "expected PostgreSQL scheme",
    ),
    tlsMode: oneOf(
      value.tlsMode,
      ["require", "verify-ca", "verify-full"] as const,
      "expected PostgreSQL TLS mode",
    ),
    user: stringValue(value.user, "expected PostgreSQL user"),
  };
}

function decodeUrlComponent(value: string, path: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${path} must be valid percent-encoded text.`);
  }
}

function canonicalTimestamp(value: string, path: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${path} must be a canonical UTC ISO timestamp.`);
  }
  return value;
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] {
  if (typeof value !== "string" || !values.some((item) => item === value)) {
    throw new Error(`${path} is invalid.`);
  }
  return value as Values[number];
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${path} is outside its safe integer range.`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive safe integer.`);
  }
  return value;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative safe integer.`);
  }
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function requiredValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (normalized !== undefined && normalized.length > 0) return normalized;
  throw new Error(`${name} is required.`);
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`);
  return value;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function record(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}


function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
