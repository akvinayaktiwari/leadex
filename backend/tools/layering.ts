import type { LayerViolation, SourceFile } from '../src/types/index.js'

// External SDKs that only repositories (or lib client factories) may import.
const EXTERNAL_SDKS: RegExp[] = [
  /^@aws-sdk\//,
  /^@anthropic-ai\//,
  /^openai$/,
  /^stripe$/,
  /^@clickhouse\//,
]

interface LayerRule {
  layer: string
  forbidden: RegExp[]
  rule: string
}

const RULES: LayerRule[] = [
  {
    layer: '/src/routes/',
    forbidden: [/(^|\/)repositories\//, ...EXTERNAL_SDKS],
    rule: 'routes call services only',
  },
  {
    layer: '/src/services/',
    forbidden: EXTERNAL_SDKS,
    rule: 'services call repositories only, never external SDKs',
  },
]

const IMPORT_PATTERN = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

export function findImports(source: string): string[] {
  return [...source.matchAll(IMPORT_PATTERN)].flatMap((match) => {
    const target = match[1] ?? match[2]
    return target ? [target] : []
  })
}

export function findLayerViolations(files: SourceFile[]): LayerViolation[] {
  return files.flatMap((file) => {
    const normalized = `/${file.path.replaceAll('\\', '/').replace(/^\/+/, '')}`
    const rule = RULES.find((candidate) => normalized.includes(candidate.layer))
    if (!rule) return []
    return findImports(file.source)
      .filter((importPath) => rule.forbidden.some((pattern) => pattern.test(importPath)))
      .map((importPath) => ({ file: file.path, importPath, rule: rule.rule }))
  })
}
