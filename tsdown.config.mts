import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: { sourcemap: false },
  clean: true,
  sourcemap: true,
  fixedExtension: false,
})
