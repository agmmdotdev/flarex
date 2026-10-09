/// <reference types="node" />

import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";

it("loads every point consumer export in Workerd without SQL construction or granting copied authority", async () => {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: join(dirname(fileURLToPath(import.meta.url)), "consumerApi.worker.ts"),
        formats: ["es"],
        fileName: "worker",
      },
      rolldownOptions: { external: ["cloudflare:workers"] },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : []);
  const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.js");
  if (worker === undefined || worker.type !== "chunk") throw new Error("Point consumer Worker was not emitted");
  const renderedModules = Object.entries(worker.modules)
    .filter(([, module]) => module.renderedLength > 0)
    .map(([id]) => id.replaceAll("\\", "/"));
  expect(renderedModules.some(id => id.endsWith("/commit/pointCommitTransactionApi.ts"))).toBe(true);
  expect(renderedModules.filter(id =>
    /(?:\/database\/|\/installation\/|\/commit\/point\/(?:construction|uniqueEligibility|durablePublication|finitePublication|replacement|relationRecovery|attemptAcceptance|sqlFailures)\.|\/node_modules\/.*(?:drizzle|postgres|pglite)|node:crypto)/.test(id))).toEqual([]);
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: [{ type: "ESModule", path: "worker.js", contents: worker.code }],
  });
  try {
    await runtime.ready;
    const response = await runtime.dispatchFetch("https://point.test/");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      exports: POINT_CONSUMER_EXPORTS,
      copiedPublisher: false,
      copiedDeveloperMaintenance: false,
      copiedUniqueMaintenance: false,
      copiedUniqueEligibility: false,
      copiedRelationMaintenance: false,
      error: "PointCommitUniqueConstraintEligibilityUnavailableV1Error",
    });
  } finally {
    await runtime.dispose();
  }
}, 120_000);

const POINT_CONSUMER_EXPORTS = [
  "MAX_INDEX_RANGE_OCC_COMMIT_SPAN_V1",
  "MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1",
  "MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1",
  "MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1",
  "PointCommitConfirmedPreDecisionRollbackV1Error",
  "PointCommitConflictV1Error",
  "PointCommitCorruptionV1Error",
  "PointCommitDecisionUncertainV1Error",
  "PointCommitDeveloperIndexMaintenanceUnavailableV1Error",
  "PointCommitIntrinsicIndexDefinitionUnavailableV1Error",
  "PointCommitPublicationObservation",
  "PointCommitResourceExhaustionV1Error",
  "PointCommitSqlErrorV1",
  "PointCommitStaleAuthorityV1Error",
  "PointCommitUniqueConstraintEligibilityUnavailableV1Error",
  "PointCommitUniqueConstraintMaintenanceUnavailableV1Error",
  "PointFiniteAttemptRetryBudgetExhaustedError",
  "PointMutationAttemptReplacementCommittedOutcomeV1Error",
  "PointMutationAttemptReplacementConfigurationV1Error",
  "PointMutationAttemptReplacementConflictNoLongerPresentV1Error",
  "PointMutationAttemptReplacementCorruptionV1Error",
  "PointMutationAttemptReplacementFiniteEntryError",
  "PointMutationAttemptReplacementRequestKeyReuseV1Error",
  "PointMutationAttemptReplacementResourceExhaustionV1Error",
  "PointMutationAttemptReplacementSqlErrorV1",
  "PointMutationAttemptReplacementStaleAuthorityV1Error",
  "RESOLVE_POINT_COMMIT_OUTCOME_V1",
  "hasPointCommitApplicationRelationMaintenance",
  "hasPointCommitDeveloperIndexMaintenanceV1",
  "hasPointCommitUniqueConstraintEligibilityV1",
  "hasPointCommitUniqueConstraintMaintenanceV1",
  "isPointFiniteCommitPublisherPort",
  "isPointFiniteReplacementTerminalRefusal",
].sort();
