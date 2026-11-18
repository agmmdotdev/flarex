import { webcrypto } from "node:crypto";
import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import {
  claimApplicationExecutableActiveSelection,
  readApplicationBindingTargetProtection,
} from "../../../src/application/activation/selectionIdentity";
import {
  makeApplicationActivationRepository,
} from "../../../src/application/activation/repository";
import {
  prepareApplicationBindingSelection,
  prepareRetainedApplicationBindingSelection,
} from "../../../src/application/activation/repositoryIdentity";
import {
  validateApplicationBindingBasisInTransaction,
} from "../../../src/application/activation/bindingAcceptance";
import {
  type ApplicationBindingInput,
} from "../../../src/application/activation/contracts";
import { fxSystemApplicationActiveHeads } from "../../../src/application/applicationActivationSchema";
import {
  makePreparedHostRuntime,
  retainPreparedHost,
} from "../../../src/execution/preparation/preparedHostRuntime";
import { lockScopeClockForShareInTransactionEffect } from "../../../src/scope/scopeClock";
import { runEffect } from "../../support/effectTestRuntime";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "../../support/postgresHelpers";
import {
  readinessFixture,
  prepareReadinessAuthorities,
  enablePhysicalBuilds,
} from "../support/readinessPostgresFixture";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("Application activation/bindingPreparation.postgres", { timeout: 30_000 }, () => {
  it("keeps standalone tokens request-owned under ambient host construction and rejects a closed retained issuer", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      const schemaVersionId = await prepareReadinessAuthorities(fixture);
      await enablePhysicalBuilds(fixture, schemaVersionId);
      const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
        deploymentId: fixture.input.deploymentId, scopeId: fixture.input.scopeId,
        readiness: fixture.repository, authority: fixture.authorityPorts });
      await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
      const requests = await runEffect(Effect.scoped(Effect.gen(function* () {
        const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 1 });
        const host = yield* retainPreparedHost(runtime, Effect.gen(function* () {
          const tokens: ApplicationBindingInput[] = [];
          for (let index = 0; index < 8; index++) {
            const token = yield* prepareApplicationBindingSelection(activation);
            const lineage = yield* Effect.fromResult(readApplicationBindingTargetProtection(token));
            expect(lineage.lifetime).toBeUndefined();
            tokens.push(token);
          }
          return Object.freeze({ tokens });
        }));
        return yield* host.use(value => Effect.succeed(value.tokens));
      })));
      for (const token of requests) {
        expect(Result.isSuccess(readApplicationBindingTargetProtection(token))).toBe(true);
        expect(Result.isFailure(claimApplicationExecutableActiveSelection(token))).toBe(true);
      }
      const accept = (token: ApplicationBindingInput) => target.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
        const clock = yield* lockScopeClockForShareInTransactionEffect(tx, fixture.input.scopeId);
        return yield* validateApplicationBindingBasisInTransaction(token, tx, clock);
      })));
      for (const token of requests) expect((await accept(token)).basis.revisionId).toBe(fixture.input.revisionId);
      const request = requests[0];
      if (request === undefined) throw new Error("Expected request binding");
      const clone = Object.freeze({ ...request });
      expect(Result.isFailure(readApplicationBindingTargetProtection(clone))).toBe(true);
      await expect(accept(clone)).rejects.toMatchObject({ reason: "invalidComposition" });
      const retained = await runEffect(Effect.scoped(Effect.gen(function* () {
        const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 16_777_216 });
        const host = yield* retainPreparedHost(runtime, Effect.gen(function* () {
          const active = yield* activation.readActive();
          const binding = yield* prepareRetainedApplicationBindingSelection(activation);
          return Object.freeze({ active, binding });
        }));
        return yield* host.use(value => Effect.gen(function* () {
          const lineage = yield* Effect.fromResult(readApplicationBindingTargetProtection(value.active.selection));
          expect(lineage.lifetime).toBeDefined();
          const bindingLineage = yield* Effect.fromResult(readApplicationBindingTargetProtection(value.binding));
          expect(bindingLineage.lifetime).toBeDefined();
          return Object.freeze({ selection: value.active.selection, binding: value.binding });
        }));
      })));
      expect(Result.isFailure(readApplicationBindingTargetProtection(retained.selection))).toBe(true);
      expect(Result.isFailure(readApplicationBindingTargetProtection(retained.binding))).toBe(true);
      await expect(accept(retained.selection)).rejects.toMatchObject({ reason: "invalidComposition" });
      await expect(accept(retained.binding)).rejects.toMatchObject({ reason: "invalidComposition" });
      // Surviving request evidence is not a cached positive business verdict.
      await target.drizzle.delete(fxSystemApplicationActiveHeads)
        .where(eq(fxSystemApplicationActiveHeads.scopeId, fixture.input.scopeId));
      // This fixture has an enabled intrinsic index whose maintenance obligation
      // requires the active head. Full physical readiness refuses that missing
      // source before the final binding-head comparison.
      await expect(accept(request)).rejects.toMatchObject({
        _tag: "ApplicationReadinessError", operation: "settle", reason: "storedState", retryable: false,
      });
    });
  }, 120_000)
});
