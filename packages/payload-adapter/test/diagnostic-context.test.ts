import { Clock, Context, Effect, Option, References, Scope, Tracer } from "effect";
import { BasePayload } from "payload";
import { describe, expect, it } from "vitest";
import { ExecutionDiagnostics, observeExecution, type ExecutionDiagnosticPolicy } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { cmsError, cmsLimits } from "@flarex/persistence-postgres/internal/cms-adapter";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/boundedRequestLifetime";
import { makeCmsCommandContext } from "../../persistence-postgres/src/cmsTransaction/context";
import { getCmsCommand } from "../../persistence-postgres/src/cmsTransaction/commands";
import { makePayloadDatabaseAdapter } from "../src/adapter";
import { makePayloadOperations } from "../src/operations";
import { makePayloadInputs } from "../src/inputs";
import { makePayloadCollectionRuntime } from "../src/collectionRuntime";
import { payloadScalarConfiguration } from "../src/testing/profiles";

const Unrelated = Context.Service<{ readonly secret: string }>("PayloadDiagnosticContext/Unrelated");
const diagnosticPolicy: ExecutionDiagnosticPolicy = {
  observe: (name, work) => Effect.useSpan(name, {}, span => Effect.provideService(work, Tracer.ParentSpan, span)),
};

describe("Payload request diagnostic handoff", () => {
  it.each([false, true])("carries only current diagnostics through actual command and adapter runners (enabled=%s)", async enabled => {
    const spans: Tracer.Span[] = [];
    const tracer = Tracer.make({ span: options => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    } });
    const defaultClock = Context.get(Context.empty(), Clock.Clock);
    const clock: Clock.Clock = {
      currentTimeMillis: Effect.succeed(1), currentTimeMillisUnsafe: () => 1,
      currentTimeNanos: Effect.succeed(1_000_000n), currentTimeNanosUnsafe: () => 1_000_000n,
      monotonicTimeNanos: defaultClock.monotonicTimeNanos,
      monotonicTimeNanosUnsafe: () => defaultClock.monotonicTimeNanosUnsafe(),
      sleep: duration => defaultClock.sleep(duration),
    };
    const linked = Tracer.externalSpan({ traceId: "linked", spanId: "linked-span" });
    const links = [{ span: linked, attributes: { relation: "native" } }];
    const collections = payloadScalarConfiguration.tables.map(makePayloadCollectionRuntime);
    const bridge = makePayloadDatabaseAdapter("payload.scalar", collections);
    // Exercise the genuine command/adapter handoff without native storage or a
    // second request owner. Complete Local API behavior remains in conformance.
    const payload = new BasePayload();
    const database = bridge.adapter.init({ payload });
    payload.count = args => database.count({ collection: args.collection,
      ...(args.req === undefined ? {} : { req: args.req }), where: {} });
    const commands = makePayloadOperations(payload, bridge, "payload.scalar", makePayloadInputs("payload.scalar", collections), () => true);
    const command = getCmsCommand(commands.count);
    if (command === undefined) throw new Error("Missing genuine Payload count command");
    let calls = 0;
    const work = Effect.scoped(Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(cmsError, cmsLimits, {}, {}, "payload diagnostics", "read"), selected => selected.close);
      const unused = () => Effect.fail(cmsError("unsupportedProfile"));
      const context = makeCmsCommandContext(lifetime, "payload diagnostics", lifetime.context, {
        documents: { get: unused, getMany: unused, insert: unused, patch: unused, replace: unused, delete: unused,
          find: () => observeExecution("LogicalDocuments.get", Effect.withFiber(fiber => Effect.sync(() => {
            calls++;
            expect(Context.get(fiber.context, Tracer.Tracer)).toBe(tracer);
            expect(Context.getOption(fiber.context, Unrelated)).toEqual(Option.none());
            expect(Context.get(fiber.context, Clock.Clock)).not.toBe(clock);
            expect(Context.getOrUndefined(fiber.context, Scope.Scope)).toBeUndefined();
            expect(Context.get(fiber.context, References.TracerTimingEnabled)).toBe(false);
            expect(Context.get(fiber.context, References.TracerSpanAnnotations)).toEqual({ request: "native" });
            expect(Context.get(fiber.context, References.TracerSpanLinks)).toBe(links);
            expect(Option.isSome(Context.getOption(fiber.context, ExecutionDiagnostics))).toBe(enabled);
            return { docs: [], total: 0 };
          }))) }, relations: { incoming: unused }, preferences: { deleteForPendingDocument: unused },
      }, true, unused);
      return yield* command.run(context, { collection: collections[0]!.collectionSlug });
    }));
    const selected = enabled ? Effect.provideService(work, ExecutionDiagnostics, diagnosticPolicy) : work;
    expect(await Effect.runPromise(selected.pipe(Effect.withSpan("request"), Effect.provideService(Tracer.Tracer, tracer),
      Effect.provideService(Unrelated, { secret: "private" }), Effect.provideService(Clock.Clock, clock), Effect.withTracerTiming(false),
      Effect.annotateSpans({ request: "native" }), Effect.provideService(References.TracerSpanLinks, links)))).toEqual({ totalDocs: 0 });
    expect(calls).toBe(1);
    const call = spans.find(span => span.name === "PayloadAdapter.call");
    const invoke = spans.find(span => span.name === "PayloadAdapter.invoke");
    const dal = spans.find(span => span.name === "LogicalDocuments.get");
    if (enabled) {
      if (call === undefined || invoke === undefined || dal === undefined) throw new Error("Missing opted-in Payload operation span");
      expect(dal.parent).toEqual(Option.some(call));
      expect(dal.attributes.get("request")).toBe("native");
      expect(dal.links).toEqual(links);
      expect(dal.status).toMatchObject({ _tag: "Ended", startTime: 0n, endTime: 0n });
      expect(call.parent).toEqual(Option.some(invoke));
    } else {
      expect(call).toBeUndefined();
      expect(invoke).toBeUndefined();
      expect(dal).toBeUndefined();
    }
  });
});
