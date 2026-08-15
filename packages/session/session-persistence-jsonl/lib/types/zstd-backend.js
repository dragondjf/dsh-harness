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
import * as nodeZlib from 'node:zlib';
const nativeZlib = nodeZlib;
/** True when the running Node ships the zstd one-shot + streaming APIs (Node 22+). */
export const nativeZstdAvailable = typeof nativeZlib.zstdCompress === 'function';
const CHECKSUM_FLAG = nativeZlib.constants?.ZSTD_c_checksumFlag ?? 0;
const CHECKSUM_OPTIONS = { params: { [CHECKSUM_FLAG]: 1 } };
const FLUSH_FLAG = nativeZlib.constants?.ZSTD_e_flush ?? 0;
const PARTIAL_FLUSH_OPTIONS = { finishFlush: FLUSH_FLAG };
let wasm;
if (!nativeZstdAvailable) {
    const mod = await import('@hpcc-js/wasm-zstd');
    wasm = await mod.Zstd.load();
}
/** Compress one independently decodable, checksummed Zstandard frame. */
export async function compressFrameBackend(input) {
    if (nativeZstdAvailable) {
        return await new Promise((resolve, reject) => {
            nativeZlib.zstdCompress(input, CHECKSUM_OPTIONS, (error, result) => {
                if (error)
                    reject(error);
                else
                    resolve(result);
            });
        });
    }
    return Buffer.from(wasm.compress(Buffer.isBuffer(input) ? input : Buffer.from(input)));
}
/** Decompress one complete frame. */
export async function decompressFrameBackend(input) {
    if (nativeZstdAvailable) {
        return await new Promise((resolve, reject) => {
            nativeZlib.zstdDecompress(input, undefined, (error, result) => {
                if (error)
                    reject(error);
                else
                    resolve(result);
            });
        });
    }
    return Buffer.from(wasm.decompress(input));
}
/**
 * Recover available plaintext from a structurally incomplete final frame.
 * Native zlib uses `ZSTD_e_flush` (partial-flush) for this; the wasm backend
 * best-effort stream-decodes the available bytes and returns whatever
 * plaintext is producible, treating an unfinished frame as expected.
 */
export async function decompressPrefixBackend(input) {
    if (nativeZstdAvailable) {
        return await new Promise((resolve, reject) => {
            nativeZlib.zstdDecompress(input, PARTIAL_FLUSH_OPTIONS, (error, result) => {
                if (error)
                    reject(error);
                else
                    resolve(result);
            });
        });
    }
    wasm.resetDecompression();
    let produced;
    try {
        produced = wasm.decompressChunk(input);
    }
    catch {
        throw new Error('incomplete Zstandard frame cannot be recovered on Node <22 (no zstd partial-flush)');
    }
    try {
        wasm.decompressEnd();
    }
    catch {
        // incomplete final frame: expected; return whatever plaintext was produced
    }
    return Buffer.from(produced);
}
/** Synchronous one-shot decode used by the public frame decoder. */
export function decompressSyncBackend(input) {
    if (nativeZstdAvailable) {
        return nativeZlib.zstdDecompressSync(input);
    }
    return Buffer.from(wasm.decompress(input));
}
//# sourceMappingURL=zstd-backend.js.map