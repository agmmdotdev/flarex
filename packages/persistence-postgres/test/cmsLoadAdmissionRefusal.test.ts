import { Cause } from "effect";
import { expect, it } from "vitest";
import { CmsTransactionError } from "../src/cmsTransaction/model";
import { ScopeAuthorizationRevocationEpochPersistenceError } from "../src/scopeClock";
import { assertCmsLoadAdmissionRefusal } from "./cmsExecutionLoadScenario";

const scopeFailure = (
  code: string,
  operation: ScopeAuthorizationRevocationEpochPersistenceError["operation"] = "lockForOrdinaryWrite",
) =>
  Cause.fail(
    new CmsTransactionError({
      reason: "invalidAuthority",
      cause: new ScopeAuthorizationRevocationEpochPersistenceError({
        operation,
        cause: { code },
      }),
    }),
  );
const resourceFailure = (
  code: string,
  reason: CmsTransactionError["reason"] = "resourceFailure",
) => Cause.fail(new CmsTransactionError({ reason, cause: { code } }));

it.each(["55P03", "57014"])(
  "recognizes the scope admission deadline %s and its drain failure",
  (code) => {
    expect(() =>
      assertCmsLoadAdmissionRefusal(scopeFailure(code)),
    ).not.toThrow();
    expect(() =>
      assertCmsLoadAdmissionRefusal(
        Cause.combine(scopeFailure(code), resourceFailure(code)),
      ),
    ).not.toThrow();
  },
);

it.each([
  ["unowned SQLSTATE", resourceFailure("57014")],
  ["different scope operation", scopeFailure("57014", "update")],
  ["different SQLSTATE", scopeFailure("XX000")],
  [
    "mixed resource failure",
    Cause.combine(scopeFailure("57014"), resourceFailure("08006")),
  ],
  [
    "uncertain decision",
    Cause.combine(
      scopeFailure("57014"),
      resourceFailure("57014", "decisionUncertain"),
    ),
  ],
  [
    "defect",
    Cause.combine(scopeFailure("57014"), Cause.die(new Error("defect"))),
  ],
  ["interruption", Cause.combine(scopeFailure("57014"), Cause.interrupt())],
  ["empty cause", Cause.empty],
] as const)(
  "rejects %s despite any accompanying admission failure",
  (_name, cause) => {
    expect(() => assertCmsLoadAdmissionRefusal(cause)).toThrow();
  },
);
