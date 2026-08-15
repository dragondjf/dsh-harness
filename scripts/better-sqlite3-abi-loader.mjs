// scripts/better-sqlite3-abi-loader.mjs
//
// Ensures the correct native ABI build of better-sqlite3 is selected for the
// active Node version at process startup. A native module compiled for Node 18
// (NODE_MODULE_VERSION 108) fails to load under Node 23 (131) and vice versa,
// which broke `dsh` after the Node 18 migration.
//
// Strategy (run with `--import ./scripts/better-sqlite3-abi-loader.mjs`, BEFORE
// any module that requires better-sqlite3, e.g. before the polyfill import):
//   1. If a prebuilt `better_sqlite3.abi{NODE_MODULE_VERSION}.node` exists in the
//      package's `prebuilt/` dir, copy it over `build/Release/better_sqlite3.node`.
//   2. Otherwise, if the existing generic binding cannot load under this Node,
//      compile it on the fly with the active Node's bundled node-gyp.

import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

try {
  // Resolve the installed better-sqlite3 package via a package that depends on it.
  const anchor = join(repoRoot, 'packages', 'storage', 'storage-sqlite');
  let pkgDir;
  try {
    pkgDir = dirname(
      createRequire(join(anchor, 'package.json')).resolve('better-sqlite3/package.json')
    );
  } catch {
    // better-sqlite3 not resolvable from this context; nothing to do.
    pkgDir = undefined;
  }

  if (pkgDir) {
    const mod = process.versions.modules;
    const prebuilt = join(pkgDir, 'prebuilt', `better_sqlite3.abi${mod}.node`);
    const releaseDir = join(pkgDir, 'build', 'Release');
    const generic = join(releaseDir, 'better_sqlite3.node');

    if (existsSync(prebuilt)) {
      // Fast path: a prebuilt for this exact Node ABI is available.
      mkdirSync(releaseDir, { recursive: true });
      copyFileSync(prebuilt, generic);
    } else {
      // No prebuilt. If the generic binding already loads, we are done.
      try {
        require(generic);
      } catch {
        // Fallback: compile better-sqlite3 for the active Node using its
        // bundled node-gyp (handles arbitrary Node versions / fresh installs).
        const nodeRoot = dirname(dirname(process.execPath));
        const nodeGyp = join(
          nodeRoot,
          'lib',
          'node_modules',
          'npm',
          'node_modules',
          'node-gyp',
          'bin',
          'node-gyp.js'
        );
        mkdirSync(releaseDir, { recursive: true });
        execFileSync(process.execPath, [nodeGyp, 'rebuild', '--release'], {
          cwd: pkgDir,
          stdio: 'inherit',
        });
      }
    }
  }
} catch (err) {
  // Never let ABI selection break process startup; surface the cause and continue.
  console.error('[better-sqlite3-abi-loader] warning:', err?.message ?? err);
}
