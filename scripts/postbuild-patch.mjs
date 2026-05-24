#!/usr/bin/env node
/**
 * Post-build patch script for DuckHive.
 * Applies runtime fixes to the bundled cli.mjs that can't be fixed at source level.
 * Run automatically after `bun run build`.
 */
import { readFileSync, writeFileSync } from 'fs'

const file = process.env.DUCKHIVE_POSTBUILD_PATCH_FILE ?? 'dist/cli.mjs'
let content = readFileSync(file, 'utf8')
let patches = 0
let alreadyPatched = 0
const missingPatches = []

function applyRequiredPatch(name, before, after, alreadyPatchedCheck) {
    const found = before instanceof RegExp ? before.test(content) : content.includes(before)
    if (found) {
        content = content.replace(before, after)
        patches++
        console.log(`[PASS] Patched ${name}`)
        return
    }

    const check = alreadyPatchedCheck !== undefined ? alreadyPatchedCheck : after
    const alreadyFound = check instanceof RegExp ? check.test(content) : content.includes(check)
    if (alreadyFound) {
        alreadyPatched++
        console.log(`[PASS] ${name} already patched`)
        return
    }

    missingPatches.push(name)
    console.error(`[FAIL] Missing expected post-build patch target: ${name}`)
}

// Patch 1: isZ4Schema - guard against undefined/null input
const isZ4SchemaOld = `function isZ4Schema(s) {
  const schema = s;
  return !!schema._zod;
}`
const isZ4SchemaNew = `function isZ4Schema(s) {
  const schema = s;
  if (!schema || typeof schema !== 'object') return false;
  return !!schema._zod;
}`
applyRequiredPatch('isZ4Schema', isZ4SchemaOld, isZ4SchemaNew)

// Patch 2: toJSONSchema - guard against non-object input.
// Use a regex with a backreference so we match whatever parameter name
// Bun's bundler assigns (input, input2, input3, etc.).
const toJSONRegex = /function toJSONSchema\((\w+), _params\) \{\r?\n  if \(\1 instanceof \$ZodRegistry\) \{/
const toJSONReplacement = (match, p1) => `function toJSONSchema(${p1}, _params) {\n  if (!${p1} || typeof ${p1} !== 'object') { return null; }\n  if (${p1} instanceof $ZodRegistry) {`
const toJSONAlreadyPatched = /function toJSONSchema\(\w+, _params\) \{\r?\n  if \(!\w+ \|\| typeof \w+ !== 'object'\) \{ return null; \}\r?\n  if \(\w+ instanceof \$ZodRegistry\) \{/
applyRequiredPatch('toJSONSchema', toJSONRegex, toJSONReplacement, toJSONAlreadyPatched)

// Patch 3: JSONSchemaGenerator.process - guard against missing _zod
const procOld = `    const def = schema._zod.def;`
const procNew = `    if (!schema || typeof schema !== 'object' || !('_zod' in schema)) { return; }
    const def = schema._zod.def;`
applyRequiredPatch('JSONSchemaGenerator.process', procOld, procNew)

if (missingPatches.length > 0) {
    console.error(
        `Post-build patch failed: ${missingPatches.length} required patch target(s) were not found in ${file}.`,
    )
    process.exit(1)
}

writeFileSync(file, content)
console.log(
    `Post-build patch: ${patches} patches applied, ${alreadyPatched} already present`,
)
