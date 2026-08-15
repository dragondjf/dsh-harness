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
 *
 * Inject via the source launcher, e.g.
 *   node --import tsx/esm --import ./scripts/node18-polyfills.ts apps/cli/src/bin.ts
 */
import { createRequire } from 'node:module'

export function makeWithResolvers<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export function makeGetBuiltinModule(): (id: string) => unknown {
  const requireFn = createRequire(import.meta.url)
  return (id: string) => requireFn(id)
}

export function installNode18Polyfills(): void {
  const P = Promise as unknown as { withResolvers?: typeof makeWithResolvers }
  if (typeof P.withResolvers !== 'function') P.withResolvers = makeWithResolvers

  const proc = process as unknown as { getBuiltinModule?: (id: string) => unknown }
  if (typeof proc.getBuiltinModule !== 'function') proc.getBuiltinModule = makeGetBuiltinModule()

  const Sym = Symbol as unknown as { dispose?: symbol; asyncDispose?: symbol }
  if (typeof Sym.dispose !== 'symbol') Sym.dispose = Symbol.for('nodejs.dispose')
  if (typeof Sym.asyncDispose !== 'symbol') Sym.asyncDispose = Symbol.for('nodejs.asyncDispose')
}

installNode18Polyfills()
