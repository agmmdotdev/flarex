import { readFile } from "node:fs/promises";
import { Miniflare, type MiniflareOptions } from "miniflare";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
  probeAttemptId,
  probeCodeId,
  probeSampleId,
  probeScopeId,
  probeSessionId,
} from "../src/identity";
import {
  decodeProbeFullInvokeSessionResponseV1OrNull,
  ProbeInvokeFacetRequestV1Schema,
} from "../src/invokeProtocol";
import { probeSyntheticCommitSeq } from "../src/commitProtocol";
import type { ProbeGatewayEnv } from "../src/gateway";
import { PROBE_PROTOCOL_VERSION_V1 } from "../src/protocol";
import { PROBE_SESSION_POSTGRES_AB_MATRIX_V1 } from "../src/matrix";
import { runEffectTestSync } from "./effectTest";

const WORKER_NAME = "runtime-topology-session-postgres-test";
const SESSION_POSTGRES_TEST_DISABLED =
  process.env.RUNTIME_TOPOLOGY_PROBE_TEST_DATABASE_URL === undefined ||
  process.env.RUNTIME_TOPOLOGY_PROBE_TEST_WORKER_BUNDLE === undefined;
const LOCAL_POSTGRES_URL =
  process.env.RUNTIME_TOPOLOGY_PROBE_TEST_DATABASE_URL ?? "";
const WORKER_BUNDLE_PATH =
  process.env.RUNTIME_TOPOLOGY_PROBE_TEST_WORKER_BUNDLE ?? "";

describe.skipIf(
  SESSION_POSTGRES_TEST_DISABLED,
).sequential(
  "P33 SessionDO-owned Postgres in Miniflare",
  () => {
    let miniflare: Miniflare;

    beforeAll(async () => {
      await resetProbeRows();
      miniflare = new Miniflare({
        workers: [{
          name: WORKER_NAME,
          compatibilityDate: "2026-06-11",
          compatibilityFlags: ["nodejs_compat"],
          modules: [{
            type: "ESModule",
            path: "worker.js",
            contents: await readFile(WORKER_BUNDLE_PATH, "utf8"),
          }],
          bindings: {
            HYPERDRIVE_CACHE_DISABLED: {
              connectionString: LOCAL_POSTGRES_URL,
            },
            RUNTIME_TOPOLOGY_PROBE_TOKEN: "p33-session-postgres-test-token",
          },
          workerLoaders: { LOADER: {} },
          serviceBindings: {
            MOCK_READ: {
              name: WORKER_NAME,
              entrypoint: "PostgresReadEntrypoint",
            },
            MOCK_FINISH: {
              name: WORKER_NAME,
              entrypoint: "PostgresFinishEntrypoint",
            },
          },
          durableObjects: {
            PROBE_SESSIONS: {
              className: "ProbeSessionDO",
              useSQLite: true,
            },
            PROBE_SYNC: {
              className: "ProbeSyncDO",
              useSQLite: true,
            },
            PROBE_RUNS: {
              className: "ProbeRunDO",
              useSQLite: true,
            },
            PROBE_CAMPAIGN: {
              className: "ProbeCampaignDO",
              useSQLite: true,
            },
          },
        }],
      } satisfies MiniflareOptions);
    }, 30_000);

    afterAll(async () => {
      await miniflare.dispose();
      await resetProbeRows();
    });

    it("keeps finalization outside the facet and commits from SessionDO", async () => {
      const response = await invoke("session_postgres_warm_invoke", "p33_session", 0);
      expect(response.executorHost).toBe("session-postgres");
      expect(response.facet.outboundFinishCalls).toBe(0);
      expect(response.facet.finish).toBeNull();
      expect(response.finish.commitAuthority).toBe("postgres");
      expect(response.finish.finishDisposition).toBe("committed");
      expect(response.finish.sync.disposition).toBe("applied");
    });

    it("retains the same-script entrypoint path as the matched control", async () => {
      const response = await invoke(
        "facet_finalizer_postgres_warm_invoke",
        "p33_control",
        0,
      );
      expect(response.executorHost).toBe("facet-finalizer");
      expect(response.facet.outboundFinishCalls).toBe(1);
      expect(response.facet.finish).not.toBeNull();
      expect(response.finish.commitAuthority).toBe("postgres");
      expect(response.finish.finishDisposition).toBe("committed");
    });

    it("advances both warm paths without changing facet capability placement", async () => {
      const [candidate, control] = await Promise.all([
        invoke("session_postgres_warm_invoke", "p33_session", 1),
        invoke("facet_finalizer_postgres_warm_invoke", "p33_control", 1),
      ]);
      expect(candidate.finish.sync.cursor).toBe(2);
      expect(candidate.facet.outboundFinishCalls).toBe(0);
      expect(control.finish.sync.cursor).toBe(2);
      expect(control.facet.outboundFinishCalls).toBe(1);
    });

    it("completes the SessionDO Postgres candidate through the public gateway", async () => {
      const headers = {
        authorization: "Bearer p33-session-postgres-test-token",
        "content-type": "application/json",
      };
      const registration = await miniflare.dispatchFetch(
        "https://probe.test/v1/campaign",
        {
          method: "POST",
          headers,
          body: JSON.stringify(PROBE_SESSION_POSTGRES_AB_MATRIX_V1),
        },
      );
      expect(registration.status, await registration.clone().text()).toBe(201);
      const candidate = PROBE_SESSION_POSTGRES_AB_MATRIX_V1.runs.find(
        run => run.scenario === "session_postgres_warm_invoke",
      );
      if (candidate === undefined) throw new Error("missing SessionDO candidate run");
      const response = await miniflare.dispatchFetch(
        "https://probe.test/v1/samples",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            protocolVersion: PROBE_PROTOCOL_VERSION_V1,
            runId: candidate.runId,
            sampleOrdinal: 0,
          }),
        },
      );
      const responseText = await response.text();
      expect(response.status, responseText).toBe(200);
      const body: unknown = JSON.parse(responseText);
      expect(body).toMatchObject({
        fragment: {
          scenario: "session_postgres_warm_invoke",
          outcome: { kind: "ok" },
        },
        control: {
          terminalState: "completed",
          syncWake: { kind: "observed", disposition: "applied" },
        },
      });
    });

    async function invoke(
      scenario:
        | "facet_finalizer_postgres_warm_invoke"
        | "session_postgres_warm_invoke",
      runIdValue: string,
      sampleOrdinalValue: number,
    ) {
      const bindings = await miniflare.getBindings<ProbeGatewayEnv>(WORKER_NAME);
      const runId = runEffectTestSync(decodeProbeRunIdEffect(runIdValue));
      const sampleOrdinal = runEffectTestSync(
        decodeProbeOrdinalEffect(sampleOrdinalValue),
      );
      const sessionOrdinal = runEffectTestSync(decodeProbeOrdinalEffect(0));
      const request = ProbeInvokeFacetRequestV1Schema.make({
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        runId,
        sampleId: probeSampleId(runId, sampleOrdinal),
        sampleOrdinal,
        scopeId: probeScopeId(runId),
        scenario,
        commitSeq: probeSyntheticCommitSeq(sampleOrdinal),
        sessionId: probeSessionId(runId, sessionOrdinal),
        sessionMode: "reuse-session",
        attemptId: probeAttemptId(runId, sessionOrdinal, sampleOrdinal),
        facetId: probeAttemptId(runId, sessionOrdinal, sessionOrdinal),
        codeMode: "stable",
        codeId: probeCodeId({
          mode: "stable",
          profile: scenario === "session_postgres_warm_invoke"
            ? "invoke-session-postgres-warm"
            : "invoke-finalizer-postgres-warm",
        }),
        journalEntries: 2,
        payload: "x".repeat(64),
      });
      const raw = await bindings.PROBE_SESSIONS.getByName(request.sessionId)
        .fetch("https://probe-session.internal/v1/full-invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
      const body: unknown = await raw.json();
      expect(raw.status, JSON.stringify(body)).toBe(200);
      const decoded = decodeProbeFullInvokeSessionResponseV1OrNull(body);
      expect(decoded).not.toBeNull();
      if (decoded === null) throw new Error("invalid SessionDO probe response");
      return decoded;
    }

    async function resetProbeRows(): Promise<void> {
      const client = new Client({ connectionString: LOCAL_POSTGRES_URL });
      await client.connect();
      try {
        await client.query(
          "TRUNCATE flarex_runtime_topology_probe_p28.terminal_outcomes, flarex_runtime_topology_probe_p28.scope_cursors",
        );
      } finally {
        await client.end();
      }
    }
  },
);
