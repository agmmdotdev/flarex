import { Effect } from "effect";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { expect } from "vitest";

import { constructApplicationQueryServing } from "../../../src/application/applicationQueryServing";
import { completeApplicationQuerySnapshot, readApplicationQueryPoint } from "../../../src/application/applicationQuerySnapshot";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../applicationNativeMutationTestFixture";
import { runEffect } from "../../support/effectTestRuntime";
import { openApplicationQuerySnapshot, queryBudget } from "./support/querySnapshot";

export const APPLICATION_QUERY_SERVING_OPTIONS = Object.freeze({
  runtimeHostIdentity: "flarex.test/application-query-serving",
  compatibilityDate: "2026-06-14",
  initialUserDocuments: [{ name: "Ada", rowId: decodeAppRowIdHexV1("11".repeat(16)) }],
});

type Fixture = ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>;
type QueryServing = ReturnType<typeof constructApplicationQueryServing>;

/** Shared semantic proof; PostgreSQL additionally constructs the graph from an
 * actual connected Client, while PGlite uses the same authoritative owner. */
export async function assertApplicationQueryServing(
  fixture: Fixture,
  makeServing: (deploymentId: string) => QueryServing,
): Promise<void> {
  const table = fixture.schemaAuthority.tables.find(candidate => candidate.logicalName === "users");
  if (table === undefined) throw new Error("Query serving fixture users table missing");
  const documentId = appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId: decodeAppRowIdHexV1("11".repeat(16)) });
  let priorSelection = fixture.active.selection;
  for (let invocation = 0; invocation < 2; invocation++) {
    const serving = makeServing(fixture.deploymentId);
    const active = await runEffect(serving.activation.readActive());
    expect(active.selection).not.toBe(priorSelection);
    priorSelection = active.selection;
    const point = await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(active.selection, "users:get", queryBudget(), serving.snapshot);
      const row = yield* readApplicationQueryPoint(opened.snapshot, "users", documentId);
      yield* completeApplicationQuerySnapshot(opened.snapshot);
      return row;
    })));
    expect(point).toMatchObject({ kind: "present", document: { name: "Ada" } });
  }
  const refused = await runEffect(Effect.flip(makeServing(`${fixture.deploymentId}:other`).activation.readActive()));
  expect(refused).toMatchObject({
    _tag: "TrustedScopeAuthorityResolutionError",
    failure: { reason: "scopeDeploymentMismatch" },
  });
}
