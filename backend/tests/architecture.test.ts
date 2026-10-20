import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findImports, findLayerViolations } from '../tools/layering.js'
import type { SourceFile } from '../src/types/index.js'

const BACKEND_ROOT = fileURLToPath(new URL('..', import.meta.url))

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return listTsFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

function loadSources(): SourceFile[] {
  return listTsFiles(join(BACKEND_ROOT, 'src')).map((file) => ({
    path: relative(BACKEND_ROOT, file),
    source: readFileSync(file, 'utf8'),
  }))
}

describe('layering (acceptance criterion 13)', () => {
  // protects=routes → services → repositories layering across the real src tree;
  // fails_when=any route imports a repository or SDK, or any service imports an SDK;
  // no_claim=does not detect dynamic require() or imports built from strings at runtime.
  it('has no layer violations in src', () => {
    expect(findLayerViolations(loadSources())).toEqual([])
  })

  // protects=the checker actually catches a route importing a repository;
  // fails_when=the checker silently passes a deliberate violation;
  // no_claim=fixture only, not a real file.
  it('flags a route that imports a repository', () => {
    const violations = findLayerViolations([
      { path: 'src/routes/bad-routes.ts', source: "import { x } from '../repositories/run-queue-repository.js'" },
    ])
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('routes call services only')
  })

  // protects=the checker catches a service importing an AWS SDK client;
  // fails_when=services can reach DynamoDB/SQS directly;
  // no_claim=fixture only.
  it('flags a service that imports an SDK', () => {
    const violations = findLayerViolations([
      { path: 'src/services/bad-service.ts', source: "import { SQSClient } from '@aws-sdk/client-sqs'" },
    ])
    expect(violations.map((v) => v.importPath)).toEqual(['@aws-sdk/client-sqs'])
  })

  // protects=import parsing covers static, re-export and dynamic forms;
  // fails_when=one form is missed so violations slip through;
  // no_claim=does not parse CommonJS require().
  it('parses static, re-export and dynamic imports', () => {
    const source = "import a from 'a'\nexport { b } from 'b'\nconst c = await import('c')"
    expect(findImports(source)).toEqual(['a', 'b', 'c'])
  })
})
