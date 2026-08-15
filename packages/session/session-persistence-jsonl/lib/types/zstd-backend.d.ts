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
/** True when the running Node ships the zstd one-shot + streaming APIs (Node 22+). */
export declare const nativeZstdAvailable: boolean;
/** Compress one independently decodable, checksummed Zstandard frame. */
export declare function compressFrameBackend(input: Buffer | string): Promise<Buffer>;
/** Decompress one complete frame. */
export declare function decompressFrameBackend(input: Buffer): Promise<Buffer>;
/**
 * Recover available plaintext from a structurally incomplete final frame.
 * Native zlib uses `ZSTD_e_flush` (partial-flush) for this; the wasm backend
 * best-effort stream-decodes the available bytes and returns whatever
 * plaintext is producible, treating an unfinished frame as expected.
 */
export declare function decompressPrefixBackend(input: Buffer): Promise<Buffer>;
/** Synchronous one-shot decode used by the public frame decoder. */
export declare function decompressSyncBackend(input: Buffer): Buffer;
//# sourceMappingURL=zstd-backend.d.ts.map