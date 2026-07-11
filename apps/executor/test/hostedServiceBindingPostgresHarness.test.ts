import { describe, expect, it } from "vitest";

import {
  compileHostedInvocationEvidence,
  decodeHostedExecutorOccProofConfig,
} from "../h05/hostedPostgresProof";

const validInput = {
  FLAREX_H05_ALLOW_STAGING_MUTATION: "yes",
  FLAREX_H05_POSTGRES_DATABASE_URL:
    "postgresql://user:secret@db.example.test/flarex_h05?sslmode=require",
  FLAREX_H05_EXPECTED_DATABASE_NAME: "flarex_h05",
  FLAREX_H05_PROBE_URL:
    "https://flarex-executor-h05-probe.example.workers.dev",
  FLAREX_H05_PROBE_TOKEN: "probe-secret",
  FLAREX_H05_RUN_ID: "run_20260711_a",
} satisfies Readonly<Record<string, string | undefined>>;

describe("hosted executor proof configuration", () => {
  it("compiles the exact counted transport and SQL oracle into receipt evidence", () => {
    const invocation = compileHostedInvocationEvidence(
      proofEvidence,
      proofSql,
      proofTransport,
    );

    expect(invocation).toMatchObject({
      unauthorizedStatus: 401,
      unauthorizedHopAbsent: true,
      authorizedResponses: 14,
      hopMarkedResponses: 14,
      noStoreResponses: 15,
      winner: { committedTs: 11, observedTs: 10, state: "finished" },
      stale: { currentTs: 11, state: "aborted" },
      fresh: { committedTs: 12, observedTs: 11, previousTs: 11 },
      sql: { finalTs: 12, finalPrevTs: 11 },
    });
  });

  it("refuses to compile invocation evidence from a drifted SQL oracle", () => {
    expect(() =>
      compileHostedInvocationEvidence(
        proofEvidence,
        { ...proofSql, commits: 1 },
        proofTransport,
      ),
    ).toThrow();
  });

  it("decodes only an explicit encrypted hosted staging configuration", () => {
    const config = decodeHostedExecutorOccProofConfig(validInput);

    expect(config.probeUrl.toString()).toBe(
      "https://flarex-executor-h05-probe.example.workers.dev/",
    );
    expect(config.databaseName).toBe("flarex_h05");
    expect(config.runId).toBe("run_20260711_a");
    expect(config.fixture).toEqual({
      deploymentId: "deployment_h05_run_20260711_a",
      projectId: "project_h05_run_20260711_a",
      markerText: "h05:run_20260711_a",
    });
  });

  it.each([
    [
      "missing mutation opt-in",
      { FLAREX_H05_ALLOW_STAGING_MUTATION: undefined },
      "FLAREX_H05_ALLOW_STAGING_MUTATION=yes",
    ],
    [
      "localhost database",
      {
        FLAREX_H05_POSTGRES_DATABASE_URL:
          "postgresql://user:secret@localhost/flarex_h05?sslmode=require",
      },
      "must target a remote host",
    ],
    [
      "trailing-dot localhost database",
      {
        FLAREX_H05_POSTGRES_DATABASE_URL:
          "postgresql://user:secret@localhost./flarex_h05?sslmode=require",
      },
      "must target a remote host",
    ],
    [
      "127/8 database",
      {
        FLAREX_H05_POSTGRES_DATABASE_URL:
          "postgresql://user:secret@127.0.0.42/flarex_h05?sslmode=require",
      },
      "must target a remote host",
    ],
    [
      "IPv6 loopback database",
      {
        FLAREX_H05_POSTGRES_DATABASE_URL:
          "postgresql://user:secret@[::1]/flarex_h05?sslmode=require",
      },
      "must target a remote host",
    ],
    [
      "database-name mismatch",
      { FLAREX_H05_EXPECTED_DATABASE_NAME: "some_other_database" },
      "must exactly match the database URL target",
    ],
    [
      "default PostgreSQL database",
      {
        FLAREX_H05_POSTGRES_DATABASE_URL:
          "postgresql://user:secret@db.example.test/postgres?sslmode=require",
        FLAREX_H05_EXPECTED_DATABASE_NAME: "postgres",
      },
      "must not target a default PostgreSQL database",
    ],
    [
      "missing TLS mode",
      {
        FLAREX_H05_POSTGRES_DATABASE_URL:
          "postgresql://user:secret@db.example.test/flarex_h05",
      },
      "must set exactly one sslmode",
    ],
    [
      "disabled TLS mode",
      {
        FLAREX_H05_POSTGRES_DATABASE_URL:
          "postgresql://user:secret@db.example.test/flarex_h05?sslmode=disable",
      },
      "must set exactly one sslmode",
    ],
    [
      "ambiguous TLS mode",
      {
        FLAREX_H05_POSTGRES_DATABASE_URL:
          "postgresql://user:secret@db.example.test/flarex_h05?sslmode=require&sslmode=disable",
      },
      "must set exactly one sslmode",
    ],
    [
      "query-parameter host override",
      {
        FLAREX_H05_POSTGRES_DATABASE_URL:
          "postgresql://user:secret@db.example.test/flarex_h05?sslmode=require&host=127.0.0.1",
      },
      "may set only the validated sslmode query parameter",
    ],
    [
      "non-HTTPS probe",
      { FLAREX_H05_PROBE_URL: "http://probe.example.test" },
      "FLAREX_H05_PROBE_URL must use HTTPS",
    ],
    [
      "probe URL with a path",
      {
        FLAREX_H05_PROBE_URL:
          "https://probe.example.workers.dev/not-an-origin",
      },
      "must be an HTTPS origin",
    ],
    [
      "invalid run ID",
      { FLAREX_H05_RUN_ID: "NOT SAFE" },
      "FLAREX_H05_RUN_ID must be",
    ],
  ] satisfies readonly [
    string,
    Readonly<Record<string, string | undefined>>,
    string,
  ][])("rejects %s", (_, overrides, message) => {
    expect(() =>
      decodeHostedExecutorOccProofConfig({ ...validInput, ...overrides }),
    ).toThrow(message);
  });

  it("redacts credentials from a malformed database URL error", () => {
    const error = captureError(() =>
      decodeHostedExecutorOccProofConfig({
        ...validInput,
        FLAREX_H05_POSTGRES_DATABASE_URL:
          "postgresql://user:super-secret@[::1",
      }),
    );

    expect(error.message).toContain(
      "FLAREX_H05_POSTGRES_DATABASE_URL must be a valid URL",
    );
    expect(error.message).not.toContain("super-secret");
  });
});

const proofEvidence = {
  winnerSessionId: "winner",
  staleSessionId: "stale",
  freshSessionId: "fresh",
  winnerTs: 11,
  freshTs: 12,
} satisfies Parameters<typeof compileHostedInvocationEvidence>[0];

const proofSql = {
  sessions: 3,
  activeSessions: 0,
  documentRevisions: 3,
  commits: 2,
  outboxEvents: 2,
  finalTs: 12,
  finalPrevTs: 11,
  winnerState: "finished",
  staleState: "aborted",
  freshState: "finished",
  winnerObservedTs: 10,
  staleObservedTs: 10,
  freshObservedTs: 11,
} satisfies Parameters<typeof compileHostedInvocationEvidence>[1];

const proofTransport = {
  unauthorizedStatus: 401,
  unauthorizedHopAbsent: true,
  authorizedResponses: 14,
  hopMarkedResponses: 14,
  noStoreResponses: 15,
} satisfies Parameters<typeof compileHostedInvocationEvidence>[2];

function captureError(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Hosted config decoder threw a non-Error value.");
  }
  throw new Error("Expected hosted config decoding to fail.");
}
