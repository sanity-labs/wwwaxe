// Packs the package and loads it the way consumers do: require() from CommonJS, import from
// ESM, and the type declarations under both Node16 resolution modes. Run after `pnpm build`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tmp = mkdtempSync(join(tmpdir(), 'wwwaxe-smoke-'))

try {
  const packed = join(tmp, 'pack')
  mkdirSync(packed)
  execFileSync('pnpm', ['pack', '--pack-destination', packed], { cwd: root, stdio: 'inherit' })
  const [tarball] = execFileSync('ls', [packed], { encoding: 'utf8' }).trim().split('\n')

  const consumer = join(tmp, 'consumer')
  const installed = join(consumer, 'node_modules', ...pkg.name.split('/'))
  mkdirSync(installed, { recursive: true })
  execFileSync('tar', ['-xzf', join(packed, tarball), '-C', installed, '--strip-components=1'])
  for (const dep of Object.keys(pkg.dependencies)) {
    symlinkSync(join(root, 'node_modules', dep), join(consumer, 'node_modules', dep))
  }
  symlinkSync(join(root, 'node_modules', '@types'), join(consumer, 'node_modules', '@types'))

  const html = '<html><body><main><h1>Hi</h1><p>text</p></main></body></html>'
  const expected = (mod) => {
    const out = mod.wwwaxe(html)
    if (typeof out !== 'string' || !out.includes('# Hi')) throw new Error('unexpected output: ' + out)
  }

  writeFileSync(join(consumer, 'cjs.cjs'), `module.exports = require(${JSON.stringify(pkg.name)})\n`)
  writeFileSync(join(consumer, 'esm.mjs'), `export * from ${JSON.stringify(pkg.name)}\n`)
  expected((await import(join(consumer, 'cjs.cjs'))).default)
  expected(await import(join(consumer, 'esm.mjs')))

  const usage = `import { wwwaxe, type WwwaxeOptions } from ${JSON.stringify(pkg.name)}\n` +
    `const options: WwwaxeOptions = { core: true }\n` +
    `export const out: string = wwwaxe('<p>x</p>', options)\n`
  writeFileSync(
    join(consumer, 'types.cts'),
    `import wwwaxeModule = require(${JSON.stringify(pkg.name)})\n` +
      `const options: wwwaxeModule.WwwaxeOptions = { core: true }\n` +
      `export const out: string = wwwaxeModule.wwwaxe('<p>x</p>', options)\n`,
  )
  writeFileSync(join(consumer, 'types.mts'), usage)
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { module: 'node16', moduleResolution: 'node16', strict: true, noEmit: true, skipLibCheck: false, types: [] },
      files: ['types.cts', 'types.mts'],
    }),
  )
  execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', consumer], { stdio: 'inherit' })
  console.log('package smoke test passed: require, import and types resolve')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
