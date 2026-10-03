import { and, eq } from "drizzle-orm";
import { Effect, Scheduler, Tracer } from "effect";
import { expect, vi } from "vitest";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { prepareLogicalSourceEvidence } from "../src/logicalDocuments/sourceAdmission";
import { prepareLogicalStorageReadiness } from "../src/logicalStorageReadiness";
import * as preparation from "../src/preparedHostRuntime";
import { runEffectTransaction } from "../src/effectTransaction";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../src/scopeClock";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../src/scopeAuthorityResolution";
import { fxSystemIndexBuildStates } from "../src/schema";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "./fixtures/applicationNativeMutationTestFixture";

/** Observe the real catalog compiler and allocation, without replacing issuance
 * or readiness. The connected borrowed-attempt component supplies the read proof. */
export const logicalSourceReadSelectionScenario = Effect.fn("LogicalSourceReadSelection.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, schemaVersionId: CatalogSchemaVersionId,
  source: Readonly<{ sourceKey: string; writeProfile: string; schema: unknown; evidence: unknown }>,
) {
  const { control, target, deploymentId, authority, authorityPorts } = fixture;
  const input = { deploymentId, scopeId: authority.scopeId, schemaVersionId };
  const ports = { controlDb: control.drizzle, authority: authorityPorts };
  const active = yield* fixture.activation.readActive();
  const resolved = yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, authorityPorts);
  const spans: string[] = [];
  const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
  let retainedSelections = 0;
  let rejectSelection = false;
  const chargedFrontierRequirements: Array<readonly number[]> = [];
  const actualCapture = preparation.captureHostPreparationCharge;
  const actualCharge = preparation.chargeHostPreparation;
  yield* Effect.acquireUseRelease(
    Effect.sync(() => ({
      charge: vi.spyOn(preparation, "chargeHostPreparation").mockImplementation(value => {
        if (Array.isArray(value) && value.every(member => typeof member === "number"))
          chargedFrontierRequirements.push([...value]);
        return actualCharge(value);
      }),
      capture: vi.spyOn(preparation, "captureHostPreparationCharge").mockImplementation(() => actualCapture().pipe(
      Effect.map(charge => charge === undefined ? undefined : value => {
        const singleton = typeof value === "object" && value !== null &&
          Object.keys(value).toSorted().join(",") === "reference,sourceKeys,tableIds";
        if (singleton) retainedSelections++;
        // Invoke the actual allocation's invalid-payload refusal. Its sticky
        // rejection and closed-lease behavior remain owned by the real lease.
        return charge(singleton && rejectSelection ? () => undefined : value);
      }))),
    })),
    () => Effect.scoped(Effect.gen(function* () {
      const runtime = yield* preparation.makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 16_777_216 });
      const construct = () => preparation.retainPreparedHost(runtime, Effect.gen(function* () {
        const priorCharges = chargedFrontierRequirements.length;
        const catalog = yield* prepareLogicalStorageReadiness(ports, fixture.uniqueConstraintEligibility, input);
        if (catalog.status !== "prepared") return yield* Effect.die("Missing real prepared catalog");
        const expectedRequirements = [...new Set(
          catalog.requirements.search.map(requirement => requirement.tableId),
        )].toSorted((left, right) => left - right);
        expect(chargedFrontierRequirements.slice(priorCharges)).toEqual([expectedRequirements]);
        return yield* prepareLogicalSourceEvidence(ports, fixture.uniqueConstraintEligibility, input,
          { sourceKey: source.sourceKey, writeProfile: source.writeProfile,
            definition: { kind: "relational", schema: source.schema }, evidence: source.evidence },
          "medusa", "relational", { kind: "prepared", catalog });
      }));
      const retained = yield* construct();
      const selected = yield* retained.use(Effect.succeed);
      // A request-owned catalog does not supply a retained allocation. The
      // demand closure must charge the actual source-construction lease.
      const requestCatalog = yield* prepareLogicalStorageReadiness(ports, fixture.uniqueConstraintEligibility, input);
      if (requestCatalog.status !== "prepared") return yield* Effect.die("Missing real request catalog");
      const demandRuntime = yield* preparation.makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 64 });
      let demandEscaped = false;
      const rejectedDemand = yield* Effect.result(preparation.retainPreparedHost(demandRuntime, Effect.gen(function* () {
        const inspect = yield* requestCatalog.prepareSourceDemand(source.sourceKey, selected.unique);
        demandEscaped = true;
        return { inspect };
      })));
      expect(rejectedDemand).toMatchObject({ _tag: "Failure", failure: { reason: "capacityExceeded" } });
      expect(demandEscaped).toBe(false);
      const replacement = yield* preparation.retainPreparedHost(demandRuntime, Effect.succeed({ available: true }));
      expect(yield* replacement.use(host => Effect.succeed(host.available))).toBe(true);
      yield* replacement.close;
      // The named request profile has no allocation to invent or borrow.
      expect(typeof (yield* requestCatalog.prepareSourceDemand(source.sourceKey, selected.unique))).toBe("function");
      let entered = 0;
      const read = (supplied = selected) => runEffectTransaction(work => target.drizzle.transaction(work),
        "Selected source read witness", (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
          const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, authority.scopeId);
          return yield* supplied.withTransactionReadBinding(active.selection, tx, resolved.authority, clock,
            () => Effect.sync(() => { entered++; }));
        }).pipe(Effect.provideService(Tracer.Tracer, tracer),
          Effect.provideService(Scheduler.MaxOpsBeforeYield, 8)), cause => new Error("Selected source witness transaction", { cause }));
      const count = (name: string) => spans.filter(span => span === name).length;
      yield* read();
      yield* read();
      const firstCompilations = count("LogicalStorageReadiness.selectSources");
      expect(firstCompilations).toBe(1);
      expect(retainedSelections).toBe(1);
      yield* read();
      yield* read();
      expect(count("LogicalStorageReadiness.selectSources")).toBe(firstCompilations);
      expect(count("LogicalStorageReadiness.inspectSelected")).toBe(4);
      expect(entered).toBe(4);
      // Fully covered ordered builds must not add an early batch. Later owners
      // still perform their genuine on-demand frontier reads in this catalog.
      expect(count("LogicalStorageReadiness.inspectIndexes")).toBe(4);
      expect(count("IndexBuildState.readCoverageTableFrontiers")).toBe(0);
      expect(count("AppRows.readTableWriteFrontiers")).toBe(4);
      const nativeIndex = selected.indexes[0];
      if (nativeIndex === undefined) return yield* Effect.die("Missing selected native index");
      const lifecycle = (value: "enabled" | "validating") => runDrizzleStatementEffect(
        target.drizzle.update(fxSystemIndexBuildStates).set({ lifecycle: value }).where(and(
          eq(fxSystemIndexBuildStates.scopeId, authority.scopeId),
          eq(fxSystemIndexBuildStates.indexDefinitionId, nativeIndex.indexDefinitionId))),
        cause => new Error("Selected index lifecycle witness", { cause }));
      yield* Effect.acquireUseRelease(lifecycle("validating"), () => Effect.gen(function* () {
        expect(yield* Effect.result(read())).toMatchObject({ _tag: "Failure", failure: { reason: "logicalSchemaNotReady" } });
        expect(entered).toBe(4);
        expect(count("LogicalStorageReadiness.selectSources")).toBe(firstCompilations);
        expect(count("LogicalStorageReadiness.inspectSelected")).toBe(5);
      }), () => lifecycle("enabled"));
      yield* read();
      expect(entered).toBe(5);
      yield* retained.close;
      expect(yield* Effect.result(read())).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
      expect(entered).toBe(5);
      expect(retainedSelections).toBe(1);

      const failedLease = yield* construct();
      const failedSource = yield* failedLease.use(Effect.succeed);
      rejectSelection = true;
      const failRead = () => runEffectTransaction(work => target.drizzle.transaction(work), "Rejected selected charge",
        (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
          const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, authority.scopeId);
          return yield* failedSource.withTransactionReadBinding(active.selection, tx, resolved.authority, clock,
            () => Effect.die("Rejected allocation must not enter"));
        }).pipe(Effect.provideService(Tracer.Tracer, tracer)), cause => new Error("Rejected selected charge transaction", { cause }));
      expect(yield* Effect.result(failRead())).toMatchObject({ _tag: "Failure", failure: { reason: "invalidPayload" } });
      const failedCompilations = count("LogicalStorageReadiness.selectSources");
      rejectSelection = false;
      expect(yield* Effect.result(failRead())).toMatchObject({ _tag: "Failure", failure: { reason: "invalidPayload" } });
      expect(count("LogicalStorageReadiness.selectSources")).toBe(failedCompilations);
      expect(retainedSelections).toBe(2);
      yield* failedLease.close;
      const freshLease = yield* construct();
      const freshSource = yield* freshLease.use(Effect.succeed);
      // Independent concurrent first transactions may compile once or twice,
      // but can charge and retain only one successful descriptor.
      yield* Effect.all([read(freshSource), read(freshSource)], { concurrency: 2 });
      expect(retainedSelections).toBe(3);
      const concurrentCompilations = count("LogicalStorageReadiness.selectSources") - failedCompilations;
      expect(concurrentCompilations).toBeGreaterThanOrEqual(1);
      expect(concurrentCompilations).toBeLessThanOrEqual(2);
      yield* read(freshSource);
      expect(count("LogicalStorageReadiness.selectSources")).toBe(failedCompilations + concurrentCompilations);
      expect(retainedSelections).toBe(3);
      yield* freshLease.close;
    })).pipe(Effect.provideService(Tracer.Tracer, tracer)),
    spies => Effect.sync(() => { spies.capture.mockRestore(); spies.charge.mockRestore(); }),
  );
});
