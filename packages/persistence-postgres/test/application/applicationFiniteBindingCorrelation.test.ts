import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema, Tracer } from "effect";
import { expect, it } from "vitest";
import {
  decodeReplacementScopeIdV1,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import {
  prepareLogicalSourceEvidence,
  withSharedLogicalSourceBindingChecks,
} from "../../src/storage/documents/logicalDocuments/sourceAdmission";
import { prepareLogicalStorageReadiness } from "../../src/storage/catalog/logicalStorageReadiness";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../src/scope/scopeAuthorityResolution";
import { logicalCurrencyFixture } from "../../../medusa-adapter/test/support/logical-currency-fixture";
import { lockScopeClockForUpdateInTransactionEffect } from "../../src/scope/scopeClock";
import { runEffect } from "../support/effectTestRuntime";
import {
  ExecutionDiagnostics,
  type ExecutionDiagnosticPolicy,
} from "../../src/execution/diagnostics/operation";
import {
  prepareApplicationBindingSelection,
} from "../../src/application/activation/repositoryIdentity";
import {
  requireAcceptedApplicationBindingObservation,
} from "../../src/application/activation/acceptedBinding";
import {
  type AcceptedApplicationBinding,
} from "../../src/application/activation/contracts";
import {
  prepareLogicalRelationalAdmission,
} from "../../src/storage/documents/logicalDocuments/relationalAdmission";
import {
  withLogicalParticipantCommitApplicationBindingInTransaction,
} from "../../src/storage/documents/logicalDocuments/participantAdmission";
import { postgresUrl } from "../support/postgresHelpers";

// Compose the actual core observation policy alongside the existing tracer.
// useSpan retains the original Cause, as in the measurement SDK composition.
const diagnostics: ExecutionDiagnosticPolicy = {
  observe: (name, work) => Effect.useSpan(name, {}, span =>
    Effect.provideService(work, Tracer.ParentSpan, span)),
};

it("retains full source proof authenticity across serialized SQL and overlapping owner lifetimes", async () => {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const fixture = await logicalCurrencyFixture("pglite", close => cleanup.push(close));
    const deploymentId = Schema.decodeUnknownSync(TransactionGrantDeploymentIdV1Schema)(fixture.deploymentId);
    const application = fixture.application;
    const selection = (await runEffect(application.activation.readActive())).selection;
    const scopeId = decodeReplacementScopeIdV1(application.authority.scopeId);
    const location = { deploymentId, scopeId, schemaVersionId: fixture.schemaVersionId };
    const logical = fixture.hostInput.logicalStorage;
    const catalog = await runEffect(prepareLogicalStorageReadiness(logical.ports, logical.unique, location));
    if (catalog.status !== "prepared") throw new Error("Expected genuine prepared catalog");
    const currency = await runEffect(prepareLogicalSourceEvidence(logical.ports, logical.unique, location,
      { sourceKey: "medusa.currency", writeProfile: "medusa.currency",
        definition: { kind: "relational", schema: fixture.currencyDefinition.schema },
        evidence: fixture.currencyDefinition.provenance }, "medusa", "relational", { kind: "prepared", catalog }));
    const resolved = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(deploymentId, application.authorityPorts));
    const spans: string[] = [];
    const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
    const count = (name: string) => spans.filter(span => span === name).length;
    const bindingProof = "DataBindingRepository.readSelectedEvidence";
    const readinessProof = "LogicalStorageReadiness.inspect";
    await fixture.persistence.drizzle.transaction(tx => runEffect(Effect.scoped(Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      const readFull = () => currency.withBinding(selection, tx, resolved.authority, clock, () => Effect.void);
      for (const ending of ["success", "failure", "interruption"] as const) {
        const enteredA = yield* Deferred.make<void>();
        const enteredB = yield* Deferred.make<void>();
        const releaseA = yield* Deferred.make<void>();
        const releaseB = yield* Deferred.make<void>();
        const beforeBinding = count(bindingProof);
        const beforeReadiness = count(readinessProof);
        // Real SQL is serialized. Only the two full-source owner lifetimes
        // overlap, so closing A must neither remove live B nor revive A later.
        const a = yield* Effect.forkScoped(withSharedLogicalSourceBindingChecks(tx, () => Effect.gen(function* () {
          yield* readFull();
          yield* Deferred.succeed(enteredA, undefined);
          yield* Deferred.await(releaseA);
          if (ending === "failure") return yield* Effect.fail("full-owner-failure");
          if (ending === "interruption") return yield* Effect.interrupt;
        })));
        yield* Deferred.await(enteredA);
        const b = yield* Effect.forkScoped(withSharedLogicalSourceBindingChecks(tx, () => Effect.gen(function* () {
          yield* readFull();
          yield* Deferred.succeed(enteredB, undefined);
          yield* Deferred.await(releaseB);
          yield* readFull();
        })));
        yield* Deferred.await(enteredB);
        yield* Deferred.succeed(releaseA, undefined);
        const outcomeA = yield* Fiber.await(a);
        yield* Deferred.succeed(releaseB, undefined);
        yield* Fiber.join(b);
        expect(Exit.isSuccess(outcomeA)).toBe(ending === "success");
        const authenticated = ending === "success" ? 2 : 3;
        expect(count(bindingProof) - beforeBinding).toBe(authenticated);
        expect(count(readinessProof) - beforeReadiness).toBe(authenticated);
        // Both scopes are closed. Every unscoped call must read full selected
        // evidence and reauthenticate logical readiness rather than use A.
        yield* readFull();
        yield* readFull();
        expect(count(bindingProof) - beforeBinding).toBe(authenticated + 2);
        expect(count(readinessProof) - beforeReadiness).toBe(authenticated + 2);
      }
      for (const priorPositive of [false, true]) {
        yield* withSharedLogicalSourceBindingChecks(tx, () => Effect.gen(function* () {
          if (priorPositive) yield* readFull();
          const failed = yield* currency.withBinding(selection, tx, resolved.authority, clock,
            () => Effect.fail("caught-full-callback-failure")).pipe(Effect.result);
          expect(failed).toEqual(Result.fail("caught-full-callback-failure"));
          const beforeBinding = count(bindingProof);
          const beforeReadiness = count(readinessProof);
          yield* readFull();
          expect(count(bindingProof) - beforeBinding).toBe(1);
          expect(count(readinessProof) - beforeReadiness).toBe(1);
        }));
      }
    })).pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.provideService(ExecutionDiagnostics, diagnostics))));
  } finally { for (const close of cleanup.reverse()) await close(); }
}, 240_000);

async function verifyThreeSourceAcceptance(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close));
    const logical = fixture.hostInput.logicalStorage;
    const deploymentId = Schema.decodeUnknownSync(TransactionGrantDeploymentIdV1Schema)(fixture.deploymentId);
    const scopeId = decodeReplacementScopeIdV1(fixture.application.authority.scopeId);
    const location = { deploymentId, scopeId, schemaVersionId: fixture.schemaVersionId };
    const catalog = await runEffect(prepareLogicalStorageReadiness(logical.ports, logical.unique, location));
    if (catalog.status !== "prepared") throw new Error("Missing actual logical catalog");
    const selected: Array<Effect.Success<ReturnType<typeof prepareLogicalSourceEvidence>>> = [];
    for (const owner of ["application", "medusa", "payload"] as const) {
      const source = catalog.requirements.evidence.candidate.sources.find(source => source.owner === owner);
      if (source === undefined) throw new Error(`Missing ${owner} source`);
      selected.push(await runEffect(prepareLogicalSourceEvidence(logical.ports, logical.unique, location,
        { sourceKey: source.key, writeProfile: source.writeProfile, definition: source.definition, evidence: source.evidence },
        owner, source.definition.kind, { kind: "prepared", catalog })));
    }
    const application = await runEffect(prepareApplicationBindingSelection(fixture.application.activation));
    const resolved = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(deploymentId, fixture.application.authorityPorts));
    const spans: string[] = [];
    const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
    const count = (name: string) => spans.filter(span => span === name).length;
    const entered: string[] = [];
    await fixture.persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      const applicationSource = selected[0], commerceSource = selected[1], payloadSource = selected[2];
      if (applicationSource === undefined || commerceSource === undefined || payloadSource === undefined)
        throw new Error("Missing selected source");
      yield* applicationSource.withTransactionBinding(application, tx, resolved.authority, clock, (first, accepted) => {
        entered.push(first.source.key);
        if (accepted === undefined) return Effect.die("Prepared callback omitted authentic binding");
        return commerceSource.withTransactionBinding(application, tx, resolved.authority, clock, (second, commerceAccepted) => {
          entered.push(second.source.key);
          expect(commerceAccepted).toBe(accepted);
          return payloadSource.withTransactionBinding(application, tx, resolved.authority, clock, (third, payloadAccepted) => Effect.sync(() => {
            entered.push(third.source.key);
            expect(payloadAccepted).toBe(accepted);
          }), commerceAccepted);
        }, accepted);
      });
    }).pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.provideService(ExecutionDiagnostics, diagnostics))));
    expect(entered).toEqual(selected.map(source => source.source.key));
    expect(count("ApplicationReadiness.validateStoredIssuedReadiness")).toBe(1);
    expect(count("ApplicationActiveHead.readCheckedCoherentForShare")).toBe(1);
    expect(count("DataBindingRepository.readSelectedEvidence")).toBe(3);
    expect(count("LogicalStorageReadiness.inspect")).toBe(3);
    expect(count("ScopeClock.requireAuthorizationRevocationEpochInTransaction")).toBe(3);
    const currency = await runEffect(prepareLogicalRelationalAdmission(logical.ports, logical.unique, location,
      { sourceKey: "medusa.currency", writeProfile: "medusa.currency", schema: fixture.currencyDefinition.schema,
        evidence: fixture.currencyDefinition.provenance }, { kind: "prepared", catalog }));
    const commit = currency.createCommitAuthority(application, "currency", ["read"]);
    await fixture.persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      const refusal = yield* withLogicalParticipantCommitApplicationBindingInTransaction(commit, tx,
        { ...clock, storageGenerationFence: StorageGenerationFenceSchema.make(clock.storageGenerationFence + 1n) },
        () => Effect.void).pipe(Effect.result);
      expect(refusal).toMatchObject({ _tag: "Failure", failure: { _tag: "LogicalParticipantAdmissionError",
        cause: { _tag: "LogicalRelationalAdmissionError", cause: { _tag: "ApplicationActivationError", reason: "scopeAuthority" } } } });
      const interrupted = yield* Effect.exit(Effect.interrupt);
      if (Exit.isSuccess(interrupted)) throw new Error("Missing original interruption");
      const original = Cause.combine(Cause.fail("original downstream refusal"),
        Cause.combine(Cause.die(new Error("original downstream defect")), interrupted.cause));
      let escaped: AcceptedApplicationBinding | undefined;
      const outcome = yield* withLogicalParticipantCommitApplicationBindingInTransaction(commit, tx, clock,
        binding => {
          escaped = binding;
          return Effect.failCause(original);
        }).pipe(Effect.exit);
      if (Exit.isSuccess(outcome)) throw new Error("Expected original downstream Cause");
      expect(outcome.cause).toBe(original);
      if (escaped === undefined) throw new Error("Missing genuine callback binding");
      expect(Result.isFailure(requireAcceptedApplicationBindingObservation(escaped, application, tx, clock))).toBe(true);
    }).pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.provideService(ExecutionDiagnostics, diagnostics))));
  } finally { for (const close of cleanup.reverse()) await close(); }
}

it("lends one ordinary Application acceptance through three authentic source callbacks in PGlite", async () => {
  await verifyThreeSourceAcceptance("pglite");
}, 240_000);
it.skipIf(postgresUrl === null)("lends one ordinary Application acceptance while retaining three fresh source proofs on PostgreSQL", async () => {
  await verifyThreeSourceAcceptance("postgres");
}, 240_000);
