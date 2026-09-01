import {
  CreatePriceListDTO,
  CreatePriceListRuleDTO,
  IPricingModuleService,
} from "@medusajs/framework/types"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"


moduleIntegrationTestRunner<IPricingModuleService>({
  moduleName: Modules.PRICING,
  testSuite: ({ service }) => {
    describe("PriceListRule Service", () => {
      beforeEach(async () => {
        await seedPriceListRuleData(service)
      })

      describe("list", () => {
        it("should list priceListRules", async () => {
          const priceListRuleResult = await service.listPriceListRules()

          expect(priceListRuleResult).toEqual([
            expect.objectContaining({
              id: "price-list-rule-1",
            }),
            expect.objectContaining({
              id: "price-list-rule-2",
            }),
          ])
        })

        it("should list priceListRules by pricelist id", async () => {
          const priceListRuleResult = await service.listPriceListRules({
            id: ["price-list-rule-1"],
          })

          expect(priceListRuleResult).toEqual([
            expect.objectContaining({
              id: "price-list-rule-1",
            }),
          ])
        })
      })

      describe("listAndCount", () => {
        it("should return pricelistrules and count", async () => {
          const [priceListRuleResult, count] =
            await service.listAndCountPriceListRules()

          expect(count).toEqual(2)
          expect(priceListRuleResult).toEqual([
            expect.objectContaining({
              id: "price-list-rule-1",
            }),
            expect.objectContaining({
              id: "price-list-rule-2",
            }),
          ])
        })

        it("should return pricelistrules and count when filtered", async () => {
          const [priceListRuleResult, count] =
            await service.listAndCountPriceListRules({
              id: ["price-list-rule-1"],
            })

          expect(count).toEqual(1)
          expect(priceListRuleResult).toEqual([
            expect.objectContaining({
              id: "price-list-rule-1",
            }),
          ])
        })

        it("should return pricelistrules and count when using skip and take", async () => {
          const [priceListRuleResult, count] =
            await service.listAndCountPriceListRules({}, { skip: 1, take: 1 })

          expect(count).toEqual(2)
          expect(priceListRuleResult).toEqual([
            expect.objectContaining({
              id: "price-list-rule-2",
            }),
          ])
        })

        it("should return requested fields", async () => {
          const [priceListRuleResult, count] =
            await service.listAndCountPriceListRules(
              {},
              {
                take: 1,
                select: ["id"],
              }
            )

          const serialized = JSON.parse(JSON.stringify(priceListRuleResult))

          expect(count).toEqual(2)
          expect(serialized).toEqual([
            {
              id: "price-list-rule-1",
            },
          ])
        })
      })

      describe("retrieve", () => {
        const id = "price-list-rule-1"

        it("should return priceList for the given id", async () => {
          const priceListRuleResult = await service.retrievePriceListRule(id)

          expect(priceListRuleResult).toEqual(
            expect.objectContaining({
              id,
            })
          )
        })

        it("should throw an error when priceListRule with id does not exist", async () => {
          let error

          try {
            await service.retrievePriceListRule("does-not-exist")
          } catch (e) {
            error = e
          }

          expect(error.message).toEqual(
            "PriceListRule with id: does-not-exist was not found"
          )
        })

        it("should throw an error when a id is not provided", async () => {
          let error

          try {
            // @ts-expect-error intentionally validates runtime handling for a missing id.
            await service.retrievePriceListRule(undefined)
          } catch (e) {
            error = e
          }

          expect(error.message).toEqual("priceListRule - id must be defined")
        })
      })

      describe("delete", () => {
        const id = "price-list-rule-1"

        it("should delete the pricelists given an id successfully", async () => {
          await service.deletePriceListRules([id])

          const priceListResult = await service.listPriceListRules({
            id: [id],
          })

          expect(priceListResult).toHaveLength(0)
        })
      })

      describe("setPriceListRules", () => {
        it("should add a price list rule to a price list", async () => {
          await service.setPriceListRules({
            price_list_id: "price-list-1",
            rules: {
              sales_channel: "sc-1",
            },
          })

          const [priceList] = await service.listPriceLists(
            { id: ["price-list-1"] },
            {
              relations: ["price_list_rules"],
            }
          )

          expect(priceList.price_list_rules).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                attribute: "sales_channel",
                value: "sc-1",
              }),
            ])
          )
        })

        it("should multiple priceListRules to a priceList", async () => {
          await service.setPriceListRules({
            price_list_id: "price-list-1",
            rules: {
              sales_channel: ["sc-1", "sc-2"],
            },
          })

          const [priceList] = await service.listPriceLists(
            {
              id: ["price-list-1"],
            },
            {
              relations: ["price_list_rules"],
            }
          )

          expect(priceList.price_list_rules).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                attribute: "sales_channel",
                value: ["sc-1", "sc-2"],
              }),
            ])
          )
        })
      })

      describe("removePriceListRules", () => {
        it("should remove a priceListRule from a priceList", async () => {
          await service.removePriceListRules({
            price_list_id: "price-list-1",
            rules: ["currency_code"],
          })

          const [priceList] = await service.listPriceLists(
            {
              id: ["price-list-1"],
            },
            {
              relations: ["price_list_rules"],
            }
          )

          expect(priceList.price_list_rules).toEqual([
            expect.objectContaining({ attribute: "region_id" }),
          ])
        })
      })
    })
  },
})

type SeedPriceListDTO = CreatePriceListDTO & {
  id: string
  rules_count: number
}

type SeedPriceListRuleDTO = CreatePriceListRuleDTO & {
  id: string
  attribute: string
  value: string[]
}

async function seedPriceListRuleData(service: IPricingModuleService) {
  const priceLists: SeedPriceListDTO[] = [
    {
      id: "price-list-1",
      title: "Price List 1",
      description: "test",
      rules_count: 0,
    },
    {
      id: "price-list-2",
      title: "Price List 2",
      description: "test",
      rules_count: 0,
    },
  ]

  await service.createPriceLists(priceLists)

  const priceListRules: SeedPriceListRuleDTO[] = [
    {
      id: "price-list-rule-1",
      price_list_id: "price-list-1",
      attribute: "currency_code",
      value: [],
    },
    {
      id: "price-list-rule-2",
      price_list_id: "price-list-1",
      attribute: "region_id",
      value: [],
    },
  ]

  await service.createPriceListRules(priceListRules)
}

