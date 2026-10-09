import { Schema } from "effect";

/** Source-controlled defaults for bounded framework execution. These are
 * distinct from Application protocol ceilings and migration/recovery policy.
 * Millisecond fields describe different phases; changing one does not extend
 * another. Trusted per-host selections are captured at host construction. */
export const frameworkTransactionTimeouts = Object.freeze({
  commandMs: 10_000,
  statementMs: 1_000,
  lockMs: 500,
  cleanupMs: 2_000,
});

const frameworkRequestDefaults = Object.freeze({
  calls: 64,
  commandBytes: 1_048_576,
  valueBytes: 65_536,
});

export const cmsLimits = Object.freeze({
  calls: frameworkRequestDefaults.calls,
  pageRows: 32,
  identities: 256,
  documentBytes: frameworkRequestDefaults.valueBytes,
  commandBytes: frameworkRequestDefaults.commandBytes,
  ...frameworkTransactionTimeouts,
});

/** Trusted per-host reductions; document/page bounds remain storage contracts. */
const CmsRequestBudget = Schema.Struct({
  calls: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: cmsLimits.calls })),
  commandBytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: cmsLimits.commandBytes })),
});
export type CmsRequestBudget = typeof CmsRequestBudget.Type;
export const defaultCmsRequestBudget: CmsRequestBudget = Object.freeze({
  calls: cmsLimits.calls, commandBytes: cmsLimits.commandBytes,
});
export const decodeCmsRequestBudget = Schema.decodeUnknownResult(CmsRequestBudget, { onExcessProperty: "error" });

/** Shared predicate complexity, independently bounded from rows returned. */
export const relationalReadLimits = Object.freeze({ filterNodes: 64, filterDepth: 8, filterOperands: 256 });

export const commerceLimits = Object.freeze({
  commandDefinitions: 128,
  catalogRows: 256,
  ...relationalReadLimits,
  calls: frameworkRequestDefaults.calls,
  rowBytes: frameworkRequestDefaults.valueBytes,
  commandBytes: frameworkRequestDefaults.commandBytes,
  ...frameworkTransactionTimeouts,
});

/** Retained scalar relational profile; not the generic logical-storage limits. */
export const relationalLimits = Object.freeze({
  calls: frameworkRequestDefaults.calls,
  page: 32,
  rows: 256,
  columns: 16,
  rowBytes: frameworkRequestDefaults.valueBytes,
  commandBytes: frameworkRequestDefaults.commandBytes,
  ...frameworkTransactionTimeouts,
});

/** Supported trusted selections, not the defaults granted to every request. */
export const frameworkEventMessageLimit = 2048;
export const commerceResourceCeilings = Object.freeze({
  catalogRows: 4096, queryRows: 4096, writeBatchRows: 2048,
  facts: 4096, calls: 4096, eventMessages: frameworkEventMessageLimit, eventIds: 4096,
  commandBytes: 16_777_216, valueNodes: 131_072,
});
export const maximumFrameworkCommandMs = 30_000;

export const CommerceCallLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: commerceResourceCeilings.calls }));
export const CommerceCommandByteLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: commerceResourceCeilings.commandBytes }));
/** Extended command deadlines are admitted only for logical atomic commands. */
export const FrameworkCommandMilliseconds = Schema.Int.check(Schema.isBetween({
  minimum: frameworkTransactionTimeouts.commandMs, maximum: maximumFrameworkCommandMs,
}));
