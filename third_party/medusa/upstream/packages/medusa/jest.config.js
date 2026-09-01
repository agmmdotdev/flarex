module.exports = {
  moduleNameMapper: {
    "^@medusajs/framework/awilix$":
      "<rootDir>/../core/framework/src/deps/awilix",
    "^@medusajs/framework/(pg|zod)$":
      "<rootDir>/../core/framework/src/deps/$1",
    "^@medusajs/framework/(mikro-orm|opentelemetry)/(.*)$":
      "<rootDir>/../core/framework/src/deps/$1-$2",
    "^@medusajs/framework$": "<rootDir>/../core/framework/src",
    "^@medusajs/framework/(.*)$": "<rootDir>/../core/framework/src/$1",
  },
  //snapshotSerializers: [`jest-serializer-path`],
  // collectCoverageFrom: coverageDirs,
  //reporters: process.env.CI
  //  ? [[`jest-silent-reporter`, { useDots: true }]].concat(
  //      useCoverage ? `jest-junit` : []
  //    )
  //  : [`default`].concat(useCoverage ? `jest-junit` : []),
  transform: { "^.+\\.[jt]s?$": "@swc/jest" },
  modulePathIgnorePatterns: ["__fixtures__", "node_modules", "dist"],
  testEnvironment: `node`,
  moduleFileExtensions: [`js`, `ts`],
  setupFilesAfterEnv: ["<rootDir>/setupTests.js"],
}
