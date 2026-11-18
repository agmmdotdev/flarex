import { expect, it } from "vitest";
import { applyPayloadPreferenceCleanup } from "../../../src/frameworks/payloadPreferences/cleanup";
import { requireCmsPendingDeletion, requireCmsClosedPendingDeletion } from "../../../src/frameworks/cmsTransaction/documents";
import { runEffectFailure } from "../../support/effectTestRuntime";

it("rejects structural cleanup receipt and pending-deletion forgeries", async () => {
  // @ts-expect-error Negative authority proof: structural data carries none of the private brands.
  expect(await runEffectFailure(applyPayloadPreferenceCleanup({}, {}, {}, {}))).toMatchObject({ reason: "invalidAuthority" });
  // @ts-expect-error Negative authority proof: a document ID and forged working set grant no authority.
  expect(await runEffectFailure(requireCmsPendingDeletion({}, {}, {}, "pretend-post"))).toMatchObject({ reason: "invalidAuthority" });
  // @ts-expect-error Negative authority proof: settlement requires the exact consumed closure.
  expect(await runEffectFailure(requireCmsClosedPendingDeletion({}, {}, {}, "pretend-post"))).toMatchObject({ reason: "invalidAuthority" });
});
