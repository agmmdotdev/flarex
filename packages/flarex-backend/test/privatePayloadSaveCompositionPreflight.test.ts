import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vitest";
import { makeSchemaComposer } from "../../medusa-adapter/src/composition/schema";
import { makeApplicationAnalysisRepository } from "../../persistence-postgres/src/application/applicationAnalysisRegistration";
import { prepareFiniteActiveApplication } from "../../persistence-postgres/src/application/activation/repositoryIdentity";
import { retainPreparedHost } from "../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import { preparedHostTestRuntime } from "../../persistence-postgres/test/execution/preparation/preparedHostRuntimeTestSupport";
import { privatePermissionFixture } from "../../persistence-postgres/test/application/ownership/privatePermissionFixture";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";

/** Temporary prerequisite witness, not an acceptance test for authorized saves.
 * Replace these refusals with connected success/ownership checks when the
 * shared V3/joint-source correction is implemented. No fake legacy authority. */
async function witness(fixture: Awaited<ReturnType<typeof privatePermissionFixture>>) {
  const { application } = fixture;
  expect(application.manifest.version).toBe(3);
  const composer = makeSchemaComposer({ deploymentId: application.deploymentId, authority: application.authority,
    applicationAnalyses: makeApplicationAnalysisRepository(application.persistence.drizzle), medusaModules: ["product"] });
  const composed = await Effect.runPromise(composer({ applicationCandidateId: application.publication.candidateId,
    payloadCollections: [{ slug: "articles", fields: [{ name: "headline", type: "text", required: true },
      { name: "featuredProduct", type: "text" }] }], payloadViews: [], extensions: [] }).pipe(Effect.result));
  expect(composed).toMatchObject({ _tag: "Failure", failure: { _tag: "SchemaCompositionError", reason: "mixedApplicationPolicy" } });

  const active = await Effect.runPromise(application.relationActivation.readActive());
  const borrowed = await Effect.runPromise(retainPreparedHost(preparedHostTestRuntime(application.persistence.drizzle),
    prepareFiniteActiveApplication(application.relationActivation, active.selection)).pipe(
      Effect.flatMap(host => host.close), Effect.result));
  expect(borrowed).toMatchObject({ _tag: "Failure", failure: { _tag: "ApplicationActivationError", operation: "read", reason: "invalidComposition" } });
}

it("witnesses the protected V3 source's joint-composition and borrowed-binding gaps (PGlite)", async () => {
  const persistence = await createMigratedPGlitePersistence(onTestFinished, "finiteCapture");
  const fixture = await privatePermissionFixture(persistence);
  try { await witness(fixture); } finally { await fixture.close(); }
}, 180_000);

describe.skipIf(postgresUrl === null)("SA2 prerequisite with an ordinary-role PostgreSQL target", () => {
  it("witnesses the same refusals with genuine target authority", async () => {
    const database = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try {
      const fixture = await privatePermissionFixture(database.persistence);
      try { await witness(fixture); } finally { await fixture.close(); }
    } finally { await database.dispose(); }
  }, 180_000);
});
