// Build the deployable package from the canonical sources:
//   lib/index.js  — host half: src/host.js verbatim (an ESM loader module).
//   lib/client.js — browser bundle: src/client.js wrapped in the web boot
//                   handoff (window.__ModuleLoader__.load({ id, factory })),
//                   with `React` provided as the platform seed word.
// Run: node scripts/build.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const libDir = join(root, 'lib')
mkdirSync(libDir, { recursive: true })

const host = readFileSync(join(root, 'src', 'host.js'), 'utf8')
writeFileSync(join(libDir, 'index.js'), host)

const client = readFileSync(join(root, 'src', 'client.js'), 'utf8')
if (client.match(/^export /m) === null) {
  throw new Error('src/client.js carries no `export ` declarations — the bundle wrapper cannot assemble exports')
}
const body = client.replace(/^export /gm, '')
const bundle = [
  '// Generated from src/client.js — do not edit directly. Run: node scripts/build.mjs',
  'window.__ModuleLoader__.load({',
  "  id: 'dsh-usage-dashboard',",
  '  factory: (require) => {',
  "    const React = require('react')",
  body.split('\n').map(line => `    ${line}`).join('\n'),
  '    return { name, inject, apply }',
  '  },',
  '})',
  '',
].join('\n')
writeFileSync(join(libDir, 'client.js'), bundle)

console.log(`built lib/index.js (${host.length} chars) and lib/client.js (${bundle.length} chars)`)
