import { expect, it } from "vitest";
import { Effect } from "effect";
import { makePayloadConformanceRuntime } from "../../payload-adapter/src/testing";
import { UnsupportedPayloadCapability } from "../../payload-adapter/src/testing";
import { runEffect } from "./effectTestRuntime";

it("initializes only the closed headless inventory and refuses deferred authority", () => runEffect(Effect.scoped(
  makePayloadConformanceRuntime().pipe(Effect.flatMap(conformance => Effect.promise(async () => {
    expect(Object.keys(conformance.payload.collections).sort()).toEqual(["payload-migrations", "payload-preferences", "posts", "users"]);
    const preferenceUser = conformance.payload.collections["payload-preferences"]?.config.fields.find(field => "name" in field && field.name === "user");
    expect(preferenceUser).toMatchObject({ type: "relationship", relationTo: ["users"], required: true });
    expect(conformance.observations.touched()).toEqual([]);
    await expect(conformance.payload.db.migrate()).rejects.toBeInstanceOf(UnsupportedPayloadCapability);
    await expect(conformance.payload.kv.get("forbidden")).rejects.toBeInstanceOf(UnsupportedPayloadCapability);
    await expect(conformance.payload.create({ collection: "posts", data: { title: "outside", publishedAt: "2026-01-01" }, depth: 0 })).rejects.toBeInstanceOf(UnsupportedPayloadCapability);
    expect(conformance.observations.touched()).toEqual([]);
  }))),
)), 30_000);
