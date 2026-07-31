import { Effect } from "effect";
import type {
  DeclarativeV2RuntimeArtifactObjectKindV1,
} from "flarex-protocol/internal/declarative-v2-runtime-projection-v1";

import {
  makeDeclarativeV2RuntimeArtifactR2StoreV1,
  type DeclarativeV2RuntimeArtifactR2BucketV1,
} from "../../flarex-backend/src/artifactRuntime/DeclarativeV2RuntimeArtifactStore";
import { makeLiveDeclarativeV2RuntimeArtifactSha256V1 } from "../../flarex-backend/src/artifactRuntime/DeclarativeV2RuntimeArtifactSha256";
import {
  CandidateRuntimeArtifactPublicationV1Error,
  type CandidateRuntimeArtifactPublisherV1,
} from "../src/candidateRuntimeProjectionV1";

const R2_BUDGET = Object.freeze({
  maximumBodyBytes: 64 * 1_048_576,
  maximumHashBytes: 64 * 1_048_576,
});

export interface RuntimeArtifactPublisherFixtureV1 {
  readonly publisher: CandidateRuntimeArtifactPublisherV1;
  readonly store: ReturnType<typeof makeDeclarativeV2RuntimeArtifactR2StoreV1>;
  readonly bodies: ReadonlyMap<string, Uint8Array>;
}

export function makeRuntimeArtifactPublisherFixtureV1():
  RuntimeArtifactPublisherFixtureV1 {
  const bucket = new MemoryRuntimeArtifactR2BucketV1();
  const store = makeDeclarativeV2RuntimeArtifactR2StoreV1(
    bucket,
    makeLiveDeclarativeV2RuntimeArtifactSha256V1(),
  );
  const publisher: CandidateRuntimeArtifactPublisherV1 = Object.freeze({
    putImmutable: (
      kind: DeclarativeV2RuntimeArtifactObjectKindV1,
      digest: Uint8Array,
      canonicalBytes: Uint8Array,
    ) => store.putImmutable(kind, digest, canonicalBytes, R2_BUDGET).pipe(
      Effect.mapError(error =>
        new CandidateRuntimeArtifactPublicationV1Error({
          operation: "putImmutable",
          reason: error._tag.includes("Corruption")
            ? "corruption"
            : error._tag.includes("SettlementUncertain")
              ? "settlementUncertain"
              : error._tag.includes("Input")
                ? "invalidInput"
                : "resource",
          kind,
        })
      ),
    ),
  });
  return Object.freeze({ publisher, store, bodies: bucket.objects });
}

class MemoryRuntimeArtifactR2BucketV1
  implements DeclarativeV2RuntimeArtifactR2BucketV1 {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, value: ArrayBuffer): Promise<unknown> {
    if (!this.objects.has(key)) {
      this.objects.set(key, new Uint8Array(value.slice(0)));
    }
    return null;
  }

  async get(key: string): Promise<unknown> {
    const bytes = this.objects.get(key);
    if (bytes === undefined) return null;
    const captured = new Uint8Array(bytes);
    return {
      size: captured.byteLength,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(captured);
          controller.close();
        },
      }),
    };
  }
}
