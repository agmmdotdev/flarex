import { Deferred, Effect, Exit, Fiber, Result, Schema, Tracer } from "effect";
import { expect, it } from "vitest";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { prepareLogicalSourceEvidence, withSharedLogicalSourceBindingChecks } from "../src/logicalDocuments/sourceAdmission";
import { prepareLogicalStorageReadiness } from "../src/logicalStorageReadiness";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../src/scopeAuthorityResolution";
import { logicalCurrencyFixture } from "../../medusa-adapter/test/support/logical-currency-fixture";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import { runEffect } from "./effectTestRuntime";
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
    })).pipe(Effect.provideService(Tracer.Tracer, tracer))));
  } finally { for (const close of cleanup.reverse()) await close(); }
}, 240_000);
