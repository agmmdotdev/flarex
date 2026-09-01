import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { resolve } from "path"
import type {
  IAnalyticsModuleService,
  ProviderIdentifyAnalyticsEventDTO,
  ProviderTrackAnalyticsEventDTO,
} from "@medusajs/types"

interface AnalyticsProviderFixture {
  identify(data: ProviderIdentifyAnalyticsEventDTO): Promise<void>
  track(data: ProviderTrackAnalyticsEventDTO): Promise<void>
}

interface AnalyticsProviderFixtureConstructor {
  readonly prototype: AnalyticsProviderFixture
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isAnalyticsProviderFixtureConstructor(
  value: unknown
): value is AnalyticsProviderFixtureConstructor {
  return (
    typeof value === "function" &&
    "prototype" in value &&
    isRecord(value.prototype) &&
    typeof value.prototype.identify === "function" &&
    typeof value.prototype.track === "function"
  )
}

// Use Node's module cache so the spy observes the exact class loaded by
// Medusa's CommonJS provider loader.
const providerFixtureModule: unknown = require("../__fixtures__/providers/default-provider.js")

if (
  !isRecord(providerFixtureModule) ||
  !isAnalyticsProviderFixtureConstructor(
    providerFixtureModule.AnalyticsProviderServiceFixtures
  )
) {
  throw new Error("Invalid Analytics provider fixture module.")
}

const { AnalyticsProviderServiceFixtures } = providerFixtureModule

jest.setTimeout(100000)

const moduleOptions = {
  providers: [
    {
      resolve: resolve(
        process.cwd() +
          "/integration-tests/__fixtures__/providers/default-provider.js"
      ),
      id: "default-provider",
    },
  ],
}

moduleIntegrationTestRunner<IAnalyticsModuleService>({
  moduleName: Modules.ANALYTICS,
  moduleOptions: moduleOptions,
  testSuite: ({ service }) => {
    describe("Analytics Module Service", () => {
      let spies: {
        track: jest.SpyInstance
        identify: jest.SpyInstance
      }

      beforeAll(async () => {
        spies = {
          track: jest.spyOn(
            AnalyticsProviderServiceFixtures.prototype,
            "track"
          ),
          identify: jest.spyOn(
            AnalyticsProviderServiceFixtures.prototype,
            "identify"
          ),
        }
      })

      afterEach(async () => {
        jest.clearAllMocks()
      })

      it("should call the provider's track method", async () => {
        await service.track({
          event: "test-event",
          actor_id: "test-user",
          properties: {
            test: "test",
          },
        })

        expect(spies.track).toHaveBeenCalledWith({
          event: "test-event",
          actor_id: "test-user",
          properties: {
            test: "test",
          },
        })
      })

      it("should call the provider's identify method to identify an actor", async () => {
        await service.identify({
          actor_id: "test-user",
          properties: {
            test: "test",
          },
        })

        expect(spies.identify).toHaveBeenCalledWith({
          actor_id: "test-user",
          properties: {
            test: "test",
          },
        })
      })

      it("should call the provider's identify method to identify a group", async () => {
        await service.identify({
          group: {
            type: "organization",
            id: "test-organization",
          },
          properties: {
            test: "test",
          },
        })

        expect(spies.identify).toHaveBeenCalledWith({
          group: {
            type: "organization",
            id: "test-organization",
          },
          properties: {
            test: "test",
          },
        })
      })
    })
  },
})
