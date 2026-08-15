/**
 * Public-API synchronous Zstandard frame decoder fallback.
 * @module dsh-session-persistence-jsonl/zstd-public-decoder
 */
import { decompressSyncBackend } from "./zstd-backend.js";
/** Multi-frame adapter built from the zstd backend (native on Node 22+, wasm otherwise). */
export class PublicZstdFrameDecoder {
    started = false;
    closed = false;
    /** @inheritdoc */
    *decode(source, frames) {
        if (this.started)
            throw new Error('Zstandard frame decoder was already started');
        if (this.closed)
            throw new Error('cannot start a closed Zstandard frame decoder');
        this.started = true;
        try {
            for (const { start, end } of frames) {
                let decoded;
                try {
                    decoded = decompressSyncBackend(source.subarray(start, end));
                }
                catch (error) {
                    throw new Error(`corrupt Zstandard session log: frame at byte ${start} failed validation`, {
                        cause: error,
                    });
                }
                yield decoded;
            }
        }
        finally {
            this.close();
        }
    }
    /** @inheritdoc */
    close() {
        this.closed = true;
    }
}
//# sourceMappingURL=zstd-public-decoder.js.map