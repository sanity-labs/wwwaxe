import { defineConfig } from 'oxfmt'

export default defineConfig({
  singleQuote: true,
  semi: false,
  sortPackageJson: false,
  ignorePatterns: [
    'node_modules/',
    'dist/',
    '*.tgz',
    'pnpm-lock.yaml',
    // Real-page fixtures are captured input: formatting them changes what the converter sees.
    'test/fixtures/',
  ],
})
