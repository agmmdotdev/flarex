import { expect, it } from "vitest";
import { Effect } from "effect";
import { makePayloadRuntime } from "../../payload-adapter/src/runtime";
import { UnsupportedPayloadCapability } from "../../payload-adapter/src/testing";
import { runEffect } from "./effectTestRuntime";

it("initializes only the closed headless inventory and refuses deferred authority", () => runEffect(Effect.scoped(
  makePayloadRuntime().pipe(Effect.flatMap(runtime => Effect.promise(async () => {
    expect(Object.keys(runtime.payload.collections).sort()).toEqual(["payload-migrations", "payload-preferences", "posts", "users"]);
    const preferenceUser = runtime.payload.collections["payload-preferences"]?.config.fields.find(field => "name" in field && field.name === "user");
    expect(preferenceUser).toMatchObject({ type: "relationship", relationTo: ["users"], required: true });
    expect(runtime.touched()).toEqual([]);
    await expect(runtime.payload.db.migrate()).rejects.toBeInstanceOf(UnsupportedPayloadCapability);
    await expect(runtime.payload.kv.get("forbidden")).rejects.toBeInstanceOf(UnsupportedPayloadCapability);
    await expect(runtime.payload.create({ collection: "posts", data: { title: "outside", publishedAt: "2026-01-01" }, depth: 0 })).rejects.toBeInstanceOf(UnsupportedPayloadCapability);
    expect(runtime.touched()).toEqual([]);
  }))),
)), 30_000);
