import { createHash } from "node:crypto";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";

import {
  decodeH05ControlPlaneEvidence,
  h05SourceEvidenceSha256,
  type H05ControlPlaneEvidence,
} from "./controlPlaneEvidence";
import {
  decodeH05ProbeTeardownEvidence,
  verifyH05ProbeTeardownEvidenceDependencies,
  type H05ProbeTeardownEvidence,
} from "./probeTeardownEvidence";
import {
  decodeH05DataPlaneEvidence,
  decodeH05HostedReceipt,
  h05AuthorizedInvocationCount,
  h05ExecutorWorkerName,
  h05HostedReceiptFormat,
  h05HyperdriveBindingName,
  h05ProbeWorkerName,
  h05ServiceBindingName,
  h05UnauthorizedInvocationCount,
  serializeH05HostedReceipt,
  type H05DataPlaneEvidence,
  type H05HostedReceipt,
} from "./receipt";
import {
  decodeH05TraceEvidence,
  h05TraceIdHashSetSha256,
  verifyH05TraceEvidenceDependencies,
  type H05TraceEvidence,
} from "./traceEvidence";

declare const bundleSha256Brand: unique symbol;

export type H05HostedProofBundleSha256 = string & {
  readonly [bundleSha256Brand]: "H05HostedProofBundleSha256";
};

export const h05HostedProofBundleFormat =
  "flarex-h05-hosted-proof-bundle-v1";
export const h05MaximumHostedProofBundleBytes = 16 * 1024 * 1024;

export interface H05HostedProofBundleInputs {
  readonly controlPlaneBefore: H05ControlPlaneEvidence;
  readonly dataPlane: H05DataPlaneEvidence;
  readonly controlPlaneAfter: H05ControlPlaneEvidence;
  readonly probeTeardown: H05ProbeTeardownEvidence;
  readonly trace: H05TraceEvidence;
}

export interface H05HostedProofBundlePayload {
  readonly format: typeof h05HostedProofBundleFormat;
  readonly inputs: H05HostedProofBundleInputs;
  readonly receipt: H05HostedReceipt;
}

export interface H05HostedProofBundle extends H05HostedProofBundlePayload {
  readonly bundleSha256: H05HostedProofBundleSha256;
}

export type H05HostedProofBundleDecode =
  | { readonly ok: true; readonly value: H05HostedProofBundle }
  | { readonly ok: false; readonly message: string };

export function compileH05HostedProofBundle(
  controlPlaneBeforeValue: unknown,
  dataPlaneValue: unknown,
  controlPlaneAfterValue: unknown,
  probeTeardownValue: unknown,
  traceValue: unknown,
): H05HostedProofBundleDecode {
  try {
    const inputs = decodeInputs(
      {
        controlPlaneBefore: controlPlaneBeforeValue,
        dataPlane: dataPlaneValue,
        controlPlaneAfter: controlPlaneAfterValue,
        probeTeardown: probeTeardownValue,
        trace: traceValue,
      },
      "$inputs",
    );
    validateInputRelationships(inputs);
    const receipt = deriveReceipt(inputs);
    const payload: H05HostedProofBundlePayload = {
      format: h05HostedProofBundleFormat,
      inputs,
      receipt,
    };
    return decodeH05HostedProofBundle({
      ...payload,
      bundleSha256: bundleSha256(serializeH05HostedProofBundlePayload(payload)),
    });
  } catch (error) {
    return failure(errorMessage(error));
  }
}

export function decodeH05HostedProofBundle(
  value: unknown,
): H05HostedProofBundleDecode {
  try {
    const record = exactRecord(value, "$", [
      "bundleSha256",
      "format",
      "inputs",
      "receipt",
    ]);
    const payload = decodePayload(
      {
        format: record.format,
        inputs: record.inputs,
        receipt: record.receipt,
      },
      "$",
    );
    const observedSha256 = sha256String(
      record.bundleSha256,
      "$.bundleSha256",
    );
    const expectedSha256 = bundleSha256(
      serializeH05HostedProofBundlePayload(payload),
    );
    if (observedSha256 !== expectedSha256) {
      fail("$.bundleSha256 does not match the canonical bundle payload.");
    }
    return {
      ok: true,
      value: { ...payload, bundleSha256: observedSha256 },
    };
  } catch (error) {
    return failure(errorMessage(error));
  }
}

export function decodeH05HostedProofBundleJson(
  raw: string,
): H05HostedProofBundleDecode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failure("bundle must contain valid JSON.");
  }
  const decoded = decodeH05HostedProofBundle(parsed);
  if (!decoded.ok) return decoded;
  if (raw !== serializeH05HostedProofBundle(decoded.value)) {
    return failure("bundle must use canonical JSON serialization.");
  }
  return decoded;
}

export function serializeH05HostedProofBundle(
  bundle: H05HostedProofBundle,
): string {
  const decoded = decodeH05HostedProofBundle(bundle);
  if (!decoded.ok) throw new Error(decoded.message);
  return canonicalJson(decoded.value);
}

export function serializeH05HostedProofBundlePayload(
  payload: H05HostedProofBundlePayload,
): string {
  return canonicalJson(decodePayload(payload, "$payload"));
}

function decodePayload(
  value: unknown,
  path: string,
): H05HostedProofBundlePayload {
  const record = exactRecord(value, path, ["format", "inputs", "receipt"]);
  if (record.format !== h05HostedProofBundleFormat) {
    fail(`${path}.format must equal ${JSON.stringify(h05HostedProofBundleFormat)}.`);
  }
  const inputs = decodeInputs(record.inputs, `${path}.inputs`);
  validateInputRelationships(inputs);
  const receipt = decodeH05HostedReceipt(record.receipt);
  if (!receipt.ok) throw new Error(receipt.message);
  const expectedReceipt = deriveReceipt(inputs);
  if (
    serializeH05HostedReceipt(receipt.value) !==
    serializeH05HostedReceipt(expectedReceipt)
  ) {
    fail(`${path}.receipt does not equal the compiler-derived receipt.`);
  }
  return {
    format: h05HostedProofBundleFormat,
    inputs,
    receipt: receipt.value,
  };
}

function decodeInputs(value: unknown, path: string): H05HostedProofBundleInputs {
  const record = exactRecord(value, path, [
    "controlPlaneBefore",
    "dataPlane",
    "controlPlaneAfter",
    "probeTeardown",
    "trace",
  ]);
  const controlPlaneBefore = decodeH05ControlPlaneEvidence(
    record.controlPlaneBefore,
  );
  if (!controlPlaneBefore.ok) throw new Error(controlPlaneBefore.message);
  const dataPlane = decodeH05DataPlaneEvidence(record.dataPlane);
  if (!dataPlane.ok) throw new Error(dataPlane.message);
  const controlPlaneAfter = decodeH05ControlPlaneEvidence(
    record.controlPlaneAfter,
  );
  if (!controlPlaneAfter.ok) throw new Error(controlPlaneAfter.message);
  const probeTeardown = decodeH05ProbeTeardownEvidence(record.probeTeardown);
  if (!probeTeardown.ok) throw new Error(probeTeardown.message);
  const trace = decodeH05TraceEvidence(record.trace);
  if (!trace.ok) throw new Error(trace.message);
  return {
    controlPlaneBefore: controlPlaneBefore.value,
    dataPlane: dataPlane.value,
    controlPlaneAfter: controlPlaneAfter.value,
    probeTeardown: probeTeardown.value,
    trace: trace.value,
  };
}

function validateInputRelationships(inputs: H05HostedProofBundleInputs): void {
  const traceCheck = verifyH05TraceEvidenceDependencies(
    inputs.trace,
    inputs.controlPlaneBefore,
    inputs.dataPlane,
    inputs.controlPlaneAfter,
  );
  if (!traceCheck.ok) throw new Error(traceCheck.message);
  const teardownCheck = verifyH05ProbeTeardownEvidenceDependencies(
    inputs.probeTeardown,
    inputs.dataPlane,
    inputs.controlPlaneAfter,
  );
  if (!teardownCheck.ok) throw new Error(teardownCheck.message);
  orderedTimestamps(
    inputs.probeTeardown.window.finishedAt,
    inputs.trace.window.collection.startedAt,
    "probe-teardown-to-trace-collection",
  );
}

function deriveReceipt(inputs: H05HostedProofBundleInputs): H05HostedReceipt {
  const before = inputs.controlPlaneBefore;
  const after = inputs.controlPlaneAfter;
  const dataPlane = inputs.dataPlane;
  const teardown = inputs.probeTeardown;
  const trace = inputs.trace;
  const hyperdrive = before.hyperdrive.opening;
  const executorDeployment = before.executor.deploymentBefore;
  const executorVersion = before.executor.opening.version;
  const probeDeployment = before.probe.deploymentBefore;
  const probeVersion = before.probe.opening.version;
  const hyperdriveBinding = executorVersion.versionBindings.find(
    (binding) => binding.type === "hyperdrive",
  );
  if (hyperdriveBinding === undefined) {
    fail("executor Hyperdrive binding is missing from verified control evidence.");
  }
  const serviceBinding = probeVersion.versionBindings.find(
    (binding) => binding.type === "service",
  );
  if (serviceBinding === undefined) {
    fail("probe service binding is missing from verified control evidence.");
  }
  const finalTeardownObservation =
    teardown.verification.observations[
      teardown.verification.observations.length - 1
    ];
  if (finalTeardownObservation === undefined) {
    fail("probe teardown has no final absence observation.");
  }
  const authorizedTraceCount = trace.traces.filter(
    (candidate) => candidate.kind === "authorized",
  ).length;
  const unauthorizedTraceCount = trace.traces.filter(
    (candidate) => candidate.kind === "unauthorized",
  ).length;
  const serviceBindingTraceCount = trace.traces.filter(
    (candidate) =>
      candidate.kind === "authorized" && candidate.executorParentLinked,
  ).length;
  const outcomeOkTraceCount = trace.traces.filter(
    (candidate) =>
      candidate.probe.outcome === "ok" &&
      (candidate.kind === "unauthorized" || candidate.executor.outcome === "ok"),
  ).length;
  const truncatedTraceCount = trace.traces.filter(
    (candidate) =>
      candidate.probe.truncated ||
      (candidate.kind === "authorized" && candidate.executor.truncated),
  ).length;
  const decoded = decodeH05HostedReceipt({
    format: h05HostedReceiptFormat,
    redaction: {
      bearerCapabilityValues: "omitted",
      databaseOrigin: "sha256-only",
      runIdentity: "included-non-sensitive",
    },
    source: {
      ...before.source,
      evidenceSha256: h05SourceEvidenceSha256(before.source),
    },
    window: {
      startedAt: before.window.startedAt,
      finishedAt: trace.window.collection.finishedAt,
    },
    run: dataPlane.run,
    inputs: {
      controlPlaneBeforeEvidenceSha256: before.evidenceSha256,
      dataPlaneEvidenceSha256: dataPlane.evidenceSha256,
      controlPlaneAfterEvidenceSha256: after.evidenceSha256,
      probeTeardownEvidenceSha256: teardown.evidenceSha256,
      traceEvidenceSha256: trace.evidenceSha256,
    },
    hyperdrive: {
      source: "cloudflare-hyperdrive-api",
      id: hyperdrive.id,
      name: hyperdrive.name,
      cachingDisabled: hyperdrive.cachingDisabled,
      originHostSha256: hyperdrive.originHostSha256,
      originDatabaseSha256: hyperdrive.originDatabaseSha256,
      originScheme: hyperdrive.originScheme,
      originPort: hyperdrive.originPort,
      tlsMode: hyperdrive.tlsMode,
      capturedAt: hyperdrive.capturedAt,
    },
    executor: {
      workerName: h05ExecutorWorkerName,
      deploymentId: executorDeployment.deploymentId,
      versionId: executorDeployment.versionId,
      trafficPercentage: executorDeployment.trafficPercentage,
      compatibilityDate: executorVersion.compatibilityDate,
      compatibilityFlags: executorVersion.compatibilityFlags,
      placementMode: executorVersion.placementMode,
      hyperdriveBinding: {
        name: hyperdriveBinding.name,
        id: hyperdriveBinding.id,
      },
      secretNames: before.executor.opening.secrets.map(({ name }) => name),
      bindingInventoryComplete: true,
      privacy: {
        source: "cloudflare-workers-api",
        inventoryComplete: true,
        workersDevEnabled: before.executor.opening.subdomain.enabled,
        previewUrlsEnabled:
          before.executor.opening.subdomain.previewsEnabled,
        routeTargetCount:
          before.executor.privacy.closing.routes.targetRouteCount,
        customDomainTargetCount:
          before.executor.privacy.closing.customDomains.filteredCount,
        directPublicRequestStatus:
          before.executor.privacy.closing.directRequest.status,
        beforeCheckedAt: before.executor.privacy.closing.checkedAt,
        afterCheckedAt: after.executor.privacy.closing.checkedAt,
      },
    },
    probe: {
      workerName: h05ProbeWorkerName,
      deploymentId: probeDeployment.deploymentId,
      versionId: probeDeployment.versionId,
      trafficPercentage: probeDeployment.trafficPercentage,
      publicOrigin: before.probe.publicOrigin,
      workersDevEnabled: before.probe.opening.subdomain.enabled,
      previewUrlsEnabled: before.probe.opening.subdomain.previewsEnabled,
      serviceBinding: {
        name: serviceBinding.name,
        service: serviceBinding.service,
      },
      secretNames: before.probe.opening.secrets.map(({ name }) => name),
      bindingInventoryComplete: true,
    },
    dataPlane: {
      window: dataPlane.window,
      invocationEvidenceSha256: dataPlane.invocation.evidenceSha256,
      proofRowsRemaining: dataPlane.postgresCleanup.proofRowsRemaining,
    },
    trace: {
      source: trace.query.source,
      probePath: trace.inputs.probePath,
      samplingRate: trace.query.samplingRate,
      queryComplete: trace.query.queryComplete,
      truncatedTraceCount,
      authorizedTraceCount,
      unauthorizedTraceCount,
      serviceBindingTraceCount,
      outcomeOkTraceCount,
      services: [h05ExecutorWorkerName, h05ProbeWorkerName],
      executorVersionId: trace.inputs.executorVersionId,
      probeVersionId: trace.inputs.probeVersionId,
      firstObservedAt: trace.window.observed.firstAt,
      lastObservedAt: trace.window.observed.lastAt,
      traceIdsSha256: h05TraceIdHashSetSha256(trace.traces),
      evidenceSha256: trace.evidenceSha256,
    },
    cleanup: {
      postgres: {
        source: "data-plane-evidence",
        proofRowsRemaining: dataPlane.postgresCleanup.proofRowsRemaining,
        evidenceSha256: dataPlane.evidenceSha256,
      },
      probe: {
        source: "probe-teardown-evidence",
        absent: true,
        deletionOutcome: teardown.deletion.outcome,
        deletionStatus: teardown.deletion.status,
        authenticatedLookupStatus:
          finalTeardownObservation.authenticatedScriptLookup.status,
        publicLookupStatus:
          finalTeardownObservation.publicProbeLookup.status,
        checkedAt: finalTeardownObservation.checkedAt,
        evidenceSha256: teardown.evidenceSha256,
      },
    },
  });
  if (!decoded.ok) throw new Error(decoded.message);
  if (
    authorizedTraceCount !== h05AuthorizedInvocationCount ||
    unauthorizedTraceCount !== h05UnauthorizedInvocationCount
  ) {
    fail("verified trace counts do not match the hosted proof contract.");
  }
  if (
    hyperdriveBinding.name !== h05HyperdriveBindingName ||
    serviceBinding.name !== h05ServiceBindingName
  ) {
    fail("verified binding names do not match the hosted proof contract.");
  }
  return decoded.value;
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  path: string,
  keys: Keys,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail(`${path} must contain exactly: ${expectedKeys.join(", ")}.`);
  }
  return value;
}

function orderedTimestamps(earlier: string, later: string, path: string): void {
  if (Date.parse(earlier) > Date.parse(later)) {
    fail(`${path} timestamps are out of order.`);
  }
}

function sha256String(value: unknown, path: string): H05HostedProofBundleSha256 {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    fail(`${path} must be a lowercase SHA-256 digest.`);
  }
  return value as H05HostedProofBundleSha256;
}

function bundleSha256(value: string): H05HostedProofBundleSha256 {
  return createHash("sha256")
    .update(`flarex-h05-hosted-proof-bundle-payload-v1\0${value}`)
    .digest("hex") as H05HostedProofBundleSha256;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(message: string): { readonly ok: false; readonly message: string } {
  return {
    ok: false,
    message: `Invalid H05 hosted proof bundle: ${message}`,
  };
}

function fail(message: string): never {
  throw new Error(message);
}
