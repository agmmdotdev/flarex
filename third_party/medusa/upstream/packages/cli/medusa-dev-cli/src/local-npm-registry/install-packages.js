const path = require(`path`)
const fs = require(`fs-extra`)

const { promisifiedSpawn } = require(`../utils/promisified-spawn`)
const { registryUrl } = require(`./verdaccio-config`)

const installPackages = async ({
  packagesToInstall,
  workspaceRoot,
  newlyPublishedPackageVersions,
  externalRegistry,
}) => {
  console.log(
    `Installing packages from local registry:\n${packagesToInstall
      .map((packageAndVersion) => ` - ${packageAndVersion}`)
      .join(`\n`)}`
  )
  let installCmd
  if (workspaceRoot) {
    const { stdout } = await promisifiedSpawn([
      `pnpm`,
      [`list`, `-r`, `--depth`, `-1`, `--json`],
      { cwd: workspaceRoot, stdio: `pipe` },
    ])

    let workspacesLayout
    try {
      workspacesLayout = Object.fromEntries(
        JSON.parse(stdout)
          .filter(({ name, path: workspacePath }) => name && workspacePath)
          .map(({ name, path: workspacePath }) => [
            name,
            {
              location: path
                .relative(workspaceRoot, workspacePath)
                .replace(/\\/g, `/`),
            },
          ])
      )
    } catch (e) {
      console.error(`Failed to parse "pnpm list" workspace output`, e)
    }

    if (!workspacesLayout) {
      console.error(
        `Couldn't parse output of "pnpm list -r --depth -1 --json" command`,
        stdout
      )
      process.exit(1)
    }

    const handleDeps = (deps) => {
      if (!deps) {
        return false
      }

      let changed = false
      Object.keys(deps).forEach((depName) => {
        if (packagesToInstall.includes(depName)) {
          deps[depName] = `medusa-dev`
          changed = true
        }
      })
      return changed
    }

    Object.keys(workspacesLayout).forEach((workspaceName) => {
      const { location } = workspacesLayout[workspaceName]
      const pkgJsonPath = path.join(workspaceRoot, location, `package.json`)
      if (!fs.existsSync(pkgJsonPath)) {
        return
      }
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, `utf8`))

      let changed = false
      changed |= handleDeps(pkg.dependencies)
      changed |= handleDeps(pkg.devDependencies)
      changed |= handleDeps(pkg.peerDependencies)

      if (changed) {
        console.log(`Changing deps in ${pkgJsonPath} to use @medusa-dev`)
        fs.outputJSONSync(pkgJsonPath, pkg, {
          spaces: 2,
        })
      }
    })

    // package.json files are changed - so we just want to install
    // using verdaccio registry
    const pnpmCommands = [`install`, `--no-frozen-lockfile`]

    if (!externalRegistry) {
      pnpmCommands.push(`--registry=${registryUrl}`)
    }

    installCmd = [`pnpm`, pnpmCommands, { cwd: workspaceRoot }]
  } else {
    const pnpmCommands = [
      `add`,
      ...packagesToInstall.map((packageName) => {
        const packageVersion = newlyPublishedPackageVersions[packageName]
        return `${packageName}@${packageVersion}`
      }),
      `--save-exact`,
    ]

    if (!externalRegistry) {
      pnpmCommands.push(`--registry=${registryUrl}`)
    }

    installCmd = [`pnpm`, pnpmCommands]
  }

  try {
    await promisifiedSpawn(installCmd)

    console.log(`Installation complete`)
  } catch (error) {
    console.error(`Installation failed`, error)
    process.exit(1)
  }
}

exports.installPackages = installPackages
