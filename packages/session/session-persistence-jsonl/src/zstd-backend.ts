/**
 * Zstandard backend abstraction for the JSONL persistence layer.
 *
 * Node 22+ ships zstd in `node:zlib` (one-shot + streaming APIs); older Node
 * releases do not. This module detects the running Node shape and, when the
 * native APIs are absent, falls back to the `@hpcc-js/wasm-zstd` WebAssembly
 * build so the persistence backend runs on Node 18+ without a per-ABI native
 * addon rebuild. Both paths emit and decode standard Zstandard frames, so
 * artifacts are interchangeable across Node versions.
 *
 * @module dsh-session-persistence-jsonl/zstd-backend
 */

import * as nodeZlib from 'node:zlib'
import type { Zstd } from '@hpcc-js/wasm-zstd'

const nativeZlib = nodeZlib as unknown as {
  zstdCompress?: (input: Buffer | string, options: object, cb: (error: Error | null, result?: Buffer) => void) => void
  zstdDecompress?: (input: Buffer, options: object | undefined, cb: (error: Error | null, result?: Buffer) => void) => void
  zstdDecompressSync?: (input: Buffer) => Buffer
  constants?: { ZSTD_c_checksumFlag?: number; ZSTD_e_flush?: number }
}

/** True when the running Node ships the zstd one-shot + streaming APIs (Node 22+). */
export const nativeZstdAvailable: boolean = typeof nativeZlib.zstdCompress === 'function'

const CHECKSUM_FLAG = nativeZlib.constants?.ZSTD_c_checksumFlag ?? 0
const CHECKSUM_OPTIONS = { params: { [CHECKSUM_FLAG]: 1 } }
const FLUSH_FLAG = nativeZlib.constants?.ZSTD_e_flush ?? 0
const PARTIAL_FLUSH_OPTIONS = { finishFlush: FLUSH_FLAG }

let wasm: Zstd | undefined
if (!nativeZstdAvailable) {
  const mod = await import('@hpcc-js/wasm-zstd')
  wasm = await mod.Zstd.load()
}

function requireWasm(): Zstd {
  if (!wasm) throw new Error('@hpcc-js/wasm-zstd backend not initialized')
  return wasm
}

function requireNativeCompress(): NonNullable<typeof nativeZlib.zstdCompress> {
  const fn = nativeZlib.zstdCompress
  if (typeof fn !== 'function') throw new Error('native zstd compress unavailable')
  return fn
}

function requireNativeDecompress(): NonNullable<typeof nativeZlib.zstdDecompress> {
  const fn = nativeZlib.zstdDecompress
  if (typeof fn !== 'function') throw new Error('native zstd decompress unavailable')
  return fn
}

function requireNativeDecompressSync(): NonNullable<typeof nativeZlib.zstdDecompressSync> {
  const fn = nativeZlib.zstdDecompressSync
  if (typeof fn !== 'function') throw new Error('native zstd sync decompress unavailable')
  return fn
}

/** Compress one independently decodable, checksummed Zstandard frame. */
export async function compressFrameBackend(input: Buffer | string): Promise<Buffer> {
  if (nativeZstdAvailable) {
    const zstdCompress = requireNativeCompress()
    return await new Promise<Buffer>((resolve, reject) => {
      zstdCompress(input as Buffer, CHECKSUM_OPTIONS, (error, result) => {
        if (error) reject(error)
        else if (result) resolve(result)
        else reject(new Error('zstd compress produced no output'))
      })
    })
  }
  return Buffer.from(requireWasm().compress(Buffer.isBuffer(input) ? input : Buffer.from(input)))
}

/** Decompress one complete frame. */
export async function decompressFrameBackend(input: Buffer): Promise<Buffer> {
  if (nativeZstdAvailable) {
    const zstdDecompress = requireNativeDecompress()
    return await new Promise<Buffer>((resolve, reject) => {
      zstdDecompress(input, undefined, (error, result) => {
        if (error) reject(error)
        else if (result) resolve(result)
        else reject(new Error('zstd decompress produced no output'))
      })
    })
  }
  return Buffer.from(requireWasm().decompress(input))
}

/**
 * Recover available plaintext from a structurally incomplete final frame.
 * Native zlib uses `ZSTD_e_flush` (partial-flush) for this; the wasm backend
 * best-effort stream-decodes the available bytes and returns whatever
 * plaintext is producible, treating an unfinished frame as expected.
 */
export async function decompressPrefixBackend(input: Buffer): Promise<Buffer> {
  if (nativeZstdAvailable) {
    const zstdDecompress = requireNativeDecompress()
    return await new Promise<Buffer>((resolve, reject) => {
      zstdDecompress(input, PARTIAL_FLUSH_OPTIONS, (error, result) => {
        if (error) reject(error)
        else if (result) resolve(result)
        else reject(new Error('zstd decompress produced no output'))
      })
    })
  }
  const backend = requireWasm()
  backend.resetDecompression()
  let produced: Uint8Array
  try {
    produced = backend.decompressChunk(input)
  } catch {
    throw new Error('incomplete Zstandard frame cannot be recovered on Node <22 (no zstd partial-flush)')
  }
  try {
    backend.decompressEnd()
  } catch {
    // incomplete final frame: expected; return whatever plaintext was produced
  }
  return Buffer.from(produced)
}

/** Synchronous one-shot decode used by the public frame decoder. */
export function decompressSyncBackend(input: Buffer): Buffer {
  if (nativeZstdAvailable) {
    return requireNativeDecompressSync()(input)
  }
  return Buffer.from(requireWasm().decompress(input))
}
