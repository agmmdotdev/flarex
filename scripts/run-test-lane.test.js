// @ts-check

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  analyzeTestLaneManifest,
  executeTestLaneSelection,
  inspectTestLaneAvailability,
  loadTestLaneManifest,
  projectTestLaneEnvironment,
  resolveTestLaneSelection,
  resolveTestLaneStepArguments,
  runTestLaneStep,
} from "./run-test-lane.mjs";

describe("test lane manifest and runner", () => {
  it("accepts the repository manifest and resolves stable selectors", () => {
    const manifest = loadTestLaneManifest();

    expect(analyzeTestLaneManifest(manifest)).toEqual([]);
    expect(resolveTestLaneSelection(manifest, "postgres").map((lane) => lane.id))
      .toEqual([
        "postgres-persistence",
        "postgres-executor",
        "postgres-system",
      ]);
    expect(resolveTestLaneSelection(manifest, "postgres-executor").map((lane) => lane.id))
      .toEqual(["postgres-executor"]);
    expect(resolveTestLaneSelection(manifest, "c08-b1a-postgres").map((lane) => lane.id))
      .toEqual(["c08-b1-postgres"]);
    expect(resolveTestLaneSelection(manifest, "c08-b1b-postgres").map((lane) => lane.id))
      .toEqual(["c08-b1-postgres"]);
    expect(resolveTestLaneSelection(manifest, "dte05-e2b-pglite").map((lane) => lane.id))
      .toEqual(["dte05-repair-checkpoint-pglite"]);
    expect(resolveTestLaneSelection(manifest, "dte05-e2c1-pglite").map((lane) => lane.id))
      .toEqual(["dte05-repair-checkpoint-pglite"]);
  });

  it("keeps stable package PostgreSQL commands delegated to the root manifest", () => {
    const delegatedCommands = [
      [
        "packages/persistence-postgres/package.json",
        "node ../../scripts/run-test-lane.mjs postgres-persistence",
      ],
      [
        "packages/executor/package.json",
        "node ../../scripts/run-test-lane.mjs postgres-executor",
      ],
      [
        "packages/system-test/package.json",
        "node ../../scripts/run-test-lane.mjs postgres-system",
      ],
    ];

    for (const [manifestPath, expectedCommand] of delegatedCommands) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      expect(manifest.scripts?.["test:postgres"]).toBe(expectedCommand);
    }
  });

  it("keeps both live C08-B1 PostgreSQL aliases on one manifest-owned proof", () => {
    const manifest = JSON.parse(readFileSync("packages/persistence-postgres/package.json", "utf8"));

    expect(manifest.scripts?.["test:c08-b1a:postgres"])
      .toBe("node ../../scripts/run-test-lane.mjs c08-b1a-postgres");
    expect(manifest.scripts?.["test:c08-b1b:postgres"])
      .toBe("node ../../scripts/run-test-lane.mjs c08-b1b-postgres");
  });

  it("keeps both DTE05 checkpoint aliases on one explicitly lower-layer PGlite proof", () => {
    const manifest = JSON.parse(readFileSync("packages/persistence-postgres/package.json", "utf8"));

    expect(manifest.scripts?.["test:dte05-e2b:pglite"])
      .toBe("node ../../scripts/run-test-lane.mjs dte05-e2b-pglite");
    expect(manifest.scripts?.["test:dte05-e2c1:pglite"])
      .toBe("node ../../scripts/run-test-lane.mjs dte05-e2c1-pglite");
  });

  it("expands shared C08-B2 and O09-B files inside each original Vitest invocation", () => {
    const manifest = loadTestLaneManifest();
    const packageManifest = JSON.parse(
      readFileSync("packages/persistence-postgres/package.json", "utf8"),
    );
    /** @type {readonly (readonly [string, readonly string[]])[]} */
    const cases = [
      [
        "c08-b2-pglite",
        [
          "exec",
          "vitest",
          "run",
          "test/appUniqueConstraintDefinitions.test.ts",
          "test/appUniqueKeys.test.ts",
          "test/storedAttemptEvidence.test.ts",
          "--no-file-parallelism",
          "--testTimeout=180000",
        ],
      ],
      [
        "o09-b-pglite",
        [
          "exec",
          "vitest",
          "run",
          "test/appUniqueKeys.test.ts",
          "test/storedAttemptEvidence.test.ts",
          "--no-file-parallelism",
          "--testTimeout=180000",
        ],
      ],
      [
        "c08-b2-postgres",
        [
          "exec",
          "vitest",
          "run",
          "test/appUniqueConstraintDefinitions.postgres.test.ts",
          "test/appUniqueKeys.postgres.test.ts",
          "test/pointCommitTransaction.postgres.test.ts",
          "--no-file-parallelism",
          "--testTimeout=180000",
        ],
      ],
      [
        "o09-b-postgres",
        [
          "exec",
          "vitest",
          "run",
          "test/appUniqueKeys.postgres.test.ts",
          "test/pointCommitTransaction.postgres.test.ts",
          "--no-file-parallelism",
          "--testTimeout=180000",
        ],
      ],
    ];

    for (const [selector, expectedArguments] of cases) {
      const lane = resolveTestLaneSelection(manifest, selector)[0];
      expect(resolveTestLaneStepArguments(manifest, lane.steps[0])).toEqual(expectedArguments);
    }
    expect(packageManifest.scripts?.["test:c08-b2:pglite"])
      .toBe("node ../../scripts/run-test-lane.mjs c08-b2-pglite");
    expect(packageManifest.scripts?.["test:c08-b2:postgres"])
      .toBe("node ../../scripts/run-test-lane.mjs c08-b2-postgres");
    expect(packageManifest.scripts?.["test:o09-b:pglite"])
      .toBe("node ../../scripts/run-test-lane.mjs o09-b-pglite");
    expect(packageManifest.scripts?.["test:o09-b:postgres"])
      .toBe("node ../../scripts/run-test-lane.mjs o09-b-postgres");
  });

  it("rejects unknown and unreferenced test-file groups", () => {
    const manifest = JSON.parse(readFileSync("test-lanes.json", "utf8"));
    manifest.testFileGroups["unused-group"] = ["test/unused.test.ts"];
    manifest.lanes[0].steps[0].args = [{ testFileGroup: "missing-group" }];

    expect(analyzeTestLaneManifest(manifest)).toEqual(expect.arrayContaining([
      "lanes[0].steps[0].args references unknown test-file group missing-group.",
      "testFileGroups.unused-group is not referenced by any lane step.",
    ]));
  });

  it("rejects test-file groups and inline files that escape the package directory", () => {
    const manifest = JSON.parse(readFileSync("test-lanes.json", "utf8"));
    manifest.testFileGroups["unsafe-group"] = [
      "test/../../../scripts/run-test-lane.test.js",
    ];
    manifest.lanes[0].steps[0].args = [
      "exec",
      "test/../../../scripts/run-test-lane.test.js",
    ];
    manifest.lanes[1].steps[0].args = [
      "exec",
      "../../**/*.test.ts",
    ];

    expect(analyzeTestLaneManifest(manifest)).toEqual(expect.arrayContaining([
      "testFileGroups.unsafe-group must be a nonempty explicit test-file array.",
      'lanes[0].steps[0].args contains unsafe test file path "test/../../../scripts/run-test-lane.test.js".',
      'lanes[1].steps[0].args contains unsafe test file glob "../../**/*.test.ts".',
    ]));

    for (const unsafeGlob of [
      "../../**/*.test.{js,ts}",
      "../../**/*.{test,spec}.ts",
      "../../**/*.test.[jt]s",
    ]) {
      const candidate = JSON.parse(readFileSync("test-lanes.json", "utf8"));
      candidate.lanes[1].steps[0].args = ["exec", unsafeGlob];
      expect(analyzeTestLaneManifest(candidate)).toContain(
        `lanes[1].steps[0].args contains unsafe test file glob ${JSON.stringify(unsafeGlob)}.`,
      );
    }
  });

  it("rejects unknown lanes, unsafe directories, duplicate prerequisites, and foreign commands", () => {
    const manifest = JSON.parse(readFileSync("test-lanes.json", "utf8"));
    manifest.lanes[0].steps[0].cwd = "../outside";
    manifest.lanes[0].steps[0].command = "node";
    manifest.lanes[0].steps[0].args = ["test", "--flag=value&unexpected-command"];
    manifest.lanes[0].prerequisites = [
      { name: "TOKEN" },
      { name: "TOKEN" },
    ];
    manifest.selectors.fast = ["missing-lane"];

    expect(analyzeTestLaneManifest(manifest)).toEqual(expect.arrayContaining([
      "lanes[0].prerequisites[1].name must be a unique environment variable name.",
      "lanes[0].steps[0].cwd must be a normalized repository-relative directory.",
      "lanes[0].steps[0].command must be pnpm.",
      "lanes[0].steps[0].args must contain shell-safe non-whitespace tokens.",
      'selectors.fast references unknown lane "missing-lane".',
    ]));
  });

  it("starts pnpm through the real platform process boundary", () => {
    const result = runTestLaneStep(
      {
        id: "process-probe",
        category: "fast",
        proof: "The installed pnpm launcher can be started by the lane runner.",
        prerequisites: [],
        steps: [],
      },
      {
        id: "pnpm-version",
        cwd: ".",
        command: "pnpm",
        args: ["--version"],
      },
      ["--version"],
    );

    expect(result).toEqual({ exitCode: 0 });
  });

  it("reports missing and mismatched prerequisites without exposing values", () => {
    const manifest = loadTestLaneManifest();
    const hosted = resolveTestLaneSelection(manifest, "hosted")[0];
    const unavailable = inspectTestLaneAvailability(hosted, {
      FLAREX_H05_ALLOW_STAGING_MUTATION: "no",
      FLAREX_H05_POSTGRES_DATABASE_URL: "postgresql://secret@example.test/db",
    });

    expect(unavailable).toEqual({
      laneId: "h05-hosted",
      missing: [
        "FLAREX_H05_EXPECTED_DATABASE_NAME",
        "FLAREX_H05_PROBE_URL",
        "FLAREX_H05_PROBE_TOKEN",
        "FLAREX_H05_RUN_ID",
      ],
      mismatched: [{
        name: "FLAREX_H05_ALLOW_STAGING_MUTATION",
        expected: "yes",
      }],
    });
    expect(JSON.stringify(unavailable)).not.toContain("secret");
  });

  it("treats whitespace-only prerequisites as missing without normalizing exact matches", () => {
    const manifest = loadTestLaneManifest();
    const postgres = resolveTestLaneSelection(manifest, "postgres-persistence")[0];
    const hosted = resolveTestLaneSelection(manifest, "hosted")[0];

    expect(inspectTestLaneAvailability(postgres, {
      FLAREX_POSTGRES_DATABASE_URL: " \t ",
    })).toEqual({
      laneId: "postgres-persistence",
      missing: ["FLAREX_POSTGRES_DATABASE_URL"],
      mismatched: [],
    });
    expect(inspectTestLaneAvailability(hosted, {
      FLAREX_H05_ALLOW_STAGING_MUTATION: " yes ",
    })?.mismatched).toContainEqual({
      name: "FLAREX_H05_ALLOW_STAGING_MUTATION",
      expected: "yes",
    });
  });

  it("keeps fast and PGlite child processes isolated from inherited PostgreSQL activation", () => {
    const manifest = loadTestLaneManifest();
    const pglite = resolveTestLaneSelection(manifest, "pglite-persistence")[0];
    const postgres = resolveTestLaneSelection(manifest, "postgres-persistence")[0];
    const parentEnvironment = {
      FLAREX_POSTGRES_DATABASE_URL: "postgresql://secret@example.test/db",
      flarex_postgres_database_url: "postgresql://lowercase-secret@example.test/db",
      RETAINED_VALUE: "retained",
    };

    expect(projectTestLaneEnvironment(pglite, parentEnvironment)).toEqual({
      RETAINED_VALUE: "retained",
    });
    expect(projectTestLaneEnvironment(postgres, parentEnvironment)).toEqual(parentEnvironment);
    expect(parentEnvironment.FLAREX_POSTGRES_DATABASE_URL).toContain("secret");
    expect(parentEnvironment.flarex_postgres_database_url).toContain("lowercase-secret");

    const pgliteArguments = pglite.steps[0].args;
    expect(pgliteArguments).toEqual(expect.arrayContaining([
      "test/postgres.test.ts",
      "test/postgresClient.test.ts",
      "test/postgresConcurrency.test.ts",
    ]));
  });

  it("fails closed before running any step when a selected lane is unavailable", () => {
    const manifest = loadTestLaneManifest();
    /** @type {string[]} */
    const calls = [];

    const report = executeTestLaneSelection(manifest, "postgres", {
      environment: {},
      runStep(lane, step) {
        calls.push(`${lane.id}/${step.id}`);
        return { exitCode: 0 };
      },
      now: incrementingClock(),
    });

    expect(calls).toEqual([]);
    expect(report).toMatchObject({
      status: "unavailable",
      selected: [
        "postgres-persistence",
        "postgres-executor",
        "postgres-system",
      ],
      passed: [],
      failed: null,
      skipped: [],
    });
    expect(report.unavailable.map((entry) => entry.laneId)).toEqual([
      "postgres-persistence",
      "postgres-executor",
      "postgres-system",
    ]);
  });

  it("runs selected lane steps in order and returns an attributable pass receipt", () => {
    const manifest = loadTestLaneManifest();
    /** @type {string[]} */
    const calls = [];

    const report = executeTestLaneSelection(manifest, "pglite", {
      environment: {},
      runStep(lane, step) {
        calls.push(`${lane.id}/${step.id}`);
        return { exitCode: 0 };
      },
      now: incrementingClock(),
    });

    expect(calls).toEqual([
      "pglite-persistence/persistence-pglite",
      "pglite-system/system-pglite",
    ]);
    expect(report).toEqual({
      schemaVersion: 1,
      resultScope: "lanes",
      selector: "pglite",
      status: "passed",
      selected: ["pglite-persistence", "pglite-system"],
      passed: ["pglite-persistence", "pglite-system"],
      failed: null,
      skipped: [],
      unavailable: [],
      durationMs: 1,
    });
  });

  it("stops after the first failed step and reports remaining lanes as skipped", () => {
    const manifest = loadTestLaneManifest();
    /** @type {string[]} */
    const calls = [];

    const report = executeTestLaneSelection(manifest, "postgres", {
      environment: { FLAREX_POSTGRES_DATABASE_URL: "postgresql://example.test/db" },
      runStep(lane, step) {
        calls.push(`${lane.id}/${step.id}`);
        return lane.id === "postgres-executor"
          ? { exitCode: 7, detail: "focused failure" }
          : { exitCode: 0 };
      },
      now: incrementingClock(),
    });

    expect(calls).toEqual([
      "postgres-persistence/persistence-postgres",
      "postgres-executor/executor-postgres",
    ]);
    expect(report).toMatchObject({
      status: "failed",
      passed: ["postgres-persistence"],
      failed: {
        laneId: "postgres-executor",
        stepId: "executor-postgres",
        exitCode: 7,
        detail: "focused failure",
      },
      skipped: [{ laneId: "postgres-system", reason: "previous-failure" }],
      unavailable: [],
    });
  });
});

function incrementingClock() {
  let value = 0;
  return () => value++;
}
