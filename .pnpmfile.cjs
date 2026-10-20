// tsup bundles declarations through rollup-plugin-dts, which needs the TypeScript JS API.
// typescript@7 no longer ships it, so tsup gets its own TypeScript 5 while the project
// itself type-checks with 7.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === 'tsup') {
        pkg.dependencies = { ...pkg.dependencies, typescript: '5.9.3' }
        if (pkg.peerDependencies) delete pkg.peerDependencies.typescript
        if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.typescript
      }
      return pkg
    },
  },
}
