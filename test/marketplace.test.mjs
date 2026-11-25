import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addRelease, compareVersions, DEFAULT_INDEX_URL, localizedFlag, MarketIndexError, parseFlags, validateIndex,
} from '../scripts/marketplace.mjs'

const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)
const REPO = 'https://github.com/example/plugin'

function validIndex() {
  return {
    format: 1,
    title: { en: 'Example Market', zh: '示例市场' },
    description: { en: 'Test plugins', zh: '测试插件' },
    metadata: {
      categories: { monitoring: { title: { en: 'Monitoring', zh: '监控' } } },
      labels: { codex: { title: { en: 'Codex', zh: 'Codex' } }, tmux: { title: { en: 'tmux', zh: 'tmux' } } },
      sortKeys: { recommended: { title: { en: 'Recommended', zh: '推荐' }, order: 'desc' } },
    },
    plugins: [{
      name: 'dsh-codex-agent',
      title: { en: 'Codex Agent', zh: 'Codex Agent' },
      description: { en: 'Remote Codex sessions', zh: '远端 Codex 会话' },
      icon: 'icons/plugin.svg',
      author: 'MuYiYong',
      homepage: REPO,
      repository: { url: REPO },
      metadata: { category: 'monitoring', keywords: ['codex', 'tmux'], labels: ['codex'], sortKeys: { recommended: 1 } },
      versions: [{
        version: '0.1.0',
        publishTimestamp: 1_760_000_000,
        source: { type: 'git', url: REPO, commit: COMMIT_A },
        engines: { dsh: '^0.2.2-rc.5' },
      }],
    }],
  }
}

const options = { iconExists: () => true }

function invalid(document, reason, assertionOptions = options) {
  assert.throws(() => validateIndex(document, assertionOptions), (error) => {
    assert.ok(error instanceof MarketIndexError, `expected MarketIndexError, got ${error}`)
    assert.match(error.message, reason)
    return true
  })
}

test('accepts a well-formed format 1 index and resolves relative icons', () => {
  const summary = validateIndex(validIndex(), options)
  assert.equal(summary.plugins.length, 1)
  assert.equal(summary.versions, 1)
  assert.equal(summary.plugins[0].icon, new URL('icons/plugin.svg', DEFAULT_INDEX_URL).href)
  assert.deepEqual(summary.metadata.labels.codex.title, { en: 'Codex', zh: 'Codex' })
})

test('rejects malformed roots, names, metadata and versions', () => {
  invalid({ ...validIndex(), format: 2 }, /\$\.format must be 1/)
  const noEnglish = validIndex()
  noEnglish.title = { zh: '没有英文' }
  invalid(noEnglish, /\$\.title must contain en/)

  const duplicate = validIndex()
  duplicate.plugins.push(structuredClone(duplicate.plugins[0]))
  invalid(duplicate, /\$\.plugins\[1\]\.name duplicates dsh-codex-agent/)

  const duplicateVersion = validIndex()
  duplicateVersion.plugins[0].versions.push(structuredClone(duplicateVersion.plugins[0].versions[0]))
  invalid(duplicateVersion, /versions\[1\]\.version duplicates 0\.1\.0/)

  const unknownCategory = validIndex()
  unknownCategory.plugins[0].metadata.category = 'games'
  invalid(unknownCategory, /references undeclared id "games"/)

  const unknownLabel = validIndex()
  unknownLabel.plugins[0].metadata.labels = ['nope']
  invalid(unknownLabel, /references undeclared id "nope"/)

  const repeatedLabel = validIndex()
  repeatedLabel.plugins[0].metadata.labels = ['codex', 'codex']
  invalid(repeatedLabel, /must not repeat a label/)

  const badCommit = validIndex()
  badCommit.plugins[0].versions[0].source.commit = 'not-a-commit'
  invalid(badCommit, /commit must be a lowercase 40-hex-digit commit SHA/)

  const trailingSlash = validIndex()
  trailingSlash.plugins[0].versions[0].source.url = `${REPO}/`
  invalid(trailingSlash, /must name a repository with at least two path segments/)

  const nonCanonical = validIndex()
  nonCanonical.plugins[0].versions[0].source.url = 'https://GitHub.com/example/plugin'
  invalid(nonCanonical, /must be a canonical URL/)

  const tarball = validIndex()
  tarball.plugins[0].versions[0].source = { type: 'git', url: 'https://github.com/example/plugin/releases/download/v0.1.0/pkg.tgz', commit: COMMIT_A }
  invalid(tarball, /must name a repository, not a tarball/)

  const badTimestamp = validIndex()
  badTimestamp.plugins[0].versions[0].publishTimestamp = 1.5
  invalid(badTimestamp, /publishTimestamp must be an integer/)

  const badRange = validIndex()
  badRange.plugins[0].versions[0].engines.dsh = 'workspace:*'
  invalid(badRange, /engines\.dsh must be a SemVer range/)

  invalid({ ...validIndex(), plugins: 'nope' }, /\$\.plugins must be an array/)
})

test('supports npm versions and rejects unsafe or missing icons', () => {
  const npmIndex = validIndex()
  npmIndex.plugins[0].versions[0].source = { type: 'npm', registry: 'https://registry.npmjs.org' }
  assert.equal(validateIndex(npmIndex, options).versions, 1)

  const missingIcon = validIndex()
  assert.throws(() => validateIndex(missingIcon, { iconExists: () => false }), /must reference an existing file/)

  const remoteIcon = validIndex()
  remoteIcon.plugins[0].icon = 'https://example.com/icon.svg'
  assert.equal(validateIndex(remoteIcon, { iconExists: () => false }).plugins[0].icon, 'https://example.com/icon.svg')

  const badDataIcon = validIndex()
  badDataIcon.plugins[0].icon = 'data:image/svg+xml;base64,'
  invalid(badDataIcon, /must be a base64 SVG/)

  const tinyPng = Buffer.from('tiny').toString('base64')
  const dataIcon = validIndex()
  dataIcon.plugins[0].icon = `data:image/png;base64,${tinyPng}`
  assert.equal(validateIndex(dataIcon, options).plugins[0].icon, dataIcon.plugins[0].icon)

  const huge = Buffer.alloc(40 * 1024, 1).toString('base64')
  const bigIcon = validIndex()
  bigIcon.plugins[0].icon = `data:image/png;base64,${huge}`
  invalid(bigIcon, /must not exceed 32 KiB/)
})

test('compares SemVer precedence, including prereleases', () => {
  assert.ok(compareVersions('0.2.0', '0.1.9') > 0)
  assert.ok(compareVersions('1.0.0-rc.1', '1.0.0') < 0)
  assert.ok(compareVersions('1.0.0-alpha', '1.0.0-alpha.1') < 0)
  assert.ok(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10') < 0)
  assert.ok(compareVersions('2.0.0+build.1', '2.0.0') === 0)
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0)
})

test('addRelease records a newer version, sorts it first and inherits engines', () => {
  const document = validIndex()
  const result = addRelease(document, {
    name: 'dsh-codex-agent', version: '0.2.0', commit: COMMIT_B, timestamp: 1_760_000_100,
  }, options)
  assert.equal(result.created, false)
  assert.equal(result.unchanged, false)
  const versions = result.document.plugins[0].versions
  assert.deepEqual(versions.map(entry => entry.version), ['0.2.0', '0.1.0'])
  assert.equal(versions[0].source.commit, COMMIT_B)
  assert.equal(versions[0].engines.dsh, '^0.2.2-rc.5')
  assert.equal(versions[0].publishTimestamp, 1_760_000_100)
  // The input document is not mutated.
  assert.deepEqual(document.plugins[0].versions.map(entry => entry.version), ['0.1.0'])
})

test('addRelease is idempotent for the same commit and rejects silent replacement', () => {
  const result = addRelease(validIndex(), {
    name: 'dsh-codex-agent', version: '0.1.0', commit: COMMIT_A,
  }, options)
  assert.equal(result.unchanged, true)
  assert.throws(() => addRelease(validIndex(), {
    name: 'dsh-codex-agent', version: '0.1.0', commit: COMMIT_B,
  }, options), /already recorded with a different commit/)

  assert.throws(() => addRelease(validIndex(), {
    name: 'dsh-codex-agent', version: '0.1.0', commit: COMMIT_A, enginesDsh: 'not a range',
  }, options), /must be a SemVer range/)
})

test('addRelease creates a new plugin entry with declared metadata', () => {
  const result = addRelease(validIndex(), {
    name: 'dsh-other-plugin',
    version: '1.0.0',
    commit: COMMIT_B,
    gitUrl: 'https://github.com/example/other',
    path: 'packages/other',
    title: { en: 'Other Plugin', zh: '另一个插件' },
    description: { en: 'Another plugin', zh: '另一个插件说明' },
    author: 'MuYiYong',
    homepage: 'https://github.com/example/other',
    category: 'monitoring',
    keywords: ['example'],
    labels: ['codex'],
    enginesDsh: '>=0.2.2-rc.5 <0.3.0',
  }, options)
  assert.equal(result.created, true)
  const plugin = result.document.plugins[1]
  assert.equal(plugin.name, 'dsh-other-plugin')
  assert.equal(plugin.versions[0].source.path, 'packages/other')
  assert.deepEqual(plugin.metadata.labels, ['codex'])
  validateIndex(result.document, options)

  assert.throws(() => addRelease(validIndex(), {
    name: 'dsh-unlisted', version: '1.0.0', commit: COMMIT_A,
  }, options), /gitUrl is required/)
})

test('parses CLI flags and localized pairs', () => {
  assert.deepEqual(parseFlags(['--name', 'x', '--verbose']), { name: 'x', verbose: true })
  assert.throws(() => parseFlags(['positional']), /unexpected argument/)
  assert.deepEqual(localizedFlag('English', '中文'), { en: 'English', zh: '中文' })
  assert.deepEqual(localizedFlag('English', undefined), { en: 'English' })
  assert.equal(localizedFlag(undefined, '中文'), undefined)
})
