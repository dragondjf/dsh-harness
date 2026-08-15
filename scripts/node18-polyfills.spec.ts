import { describe, expect, it, vi } from 'vitest'
import { installNode18Polyfills, makeGetBuiltinModule, makeWithResolvers } from './node18-polyfills.ts'

describe('node18 polyfills', () => {
  it('makeWithResolvers resolves and rejects per spec', async () => {
    const { promise, resolve } = makeWithResolvers<number>()
    expect(promise).toBeInstanceOf(Promise)
    const onResolve = vi.fn()
    promise.then(onResolve)
    resolve(7)
    await promise
    expect(onResolve).toHaveBeenCalledWith(7)

    const { promise: p2, reject } = makeWithResolvers<string>()
    const onReject = vi.fn()
    p2.catch(onReject)
    reject(new Error('x'))
    await p2.catch(() => undefined)
    expect(onReject).toHaveBeenCalled()
  })

  it('makeGetBuiltinModule resolves node: builtins', () => {
    const get = makeGetBuiltinModule()
    const pathMod = get('node:path') as { join: (...a: string[]) => string }
    expect(typeof pathMod.join).toBe('function')
  })

  it('installNode18Polyfills is idempotent and safe on a supported Node', () => {
    expect(() => installNode18Polyfills()).not.toThrow()
    expect(typeof Promise.withResolvers).toBe('function')
    expect(typeof (process as { getBuiltinModule?: unknown }).getBuiltinModule).toBe('function')
    expect(typeof Symbol.dispose).toBe('symbol')
    expect(typeof Symbol.asyncDispose).toBe('symbol')
  })
})
