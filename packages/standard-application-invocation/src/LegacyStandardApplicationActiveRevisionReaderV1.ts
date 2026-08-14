import {
  readActiveApplicationRevisionV1,
  type ApplicationRevisionActivationContextV1,
} from
  "@flarex/persistence-postgres/internal/system-test/application-revision-activation-v1";
import { Context, Effect, Layer } from "effect";

export interface LegacyStandardApplicationActiveRevisionReaderV1Api {
  readonly read: ReturnType<typeof makeRead>;
}

export class LegacyStandardApplicationActiveRevisionReaderV1 extends Context.Service<
  LegacyStandardApplicationActiveRevisionReaderV1,
  LegacyStandardApplicationActiveRevisionReaderV1Api
>()(
  "flarex/standard-application-invocation/LegacyStandardApplicationActiveRevisionReaderV1",
) {}

export function makeLegacyStandardApplicationActiveRevisionReaderV1Layer(
  context: ApplicationRevisionActivationContextV1,
): Layer.Layer<LegacyStandardApplicationActiveRevisionReaderV1> {
  return Layer.succeed(
    LegacyStandardApplicationActiveRevisionReaderV1,
    LegacyStandardApplicationActiveRevisionReaderV1.of({
      read: makeRead(context),
    }),
  );
}

function makeRead(context: ApplicationRevisionActivationContextV1) {
  return Effect.fn("LegacyStandardApplicationActiveRevisionReader.read")(
    () => readActiveApplicationRevisionV1(context),
  )();
}
