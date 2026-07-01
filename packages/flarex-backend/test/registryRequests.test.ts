import { Effect } from "effect";
import { ProtocolValidationError } from "flarex-protocol/registry";
import { describe, expect, it } from "vitest";
import {
  decodeRegistryCreateDeploymentPayload,
} from "../src/registry/Requests";

describe("registry request payloads", () => {
  it("decodes create deployment payloads through the shared source boundary", async () => {
    const payload = {
      deploymentId: "deployment-a",
      slug: "slug-a",
    };

    await expect(Effect.runPromise(decodeRegistryCreateDeploymentPayload(payload)))
      .resolves
      .toEqual(payload);

    await expect(Effect.runPromise(decodeRegistryCreateDeploymentPayload({
      deploymentId: "deployment-b",
    }))).resolves.toEqual({
      deploymentId: "deployment-b",
    });
  });

  it("keeps registry protocol failures typed before route HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeRegistryCreateDeploymentPayload({
      deploymentId: 123,
    }))).rejects.toBeInstanceOf(ProtocolValidationError);

    await expect(Effect.runPromise(decodeRegistryCreateDeploymentPayload({
      slug: 123,
    }))).rejects.toBeInstanceOf(ProtocolValidationError);
  });
});
