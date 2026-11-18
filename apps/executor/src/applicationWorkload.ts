import { CoreSchemaWorkBudgetSchema, CoreSchemaWorkerOptionsSchema } from
  "@flarex/persistence-postgres/internal/core";
import { CoreApplicationAdmissionConfigurationSchema } from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { Schema } from "effect";

const NonnegativeCount = Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0
  ? undefined : "Expected a nonnegative safe count"));

/** Operator-owned memory, work and admission limits, validated before pool allocation. */
export const ApplicationDurableObjectWorkloadSchema = Schema.Struct({
  indexCache: Schema.Struct({ maxBytes: NonnegativeCount,
    verifyPercent: NonnegativeCount.check(Schema.isLessThanOrEqualTo(100)) }),
  operationCacheMaxBytes: NonnegativeCount,
  schemaWorker: CoreSchemaWorkerOptionsSchema,
  schemaScheduler: Schema.Struct({ work: CoreSchemaWorkBudgetSchema,
    wakeDelayMilliseconds: NonnegativeCount.check(Schema.isGreaterThan(0)),
    continuationDelayMilliseconds: NonnegativeCount.check(Schema.isGreaterThan(0)) }),
  admission: CoreApplicationAdmissionConfigurationSchema,
  maxRequests: NonnegativeCount.check(Schema.isGreaterThan(0)),
});
export type ApplicationDurableObjectWorkload = typeof ApplicationDurableObjectWorkloadSchema.Type;
const decodeWorkload = Schema.decodeUnknownSync(ApplicationDurableObjectWorkloadSchema);

export function captureApplicationDurableObjectWorkload(input: unknown): ApplicationDurableObjectWorkload {
  const decoded = decodeWorkload(input);
  return Object.freeze({ ...decoded,
    indexCache: Object.freeze({ ...decoded.indexCache }),
    schemaWorker: Object.freeze({ ...decoded.schemaWorker }),
    schemaScheduler: Object.freeze({ ...decoded.schemaScheduler, work: Object.freeze({ ...decoded.schemaScheduler.work }) }),
    admission: Object.freeze({ ...decoded.admission,
      query: Object.freeze({ ...decoded.admission.query }), mutation: Object.freeze({ ...decoded.admission.mutation }) }),
  });
}
