console.log(`

Oops! Medusa noticed some lint or style issues in the code for this
commit. You need to fix the issues before pushing the changes.
Use 'pnpm run lint' to manually re-run these checks. You can also disable these
checks:
- for a single commit: git commit --no-verify
- for all future commits: pnpm run hooks:uninstall

`)

process.exit(1)
