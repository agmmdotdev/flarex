import { Effect } from "effect";
import { expect, it } from "vitest";
import type { Json } from "flarex-protocol/json";
import { cmsLimits } from "../src/cmsTransaction/model";
import { captureCurrencyAnnouncementRequest } from "../src/crossDomainCommand/request";

const key = "composite/00000000-0000-0000-0000-000000000000";

it("retains a detached frozen request for both replay evidence and participant arguments", () => {
  const args = {
    currency: { code: "usd" },
    cms: { data: { title: "announcement" } },
    application: {},
  };
  const request = Effect.runSync(captureCurrencyAnnouncementRequest(key, args));
  args.currency.code = "eur";
  args.cms.data.title = "changed";
  expect(request.argumentsValue).toEqual({
    currency: { code: "usd" },
    cms: { data: { title: "announcement" } },
    application: {},
  });
  expect(request.argumentsValue).toBe(request.captured.value);
  expect(Object.isFrozen(request.argumentsValue.currency)).toBe(true);
  expect(Object.isFrozen(request.argumentsValue.cms.data)).toBe(true);
  expect(Reflect.set(request.argumentsValue.currency, "code", "gbp")).toBe(
    false,
  );
});

it.each<Json>([
  null,
  [],
  {},
  { currency: {}, cms: {} },
  { currency: {}, cms: {}, application: {}, extra: null },
  ...["currency", "cms", "application"].flatMap((field) =>
    [null, [], "invalid"].map((value) => ({
      currency: {},
      cms: {},
      application: {},
      [field]: value,
    })),
  ),
])("refuses malformed command envelopes: %j", (args) => {
  expect(
    Effect.runSync(Effect.flip(captureCurrencyAnnouncementRequest(key, args))),
  ).toMatchObject({ _tag: "CompositeCommandError", reason: "invalidInput" });
});

it("captures without invoking getters and preserves capture-before-key error order", () => {
  let getterCalls = 0;
  const args = {
    currency: {},
    cms: {},
    get application() {
      getterCalls++;
      return {};
    },
  };
  expect(
    Effect.runSync(Effect.flip(captureCurrencyAnnouncementRequest(key, args))),
  ).toMatchObject({ reason: "invalidInput" });
  expect(getterCalls).toBe(0);
  expect(
    Effect.runSync(
      Effect.flip(
        captureCurrencyAnnouncementRequest("invalid-key", {
          currency: {},
          cms: {},
          application: { text: "x".repeat(cmsLimits.commandBytes + 1) },
        }),
      ),
    ),
  ).toMatchObject({ reason: "limitExceeded" });
});

it.each(["", "cms/00000000-0000-0000-0000-000000000000", "composite/short"])(
  "preserves private request-key refusal: %s",
  (requestKey) => {
    expect(
      Effect.runSync(
        Effect.flip(
          captureCurrencyAnnouncementRequest(requestKey, {
            currency: {},
            cms: {},
            application: {},
          }),
        ),
      ),
    ).toMatchObject({ reason: "invalidInput" });
  },
);
