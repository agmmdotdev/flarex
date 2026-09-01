// @ts-check

const {
  AbstractAuthModuleProvider,
  MedusaError,
} = require("@medusajs/framework/utils")

/** @typedef {import("@medusajs/framework/types").AuthenticationInput} AuthenticationInput */
/** @typedef {import("@medusajs/framework/types").AuthenticationResponse} AuthenticationResponse */
/** @typedef {import("@medusajs/framework/types").AuthIdentityDTO} AuthIdentityDTO */
/** @typedef {import("@medusajs/framework/types").AuthIdentityProviderService} AuthIdentityProviderService */

class AuthServiceFixtures extends AbstractAuthModuleProvider {
  static identifier = "plaintextpass"

  constructor() {
    super()
  }

  /**
   * @param {AuthenticationInput} authenticationData
   * @param {AuthIdentityProviderService} service
   * @returns {Promise<AuthenticationResponse>}
   */
  async authenticate(authenticationData, service) {
    const { email, password } = authenticationData.body ?? {}
    if (typeof email !== "string") {
      return { success: false, error: "Email is required" }
    }

    /** @type {AuthIdentityDTO | undefined} */
    let authIdentity
    try {
      authIdentity = await service.retrieve({
        entity_id: email,
      })

      // The provider has to be present, guaranteed by the retrieve filter above.
      const providerIdentity = authIdentity.provider_identities?.find(
        (pi) => pi.provider === this.provider
      )
      if (!providerIdentity) {
        throw new Error(`Missing provider identity for ${this.provider}`)
      }

      if (providerIdentity.provider_metadata?.password === password) {
        return {
          success: true,
          authIdentity,
        }
      }
    } catch (error) {
      if (
        error instanceof MedusaError &&
        error.type === MedusaError.Types.NOT_FOUND
      ) {
        const createdAuthIdentity = await service.create({
          entity_id: email,
          provider_metadata: {
            password,
          },
        })

        return {
          success: true,
          authIdentity: createdAuthIdentity,
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    return {
      success: false,
      error: "Invalid email or password",
    }
  }
}

const services = [AuthServiceFixtures]

module.exports = { AuthServiceFixtures, services }
