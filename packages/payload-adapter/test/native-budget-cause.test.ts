import { Cause, Context, Effect, Exit } from "effect";
import { expect, it } from "vitest";
import { CoreNativeBudgetError, type CoreDatabase } from "../../persistence-postgres/src/core/api";
import { makePreparedHostRuntime } from "../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import { CmsTransactionError } from "../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { makeCmsNativeBinding } from "../../persistence-postgres/src/frameworks/cmsTransaction/nativeBinding";
import { bindPayloadDirect } from "../src/direct/binding";
import { makePayloadNative } from "../src/runtime/native";
import { createCorePayloadFixture } from "./support/core-payload-fixture";

it.each(["object", "primitive"] as const)("preserves the real retained-budget mixed Cause with a %s defect and confines its receipt to one Local API call", async kind => {
  let foreignRejection: Readonly<{ value: unknown }> | undefined;
  const fixture = await createCorePayloadFixture({ kind: "fresh", driver: "pglite" }, { makeRuntime: compiled => Effect.gen(function* () {
    const native = yield* makePayloadNative(compiled, { hooks: { afterRead: [({ doc }) => {
      if (foreignRejection !== undefined) throw foreignRejection.value;
      return doc;
    }] } });
    return bindPayloadDirect(native);
  }) });
  try {
    await fixture.run(Effect.gen(function* () {
      const created = yield* fixture.writer.create(fixture.writer.newRequestKey(), {
        collection: "news", data: { title: `retained-budget-${"x".repeat(1024)}` },
      });
      const Marker = Context.Service<object>("test/native-retained-budget-cause");
      const marker = Object.freeze({ boundary: "actual retained-body charge" });
      const defect = kind === "object" ? new Error("retained-budget companion defect") : "retained-budget primitive defect";
      const interruptor = 7311;
      let nativeBegins = 0;
      let refusedCharges = 0;
      let observed: Readonly<{ error: CmsTransactionError; annotations: ReadonlyMap<string, unknown> }> | undefined;
      // Keep the actual database, native token and transaction; alter only the
      // failure returned by the trusted CMS budget callback after it refuses.
      const database: CoreDatabase = {
        ...fixture.database,
        beginNative: (binding, options) => {
          nativeBegins++;
          return fixture.database.beginNative(binding, { ...options,
            chargeRetained: bytes => options.chargeRetained(bytes).pipe(Effect.catchCause(cause => {
              refusedCharges++;
              expect(bytes).toBeGreaterThan(512);
              const failure = cause.reasons.find(Cause.isFailReason);
              if (failure === undefined || !(failure.error instanceof CoreNativeBudgetError)
                || !(failure.error.cause instanceof CmsTransactionError)) throw new Error("Expected the genuine CMS-to-Core budget refusal");
              expect(cause.reasons).toHaveLength(1);
              expect(failure.error.reason).toBe("limitExceeded");
              expect(failure.error.cause.reason).toBe("limitExceeded");
              const annotated = Cause.annotate(cause, Context.make(Marker, marker));
              const original = annotated.reasons.find(Cause.isFailReason);
              if (original === undefined) throw new Error("Expected the annotated budget refusal");
              observed = { error: failure.error.cause, annotations: new Map(original.annotations) };
              return Effect.failCause(Cause.combine(annotated, Cause.combine(Cause.die(defect), Cause.interrupt(interruptor))));
            })),
          });
        },
      };
      const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 8 * 1024 * 1024 });
      const binding = yield* makeCmsNativeBinding({ database, binding: fixture.binding, hostRuntime,
        identityAndAccessPolicy: { profile: "payload.scalar", access: "closed-headless-local-api" },
        requestBudget: { calls: 64, commandBytes: 512 },
      });
      const reader = yield* fixture.runtime.bindNativeRead(binding);
      const outcome = yield* Effect.exit(reader.findByID({ collection: "news", id: created.id }));
      expect(nativeBegins).toBe(1);
      expect(refusedCharges).toBe(1);
      if (observed === undefined) throw new Error("The real Core transaction did not reach the retained-body budget refusal");
      const originalRefusal = observed;
      const origins = [...originalRefusal.annotations].filter(([key]) => key.startsWith("Flarex/"));
      expect(origins.length).toBeGreaterThan(0);
      if (Exit.isSuccess(outcome)) throw new Error("A mixed retained-budget failure must not return a document");
      const failures = outcome.cause.reasons.filter(Cause.isFailReason);
      const details = outcome.cause.reasons.map(reason => ({
        type: reason._tag,
        originalError: Cause.isFailReason(reason) && reason.error === originalRefusal.error,
        originalDefect: Cause.isDieReason(reason) && reason.defect === defect,
        interruptor: Cause.isInterruptReason(reason) ? reason.fiberId : undefined,
        annotationKeys: [...reason.annotations.keys()],
        originalOrigins: origins.every(([key, value]) => reason.annotations.get(key) === value),
        originalMarker: reason.annotations.get(Marker.key) === marker,
      }));
      expect(failures, JSON.stringify(details)).toHaveLength(1);
      const failure = failures[0];
      if (failure === undefined) throw new Error("The native CMS facade lost its original typed budget refusal");
      expect(failure.error).toBe(originalRefusal.error);
      expect(failure.error.reason).toBe("limitExceeded");
      for (const [key, value] of origins) expect(failure.annotations.get(key), key).toBe(value);
      expect(failure.annotations.get(Marker.key)).toBe(marker);
      expect(outcome.cause.reasons.filter(reason => Cause.isDieReason(reason) && reason.defect === defect)).toHaveLength(1);
      expect(outcome.cause.reasons.filter(reason => Cause.isInterruptReason(reason) && reason.fiberId === interruptor)).toHaveLength(1);
      expect(outcome.cause.reasons).toHaveLength(3);
      yield* reader.close;
      // Native hooks can later throw an equal primitive, the exact same Error,
      // or an object resembling an outcome. None has this request's receipt.
      const forged = Object.freeze({ _tag: "Failure", cause: outcome.cause });
      for (const rejection of [originalRefusal.error, defect, forged]) {
        foreignRejection = { value: rejection };
        const foreign = yield* Effect.exit(fixture.reader.findByID({ collection: "news", id: created.id }));
        if (Exit.isSuccess(foreign)) throw new Error("Expected the genuine native hook rejection");
        expect(foreign.cause.reasons, Cause.pretty(foreign.cause)).toHaveLength(1);
        const reason = foreign.cause.reasons[0];
        if (reason === undefined) throw new Error("The foreign rejection was lost");
        if (rejection instanceof CmsTransactionError) {
          expect(Cause.isFailReason(reason) && reason.error === rejection).toBe(true);
        } else expect(Cause.isDieReason(reason) && reason.defect === rejection).toBe(true);
        for (const [key, value] of origins) expect(reason.annotations.get(key)).not.toBe(value);
      }
      foreignRejection = undefined;
      expect(yield* fixture.reader.findByID({ collection: "news", id: created.id })).toMatchObject({ id: created.id });
      if (kind === "primitive") {
        const primitive = "native charge continuation primitive";
        let successfulCharges = 0;
        const primitiveDatabase: CoreDatabase = { ...fixture.database,
          beginNative: (nativeBinding, options) => fixture.database.beginNative(nativeBinding, { ...options,
            chargeRetained: bytes => options.chargeRetained(bytes).pipe(Effect.andThen(() => {
              successfulCharges++;
              return Effect.die(primitive);
            })),
          }),
        };
        const primitiveBinding = yield* makeCmsNativeBinding({ database: primitiveDatabase, binding: fixture.binding, hostRuntime,
          identityAndAccessPolicy: { profile: "payload.scalar", access: "closed-headless-local-api" },
        });
        const primitiveReader = yield* fixture.runtime.bindNativeRead(primitiveBinding);
        const pure = yield* Effect.exit(primitiveReader.findByID({ collection: "news", id: created.id }));
        expect(successfulCharges).toBe(1);
        if (Exit.isSuccess(pure)) throw new Error("Expected the fault after the actual successful retained-body charge");
        expect(pure.cause.reasons, Cause.pretty(pure.cause)).toHaveLength(1);
        const pureReason = pure.cause.reasons[0];
        if (pureReason === undefined) throw new Error("The primitive native defect was lost");
        expect(Cause.isDieReason(pureReason) && pureReason.defect === primitive).toBe(true);
        yield* primitiveReader.close;
        foreignRejection = { value: primitive };
        const equal = yield* Effect.exit(fixture.reader.findByID({ collection: "news", id: created.id }));
        if (Exit.isSuccess(equal)) throw new Error("Expected the equal primitive native hook rejection");
        expect(equal.cause.reasons, Cause.pretty(equal.cause)).toHaveLength(1);
        const equalReason = equal.cause.reasons[0];
        if (equalReason === undefined) throw new Error("The equal primitive foreign defect was lost");
        expect(Cause.isDieReason(equalReason) && equalReason.defect === primitive).toBe(true);
        for (const [key, value] of pureReason.annotations) if (key.startsWith("Flarex/"))
          expect(equalReason.annotations.get(key)).not.toBe(value);
      }
    }));
  } finally { await fixture.close(); }
}, 60_000);
