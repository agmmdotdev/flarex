import {
  defineMedusaFetchHttpRuntime,
  type MedusaFetchHttpRuntimeOptions,
} from "@medusajs/medusa/static/fetch-http-handler"
import { medusaStaticHttpProofManifest } from "@medusajs/medusa/static/http-proof-manifest"
import { staticHttpProofManifest } from "./manifest"
import {
  commitStaticHttpProofSession,
  createStaticHttpProofRequestScope,
  createStaticHttpProofSession,
  handleStaticHttpProofSetupRequest,
  isStaticHttpProofSetupPath,
  prepareStaticHttpProofRequest,
  staticHttpProofResourcesAfterManifest,
  staticHttpProofResourcesBeforeManifest,
} from "./resources"

export const staticHttpProofRuntimeOptions =
  defineMedusaFetchHttpRuntime({
    additionalManifests: [
      staticHttpProofManifest,
      medusaStaticHttpProofManifest,
    ],
    resourcesBeforeManifest: [staticHttpProofResourcesBeforeManifest],
    resourcesAfterManifest: [staticHttpProofResourcesAfterManifest],
    createRequestScope: createStaticHttpProofRequestScope,
    createSession: createStaticHttpProofSession,
    commitSession: commitStaticHttpProofSession,
    handleSetupRequest: handleStaticHttpProofSetupRequest,
    isSetupPath: isStaticHttpProofSetupPath,
    prepareRequest: prepareStaticHttpProofRequest,
  }) satisfies MedusaFetchHttpRuntimeOptions
