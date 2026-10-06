import { Effect, Result } from "effect";
import { getCoLocatedReadInstallationReferencesResult } from "../src/installationLifecycle";
import { prepareProtectedMetadata } from "../src/preparedMetadataEpoch";
import { expect, it, vi } from "vitest";
import { NodePgSession } from "drizzle-orm/node-postgres";
import { PgliteSession } from "drizzle-orm/pglite";
import * as drizzleUtils from "drizzle-orm/utils";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createFileScopedPostgresFixture, createProtectedFileScopedPostgresFixture, createActivationServingFileScopedPostgresFixture,
  createCoLocatedReadInstallationFixture, postgresUrl } from "./postgresHelpers";
import { createPostgresLocatedPointMutationSessionActivationTargetV1 } from "../src/postgres";
import { isLocatedReadCommittedAttemptTargetV1 } from "../src/transactionSessionAttemptKernel";
import { finiteApplicationMetadataScenario } from "./finiteApplicationMetadataScenario";

/** Compare the private plan with pinned Drizzle on the same real driver rows.
 * This observes mapping only; genuine entry, SQL acceptance and driver execution
 * still belong to the connected scenario. */
function observeCaptureProjectionParity() {
  const reference: unknown = Reflect.get(drizzleUtils, "mapResultRow");
  if (typeof reference !== "function") throw new Error("Pinned Drizzle result mapper is missing");
  let mappedCaptureRows = 0;
  const originalPglite = PgliteSession.prototype.prepareQuery;
  const originalPostgres = NodePgSession.prototype.prepareQuery;
  const compare = (args: Parameters<typeof originalPglite>) => {
    const fields = args[1];
    const mapper = args[4];
    if (mapper === undefined || fields === undefined) return;
    args[4] = rows => {
      const actual: unknown = mapper(rows);
      const expected: unknown = rows.map(row => Reflect.apply(reference, drizzleUtils, [fields, row]));
      expect(actual).toEqual(expected);
      mappedCaptureRows += rows.length;
      return actual;
    };
  };
  const pglite = vi.spyOn(PgliteSession.prototype, "prepareQuery").mockImplementation(function (
    this: typeof PgliteSession.prototype, ...args
  ) { compare(args); return originalPglite.apply(this, args); });
  const postgres = vi.spyOn(NodePgSession.prototype, "prepareQuery").mockImplementation(function (
    this: typeof NodePgSession.prototype, ...args
  ) { compare(args); return originalPostgres.apply(this, args); });
  return {
    verify: () => expect(mappedCaptureRows).toBeGreaterThan(0),
    restore: () => { pglite.mockRestore(); postgres.mockRestore(); },
  };
}

it("accepts retained ownership successor catalogs from the original separate control owner before allowing original unmanaged writes in PGlite", async () => {
  const projection = observeCaptureProjectionParity();
  try { await finiteApplicationMetadataScenario(await createMigratedPGlitePersistence(undefined, "finiteCapture"), { ownershipSuccessor: true }); projection.verify(); }
  finally { projection.restore(); }
}, 240_000);
it.skipIf(postgresUrl === null)("accepts retained ownership successor catalogs from the original separate control owner before allowing original unmanaged writes in PostgreSQL", async () => {
  const projection = observeCaptureProjectionParity();
  try {
    const fixture = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try { await finiteApplicationMetadataScenario(fixture.persistence, { ownershipSuccessor: true }); projection.verify(); }
    finally { await fixture.dispose(); }
  } finally { projection.restore(); }
}, 240_000);

it.skipIf(postgresUrl === null)("accepts retained ownership successor catalogs through the restricted installed control reader before allowing original unmanaged writes", async () => {
  const projection = observeCaptureProjectionParity();
  try {
    const targetOwner = await createFileScopedPostgresFixture();
    try {
      const controlOwner = await createFileScopedPostgresFixture();
      try {
        const dual = await createActivationServingFileScopedPostgresFixture(targetOwner, "finiteCapture");
        try {
          const target = dual.serving;
          const control = await createProtectedFileScopedPostgresFixture("managed", controlOwner);
          try {
            const pair = await createCoLocatedReadInstallationFixture({ target, control, controlOwner });
            const refs = Result.getOrThrow(getCoLocatedReadInstallationReferencesResult(pair.installation, target.persistence.drizzle));
            const controlProtection = await Effect.runPromise(prepareProtectedMetadata(target.persistence.drizzle, refs.controlInstallation));
            const activationTarget = createPostgresLocatedPointMutationSessionActivationTargetV1(dual.activation.persistence,
              { kind: "database_per_scope", databaseKey: "finite_metadata_target", schemaName: target.schemaName },
              { directInstallation: dual.activation.installation });
            if (!isLocatedReadCommittedAttemptTargetV1(activationTarget)) throw new Error("Missing genuine activation runner");
            await finiteApplicationMetadataScenario(target.persistence, { ownershipSuccessor: true, controlPersistence: control.persistence,
              activationProfile: { kind: "installed", installation: dual.pair, target: activationTarget },
              sessionTargetOptions: { managedInstallation: { installation: pair.installation, controlProtection } } });
            projection.verify();
          } finally { await control.dispose(); }
        } finally { await dual.dispose(); }
      } finally { await controlOwner.dispose(); }
    } finally { await targetOwner.dispose(); }
  } finally { projection.restore(); }
}, 240_000);
