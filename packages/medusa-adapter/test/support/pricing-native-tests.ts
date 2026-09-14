import { expect, it } from "vitest";
import type { CreatePriceSetDTO, FilterablePriceSetProps, FindConfig, PriceSetDTO } from "@medusajs/framework/types";
export interface NativePriceSet { readonly id: string; readonly prices?: readonly object[] }
export interface NativePricingTestService {
  createPriceSets(data: CreatePriceSetDTO[]): Promise<readonly NativePriceSet[]>;
  listPriceSets(filters?: FilterablePriceSetProps): Promise<readonly NativePriceSet[]>;
  retrievePriceSet(id: string, config?: FindConfig<PriceSetDTO>): Promise<NativePriceSet>;
}
// The pinned seed supplies the native Price title omitted by its public DTO.
// This is a type-only correction; the guarded seed statements are unchanged.
type SeedPriceSetDTO = Omit<CreatePriceSetDTO, "prices"> & { id: string;
  prices?: Array<NonNullable<CreatePriceSetDTO["prices"]>[number] & { title?: string }> };
/** Three complete native bodies and the real seed; the promotion guard compares executable ASTs. */
export function registerNativePricingTests(service: NativePricingTestService) {
it("should create a price set with prices", async () => {
          const [priceSet] = await service.createPriceSets([
            {
              prices: [
                {
                  amount: 100,
                  currency_code: "USD",
                  rules: {
                    region_id: "1",
                  },
                },
                {
                  amount: 150,
                  currency_code: "USD",
                },
              ],
            },
          ])

          expect(priceSet).toEqual(
            expect.objectContaining({
              prices: expect.arrayContaining([
                expect.objectContaining({
                  amount: 100,
                  currency_code: "USD",
                }),
                expect.objectContaining({
                  amount: 150,
                  currency_code: "USD",
                }),
              ]),
            })
          )
        })
it("should create a priceSet successfully", async () => {
          const priceSets: SeedPriceSetDTO[] = [
            {
              id: "price-set-new",
            },
          ]

          await service.createPriceSets(priceSets)

          const [priceSet] = await service.listPriceSets({
            id: ["price-set-new"],
          })

          expect(priceSet).toEqual(
            expect.objectContaining({
              id: "price-set-new",
            })
          )
        })
it("should take the later price when passing two prices with equivalent rules", async () => {
          const priceSets: SeedPriceSetDTO[] = [
            {
              id: "price-set-new",
              prices: [
                {
                  amount: 100,
                  currency_code: "USD",
                  rules: { region_id: "1234" },
                },
                {
                  amount: 200,
                  currency_code: "USD",
                  rules: { region_id: "1234" },
                },
              ],
            },
          ]

          await service.createPriceSets(priceSets)

          const priceSet = await service.retrievePriceSet("price-set-new", {
            relations: ["prices", "prices.price_rules"],
          })

          expect(priceSet.prices).toEqual([
            expect.objectContaining({
              amount: 200,
              currency_code: "USD",
              price_rules: [
                expect.objectContaining({
                  attribute: "region_id",
                  value: "1234",
                }),
              ],
            }),
          ])
        })
}
export async function seedPriceSetData(service: NativePricingTestService) {
  const priceSets: SeedPriceSetDTO[] = [
    {
      id: "price-set-1",
      prices: [
        {
          id: "price-set-money-amount-USD",
          currency_code: "USD",
          amount: 500,
          title: "price set money amount USD",
          rules: {
            currency_code: "USD",
          },
        },
      ],
    },
    {
      id: "price-set-2",
      prices: [
        {
          id: "price-set-money-amount-EUR",
          currency_code: "EUR",
          amount: 400,
          title: "price set money amount EUR",
          rules: {
            region_id: "region_1",
          },
        },
      ],
    },
    {
      id: "price-set-3",
      prices: [
        {
          id: "price-set-money-amount-CAD",
          currency_code: "CAD",
          amount: 600,
          title: "price set money amount CAD",
        },
      ],
    },
  ]

  await service.createPriceSets(priceSets)
}
