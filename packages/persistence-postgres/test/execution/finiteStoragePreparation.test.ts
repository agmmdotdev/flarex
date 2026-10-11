import { PGlite } from "@electric-sql/pglite";
import { is, SQL } from "drizzle-orm";
import { compileFiniteCaptureResultMapper, type CaptureProjectionField } from "../../src/execution/finiteStorageCaptureProjection";
import { drizzle as nodeDrizzle } from "drizzle-orm/node-postgres";
import { NodePgPreparedQuery } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/pglite";
import { PglitePreparedQuery } from "drizzle-orm/pglite";
import { Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { bindFiniteStorageCaptureOwner, type FiniteStorageCaptureProfile } from "../../src/execution/finiteStorageCapture";
import { InstallationLifecycleError, getCoLocatedReadInstallationReferencesResult,
  loadCoLocatedReadInstallation, loadManagedInstallation,
  type PreparedCoLocatedReadInstallation } from "../../src/installation/installationLifecycle";
import { flarexSchema } from "../../src/database/schema";
import type { ScopePhysicalLocator } from "../../src/scope/scopeMetadataTypes";
import {
  createLocatedPointMutationSessionActivationTargetV1,
} from "../../src/execution/session/target";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../src/scope/scopeAuthorityResolution";
import { createPGliteLocatedPointMutationSessionActivationTargetV1 } from "../../src/database/pglite";
import { createPostgresLocatedPointMutationSessionActivationTargetV1 } from "../../src/database/postgres";
import { prepareProtectedMetadata } from "../../src/execution/preparation/preparedMetadataEpoch";
import { prepareInstalledAttemptScopeAuthority } from "../../src/scope/scopeAuthorityControlRead";
import { createPostgresLocatedReadCommittedTransactionRunnerV1 } from "../../src/database/postgresLocatedReadCommitted";
import type { LocatedScopeClockReader } from "../../src/scope/scopeAuthorityResolution";
import { runEffect } from "../support/effectTestRuntime";
import { readFiniteActiveApplicationPreparationState } from "../../src/application/activation/finiteIdentity";
import { readFiniteMetadataSourcePreparation } from "../../src/execution/finiteMetadataDependencies";
import { createMixedMutationProductFixture } from "../../../executor/test/performance/support/mixedMutationProductFixture";
import { postgresUrl } from "../support/postgresHelpers";

const locator: ScopePhysicalLocator = { kind: "shared_database", databaseKey: "prepared-database", schemaName: "capture_target" };
const constructionDriver: Extract<FiniteStorageCaptureProfile, { kind: "installed" }>["driver"] = {
  runImplicitCommandEffect: () => Effect.die("Construction must never acquire a client"),
};

/** A tiny installation-issuer fixture, not an installed serving database. It
 * exercises genuine issuer identities with actual SQL, while these tests only
 * observe pure compilation. Full maintenance/role/live acceptance has its own
 * connected PGlite and ordinary-role Postgres lanes. */
async function installationFixture() {
  const client = new PGlite();
  const database = drizzle(client, { schema: flarexSchema });
  const controlDatabase = drizzle(client, { schema: flarexSchema });
  try {
    for (const [schema, access, policy, incarnation] of [
      ["capture_target", "dataRuntime", "target", "60000000-0000-4000-8000-000000000001"],
      ["capture_control", "controlRead", "control", "60000000-0000-4000-8000-000000000002"],
    ]) {
      await client.exec(`create schema ${schema};
        create table ${schema}.fx_system_installation (singleton_id integer, state text, database_name text,
          schema_name text, namespace_oid bigint, incarnation uuid, structural_generation bigint);
        create table ${schema}.fx_system_installation_runtime (login text, login_oid bigint, incarnation uuid,
          structural_generation bigint, endpoint_policy text, access_profile text, metadata_incarnation uuid);
        insert into ${schema}.fx_system_installation values (1, 'active', current_database(), '${schema}',
          '${schema}'::pg_catalog.regnamespace::oid::bigint, '${incarnation}', 1);
        insert into ${schema}.fx_system_installation_runtime values (session_user,
          session_user::pg_catalog.regrole::oid::bigint, '${incarnation}', 1, '${policy}', '${access}', '${incarnation}');
        create function ${schema}.fx_lock_installation_admission() returns setof ${schema}.fx_system_installation
          language sql stable as 'select * from ${schema}.fx_system_installation where singleton_id = 1';`);
    }
    await client.exec("set search_path to capture_control");
    const control = await runEffect(loadManagedInstallation(controlDatabase, "control", "capture_control", "controlRead"));
    await client.exec("set search_path to capture_target");
    const target = await runEffect(loadManagedInstallation(database, "target", "capture_target"));
    const pair = () => runEffect(loadCoLocatedReadInstallation({ database, targetInstallation: target,
      control: { database: controlDatabase, installation: control }, controlEndpointPolicy: "control" }));
    return { client, database, pair };
  } catch (cause) {
    await client.close();
    throw cause;
  }
}

describe("database-owned finite storage preparation", () => {
  it("decodes all nine actual installed and full-artifact projections into one header and final bodies, refusing malformed layouts", async () => {
    const fixture = await installationFixture();
    const kinds = ["rows", "indexPage", "ownership", "historicalIdentity", "transactionTime", "retirement",
      "ownershipPolicyManifest", "ownershipUniqueClosure", "ownershipFence"] as const;
    try {
      const installation = await fixture.pair();
      for (const profile of [{ kind: "fullArtifact" } as const,
        { kind: "installed", installation, driver: constructionDriver } as const]) {
        const select = vi.spyOn(fixture.database, "select");
        try {
          Result.getOrThrow(bindFiniteStorageCaptureOwner(fixture.database, locator, profile));
          expect(select).toHaveBeenCalledTimes(kinds.length);
          for (const [ordinal, [selection]] of select.mock.calls.entries()) {
            const kind = kinds[ordinal]!;
            const fields: CaptureProjectionField[] = [];
            const flatten = (value: unknown, path: readonly string[]) => {
              if (is(value, SQL)) fields.push({ path, field: value });
              else {
                if (value === null || typeof value !== "object") throw new Error("Invalid actual capture selection");
                for (const [name, field] of Object.entries(value)) flatten(field, [...path, name]);
              }
            };
            flatten(selection, []);
            const index = (...path: string[]) => {
              const result = fields.findIndex(field => field.path.length === path.length && field.path.every((name, offset) => name === path[offset]));
              if (result < 0) throw new Error("Missing actual capture field: " + path.join("."));
              return result;
            };
            const layout = { historicalIdentity: kind === "historicalIdentity", fullArtifact: profile.kind === "fullArtifact" };
            const mapper = compileFiniteCaptureResultMapper<Record<string, unknown>>(fields, layout);
            const first: unknown[] = fields.map(() => null);
            first[index("reason")] = "accepted";
            first[index("databaseNow")] = "10";
            first[index("servingCommitSeq")] = "2";
            first[index("retainedFloor")] = "0";
            first[index("targetMetadataEpoch")] = "9";
            first[index("controlMetadataEpoch")] = "8";
            first[index("storagePresent")] = true;
            first[index("transactionTimestamp")] = "2026-10-08 00:00:00+00";
            first[index("exists")] = layout.historicalIdentity;
            const bodyOrdinal = fields.findIndex(field => field.path[0] === "raw" && field.path[1] === "ordinal");
            if (bodyOrdinal >= 0) first[bodyOrdinal] = 1;
            const later: unknown[] = fields.map(() => null);
            later[index("storagePresent")] = true;
            later[index("exists")] = layout.historicalIdentity;
            if (layout.fullArtifact) {
              later[index("targetMetadataEpoch")] = "9";
              later[index("controlMetadataEpoch")] = "8";
            }
            if (bodyOrdinal >= 0) later[bodyOrdinal] = 2;
            const accepted = mapper([first, later]);
            expect(accepted.layoutFailure, profile.kind + ":" + kind).toBeUndefined();
            expect(accepted.header).toMatchObject({ reason: "accepted", servingCommitSeq: "2", retainedFloor: "0" });
            expect(accepted.header).not.toHaveProperty("frontier");
            for (const displaced of ["build", "uniqueBuild", "indexMaintenance", "uniqueMaintenance", "tableFrontier", "historicalChange"])
              expect(fields.some(field => field.path[0] === displaced)).toBe(false);
            const replacement = [...first]; replacement[index("reason")] = "attemptReplaced";
            replacement[index("frontier", "attemptFence")] = "7";
            expect(mapper([replacement]).header).toMatchObject({ reason: "attemptReplaced", frontier: { attemptFence: 7n } });
            expect(accepted.rawRows).toHaveLength(2);
            expect(Object.keys(accepted.rawRows[0]!)).toEqual(fields.filter(field => field.path[0] === "raw")
              .map(field => field.path[1]!));
            const sentinel = [...first];
            sentinel[index("storagePresent")] = false;
            for (const [offset, field] of fields.entries()) if (field.path[0] === "raw") sentinel[offset] = null;
            expect(mapper([sentinel])).toMatchObject({ layoutFailure: undefined, rawRows: [] });
            expect(mapper([])).toMatchObject({ header: undefined, layoutFailure: undefined, rawRows: [] });
            const assertMalformed = (row: unknown[], previous?: unknown[]) =>
              expect(mapper(previous === undefined ? [row] : [previous, row]).layoutFailure, profile.kind + ":" + kind).toBeDefined();
            assertMalformed([...first, null]);
            assertMalformed(first.slice(0, -1));
            assertMalformed(later.slice(0, index("frontier", "attemptFence")), first);
            for (const marker of [undefined, null, "true", 1]) {
              const changed = [...first]; changed[index("storagePresent")] = marker; assertMalformed(changed);
            }
            const repeatedHeader = [...later]; repeatedHeader[index("reason")] = "accepted"; assertMalformed(repeatedHeader, first);
            const changedEpoch = [...later]; changedEpoch[index("targetMetadataEpoch")] = "changed"; assertMalformed(changedEpoch, first);
            const inactive = [...sentinel];
            inactive[fields.findIndex(field => field.path[0] === "raw")] = 1;
            assertMalformed(inactive);
            const nativeFailure = [...first]; nativeFailure[index("frontier", "attemptFence")] = "invalid bigint";
            expect(() => mapper([nativeFailure])).toThrow(SyntaxError);
          }
        } finally { select.mockRestore(); }
      }
    } finally { await fixture.client.close(); }
  });

  it("reuses actual compilation across repeated located-target construction and isolates exact database/locator identity", () => {
    const database = nodeDrizzle.mock({ schema: flarexSchema });
    const select = vi.spyOn(database, "select");
    createLocatedPointMutationSessionActivationTargetV1(database, locator);
    expect(select).toHaveBeenCalledTimes(9);
    select.mockClear();
    createLocatedPointMutationSessionActivationTargetV1(database, { ...locator });
    expect(select).not.toHaveBeenCalled();

    for (const changed of [
      { ...locator, databaseKey: "another-database-key" },
      { ...locator, schemaName: "another_namespace" },
      { ...locator, kind: "schema_per_scope" as const },
      locator,
    ]) {
      select.mockClear();
      createLocatedPointMutationSessionActivationTargetV1(database, changed);
      expect(select).toHaveBeenCalledTimes(9);
    }
    const otherDatabase = nodeDrizzle.mock({ schema: flarexSchema });
    const otherSelect = vi.spyOn(otherDatabase, "select");
    createLocatedPointMutationSessionActivationTargetV1(otherDatabase, locator);
    expect(otherSelect).toHaveBeenCalledTimes(9);
  });

  it("authenticates genuine installed preparation before reuse and isolates each installation issuer", async () => {
    const fixture = await installationFixture();
    try {
      const installation = await fixture.pair();
      const profile = { kind: "installed", installation, driver: constructionDriver } as const;
      const select = vi.spyOn(fixture.database, "select");
      const first = Result.getOrThrow(bindFiniteStorageCaptureOwner(fixture.database, locator, profile));
      expect(select).toHaveBeenCalledTimes(9);
      select.mockClear();
      const next = Result.getOrThrow(bindFiniteStorageCaptureOwner(fixture.database, { ...locator }, profile));
      expect(select).not.toHaveBeenCalled();
      expect(next).not.toBe(first);
      expect(next.capture).not.toBe(first.capture);

      // SAFETY: this negative witness deliberately forges an opaque issuer token.
      const forged = Object.freeze({}) as PreparedCoLocatedReadInstallation;
      const counterfeit = Result.getOrThrow(Result.flip(bindFiniteStorageCaptureOwner(fixture.database, locator,
        { ...profile, installation: forged })));
      expect(counterfeit).toBeInstanceOf(InstallationLifecycleError);
      expect(counterfeit.reason).toBe("invalidCapability");
      const otherNamespace = Result.getOrThrow(Result.flip(bindFiniteStorageCaptureOwner(fixture.database,
        { ...locator, schemaName: "another_namespace" }, profile)));
      expect(otherNamespace.reason).toBe("invalidAuthority");
      const otherDatabase = drizzle(fixture.client, { schema: flarexSchema });
      const foreignDatabase = Result.getOrThrow(Result.flip(bindFiniteStorageCaptureOwner(otherDatabase, locator, profile)));
      expect(foreignDatabase).toBeInstanceOf(InstallationLifecycleError);
      expect(foreignDatabase.reason).toBe("invalidCapability");
      expect(select).not.toHaveBeenCalled();

      const otherInstallation = await fixture.pair();
      select.mockClear();
      Result.getOrThrow(bindFiniteStorageCaptureOwner(fixture.database, locator, { ...profile, installation: otherInstallation }));
      expect(select).toHaveBeenCalledTimes(9);
    } finally { await fixture.client.close(); }
  });

  for (const driver of postgresUrl === null ? ["pglite" as const] : ["pglite" as const, "postgres" as const]) {
    it(`binds distinct root parameters to reused plans and preserves active owners after locator-slot replacement in ${driver}`, async () => {
      const first = await createMixedMutationProductFixture({ driver, suffix: `prepared-plan-first-${driver}` });
      let second: Awaited<ReturnType<typeof first.openCompetingFiniteFixture>> | undefined;
      const observed: Array<Readonly<{ driver: "pglite" | "postgres"; sessionId: unknown;
        snapshot: unknown; owner: unknown; claimFence: unknown; anchorBytes: unknown; anchorDigest: unknown;
        staticParameters: unknown }>> = [];
      const observe = (actualDriver: "pglite" | "postgres", values: Record<string, unknown> | undefined) => {
        if (values !== undefined && values.pin_sessionId !== undefined) observed.push({
          driver: actualDriver, sessionId: values.pin_sessionId, snapshot: values.snapshot,
          owner: values.claimOwner, claimFence: values.claimFence,
          anchorBytes: values.anchorBytes, anchorDigest: values.anchorDigest, staticParameters: Object.getPrototypeOf(values),
        });
      };
      const originalPglite = PglitePreparedQuery.prototype.execute;
      const originalPostgres = NodePgPreparedQuery.prototype.execute;
      const pgliteExecute = vi.spyOn(PglitePreparedQuery.prototype, "execute").mockImplementation(function (
        this: typeof PglitePreparedQuery.prototype, ...args
      ) {
        observe("pglite", args[0]);
        return originalPglite.apply(this, args);
      });
      const postgresExecute = vi.spyOn(NodePgPreparedQuery.prototype, "execute").mockImplementation(function (
        this: typeof NodePgPreparedQuery.prototype, ...args
      ) {
        observe("postgres", args[0]);
        return originalPostgres.apply(this, args);
      });
      try {
        second = await first.openCompetingFiniteFixture(`prepared-plan-second-${driver}`);
        for (const fixture of [first, second]) {
          const active = readFiniteActiveApplicationPreparationState(fixture.preparedFiniteApplication);
          if (active === undefined) throw new Error("Missing retained original Application generation");
          const projection = await runEffect(fixture.prepared.lendFiniteMetadataProjection());
          const source = Result.getOrThrow(readFiniteMetadataSourcePreparation(projection, fixture.prepared));
          expect(source.schemaVersionId).toBe(fixture.logicalSchemaVersionId);
          expect(source.schemaVersionId).not.toBe(fixture.schemaVersionId);
          expect(source.boundApplicationProjection).toBeDefined();
          expect(source.lifetime?.checkOpen).toBe(active.lifetime?.checkOpen);
          expect(source.lifetime?.checkOpen).toBeTypeOf("function");
        }
        const resource = first.currency.resource;
        const database = resource.target.drizzle;
        expect(resource.kind).toBe(driver);
        expect(first.currency.persistence.drizzle).toBe(database);
        expect(second.currency.persistence.drizzle).toBe(database);
        let rebind: (physicalLocator: ScopePhysicalLocator) => LocatedScopeClockReader;
        if (resource.kind === "postgres") {
          const managed = first.currency.managedRead;
          if (managed === undefined) throw new Error("Postgres witness requires its genuine managed installation");
          expect(second.currency.managedRead?.readInstallation).toBe(managed.readInstallation);
          const refs = Result.getOrThrow(getCoLocatedReadInstallationReferencesResult(managed.readInstallation, database));
          const controlProtection = await runEffect(prepareProtectedMetadata(database, refs.controlInstallation));
          rebind = physicalLocator => createPostgresLocatedPointMutationSessionActivationTargetV1(resource.target,
            physicalLocator, { managedInstallation: { installation: managed.readInstallation, controlProtection } });
        } else {
          expect(first.currency.managedRead).toBeUndefined();
          expect(second.currency.managedRead).toBeUndefined();
          rebind = physicalLocator => createPGliteLocatedPointMutationSessionActivationTargetV1(resource.target, physicalLocator);
        }
        const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(first.activation.anchor.deploymentId,
          first.application.authorityPorts));
        const physicalLocator = located.authority.physicalLocator;
        const select = vi.spyOn(database, "select");
        const compiledCaptures = () => select.mock.calls.filter(([projection]) => projection !== undefined &&
          "reason" in projection && "raw" in projection).length;
        const compiledAuthorities = () => select.mock.calls.filter(([projection]) => projection !== undefined &&
          "reason" in projection && "clock" in projection && !("raw" in projection)).length;
        rebind(physicalLocator);
        expect(compiledCaptures()).toBe(0);
        expect(compiledAuthorities()).toBe(0);
        // Replace only the bounded retention slot; the first and second active
        // targets retain their original immutable plan rather than a cache lookup.
        select.mockClear();
        rebind({ ...physicalLocator, databaseKey: `${physicalLocator.databaseKey}-displaced` });
        expect(compiledCaptures()).toBe(9);
        expect(compiledAuthorities()).toBe(driver === "postgres" ? 2 : 0);
        select.mockRestore();
        if (resource.kind === "postgres") {
          const managed = first.currency.managedRead;
          if (managed === undefined) throw new Error("Acceptance isolation requires its genuine managed installation");
          const firstOwner = Result.getOrThrow(prepareInstalledAttemptScopeAuthority(managed.readInstallation, database, physicalLocator));
          const secondOwner = Result.getOrThrow(prepareInstalledAttemptScopeAuthority(managed.readInstallation, database, physicalLocator));
          const selection = { deploymentId: first.activation.anchor.deploymentId, scopeId: first.activation.anchor.scopeId };
          const runTransaction = createPostgresLocatedReadCommittedTransactionRunnerV1(resource.target.pool,
            { managedInstallation: { installation: managed.readInstallation, database } });
          await runTransaction(async tx => {
            try {
              await runEffect(firstOwner.lock(tx, selection, "share"));
              expect(Result.isSuccess(firstOwner.requireAcceptedTransaction(tx, selection, "share"))).toBe(true);
              expect(Result.getOrThrow(Result.flip(secondOwner.requireAcceptedTransaction(tx, selection, "share"))).reason)
                .toBe("invalidAuthority");
              await runEffect(secondOwner.lock(tx, selection, "share"));
              firstOwner.closeAcceptedTransaction(tx);
              expect(Result.getOrThrow(Result.flip(firstOwner.requireAcceptedTransaction(tx, selection, "share"))).reason)
                .toBe("invalidAuthority");
              expect(Result.isSuccess(secondOwner.requireAcceptedTransaction(tx, selection, "share"))).toBe(true);
            } finally {
              firstOwner.closeAcceptedTransaction(tx);
              secondOwner.closeAcceptedTransaction(tx);
            }
          });
        }
        observed.length = 0;
        await first.runExecution();
        const firstCaptures = observed.splice(0);
        await second.runExecution();
        const secondCaptures = observed.splice(0);
        expect(firstCaptures.length).toBeGreaterThan(0);
        expect(secondCaptures.length).toBeGreaterThan(0);
        expect(first.activation.anchor.sessionId).not.toBe(second.activation.anchor.sessionId);
        for (const [captures, fixture] of [[firstCaptures, first], [secondCaptures, second]] as const) {
          expect(new Set(captures.map(capture => capture.driver))).toEqual(new Set([driver]));
          expect(new Set(captures.map(capture => capture.sessionId))).toEqual(new Set([fixture.activation.anchor.sessionId]));
          expect(new Set(captures.map(capture => capture.snapshot))).toEqual(new Set([fixture.activation.anchor.snapshotToken.commitSeq]));
          expect(new Set(captures.map(capture => capture.owner))).toEqual(new Set([fixture.activation.executionClaim.claimOwner]));
          expect(new Set(captures.map(capture => capture.claimFence))).toEqual(new Set([fixture.activation.executionClaim.claimFence]));
          expect(new Set(captures.map(capture => capture.anchorBytes)).size).toBe(1);
          expect(new Set(captures.map(capture => capture.anchorDigest)).size).toBe(1);
          expect(new Set(captures.map(capture => capture.staticParameters)).size).toBe(1);
          expect(Object.isFrozen(captures[0]?.staticParameters)).toBe(true);
          expect(fixture.getOpenTransactionDepth()).toBe(0);
        }
        expect(firstCaptures[0]?.anchorBytes).not.toBe(secondCaptures[0]?.anchorBytes);
        expect(firstCaptures[0]?.staticParameters).not.toBe(secondCaptures[0]?.staticParameters);
      } finally {
        pgliteExecute.mockRestore();
        postgresExecute.mockRestore();
        try { await second?.close(); } finally { await first.close(); }
      }
    }, 240_000);
  }
});
