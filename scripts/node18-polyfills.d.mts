export function makeWithResolvers<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}
export function makeGetBuiltinModule(): (id: string) => unknown
export function installNode18Polyfills(): void
