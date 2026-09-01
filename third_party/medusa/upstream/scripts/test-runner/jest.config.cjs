const defineJestConfig = require("../../define_jest_config")

module.exports = defineJestConfig({
  rootDir: "../..",
  roots: [
    "<rootDir>/scripts/test-runner/contracts",
    "<rootDir>/packages/core/utils/src/dal/mikro-orm/__tests__",
    "<rootDir>/packages/core/utils/src/modules-sdk/decorators/__tests__",
  ],
  moduleNameMapper: {
    "^@contract-services$":
      "<rootDir>/scripts/test-runner/contracts/fixtures/aliases/services/index.ts",
    "^@contract-services/(.*)$":
      "<rootDir>/scripts/test-runner/contracts/fixtures/aliases/services/$1",
    "^@contract-services-other$":
      "<rootDir>/scripts/test-runner/contracts/fixtures/aliases/services-other.ts",
  },
  testPathIgnorePatterns: [
    "dist/",
    "node_modules/",
    "__fixtures__/",
    "__mocks__/",
    "\\.vitest\\.spec\\.ts$",
  ],
  testMatch: [
    "<rootDir>/scripts/test-runner/contracts/__tests__/**/*.{js,ts}",
    "<rootDir>/scripts/test-runner/contracts/**/*.{spec,test}.{js,ts}",
    "<rootDir>/packages/core/utils/src/dal/mikro-orm/__tests__/big-number-field.spec.ts",
    "<rootDir>/packages/core/utils/src/modules-sdk/decorators/__tests__/emit-events.ts",
  ],
})
