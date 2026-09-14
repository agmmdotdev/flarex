import { expect, it, type Mock } from "vitest";
import type { CreateShippingProfileDTO, IEventBusModuleService } from "@medusajs/framework/types";
import { FulfillmentEvents } from "@medusajs/framework/utils/portable";
import { buildExpectedEventMessageShape } from "./shipping-profile-events-fixture";

export interface NativeShippingProfileRow { readonly id: string; readonly name: string; readonly type: string }
export interface NativeShippingProfileTestService {
  createShippingProfiles(data: CreateShippingProfileDTO): Promise<NativeShippingProfileRow>;
  createShippingProfiles(data: CreateShippingProfileDTO[]): Promise<readonly NativeShippingProfileRow[]>;
}
/** The two selected pinned creation/event bodies retain their executable statements. The
 * promotion guard compares them to the complete five-test source island file.
 * Duplicate-message parity and deletion remain explicitly deferred. */
export function registerNativeShippingProfileTests(service: NativeShippingProfileTestService,
  eventBusEmitSpy: Mock<IEventBusModuleService["emit"]>) {
it("should create a new shipping profile", async function () {
            const createData: CreateShippingProfileDTO = {
              name: "test-default-profile",
              type: "default",
            }

            const createdShippingProfile = await service.createShippingProfiles(
              createData
            )

            expect(createdShippingProfile).toEqual(
              expect.objectContaining({
                name: createData.name,
                type: createData.type,
              })
            )

            expect(eventBusEmitSpy.mock.calls[0]![0]).toHaveLength(1)
            expect(eventBusEmitSpy).toHaveBeenCalledWith(
              [
                buildExpectedEventMessageShape({
                  eventName: FulfillmentEvents.SHIPPING_PROFILE_CREATED,
                  action: "created",
                  object: "shipping_profile",
                  data: { id: createdShippingProfile.id },
                }),
              ],
              {
                internal: true,
              }
            )
          })
it("should create multiple new shipping profiles", async function () {
            const createData: CreateShippingProfileDTO[] = [
              {
                name: "test-profile-1",
                type: "default",
              },
              {
                name: "test-profile-2",
                type: "custom",
              },
            ]

            const createdShippingProfiles =
              await service.createShippingProfiles(createData)

            expect(createdShippingProfiles).toHaveLength(2)
            expect(eventBusEmitSpy.mock.calls[0]![0]).toHaveLength(2)

            let i = 0
            for (const data_ of createData) {
              expect(createdShippingProfiles[i]).toEqual(
                expect.objectContaining({
                  name: data_.name,
                  type: data_.type,
                })
              )

              expect(eventBusEmitSpy).toHaveBeenCalledWith(
                expect.arrayContaining([
                  buildExpectedEventMessageShape({
                    eventName: FulfillmentEvents.SHIPPING_PROFILE_CREATED,
                    action: "created",
                    object: "shipping_profile",
                    data: {
                      id: createdShippingProfiles[i]!.id,
                    },
                  }),
                ]),
                {
                  internal: true,
                }
              )

              ++i
            }
          })
}
