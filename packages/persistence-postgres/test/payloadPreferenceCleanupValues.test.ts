import { expect, it } from "vitest";
import { consumePayloadPreferenceCleanup } from "../src/payloadPreferences/cleanup";
import { requireCmsPendingDeletion } from "../src/cmsTransaction/documents";
import { runEffectFailure } from "./effectTestRuntime";

it("rejects structural cleanup receipt and pending-deletion forgeries", async () => {
  // @ts-expect-error Negative authority proof: structural data carries none of the private brands.
  expect(await runEffectFailure(consumePayloadPreferenceCleanup({}, {}, {}))).toMatchObject({ reason: "invalidAuthority" });
  // @ts-expect-error Negative authority proof: a document ID and forged working set grant no authority.
  expect(await runEffectFailure(requireCmsPendingDeletion({}, {}, {}, "pretend-post"))).toMatchObject({ reason: "invalidAuthority" });
});
