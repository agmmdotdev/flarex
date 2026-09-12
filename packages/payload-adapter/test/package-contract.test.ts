import { Effect } from "effect";
import { expect, it } from "vitest";
import { payloadIsManagedField } from "@flarex/payload-adapter/internal/contract";
import { compilePayloadCollections } from "@flarex/payload-adapter/internal/collections";
import {
  makePayloadContentProfiles,
} from "@flarex/payload-adapter/internal/profile";
import { makePayloadRuntime } from "@flarex/payload-adapter/internal/runtime";
import { makePayloadConformanceRuntime, UnsupportedPayloadCapability } from "@flarex/payload-adapter/internal/testing";

it("resolves every declared private package subpath", () =>
  Effect.runPromise(compilePayloadCollections([{ slug: "entries", fields: [{ name: "label", type: "text", required: true }] }]).pipe(
    Effect.flatMap(makePayloadContentProfiles))).then((profiles) => {
    expect(Object.isFrozen(profiles)).toBe(true);
    expect(payloadIsManagedField("createdAt")).toBe(true);
    expect(makePayloadRuntime).toBeTypeOf("function");
    expect(compilePayloadCollections).toBeTypeOf("function");
    expect(makePayloadConformanceRuntime).toBeTypeOf("function");
    expect(new UnsupportedPayloadCapability("probe")).toBeInstanceOf(Error);
  }));
