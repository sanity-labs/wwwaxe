import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { wwwaxe } from '../src/index.ts'

// The formatter trims trailing spaces in the README, so compare without them.
const trimLines = (text: string): string => text.replace(/[ \t]+$/gm, '')

it('the README example output is what the converter returns for the README example input', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const section = readme.slice(readme.indexOf('### Example output'))
  const input = /```html\n([\s\S]*?)\n```/.exec(section)?.[1]
  const output = /```text\n([\s\S]*?)\n```/.exec(section)?.[1]
  expect(input).toBeTruthy()
  expect(output).toBeTruthy()
  expect(trimLines(wwwaxe(input!, { core: true }))).toBe(output)
})
