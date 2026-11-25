/**
 * DSH plugin market index format 1 helpers: validation, SemVer precedence, and
 * release bookkeeping. Dependency-free so the index repository validates with a
 * stock Node runtime, mirroring the Host validator shipped with DSH.
 */

/** Default public location of this repository's index, used to resolve icons. */
export const DEFAULT_INDEX_URL = 'https://raw.githubusercontent.com/MuYiYong/dsh-marketplace/main/index.json'

const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const PACKAGE_NAME_MAX_LENGTH = 214
const NUMERIC = '(?:0|[1-9]\\d*)'
const PRERELEASE_PART = `(?:${NUMERIC}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`
const SEMVER = new RegExp(`^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-${PRERELEASE_PART}(?:\\.${PRERELEASE_PART})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`, 'u')
const COMMIT = /^[0-9a-f]{40}$/u
const PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/u
const DATA_ICON = /^data:(?:image\/svg\+xml|image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]*={0,2})$/u
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const MAX_INLINE_ICON_BYTES = 32 * 1024
const MAX_PUBLISH_TIMESTAMP = 1e11

/** One rule violated by an index document; `path` is a JSON path such as `$.plugins[0].versions[1].version`. */
export class MarketIndexError extends Error {
  /**
   * @param {string} path - JSON path of the offending value.
   * @param {string} reason - violated rule.
   */
  constructor(path, reason) {
    super(`${path} ${reason}`)
    this.name = 'MarketIndexError'
    this.path = path
    this.reason = reason
  }
}

function fail(path, reason) {
  throw new MarketIndexError(path, reason)
}

function objectAt(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be an object')
  return value
}

function stringAt(value, path) {
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'must be a string with a non-whitespace character')
  return value
}

function optional(object, key, path, read) {
  return Object.hasOwn(object, key) ? read(object[key], `${path}.${key}`) : undefined
}

function localizedText(value, path) {
  if (typeof value === 'string') return stringAt(value, path)
  const object = objectAt(value, path)
  const text = {}
  for (const [language, member] of Object.entries(object)) {
    if (!LANGUAGE_ID.test(language)) fail(`${path}.${language}`, 'must be keyed by a lowercase language id')
    text[language] = stringAt(member, `${path}.${language}`)
  }
  if (!Object.hasOwn(text, 'en')) fail(path, 'must contain en')
  return text
}

function declarations(value, path, read) {
  const result = {}
  for (const [id, member] of Object.entries(objectAt(value, path))) {
    if (id === '') fail(path, 'must not declare an empty id')
    result[id] = read(objectAt(member, `${path}.${id}`), `${path}.${id}`)
  }
  return result
}

function declaredId(value, path, declared) {
  const id = stringAt(value, path)
  if (!Object.hasOwn(declared, id)) fail(path, `references undeclared id ${JSON.stringify(id)}`)
  return id
}

function httpUrl(value, path, protocols) {
  const text = stringAt(value, path)
  let url
  try {
    url = new URL(text)
  } catch {
    fail(path, 'must be an absolute URL')
  }
  if (!protocols.includes(url.protocol)) fail(path, `must use ${protocols.join(' or ')}`)
  if (url.username !== '' || url.password !== '') fail(path, 'must not contain credentials')
  if (url.href.includes('?') || url.href.includes('#')) fail(path, 'must not contain a query or fragment')
  return url
}

function homepageUrl(value, path) {
  const text = stringAt(value, path)
  if (!URL.canParse(text)) fail(path, 'must be an absolute URL')
  const url = new URL(text)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail(path, 'must use https: or http:')
  return url.href
}

function gitUrl(value, path) {
  const url = httpUrl(value, path, ['https:'])
  if (url.href !== value) fail(path, 'must be a canonical URL')
  if (!/^(?:\/[^/]+){2,}$/u.test(url.pathname)) fail(path, 'must name a repository with at least two path segments')
  if (/\.(?:tgz|tar\.gz)$/iu.test(url.pathname)) fail(path, 'must name a repository, not a tarball')
  return url.href
}

function packagePath(value, path) {
  const text = stringAt(value, path)
  if (text.split('/').some(segment => segment === '.' || segment === '..' || !PATH_SEGMENT.test(segment))) {
    fail(path, 'must be a relative directory of letters, digits, and ._@+- segments without . or ..')
  }
  return text
}

function icon(value, path, baseUrl, iconExists) {
  const text = stringAt(value, path)
  if (text.startsWith('data:')) {
    const payload = DATA_ICON.exec(text)?.[1]
    if (payload === undefined || payload === '' || !BASE64.test(payload)) fail(path, 'must be a base64 SVG, PNG, JPEG, or WebP data URL')
    const bytes = payload.length / 4 * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
    if (bytes > MAX_INLINE_ICON_BYTES) fail(path, `must not exceed ${String(MAX_INLINE_ICON_BYTES / 1024)} KiB of decoded bytes`)
    return text
  }
  const base = new URL(baseUrl)
  let resolved
  try {
    resolved = new URL(text, base)
  } catch {
    fail(path, 'must be a URL reference')
  }
  if (resolved.protocol !== 'https:' && resolved.origin !== base.origin) fail(path, 'must resolve to https or the index origin')
  const absolute = /^[a-z][a-z0-9+.-]*:/iu.test(text)
  if (!absolute && typeof iconExists === 'function' && !iconExists(text)) {
    fail(path, `must reference an existing file (${text})`)
  }
  return resolved.href
}

function isSemverRange(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.startsWith('workspace:')) return false
  const token = `(?:\\^|~|>=|<=|>|<|=)?v?(?:0|[1-9]\\d*)(?:\\.(?:0|[1-9]\\d*|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?`
  return value.split('||').every(part => {
    const text = part.trim()
    if (text === '' || text === '*' || text === 'x' || text === 'X') return text !== ''
    const hyphen = /^(.+?)\s+-\s+(.+)$/u.exec(text)
    const tokens = hyphen === null ? text.split(/\s+/u) : [hyphen[1], hyphen[2]]
    return tokens.every(member => new RegExp(`^${token}$`, 'u').test(member))
  })
}

function engines(value, path) {
  const object = objectAt(value, path)
  const dsh = optional(object, 'dsh', path, (member, at) => {
    const range = stringAt(member, at)
    if (!isSemverRange(range)) fail(at, 'must be a SemVer range')
    return range
  })
  return dsh === undefined ? {} : { dsh }
}

function source(value, path) {
  const object = objectAt(value, path)
  switch (object.type) {
    case 'npm': {
      const registry = optional(object, 'registry', path, (member, at) => httpUrl(member, at, ['https:', 'http:']).href)
      return { type: 'npm', ...(registry === undefined ? {} : { registry }) }
    }
    case 'git': {
      const commit = stringAt(object.commit, `${path}.commit`)
      if (!COMMIT.test(commit)) fail(`${path}.commit`, 'must be a lowercase 40-hex-digit commit SHA')
      const directory = optional(object, 'path', path, packagePath)
      return {
        type: 'git',
        url: gitUrl(object.url, `${path}.url`),
        commit,
        ...(directory === undefined ? {} : { path: directory }),
      }
    }
    default:
      return fail(`${path}.type`, 'must be "npm" or "git"')
  }
}

function pluginMetadata(value, path, index) {
  const object = value === undefined || value === null ? {} : objectAt(value, path)
  const field = (key, read) => (object[key] === null ? undefined : optional(object, key, path, read))
  const category = field('category', (member, at) => declaredId(member, at, index.categories))
  const keywords = field('keywords', (member, at) => {
    if (!Array.isArray(member)) fail(at, 'must be an array')
    return member.map((keyword, position) => {
      if (typeof keyword !== 'string') fail(`${at}[${String(position)}]`, 'must be a string')
      return keyword
    })
  }) ?? []
  const labels = field('labels', (member, at) => {
    if (!Array.isArray(member)) fail(at, 'must be an array')
    const ids = member.map((label, position) => declaredId(label, `${at}[${String(position)}]`, index.labels))
    if (new Set(ids).size !== ids.length) fail(at, 'must not repeat a label')
    return ids
  }) ?? []
  const sortKeys = field('sortKeys', (member, at) => {
    const values = {}
    for (const [id, sortValue] of Object.entries(objectAt(member, at))) {
      declaredId(id, `${at}.${id}`, index.sortKeys)
      if (sortValue === null) continue
      if (typeof sortValue !== 'number' || !Number.isFinite(sortValue)) fail(`${at}.${id}`, 'must be a finite number')
      values[id] = sortValue
    }
    return values
  }) ?? {}
  return { ...(category === undefined ? {} : { category }), keywords, labels, sortKeys }
}

function marketVersion(value, path) {
  const object = objectAt(value, path)
  const version = stringAt(object.version, `${path}.version`)
  if (!SEMVER.test(version)) fail(`${path}.version`, 'must be an exact SemVer version')
  const publishTimestamp = object.publishTimestamp
  if (typeof publishTimestamp !== 'number' || !Number.isInteger(publishTimestamp)
    || publishTimestamp < 0 || publishTimestamp >= MAX_PUBLISH_TIMESTAMP) {
    fail(`${path}.publishTimestamp`, 'must be an integer number of Unix seconds in [0, 10^11)')
  }
  return {
    version,
    publishTimestamp,
    source: source(object.source, `${path}.source`),
    engines: optional(object, 'engines', path, engines) ?? {},
  }
}

function plugin(value, path, index, baseUrl, iconExists) {
  const object = objectAt(value, path)
  const name = stringAt(object.name, `${path}.name`)
  if (name.length > PACKAGE_NAME_MAX_LENGTH || !PACKAGE_NAME.test(name)) fail(`${path}.name`, 'must be a valid npm package name')
  const title = optional(object, 'title', path, localizedText)
  const description = optional(object, 'description', path, localizedText)
  const iconUrl = optional(object, 'icon', path, (member, at) => icon(member, at, baseUrl, iconExists))
  const author = optional(object, 'author', path, stringAt)
  const homepage = optional(object, 'homepage', path, homepageUrl)
  const repositoryUrl = optional(object, 'repository', path, (member, at) => {
    const repo = objectAt(member, at)
    const url = httpUrl(repo.url, `${at}.url`, ['https:', 'http:']).href
    const directory = optional(repo, 'directory', at, packagePath)
    return { url, ...(directory === undefined ? {} : { directory }) }
  })
  const versions = object.versions
  if (!Array.isArray(versions) || versions.length === 0) fail(`${path}.versions`, 'must be a non-empty array')
  const seen = new Set()
  const parsedVersions = versions.map((member, position) => {
    const at = `${path}.versions[${String(position)}]`
    const entry = marketVersion(member, at)
    if (seen.has(entry.version)) fail(`${at}.version`, `duplicates ${entry.version}`)
    seen.add(entry.version)
    return entry
  })
  return {
    name,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(iconUrl === undefined ? {} : { icon: iconUrl }),
    ...(author === undefined ? {} : { author }),
    ...(homepage === undefined ? {} : { homepage }),
    ...(repositoryUrl === undefined ? {} : { repository: repositoryUrl }),
    metadata: pluginMetadata(object.metadata, `${path}.metadata`, index),
    versions: parsedVersions,
  }
}

/**
 * Validate a parsed format-1 index document.
 * @param {unknown} value - parsed index JSON.
 * @param {{ baseUrl?: string, iconExists?: (relativePath: string) => boolean }} [options] - index location used to resolve relative icons, and an optional local file check.
 * @returns {{ title: object, plugins: Array<object>, versions: number }} summary of the validated document.
 * @throws {MarketIndexError} for the first violated rule.
 */
export function validateIndex(value, options = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_INDEX_URL
  if (!URL.canParse(baseUrl)) fail('$', 'base URL for relative icons must be absolute')
  const object = objectAt(value, '$')
  if (object.format !== 1) fail('$.format', 'must be 1')
  const metadataRaw = object.metadata === undefined ? {} : objectAt(object.metadata, '$.metadata')
  const metadata = {
    categories: optional(metadataRaw, 'categories', '$.metadata', (member, at) => declarations(member, at, (entry, path) => ({ title: localizedText(entry.title, `${path}.title`) }))) ?? {},
    labels: optional(metadataRaw, 'labels', '$.metadata', (member, at) => declarations(member, at, (entry, path) => ({ title: localizedText(entry.title, `${path}.title`) }))) ?? {},
    sortKeys: optional(metadataRaw, 'sortKeys', '$.metadata', (member, at) => declarations(member, at, (entry, path) => {
      if (entry.order !== 'asc' && entry.order !== 'desc') fail(`${path}.order`, 'must be "asc" or "desc"')
      return { title: localizedText(entry.title, `${path}.title`), order: entry.order }
    })) ?? {},
  }
  if (!Array.isArray(object.plugins)) fail('$.plugins', 'must be an array')
  const names = new Set()
  let versions = 0
  const plugins = object.plugins.map((entry, position) => {
    const parsed = plugin(entry, `$.plugins[${String(position)}]`, metadata, baseUrl, options.iconExists)
    if (names.has(parsed.name)) fail(`$.plugins[${String(position)}].name`, `duplicates ${parsed.name}`)
    names.add(parsed.name)
    versions += parsed.versions.length
    return parsed
  })
  const title = localizedText(object.title, '$.title')
  const description = optional(object, 'description', '$', localizedText)
  return { title, ...(description === undefined ? {} : { description }), metadata, plugins, versions }
}

/** Parse the numeric parts of an exact SemVer version; build metadata is ignored. */
function parseSemver(version) {
  const withoutBuild = version.split('+', 1)[0]
  const dash = withoutBuild.indexOf('-')
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)
  const prerelease = dash === -1 ? [] : withoutBuild.slice(dash + 1).split('.')
  return { core: core.split('.').map(Number), prerelease }
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const aNumeric = /^\d+$/u.test(a)
    const bNumeric = /^\d+$/u.test(b)
    if (aNumeric && bNumeric) return Number(a) < Number(b) ? -1 : 1
    if (aNumeric) return -1
    if (bNumeric) return 1
    return a < b ? -1 : 1
  }
  return 0
}

/**
 * Compare two exact SemVer versions by precedence.
 * @param {string} left - a version.
 * @param {string} right - a version.
 * @returns {number} negative, zero, or positive as left sorts before, equal to, or after right.
 */
export function compareVersions(left, right) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

function buildGitSource(gitUrlValue, commit, directory) {
  const url = gitUrl(gitUrlValue, '$.gitUrl')
  if (!COMMIT.test(commit)) fail('$.commit', 'must be a lowercase 40-hex-digit commit SHA')
  const sourceValue = { type: 'git', url, commit, ...(directory === undefined ? {} : { path: packagePath(directory, '$.path') }) }
  return sourceValue
}

function latestVersion(versions) {
  return [...versions].sort((left, right) => compareVersions(right.version, left.version))[0]
}

/**
 * Add one Git-pinned version to an index document.
 * @param {object} document - parsed format-1 index.
 * @param {object} input - release fields: name, version, commit, gitUrl, optional path, timestamp, enginesDsh, title, description, icon, author, homepage, category, keywords, labels.
 * @param {{ baseUrl?: string, iconExists?: (relativePath: string) => boolean }} [options] - validation options.
 * @returns {{ document: object, plugin: object, version: object, created: boolean, unchanged: boolean }} the updated document is a copy.
 */
export function addRelease(document, input, options = {}) {
  const before = validateIndex(document, options)
  const copy = structuredClone(document)
  const name = stringAt(input.name, '$.name')
  if (name.length > PACKAGE_NAME_MAX_LENGTH || !PACKAGE_NAME.test(name)) fail('$.name', 'must be a valid npm package name')
  const version = stringAt(input.version, '$.version')
  if (!SEMVER.test(version)) fail('$.version', 'must be an exact SemVer version')
  const timestamp = input.timestamp === undefined ? Math.floor(Date.now() / 1000) : input.timestamp
  if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp >= MAX_PUBLISH_TIMESTAMP) {
    fail('$.timestamp', 'must be an integer number of Unix seconds in [0, 10^11)')
  }
  let plugin = copy.plugins.find(entry => entry.name === name)
  const created = plugin === undefined
  const previous = created ? undefined : latestVersion(plugin.versions)
  const gitUrlValue = input.gitUrl ?? (previous?.source.type === 'git' ? previous.source.url : undefined)
  if (gitUrlValue === undefined) fail('$.gitUrl', 'is required for a new plugin or when existing versions do not use a git source')
  const sourceValue = buildGitSource(gitUrlValue, stringAt(input.commit, '$.commit'), input.path)
  const enginesDsh = input.enginesDsh ?? (previous?.engines?.dsh)
  if (enginesDsh !== undefined && !isSemverRange(enginesDsh)) fail('$.enginesDsh', 'must be a SemVer range')

  if (created) {
    const metadataInput = {}
    for (const key of ['category', 'keywords', 'labels']) {
      if (input[key] !== undefined) metadataInput[key] = input[key]
    }
    plugin = {
      name,
      ...(input.title === undefined ? {} : { title: localizedText(input.title, '$.title') }),
      ...(input.description === undefined ? {} : { description: localizedText(input.description, '$.description') }),
      ...(input.icon === undefined ? {} : { icon: icon(input.icon, '$.icon', options.baseUrl ?? DEFAULT_INDEX_URL, options.iconExists) }),
      ...(input.author === undefined ? {} : { author: stringAt(input.author, '$.author') }),
      ...(input.homepage === undefined ? {} : { homepage: homepageUrl(input.homepage, '$.homepage') }),
      metadata: pluginMetadata(metadataInput, '$.metadata', before.metadata),
      versions: [],
    }
    copy.plugins.push(plugin)
  }

  const existing = plugin.versions.find(entry => entry.version === version)
  if (existing !== undefined) {
    const same = existing.source.type === 'git'
      && existing.source.url === sourceValue.url
      && existing.source.commit === sourceValue.commit
      && existing.source.path === sourceValue.path
    if (!same) fail('$.version', `already recorded with a different commit or source`)
    validateIndex(copy, options)
    return { document: copy, plugin, version: existing, created, unchanged: true }
  }
  const entry = {
    version,
    publishTimestamp: timestamp,
    source: sourceValue,
    ...(enginesDsh === undefined ? {} : { engines: { dsh: enginesDsh } }),
  }
  plugin.versions.push(entry)
  plugin.versions.sort((left, right) => compareVersions(right.version, left.version))
  validateIndex(copy, options)
  return { document: copy, plugin, version: entry, created, unchanged: false }
}

/**
 * Parse `--name value` style arguments.
 * @param {string[]} argv - arguments after the entry point.
 * @returns {Record<string, string | true>} flags without their leading dashes.
 */
export function parseFlags(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`)
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) flags[key] = true
    else {
      flags[key] = next
      index += 1
    }
  }
  return flags
}

/** Convert a localized text flag pair into the index shape. */
export function localizedFlag(en, zh) {
  if (typeof en !== 'string') return undefined
  return typeof zh === 'string' ? { en, zh } : { en }
}
