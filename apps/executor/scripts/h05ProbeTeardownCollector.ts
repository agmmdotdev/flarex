import {
  decodeH05ControlPlaneEvidence,
  h05CloudflareAccountIdSha256,
  type H05ControlPlaneEvidence,
} from "../h05/controlPlaneEvidence";
import {
  compileH05ProbeTeardownEvidence,
  h05ProbeTeardownMaximumAttempts,
  h05ProbeTeardownPollIntervalMs,
  h05ProbeTeardownStableObservationCount,
  validateH05ProbeTeardownDependencies,
  type H05ProbeTeardownEvidence,
} from "../h05/probeTeardownEvidence";
import {
  decodeH05DataPlaneEvidence,
  type H05DataPlaneEvidence,
} from "../h05/receipt";
import type { H05CloudflareProbeTeardownApi } from "./cloudflareProbeTeardownApi";

export interface H05ProbeTeardownCollectorOptions {
  readonly accountId: string;
  readonly api: H05CloudflareProbeTeardownApi;
  readonly controlPlaneAfter: unknown;
  readonly dataPlane: unknown;
  readonly now?: () => string;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

interface H05ProbeTeardownDependencies {
  readonly controlPlaneAfter: H05ControlPlaneEvidence;
  readonly dataPlane: H05DataPlaneEvidence;
}

interface H05RawProbeAbsenceObservation {
  readonly authenticatedScriptLookup: {
    readonly method: "GET";
    readonly status: 404;
  };
  readonly attempt: number;
  readonly checkedAt: string;
  readonly publicProbeLookup: {
    readonly authorization: "omitted";
    readonly method: "POST";
    readonly status: 404;
  };
}

export async function collectH05ProbeTeardownEvidence(
  options: H05ProbeTeardownCollectorOptions,
): Promise<H05ProbeTeardownEvidence> {
  const dependencies = decodeDependencies(options);
  const dependencyCheck = validateH05ProbeTeardownDependencies(
    dependencies.dataPlane,
    dependencies.controlPlaneAfter,
  );
  if (!dependencyCheck.ok) throw new Error(dependencyCheck.message);
  if (
    h05CloudflareAccountIdSha256(options.accountId) !==
    dependencies.controlPlaneAfter.accountIdSha256
  ) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID does not match the post-run control-plane evidence.",
    );
  }

  const now = options.now ?? (() => new Date().toISOString());
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = now();
  const accountAccessStatus = await options.api.verifyAccountAccess();
  const accountAccessCheckedAt = now();
  const deletionResult = await options.api.deleteProbe();
  const completedAt = now();
  const observations: H05RawProbeAbsenceObservation[] = [];
  let attemptsUsed = 0;

  while (
    attemptsUsed < h05ProbeTeardownMaximumAttempts &&
    observations.length < h05ProbeTeardownStableObservationCount
  ) {
    attemptsUsed += 1;
    const [authenticatedStatus, publicStatus] = await Promise.all([
      options.api.probeScriptStatus(),
      options.api.publicProbeStatus(),
    ]);
    const checkedAt = now();
    if (authenticatedStatus === 404 && publicStatus === 404) {
      observations.push({
        authenticatedScriptLookup: { method: "GET", status: 404 },
        attempt: attemptsUsed,
        checkedAt,
        publicProbeLookup: {
          authorization: "omitted",
          method: "POST",
          status: 404,
        },
      });
    } else {
      observations.length = 0;
    }
    if (observations.length === h05ProbeTeardownStableObservationCount) break;
    if (attemptsUsed < h05ProbeTeardownMaximumAttempts) {
      await sleep(h05ProbeTeardownPollIntervalMs);
    }
  }

  if (observations.length !== h05ProbeTeardownStableObservationCount) {
    throw new Error(
      `H05 probe absence did not stabilize after ${h05ProbeTeardownMaximumAttempts} attempts.`,
    );
  }

  const compiled = compileH05ProbeTeardownEvidence(
    dependencies.dataPlane,
    dependencies.controlPlaneAfter,
    {
      accountAccess: {
        checkedAt: accountAccessCheckedAt,
        method: "GET",
        selection: "fixed-tag-filter",
        source: "cloudflare-workers-scripts-api",
        status: accountAccessStatus,
      },
      deletion: {
        completedAt,
        forceParameter: "omitted",
        method: "DELETE",
        outcome: deletionResult.outcome,
        source: "cloudflare-workers-scripts-api",
        status: deletionResult.status,
      },
      verification: {
        attemptsUsed,
        maximumAttempts: h05ProbeTeardownMaximumAttempts,
        observations,
        pollIntervalMs: h05ProbeTeardownPollIntervalMs,
        requiredConsecutiveObservations:
          h05ProbeTeardownStableObservationCount,
      },
      window: { finishedAt: now(), startedAt },
    },
  );
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.value;
}

function decodeDependencies(
  options: H05ProbeTeardownCollectorOptions,
): H05ProbeTeardownDependencies {
  const dataPlane = decodeH05DataPlaneEvidence(options.dataPlane);
  if (!dataPlane.ok) throw new Error(dataPlane.message);
  const controlPlaneAfter = decodeH05ControlPlaneEvidence(
    options.controlPlaneAfter,
  );
  if (!controlPlaneAfter.ok) throw new Error(controlPlaneAfter.message);
  return {
    controlPlaneAfter: controlPlaneAfter.value,
    dataPlane: dataPlane.value,
  };
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
