#!/usr/bin/env node
/**
 * Add or replace one Git-pinned release in `index.json`.
 *
 * Usage:
 *   node scripts/add-release.mjs --name <pkg> --version <semver> --commit <40-hex> \
 *     [--git-url https://github.com/owner/repo] [--path <package dir>] \
 *     [--engines-dsh "^0.2.2-rc.5"] [--timestamp <unix seconds>] \
 *     [--title-en "..."] [--title-zh "..."] \
 *     [--description-en "..."] [--description-zh "..."] \
 *     [--icon https://...|icons/...] [--author "..."] [--homepage "https://..."] \
 *     [--category <id>] [--keywords a,b] [--labels a,b] [--file index.json]
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addRelease, DEFAULT_INDEX_URL, localizedFlag, MarketIndexError, parseFlags, validateIndex,
} from './marketplace.mjs'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function required(flags, key, usage) {
  const value = flags[key]
  if (typeof value !== 'string' || value.trim() === '') {
    console.error(`missing --${key}\n\n${usage}`)
    process.exit(2)
  }
  return value
}

function csv(value) {
  if (typeof value !== 'string') return undefined
  return value.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
}

async function main() {
  const usage = 'See scripts/add-release.mjs header for the full flag list.'
  const flags = parseFlags(process.argv.slice(2))
  const indexFile = resolve(typeof flags.file === 'string' ? flags.file : join(repositoryRoot, 'index.json'))
  const baseUrl = typeof flags['base-url'] === 'string' ? flags['base-url'] : DEFAULT_INDEX_URL
  const indexDirectory = dirname(indexFile)
  const iconExists = (relativePath) => {
    if (relativePath.split('/').some(segment => segment === '.' || segment === '..' || segment === '')) return false
    return existsSync(join(indexDirectory, relativePath))
  }
  let document
  try {
    document = JSON.parse(await readFile(indexFile, 'utf8'))
  } catch (error) {
    console.error(`cannot read ${indexFile}: ${error.message}`)
    process.exit(2)
  }
  const input = {
    name: required(flags, 'name', usage),
    version: required(flags, 'version', usage),
    commit: required(flags, 'commit', usage),
    gitUrl: typeof flags['git-url'] === 'string' ? flags['git-url'] : undefined,
    path: typeof flags.path === 'string' ? flags.path : undefined,
    timestamp: typeof flags.timestamp === 'string' ? Number(flags.timestamp) : undefined,
    enginesDsh: typeof flags['engines-dsh'] === 'string' ? flags['engines-dsh'] : undefined,
    title: localizedFlag(flags['title-en'], flags['title-zh']),
    description: localizedFlag(flags['description-en'], flags['description-zh']),
    icon: typeof flags.icon === 'string' ? flags.icon : undefined,
    author: typeof flags.author === 'string' ? flags.author : undefined,
    homepage: typeof flags.homepage === 'string' ? flags.homepage : undefined,
    category: typeof flags.category === 'string' ? flags.category : undefined,
    keywords: csv(flags.keywords),
    labels: csv(flags.labels),
  }
  try {
    const result = addRelease(document, input, { baseUrl, iconExists })
    if (result.unchanged) {
      console.log(`already recorded: ${input.name}@${input.version} at ${input.commit}`)
      return
    }
    await writeFile(indexFile, `${JSON.stringify(result.document, null, 2)}\n`)
    const summary = validateIndex(result.document, { baseUrl, iconExists })
    console.log(`${result.created ? 'created' : 'updated'} ${input.name}@${input.version} (${input.commit}); index now ${String(summary.plugins.length)} plugins, ${String(summary.versions)} versions`)
  } catch (error) {
    if (error instanceof MarketIndexError) {
      console.error(`cannot record release: ${error.message}`)
      process.exit(1)
    }
    throw error
  }
}

await main()
