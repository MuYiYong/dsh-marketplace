#!/usr/bin/env node
/**
 * Validate `index.json` against DSH plugin market index format 1.
 * Usage: node scripts/validate-index.mjs [--file index.json] [--base-url <index URL>]
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_INDEX_URL, MarketIndexError, parseFlags, validateIndex } from './marketplace.mjs'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  const indexFile = resolve(typeof flags.file === 'string' ? flags.file : join(repositoryRoot, 'index.json'))
  const baseUrl = typeof flags['base-url'] === 'string' ? flags['base-url'] : DEFAULT_INDEX_URL
  let document
  try {
    document = JSON.parse(await readFile(indexFile, 'utf8'))
  } catch (error) {
    console.error(`cannot read ${indexFile}: ${error.message}`)
    process.exit(2)
  }
  const indexDirectory = dirname(indexFile)
  const iconExists = (relativePath) => {
    if (relativePath.split('/').some(segment => segment === '.' || segment === '..' || segment === '')) return false
    return existsSync(join(indexDirectory, relativePath))
  }
  try {
    const summary = validateIndex(document, { baseUrl, iconExists })
    console.log(`index OK: ${String(summary.plugins.length)} plugins, ${String(summary.versions)} versions (icons resolved against ${baseUrl})`)
  } catch (error) {
    if (error instanceof MarketIndexError) {
      console.error(`index INVALID: ${error.message}`)
      process.exit(1)
    }
    throw error
  }
}

await main()
