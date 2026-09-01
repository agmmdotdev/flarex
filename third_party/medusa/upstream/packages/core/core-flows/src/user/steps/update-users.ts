import type {
  IUserModuleService,
  UpdateUserDTO,
} from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export const updateUsersStepId = "update-users-step"
/**
 * This step updates one or more users.
 *
 * @example
 * const data = updateUsersStep([
 *   {
 *     id: "user_123",
 *     last_name: "Doe",
 *   }
 * ])
 */
export const updateUsersStep = createStep(
  updateUsersStepId,
  async (input: UpdateUserDTO[], { container }) => {
    const service: IUserModuleService = container.resolve(Modules.USER)

    if (!input.length) {
      return new StepResponse([], [])
    }

    const originalUsers = await service.listUsers({
      id: input.map((u) => u.id),
    })

    const users = await service.updateUsers(input)
    return new StepResponse(users, originalUsers)
  },
  async (originalUsers, { container }) => {
    if (!originalUsers?.length) {
      return
    }

    const service: IUserModuleService = container.resolve(Modules.USER)

    await service.updateUsers(
      originalUsers.map((u) => ({
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        email: u.email,
        avatar_url: u.avatar_url,
        metadata: u.metadata,
      }))
    )
  }
)
