import { describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";

import {
  POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1,
} from "flarex-backend/internal/point-mutation-internal-call-exact-runtime-host-v1";

import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedScopeAuthorizationEpochTarget,
} from "@flarex/persistence-postgres/pglite";
import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-targets-v1";
import { FSV05_SUPPORTED_LOCATOR } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import {
  pointMutationWorkerdDispatchModuleSourceForTest,
  proveSap06A2MutationInternalQueryV1,
} from
  "../../support/fsv06StandardPointMutationHarness";
import { decodeSystemTestStructuredCloneBridgeValueV1 } from
  "../../support/systemTestStructuredCloneBridgeV1";
import { createHistoricalApplicationAnalysisPGlitePersistence as createMigratedPGlitePersistence } from "../support/databaseFixturesV1";

describe("SAP06-A2 mutation internal query - PGlite", () => {
  it("reads a staged write inline and publishes only the parent outcome", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await proveSap06A2MutationInternalQueryV1({
      name: "pglite",
      persistence,
      registrationTarget:
        createPGliteLocatedApplicationRevisionRegistrationTargetV1(
          persistence,
          FSV05_SUPPORTED_LOCATOR,
        ),
      makeActivationTarget: () =>
        createPGliteLocatedApplicationRevisionActivationTargetV1(
          persistence,
          FSV05_SUPPORTED_LOCATOR,
        ),
      makeDecisionUncertainTarget: () => {
        throw new Error("SAP06-A2 does not alter activation uncertainty.");
      },
      makeSessionTarget: () =>
        createPGliteLocatedPointMutationSessionActivationTargetV1(
          persistence,
          FSV05_SUPPORTED_LOCATOR,
        ),
      makeEpochTarget: () => createPGliteLocatedScopeAuthorizationEpochTarget(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    });
    expect(proof).toMatchObject({
      lane: "pglite",
      inlineInternalQuery: true,
      realWorkerdExecution: true,
      stagedDeleteObservedByChild: true,
      oneParentPublication: true,
      currentRowPointerCount: 1,
      liveRowCount: 0,
      commitCount: 2,
      outcomeCount: 2,
      feedCount: 2,
      outboxCount: 2,
      postgresVersion: null,
    });
  }, 480_000);

  it("maps the exact runtime journal-boundary name to the host failure reason", async () => {
    const runtime = new Miniflare({
      compatibilityDate: "2026-06-18",
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: pointMutationWorkerdDispatchModuleSourceForTest(),
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1,
          contents: `export class FlarexPointMutationInternalCallExactRuntimeV1 {
  async run() {
    const error = new Error("journal failed");
    Object.defineProperty(error, "name", { value: "PointMutationInternalCallExactRuntimeJournalBoundaryV1Error" });
    throw error;
  }
}`,
        },
        {
          type: "ESModule",
          path: "_flarex/application-error-platform-v1.js",
          contents: "export const captureCoreApplicationErrorV1 = () => null;",
        },
      ],
      serviceBindings: {
        JOURNAL: () => new Response("not reached", { status: 500 }),
      },
    });
    try {
      const response = await runtime.dispatchFetch("https://dispatcher.test/", {
        method: "POST",
        body: JSON.stringify({ context: { randomSeed: [] } }),
      });
      const envelope = decodeSystemTestStructuredCloneBridgeValueV1(
        await response.json(),
      );
      expect(envelope).toMatchObject({
        ok: false,
        reason: "journalBoundaryFailed",
        name: "PointMutationInternalCallExactRuntimeJournalBoundaryV1Error",
      });
    } finally {
      await runtime.dispose();
    }
  });
});
