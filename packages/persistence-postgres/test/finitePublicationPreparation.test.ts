import { Result } from "effect";
import { expect, it } from "vitest";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { disposeFiniteMetadataProjection, encodeFiniteMetadataComparison,
  prepareFiniteMetadataEntryComparison, prepareFiniteMetadataProjection,
  readFiniteMetadataProjectionPreparationPayload, mergeFiniteMetadataProjections } from "../src/finiteMetadataDependencies";
import { disposePublicationDefinitions, preparePublicationDefinitions,
  readPublicationDefinitionPreparationPayload, selectPreparedPublicationDefinitions } from "../src/commitPublication/definitionPreparation";
import { runEffect } from "./effectTestRuntime";

it("lends exact immutable comparison data and reclaims it with its genuine issuer", async () => {
  const projection = await runEffect(prepareFiniteMetadataProjection({ indexes: [], unique: [],
    application: { functions: [{ path: "read", semantic: { result: "value" } }], groups: [] } }));
  const first = Result.getOrThrow(prepareFiniteMetadataEntryComparison(projection));
  expect(Result.getOrThrow(prepareFiniteMetadataEntryComparison(projection))).toBe(first);
  expect(Object.isFrozen(first)).toBe(true);
  expect(first.every(Object.isFrozen)).toBe(true);
  expect(encodeFiniteMetadataComparison(first)).toBe(JSON.stringify(first));
  const payload = Result.getOrThrow(readFiniteMetadataProjectionPreparationPayload(projection));
  expect(payload.comparisons.encoded).toEqual(first.map(expected => JSON.stringify(expected)));
  expect(Result.isFailure(prepareFiniteMetadataEntryComparison({ ...projection }))).toBe(true);
  const merged = Result.getOrThrow(mergeFiniteMetadataProjections([projection]));
  const borrowed = Result.getOrThrow(prepareFiniteMetadataEntryComparison(merged));
  expect(borrowed[0]).toBe(first[0]);
  expect(Result.getOrThrow(readFiniteMetadataProjectionPreparationPayload(merged)).comparisons.encoded).toEqual([]);
  disposeFiniteMetadataProjection(merged);
  expect(Result.getOrThrow(prepareFiniteMetadataEntryComparison(projection))).toBe(first);
  disposeFiniteMetadataProjection(projection);
  expect(Result.isFailure(prepareFiniteMetadataEntryComparison(projection))).toBe(true);
  expect(Result.isFailure(readFiniteMetadataProjectionPreparationPayload(projection))).toBe(true);
  // Escaped scalar data remains inert; disposal cannot turn it into authority.
  expect(encodeFiniteMetadataComparison(first)).toBe(JSON.stringify(first));
});

it("binds a new touched selection and refuses a disposed or forged definition preparation", () => {
  const prepared = preparePublicationDefinitions([], []);
  const touched = new Set([CatalogTableIdSchema.make(101)]);
  expect(selectPreparedPublicationDefinitions(prepared, touched)).toEqual({ indexes: [], unique: [] });
  expect(readPublicationDefinitionPreparationPayload(prepared)).toEqual({ indexesByTable: [], uniqueByTable: [] });
  expect(selectPreparedPublicationDefinitions({ ...prepared }, touched)).toBeNull();
  disposePublicationDefinitions(prepared);
  expect(selectPreparedPublicationDefinitions(prepared, touched)).toBeNull();
  expect(readPublicationDefinitionPreparationPayload(prepared)).toBeNull();
});
