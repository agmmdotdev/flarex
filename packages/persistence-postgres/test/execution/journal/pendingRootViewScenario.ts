import { Effect, Result } from "effect";
import { expect } from "vitest";
import { canonicalizeFlarexValueV1Effect, isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import { lowerAppDeveloperIndexKeyV1 } from "../../../src/storage/indexes/appDeveloperIndexKeys";
import type { LocatedAppIndexDefinitionV1 } from "../../../src/storage/indexes/locatedAppIndexDefinition";
import { attachLogicalDocumentRootEvaluator, makeLogicalDocumentRootEvaluator,
  readLogicalDocumentRootPendingIndex, registerLogicalDocumentRootIndexes,
  type LogicalDocumentRootPins, type LogicalDocumentRootPointFailure } from "../../../src/storage/documents/logicalDocuments/rootEvaluator";
import type { ApplicationDocumentObservation } from "../../../src/storage/materialization/model";

type Failure = LogicalDocumentRootPointFailure | Result.Result.Failure<ReturnType<typeof lowerAppDeveloperIndexKeyV1>>;

/** Portable owner isolation, using the real finite entry's pins/observation and
 * catalog definition. The binary field is codec-domain evidence only; this does
 * not assert that the public users schema admits that additional field. */
export const pendingRootViewScenario = Effect.fn("PendingIndex.rootViewScenario")(
  function* (input: Readonly<{ pins: LogicalDocumentRootPins; observation: ApplicationDocumentObservation;
    definition: LocatedAppIndexDefinitionV1; creationTime: AppCreationTimeV1 }>) {
    const scalar = (document: CanonicalFlarexValueV1, projection: "value" | "valueJson") => {
      const value = document[projection];
      if (typeof value !== "object" || value === null) throw new Error("Missing canonical owner object");
      Reflect.set(value, "name", "foreign mutation");
    };
    const mutations: readonly Readonly<{ name: string; run: (document: CanonicalFlarexValueV1) => void }>[] = [
      { name: "runtime scalar", run: document => scalar(document, "value") },
      { name: "JSON scalar", run: document => scalar(document, "valueJson") },
      { name: "canonical bytes", run: document => {
        Reflect.set(document.canonicalBytes, "0", (document.canonicalBytes[0] ?? 0) ^ 255);
      } },
      { name: "canonical hash", run: document => {
        Reflect.set(document.sha256, "0", (document.sha256[0] ?? 0) ^ 255);
      } },
      { name: "nested runtime binary", run: document => {
        const value = document.value;
        if (!isCanonicalFlarexRuntimeObjectV1(value) || !(value.binary instanceof ArrayBuffer))
          throw new Error("Missing real codec binary");
        new Uint8Array(value.binary).fill(255);
      } },
    ];
    for (const view of ["row", "index"] as const) for (const mutation of mutations) {
      const root = yield* Effect.acquireRelease(Effect.sync(() => makeLogicalDocumentRootEvaluator(input.pins,
        { identities: 4, workingBytes: 1_048_576 })), owner => Effect.sync(owner.close));
      const state = attachLogicalDocumentRootEvaluator(root, input.pins);
      if (state === null) throw new Error("Missing genuine owner root");
      Result.getOrThrow(root.observePoint("users", input.observation, { kind: "missing" }));
      const document = yield* canonicalizeFlarexValueV1Effect({ _id: input.observation.documentId,
        _creationTime: input.creationTime, name: "Immutable pending", binary: new Uint8Array([1, 2, 3]).buffer }, "appDocument");
      Result.getOrThrow(root.writePoint("users", input.observation,
        { kind: "live", creationTime: input.creationTime, document }, "insert"));
      Result.getOrThrow(registerLogicalDocumentRootIndexes(state, [input.definition], { error: failure => failure }));
      const read = () => Result.getOrThrow(readLogicalDocumentRootPendingIndex<Failure>(state, input.definition, {
        order: "application", lower: row => {
          if (row.current === null) throw new Error("Missing live owner row");
          return lowerAppDeveloperIndexKeyV1(input.definition, row.current, row.creationTime);
        }, error: failure => failure, charge: () => Result.succeed(undefined),
      }));
      const first = read().positions[0];
      const exposed = view === "row" ? state.rows.get(input.observation.documentId)?.current : first?.document;
      if (first === undefined || exposed == null) throw new Error("Missing actual exposed canonical owner view");
      const history = structuredClone(root.snapshot());
      const point = structuredClone(root.point(input.observation.tableId, input.observation.rowId));
      const key = first.encodedKey;
      mutation.run(exposed);
      expect(root.snapshot(), view + ": " + mutation.name + " preserves history").toEqual(history);
      expect(root.point(input.observation.tableId, input.observation.rowId),
        view + ": " + mutation.name + " preserves current evidence").toEqual(point);
      const current = state.rows.get(input.observation.documentId)?.current;
      if (current == null) throw new Error("Owner row disappeared after foreign mutation");
      expect(Result.getOrThrow(lowerAppDeveloperIndexKeyV1(input.definition, current, input.creationTime))).toBe(key);
      expect(read().positions.map(position => position.encodedKey)).toEqual([key]);
    }
  },
);
