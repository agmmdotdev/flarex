import { describe, expect, it } from "vitest";

import {
  h05ProbeTeardownMaximumAttempts,
  h05ProbeTeardownPollIntervalMs,
  verifyH05ProbeTeardownEvidenceDependencies,
} from "../h05/probeTeardownEvidence";
import type { H05CloudflareProbeTeardownApi } from "../scripts/cloudflareProbeTeardownApi";
import { collectH05ProbeTeardownEvidence } from "../scripts/h05ProbeTeardownCollector";
import {
  h05TraceFixtureAccountId,
  validH05TraceControlPlaneEvidence,
  validH05TraceDataPlaneEvidence,
} from "./h05TraceFixtures";

describe("H05 probe teardown collector", () => {
  it("requires two consecutive authenticated and public 404 sweeps", async () => {
    const fixture = fixtureApi({
      publicStatuses: [404, 404, 404, 404],
      scriptStatuses: [404, 200, 404, 404],
    });
    const sleeps: number[] = [];
    const dataPlane = validH05TraceDataPlaneEvidence();
    const controlPlaneAfter = validH05TraceControlPlaneEvidence("after");
    const evidence = await collectH05ProbeTeardownEvidence({
      accountId: h05TraceFixtureAccountId,
      api: fixture.api,
      controlPlaneAfter,
      dataPlane,
      now: timestampSequence([
        "2026-07-11T10:03:08.000Z",
        "2026-07-11T10:03:08.500Z",
        "2026-07-11T10:03:09.000Z",
        "2026-07-11T10:03:10.000Z",
        "2026-07-11T10:03:12.000Z",
        "2026-07-11T10:03:14.000Z",
        "2026-07-11T10:03:16.000Z",
        "2026-07-11T10:03:17.000Z",
      ]),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    expect(evidence.verification.attemptsUsed).toBe(4);
    expect(evidence.verification.observations.map(({ checkedAt }) => checkedAt)).toEqual([
      "2026-07-11T10:03:14.000Z",
      "2026-07-11T10:03:16.000Z",
    ]);
    expect(evidence.verification.observations.map(({ attempt }) => attempt)).toEqual([
      3,
      4,
    ]);
    expect(evidence.deletion).toMatchObject({
      forceParameter: "omitted",
      outcome: "deleted",
      status: 200,
    });
    expect(fixture.calls).toEqual({
      access: 1,
      deletion: 1,
      public: 4,
      script: 4,
    });
    expect(sleeps).toEqual([
      h05ProbeTeardownPollIntervalMs,
      h05ProbeTeardownPollIntervalMs,
      h05ProbeTeardownPollIntervalMs,
    ]);
    expect(
      verifyH05ProbeTeardownEvidenceDependencies(
        evidence,
        dataPlane,
        controlPlaneAfter,
      ),
    ).toEqual({ ok: true });
  });

  it("emits retry-safe evidence when the exact probe is already absent", async () => {
    const fixture = fixtureApi({ deletionStatus: 404 });
    const evidence = await collectH05ProbeTeardownEvidence({
      accountId: h05TraceFixtureAccountId,
      api: fixture.api,
      controlPlaneAfter: validH05TraceControlPlaneEvidence("after"),
      dataPlane: validH05TraceDataPlaneEvidence(),
      now: timestampSequence([
        "2026-07-11T10:03:08.000Z",
        "2026-07-11T10:03:08.500Z",
        "2026-07-11T10:03:09.000Z",
        "2026-07-11T10:03:10.000Z",
        "2026-07-11T10:03:12.000Z",
        "2026-07-11T10:03:13.000Z",
      ]),
      sleep: async () => {},
    });

    expect(evidence.deletion).toMatchObject({
      outcome: "already-absent",
      status: 404,
    });
  });

  it("requires positive same-token account access before deletion", async () => {
    const fixture = fixtureApi({ accessFailure: true });

    await expect(
      collectH05ProbeTeardownEvidence({
        accountId: h05TraceFixtureAccountId,
        api: fixture.api,
        controlPlaneAfter: validH05TraceControlPlaneEvidence("after"),
        dataPlane: validH05TraceDataPlaneEvidence(),
      }),
    ).rejects.toThrow("account access fixture failed");
    expect(fixture.calls).toEqual({
      access: 1,
      deletion: 0,
      public: 0,
      script: 0,
    });
  });

  it("validates the account and dependency fence before deletion", async () => {
    const wrongAccountFixture = fixtureApi();
    await expect(
      collectH05ProbeTeardownEvidence({
        accountId: "f".repeat(32),
        api: wrongAccountFixture.api,
        controlPlaneAfter: validH05TraceControlPlaneEvidence("after"),
        dataPlane: validH05TraceDataPlaneEvidence(),
      }),
    ).rejects.toThrow("does not match the post-run control-plane evidence");
    expect(wrongAccountFixture.calls.deletion).toBe(0);

    const wrongFenceFixture = fixtureApi();
    await expect(
      collectH05ProbeTeardownEvidence({
        accountId: h05TraceFixtureAccountId,
        api: wrongFenceFixture.api,
        controlPlaneAfter: validH05TraceControlPlaneEvidence("before"),
        dataPlane: validH05TraceDataPlaneEvidence(),
      }),
    ).rejects.toThrow("data-plane-to-control-plane-after");
    expect(wrongFenceFixture.calls.deletion).toBe(0);
  });

  it("fails after the bounded observation budget without repeating deletion", async () => {
    const fixture = fixtureApi({
      publicStatuses: Array.from(
        { length: h05ProbeTeardownMaximumAttempts },
        () => 404,
      ),
      scriptStatuses: Array.from(
        { length: h05ProbeTeardownMaximumAttempts },
        () => 200,
      ),
    });
    let sleeps = 0;

    await expect(
      collectH05ProbeTeardownEvidence({
        accountId: h05TraceFixtureAccountId,
        api: fixture.api,
        controlPlaneAfter: validH05TraceControlPlaneEvidence("after"),
        dataPlane: validH05TraceDataPlaneEvidence(),
        now: monotonicallyIncreasingTimestamp(),
        sleep: async () => {
          sleeps += 1;
        },
      }),
    ).rejects.toThrow(
      `did not stabilize after ${h05ProbeTeardownMaximumAttempts} attempts`,
    );
    expect(fixture.calls).toEqual({
      access: 1,
      deletion: 1,
      public: h05ProbeTeardownMaximumAttempts,
      script: h05ProbeTeardownMaximumAttempts,
    });
    expect(sleeps).toBe(h05ProbeTeardownMaximumAttempts - 1);
  });
});

interface FixtureOptions {
  readonly accessFailure?: boolean;
  readonly deletionStatus?: 200 | 404;
  readonly publicStatuses?: readonly number[];
  readonly scriptStatuses?: readonly (200 | 404)[];
}

function fixtureApi(options: FixtureOptions = {}): {
  readonly api: H05CloudflareProbeTeardownApi;
  readonly calls: {
    access: number;
    deletion: number;
    public: number;
    script: number;
  };
} {
  const calls = { access: 0, deletion: 0, public: 0, script: 0 };
  const publicStatuses = [...(options.publicStatuses ?? [404, 404])];
  const scriptStatuses = [...(options.scriptStatuses ?? [404, 404])];
  const deletionStatus = options.deletionStatus ?? 200;
  return {
    calls,
    api: {
      async verifyAccountAccess() {
        calls.access += 1;
        if (options.accessFailure === true) {
          throw new Error("account access fixture failed");
        }
        return 200;
      },
      async deleteProbe() {
        calls.deletion += 1;
        return deletionStatus === 200
          ? { outcome: "deleted", status: 200 }
          : { outcome: "already-absent", status: 404 };
      },
      async probeScriptStatus() {
        calls.script += 1;
        const status = scriptStatuses.shift();
        if (status === undefined) throw new Error("script fixture exhausted");
        return status;
      },
      async publicProbeStatus() {
        calls.public += 1;
        const status = publicStatuses.shift();
        if (status === undefined) throw new Error("public fixture exhausted");
        return status;
      },
    },
  };
}

function timestampSequence(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => {
    const value = remaining.shift();
    if (value === undefined) throw new Error("timestamp fixture exhausted");
    return value;
  };
}

function monotonicallyIncreasingTimestamp(): () => string {
  let offset = 0;
  const base = Date.parse("2026-07-11T10:03:08.000Z");
  return () => new Date(base + offset++ * 1_000).toISOString();
}
