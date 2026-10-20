import { defineConfig } from 'oxfmt'

export default defineConfig({
  singleQuote: true,
  semi: false,
  sortPackageJson: false,
  overrides: [
    {
      // Fenced code in the README is documentation: the example input and its output must stay
      // exactly as written, because a test runs the one and compares the other.
      files: ['**/*.md'],
      options: { embeddedLanguageFormatting: 'off' },
    },
  ],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    '*.tgz',
    'pnpm-lock.yaml',
    // Real-page fixtures are captured input: formatting them changes what the converter sees.
    'test/fixtures/',
  ],
})
