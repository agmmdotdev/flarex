const { resolveWorkspaceDependencySpecifiers } = require(`../publish-package`)

describe(`resolveWorkspaceDependencySpecifiers`, () => {
  it(`resolves workspace dependency ranges for local publishing`, () => {
    const packageJson = {
      dependencies: {
        "@medusajs/published": `workspace:*`,
        "@medusajs/installed": `workspace:^`,
        external: `^1.0.0`,
      },
      devDependencies: {
        "@medusajs/dev-only": `workspace:*`,
      },
      optionalDependencies: {
        "@medusajs/optional": `workspace:~`,
      },
      peerDependencies: {
        "@medusajs/peer": `workspace:*`,
      },
    }
    const versions = new Map([
      [`@medusajs/published`, `2.13.4`],
      [`@medusajs/installed`, `2.13.4`],
      [`@medusajs/dev-only`, `2.13.4`],
      [`@medusajs/optional`, `2.13.4`],
      [`@medusajs/peer`, `2.13.4`],
    ])

    resolveWorkspaceDependencySpecifiers({
      packageJson,
      packagesToPublish: [`@medusajs/published`],
      versionPostFix: 123,
      getPackageVersion: (packageName) => versions.get(packageName),
    })

    expect(packageJson).toEqual({
      dependencies: {
        "@medusajs/published": `2.13.4-dev-123`,
        "@medusajs/installed": `^2.13.4`,
        external: `^1.0.0`,
      },
      devDependencies: {
        "@medusajs/dev-only": `2.13.4`,
      },
      optionalDependencies: {
        "@medusajs/optional": `~2.13.4`,
      },
      peerDependencies: {
        "@medusajs/peer": `2.13.4`,
      },
    })
  })
})
