/**
 * Node 18 compatibility polyfills for DeepSeek Harness.
 *
 * The harness officially targets Node `^22.19 || >=24`, but these shims let it
 * boot on Node 18 where the following globals are absent. Each shim is installed
 * only when missing, so on supported Node versions this module is a no-op.
 *
 * - `Promise.withResolvers`: used pervasively across the runtime (timers, HMR,
 *   subprocess-local, jobs-local, workflow worker threads, schedule, ACP,
 *   presets).
 * - `process.getBuiltinModule`: referenced by `!!js` expressions in cordis.yml
 *   configs (agent presets, the mcp-memory example).
 * - `Symbol.dispose` / `Symbol.asyncDispose`: required by down-leveled `using`
 *   declarations under tsx on Node 18.
 * - `crypto` (Web Crypto) global: exposed as a global since Node 19/20, but Node
 *   18 only provides it via `node:crypto`.webcrypto. Several packages reference
 *   the bare `crypto` global.
 *
 * This file is plain ESM JavaScript (no TypeScript) so it can be loaded via
 * `node --import` on Node 18 *before* the tsx loader registers, guaranteeing the
 * shims exist before any `.ts` module (including tsx itself) is evaluated.
 *
 * Inject via the source launcher, e.g.
 *   node --import ./scripts/node18-polyfills.mjs --import tsx/esm apps/cli/src/bin.ts
 */
import { createRequire } from 'node:module'
import { webcrypto } from 'node:crypto'

export function makeWithResolvers() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export function makeGetBuiltinModule() {
  const requireFn = createRequire(import.meta.url)
  return (id) => requireFn(id)
}

export function makeArrayShims() {
  const AP = Array.prototype
  const define = (name, fn) => {
    if (typeof AP[name] !== 'function') {
      Object.defineProperty(AP, name, { value: fn, writable: true, configurable: true, enumerable: false })
    }
  }
  define('toSpliced', function (start, deleteCount, ...items) {
    const out = this.slice()
    out.splice(start, deleteCount, ...items)
    return out
  })
  define('toReversed', function () {
    return this.slice().reverse()
  })
  define('toSorted', function (compareFn) {
    return this.slice().sort(compareFn)
  })
  define('with', function (index, value) {
    const out = this.slice()
    out[index] = value
    return out
  })
}

export function installNode18Polyfills() {
  const P = Promise
  if (typeof P.withResolvers !== 'function') P.withResolvers = makeWithResolvers

  const proc = process
  if (typeof proc.getBuiltinModule !== 'function') proc.getBuiltinModule = makeGetBuiltinModule()

  const Sym = Symbol
  if (typeof Sym.dispose !== 'symbol') Sym.dispose = Symbol.for('nodejs.dispose')
  if (typeof Sym.asyncDispose !== 'symbol') Sym.asyncDispose = Symbol.for('nodejs.asyncDispose')

  // `crypto` global (Web Crypto) — global since Node 19/20; Node 18 only has it
  // behind `node:crypto`.webcrypto.
  if (typeof globalThis.crypto === 'undefined') globalThis.crypto = webcrypto

  // ES2023 Array methods (toSpliced/toReversed/toSorted/with) — shipped in Node
  // 20; absent on Node 18. Used by the agent inbox, api-proxy, and
  // agent-instructions packages.
  makeArrayShims()
}

installNode18Polyfills()
