import {
  CreatePriceRuleDTO,
  CreatePriceSetDTO,
  IPricingModuleService,
} from "@medusajs/framework/types"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"


moduleIntegrationTestRunner<IPricingModuleService>({
  moduleName: Modules.PRICING,
  testSuite: ({ service }) => {
    describe("PricingModule Service - PriceRule", () => {
      beforeEach(async () => {
        await seedPriceRuleData(service)
      })

      describe("list", () => {
        it("should list priceRules", async () => {
          const PriceRulesResult = await service.listPriceRules()
          const serialized = JSON.parse(JSON.stringify(PriceRulesResult))

          expect(serialized).toEqual([
            expect.objectContaining({
              id: "price-rule-1",
            }),
            expect.objectContaining({
              id: "price-rule-2",
            }),
          ])
        })

        it("should list priceRules by id", async () => {
          const priceRuleResult = await service.listPriceRules({
            id: ["price-rule-1"],
          })

          expect(priceRuleResult).toEqual([
            expect.objectContaining({
              id: "price-rule-1",
            }),
          ])
        })

        it("should list priceRules with relations and selects", async () => {
          const priceRulesResult = await service.listPriceRules(
            {
              id: ["price-rule-1"],
            },
            {
              select: ["id", "price.id"],
              relations: ["price"],
            }
          )

          const serialized = JSON.parse(JSON.stringify(priceRulesResult))

          expect(serialized).toEqual([
            {
              id: "price-rule-1",
              price: {
                id: "price-set-money-amount-USD",
              },
              price_id: "price-set-money-amount-USD",
            },
          ])
        })

        describe("listAndCount", () => {
          it("should return priceRules and count", async () => {
            const [priceRulesResult, count] =
              await service.listAndCountPriceRules()

            expect(count).toEqual(2)
            expect(priceRulesResult).toEqual([
              expect.objectContaining({
                id: "price-rule-1",
              }),
              expect.objectContaining({
                id: "price-rule-2",
              }),
            ])
          })

          it("should return priceRules and count when filtered", async () => {
            const [priceRulesResult, count] =
              await service.listAndCountPriceRules({
                id: ["price-rule-1"],
              })

            expect(count).toEqual(1)
            expect(priceRulesResult).toEqual([
              expect.objectContaining({
                id: "price-rule-1",
              }),
            ])
          })

          it("should list PriceRules with relations and selects", async () => {
            const [PriceRulesResult, count] =
              await service.listAndCountPriceRules(
                {
                  id: ["price-rule-1"],
                },
                {
                  select: ["id", "price.id"],
                  relations: ["price"],
                }
              )

            const serialized = JSON.parse(JSON.stringify(PriceRulesResult))

            expect(count).toEqual(1)
            expect(serialized).toEqual([
              {
                id: "price-rule-1",
                price: {
                  id: "price-set-money-amount-USD",
                },
                price_id: "price-set-money-amount-USD",
              },
            ])
          })

          it("should return PriceRules and count when using skip and take", async () => {
            const [PriceRulesResult, count] =
              await service.listAndCountPriceRules({}, { skip: 1, take: 1 })

            expect(count).toEqual(2)
            expect(PriceRulesResult).toEqual([
              expect.objectContaining({
                id: "price-rule-2",
              }),
            ])
          })

          it("should return requested fields", async () => {
            const [PriceRulesResult, count] =
              await service.listAndCountPriceRules(
                {},
                {
                  take: 1,
                  select: ["id"],
                }
              )

            const serialized = JSON.parse(JSON.stringify(PriceRulesResult))

            expect(count).toEqual(2)
            expect(serialized).toEqual([
              {
                id: "price-rule-1",
              },
            ])
          })
        })

        describe("retrieve", () => {
          const id = "price-rule-1"

          it("should return PriceRule for the given id", async () => {
            const PriceRule = await service.retrievePriceRule(id)

            expect(PriceRule).toEqual(
              expect.objectContaining({
                id,
              })
            )
          })

          it("should throw an error when PriceRule with id does not exist", async () => {
            let error

            try {
              await service.retrievePriceRule("does-not-exist")
            } catch (e) {
              error = e
            }

            expect(error.message).toEqual(
              "PriceRule with id: does-not-exist was not found"
            )
          })

          it("should throw an error when a id is not provided", async () => {
            let error

            try {
              // @ts-expect-error intentionally validates runtime handling for a missing id.
              await service.retrievePriceRule(undefined)
            } catch (e) {
              error = e
            }

            expect(error.message).toEqual("priceRule - id must be defined")
          })

          it("should return PriceRule based on config select param", async () => {
            const PriceRule = await service.retrievePriceRule(id, {
              select: ["id"],
            })

            const serialized = JSON.parse(JSON.stringify(PriceRule))

            expect(serialized).toEqual({
              id,
            })
          })
        })

        describe("delete", () => {
          const id = "price-set-1"

          it("should delete the PriceRules given an id successfully", async () => {
            await service.deletePriceRules([id])

            const PriceRules = await service.listPriceRules({
              id: [id],
            })

            expect(PriceRules).toHaveLength(0)
          })
        })

        describe("update", () => {
          const id = "price-set-1"

          it("should throw an error when a id does not exist", async () => {
            let error

            try {
              await service.updatePriceRules([
                {
                  id: "does-not-exist",
                },
              ])
            } catch (e) {
              error = e
            }

            expect(error.message).toEqual(
              'PriceRule with id "does-not-exist" not found'
            )
          })
        })

        describe("create", () => {
          it("should throw an error when a id does not exist", async () => {
            let error

            try {
              // @ts-expect-error intentionally validates runtime handling for missing id.
              await service.updatePriceRules([
                {
                  random: "does-not-exist",
                },
              ])
            } catch (e) {
              error = e
            }

            expect(error.message).toEqual('PriceRule with id "" not found')
          })

          it("should create a PriceRule successfully", async () => {
            await service.addPrices({
              priceSetId: "price-set-1",
              prices: [
                {
                  id: "price-rule-new-price",
                  currency_code: "EUR",
                  amount: 100,
                },
              ],
            })

            await service.createPriceRules([{
              id: "price-rule-new",
              price_set_id: "price-set-1",
              attribute: "region_id",
              value: "region_1",
              price_list_id: "test",
              price_id: "price-rule-new-price",
            }])

            const [priceRule] = await service.listPriceRules({
              id: ["price-rule-new"],
            })

            expect(priceRule).toEqual(
              expect.objectContaining({
                id: "price-rule-new",
              })
            )
          })
        })
      })
    })
  },
})

type SeedPriceSetDTO = CreatePriceSetDTO & { id: string }
type SeedPriceRuleDTO = CreatePriceRuleDTO & {
  id: string
  price_list_id: string
}

async function seedPriceRuleData(service: IPricingModuleService) {
  const priceSets: SeedPriceSetDTO[] = [
    {
      id: "price-set-1",
    },
    {
      id: "price-set-2",
    },
    {
      id: "price-set-3",
    },
  ]

  await service.createPriceSets(priceSets)

  await service.addPrices([
    {
      priceSetId: "price-set-1",
      prices: [
        {
          id: "price-set-money-amount-USD",
          currency_code: "USD",
          amount: 500,
        },
      ],
    },
    {
      priceSetId: "price-set-2",
      prices: [
        {
          id: "price-set-money-amount-EUR",
          currency_code: "EUR",
          amount: 400,
        },
      ],
    },
    {
      priceSetId: "price-set-3",
      prices: [
        {
          id: "price-set-money-amount-CAD",
          currency_code: "CAD",
          amount: 600,
        },
      ],
    },
  ])

  const priceRules: SeedPriceRuleDTO[] = [
    {
      id: "price-rule-1",
      price_set_id: "price-set-1",
      attribute: "currency_code",
      value: "USD",
      price_list_id: "test",
      price_id: "price-set-money-amount-USD",
    },
    {
      id: "price-rule-2",
      price_set_id: "price-set-2",
      attribute: "region_id",
      value: "region_1",
      price_list_id: "test",
      price_id: "price-set-money-amount-EUR",
    },
  ]

  await service.createPriceRules(priceRules)
}

