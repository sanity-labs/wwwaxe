import { defineConfig } from 'oxlint'

export default defineConfig({
  ignorePatterns: ['dist/', 'node_modules/'],
  options: {
    denyWarnings: true,
    typeAware: true,
  },
  categories: {
    correctness: 'error',
  },
})
