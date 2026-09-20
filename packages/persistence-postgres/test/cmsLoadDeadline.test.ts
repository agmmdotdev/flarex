import { Cause } from "effect";
import { expect, it } from "vitest";
import { CmsTransactionError } from "../src/cmsTransaction/model";
import { ScopeAuthorizationRevocationEpochPersistenceError } from "../src/scopeClock";
import { assertCmsLoadDeadline } from "./cmsExecutionLoadScenario";

const scopeFailure = (
  code: string,
  operation: ScopeAuthorizationRevocationEpochPersistenceError["operation"] = "lockForSnapshotRead",
  reason: CmsTransactionError["reason"] = "invalidAuthority",
) =>
  Cause.fail(
    new CmsTransactionError({
      reason,
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
    expect(assertCmsLoadDeadline(scopeFailure(code))).toBe("admission");
    expect(
      assertCmsLoadDeadline(
        Cause.combine(scopeFailure(code), resourceFailure(code)),
      ),
    ).toBe("admission");
    const publication = scopeFailure(code, "lockForOrdinaryWrite", "statementFailure");
    expect(assertCmsLoadDeadline(publication)).toBe("publication");
    expect(assertCmsLoadDeadline(Cause.combine(publication, resourceFailure(code)))).toBe("publication");
  },
);

it.each([
  ["unowned SQLSTATE", resourceFailure("57014")],
  ["different scope operation", scopeFailure("57014", "update")],
  ["old pre-execution publication assumption", scopeFailure("57014", "lockForOrdinaryWrite")],
  ["publication reason on admission", scopeFailure("57014", "lockForSnapshotRead", "statementFailure")],
  ["multiple primary owners", Cause.combine(scopeFailure("57014"), scopeFailure("57014", "lockForOrdinaryWrite", "statementFailure"))],
  ["unowned publication failure", resourceFailure("57014", "statementFailure")],
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
    expect(() => assertCmsLoadDeadline(cause)).toThrow();
  },
);
