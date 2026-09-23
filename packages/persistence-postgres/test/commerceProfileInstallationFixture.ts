import { Effect } from "effect";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { FrameworkSchemaTarget } from "../src/frameworkSchema/target";
import type { CommerceProfile, CommerceProfileState } from "../src/commerceTransaction/profile";
import { makeFrameworkInstaller } from "../src/migrationCoordination/installer";
import { prepareFrameworkSchemaArtifactAdmission, makeFrameworkSchemaArtifactRepository } from
  "../src/frameworkSchema/artifact/repository";
import { admitFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/admission";
import { makeCatalogControlSessionStarter } from "../src/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../src/postgresCatalogControlSession";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from
  "./frameworkSchemaArtifactAdmissionTestSupport";
import { makeFrameworkMigrationFixtureTarget } from "./frameworkMigrationFixtureTarget";

/** Test-only installer composition for an existing authenticated target. */
export const installCommerceProfileFixture = Effect.fn("CommerceFixture.installProfile")(
  function* <ColdFailure>(input: {
    readonly persistence: PGliteFlarexPersistence | PostgresFlarexPersistence;
    readonly target: FrameworkSchemaTarget;
    readonly descriptor: CommerceProfileState;
    readonly profile: CommerceProfile;
    readonly attemptId: string;
    readonly leaseOwnerId: string;
    readonly coldProfile?: () => Effect.Effect<CommerceProfile, ColdFailure>;
  }) {
    const { persistence, target, descriptor, profile } = input;
    const repository = "pool" in persistence ? yield* Effect.fromResult(makeFrameworkSchemaArtifactRepository({
      controlDb: persistence.drizzle,
      controlSessionStarter: makeCatalogControlSessionStarter({ controlDb: persistence.drizzle,
        driver: makePostgresCatalogControlSessionDriver(persistence.pool) }),
      readTimeoutMilliseconds: 10_000, attemptTimeoutMilliseconds: 10_000,
      recoveryTimeoutMilliseconds: 10_000, lockTimeoutMilliseconds: 2_000,
    })) : makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence).repository;
    yield* admitFrameworkSchemaArtifactEffect(repository,
      yield* Effect.fromResult(prepareFrameworkSchemaArtifactAdmission(descriptor.artifact)));
    const migrationTarget = yield* Effect.tryPromise({
      try: () => makeFrameworkMigrationFixtureTarget(persistence, target),
      catch: cause => new Error("Commerce fixture migration target", { cause }),
    });
    const installer = yield* Effect.fromResult(makeFrameworkInstaller({ target: migrationTarget,
      artifactRepository: repository, policy: { leaseDurationMilliseconds: 120_000,
        lockTimeoutMilliseconds: 5_000, statementTimeoutMilliseconds: 30_000,
        runTimeoutMilliseconds: 120_000, maximumStepsPerCall: 128 } }));
    const request = { artifactIdentity: descriptor.artifact.identity, commerceProfile: profile,
      attemptId: input.attemptId, leaseOwnerId: input.leaseOwnerId };
    const ready = yield* installer.installFresh(request).pipe(Effect.timeout(90_000));
    if (ready.kind !== "ready") return yield* Effect.fail(new Error(`Commerce installation incomplete: ${ready.kind}`));
    if (input.coldProfile !== undefined) {
      const coldProfile = yield* input.coldProfile();
      const replay = yield* installer.installFresh({ ...request, commerceProfile: coldProfile })
        .pipe(Effect.timeout(90_000));
      if (replay.kind !== "ready") return yield* Effect.fail(new Error(`Cold commerce installation incomplete: ${replay.kind}`));
    }
    if (ready.availability.installation.admission.admission.frame.admissionProfile !== "registered-commerce-fresh")
      return yield* Effect.fail(new Error("Unexpected commerce admission profile"));
    return ready.availability;
  },
);
