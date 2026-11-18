import { expect, it } from "vitest";
import { Effect, Exit, Result } from "effect";
import { captureApiKeyNativeQuery, captureApiKeyNativeUpdates } from "../src/modules/api-key/native-input";
import { captureCommerceInput } from "../src/value/input";

it("translates only native revocation Dates before ordinary JSON capture", async () => {
  const instant = new Date("2026-10-23T00:00:00.000Z");
  const query = { where: { id: ["apk_one"], type: "secret", revoked_at: { $lt: instant } }, options: {} };
  expect(await Effect.runPromise(captureApiKeyNativeQuery(query))).toEqual({ where: {
    id: ["apk_one"], type: "secret", revoked_at: { $lt: instant.toISOString() } }, options: {} });
  expect(query.where.revoked_at.$lt).toBe(instant);
  expect(await Effect.runPromise(captureApiKeyNativeQuery({ where: { $or: [{ revoked_at: { $eq: null } }, { revoked_at: { $gt: instant } }] } })))
    .toEqual({ where: { $or: [{ revoked_at: { $eq: null } }, { revoked_at: { $gt: instant.toISOString() } }] } });
  const updated = await Effect.runPromise(captureApiKeyNativeUpdates([{ entity: { id: "apk_one" }, update: { revoked_at: instant } }]));
  expect(updated).toEqual([{ entity: { id: "apk_one" }, update: { revoked_at: instant.toISOString() } }]);
  const unsupported = await Effect.runPromise(captureApiKeyNativeUpdates([{ entity: { id: "apk_one" }, update: { created_at: instant } }]));
  expect(Result.isFailure(captureCommerceInput(unsupported))).toBe(true);
});

it("refuses accessors and oversized arrays before native timestamp translation", async () => {
  let evaluated = false;
  const branch = Object.defineProperty({}, "revoked_at", { enumerable: true, get() { evaluated = true; return { $lt: new Date() }; } });
  expect(Exit.isFailure(await Effect.runPromiseExit(captureApiKeyNativeQuery({ where: { $or: [branch] } })))).toBe(true);
  const array = Object.defineProperty([], "0", { enumerable: true, get() { evaluated = true; return {}; } });
  expect(Exit.isFailure(await Effect.runPromiseExit(captureApiKeyNativeUpdates(array)))).toBe(true);
  const oversized = await Effect.runPromiseExit(captureApiKeyNativeUpdates(Array.from({ length: 5 }, () => ({}))));
  expect(Exit.isFailure(oversized)).toBe(true);
  expect(evaluated).toBe(false);
});
