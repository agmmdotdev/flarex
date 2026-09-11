import { Effect } from "effect";
import { expect, it } from "vitest";
import { payloadScalarFields } from "@flarex/payload-adapter/internal/contract";
import { compilePayloadCollections } from "@flarex/payload-adapter/internal/collections";
import {
  makePayloadContentProfiles,
  payloadPostsCollection,
} from "@flarex/payload-adapter/internal/profile";
import { makePayloadRuntime } from "@flarex/payload-adapter/internal/runtime";
import { makePayloadConformanceRuntime, UnsupportedPayloadCapability } from "@flarex/payload-adapter/internal/testing";

it("resolves every declared private package subpath", () =>
  Effect.runPromise(makePayloadContentProfiles()).then((profiles) => {
    expect(Object.isFrozen(profiles)).toBe(true);
    expect(payloadPostsCollection().slug).toBe("posts");
    expect(payloadScalarFields).toHaveLength(6);
    expect(makePayloadRuntime).toBeTypeOf("function");
    expect(compilePayloadCollections).toBeTypeOf("function");
    expect(makePayloadConformanceRuntime).toBeTypeOf("function");
    expect(new UnsupportedPayloadCapability("probe")).toBeInstanceOf(Error);
  }));
