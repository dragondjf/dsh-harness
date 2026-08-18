/**
 * Build a self-contained, install-free green package for dsh (the deepseek
 * harness web/CLI surface).
 *
 * Route (owned by this file): instead of copying the 2.7 GB pnpm workspace
 * node_modules (a symlink forest that explodes archive speed on NTFS), deploy
 * a flat, hoisted, symlink-free, production-only closure with `pnpm deploy
 * --prod` — the same mechanism `scripts/build-exe-for-python-sdk.ts` uses for
 * the Python SDK runtime carrier. The closure carries pre-built lib/ artifacts
 * (every package's `files` field) and the web frontend dist (resolved at
 * runtime via `require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')`
 * in packages/bundle/web-app).
 *
 * Layout of one product (one OS/arch, since native addons are platform-specific):
 *
 *   dsh-web-<version>-<platform>-<arch>/
 *     node/                     # bundled Node runtime (fixed version)
 *     app/                      # dsh deployment closure (pnpm deploy output)
 *       lib/bin.js              # backend entry (@deepseek-ai/dsh)
 *       node_modules/...        # hoisted, symlink-free, prod-only
 *     data/                     # DSH_HOME (moves with the package)
 *     start-web.cmd / .ps1     # launchers (Windows)
 *     start-web.sh             # launcher (Unix)
 *     README.txt
 *
 * The script is platform-agnostic: run it on the target platform so native
 * addons (node-pty/koffi/node-addon-require-builtin) match the binary.
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The closure root whose dependencies define the package. */
const DEPLOY_ROOT_PACKAGE = '@deepseek-ai/dsh'
/** Backend entry inside the deployed closure. */
const ENTRY_BIN = 'lib/bin.js'
const OUT_DIR = 'dist-green'
/** Legacy-hoist recovery reads missing direct deps from the workspace root install. */
const WORKSPACE_NODE_MODULES = 'node_modules'
/** Frontend artifact package (resolved at runtime via its exports map). */
const FRONTEND_PACKAGE = '@deepseek-ai/dsh-web-frontend'
const FRONTEND_DIST_INDEX = `${FRONTEND_PACKAGE}/dist/index.html`

const PLATFORMS = ['win32', 'linux', 'darwin'] as const
const ARCHES = ['x64', 'arm64'] as const
type Platform = (typeof PLATFORMS)[number]
type Arch = (typeof ARCHES)[number]

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value)
}
function isArch(value: string): value is Arch {
  return (ARCHES as readonly string[]).includes(value)
}

class Target {
  private constructor(
    readonly platform: Platform,
    readonly arch: Arch,
  ) {}
  get dir(): string {
    return `${this.platform}-${this.arch}`
  }
  static parse(spec: string): Target {
    const [platform, arch] = spec.split('-')
    if (platform === undefined || arch === undefined || spec.split('-').length !== 2) {
      throw new Error(`build-green-package: target ${JSON.stringify(spec)} must be <platform>-<arch>, e.g. win32-x64, linux-x64, darwin-arm64.`)
    }
    if (!isPlatform(platform)) throw new Error(`build-green-package: unsupported platform ${JSON.stringify(platform)}.`)
    if (!isArch(arch)) throw new Error(`build-green-package: unsupported arch ${JSON.stringify(arch)}.`)
    return new Target(platform, arch)
  }
  static host(): Target {
    const platform = (process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : undefined) as Platform | undefined
    if (platform === undefined) throw new Error(`build-green-package: unsupported host platform ${process.platform}.`)
    const arch = (process.arch === 'x64' || process.arch === 'arm64' ? process.arch : undefined) as Arch | undefined
    if (arch === undefined) throw new Error(`build-green-package: unsupported host arch ${process.arch}.`)
    return new Target(platform, arch)
  }
}

class BuildCli {
  private constructor(
    readonly target: Target,
    readonly nodeDir: string | undefined,
    readonly useLocalNode: boolean,
    readonly outDir: string,
    readonly skipBuild: boolean,
    readonly dryRun: boolean,
    readonly skipSmoke: boolean,
  ) {}
  static parse(argv: string[]): BuildCli {
    let values: ReturnType<typeof BuildCli.parseRaw>
    try {
      values = BuildCli.parseRaw(argv)
    } catch (error) {
      console.error(`build-green-package: ${error instanceof Error ? error.message : String(error)}\n`)
      console.error(BuildCli.usage())
      process.exit(1)
    }
    if (values.help) {
      console.log(BuildCli.usage())
      process.exit(0)
    }
    const target = values.target === undefined ? Target.host() : Target.parse(values.target)
    if (values['use-local-node'] && values.node !== undefined) {
      throw new Error('build-green-package: pass only one of --use-local-node / --node, not both.')
    }
    const nodeDir = values['use-local-node'] ? process.execPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '') : values.node
    if (nodeDir === undefined) {
      throw new Error('build-green-package: pass --node <dir> or --use-local-node (the bundled Node runtime is required).')
    }
    return new BuildCli(target, nodeDir, values['use-local-node'], values.out ?? OUT_DIR, values['skip-build'], values['dry-run'], values['skip-smoke'])
  }
  private static parseRaw(argv: string[]) {
    return parseArgs({
      args: argv,
      options: {
        'target': { type: 'string' },
        'node': { type: 'string' },
        'use-local-node': { type: 'boolean', default: false },
        'out': { type: 'string' },
        'skip-build': { type: 'boolean', default: false },
        'skip-smoke': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'help': { type: 'boolean', default: false },
      },
    }).values
  }
  private static usage(): string {
    return [
      'Usage: pnpm exec tsx scripts/build-green-package.ts [flags]',
      '',
      '  --target=<platform>-<arch>  e.g. win32-x64, linux-x64, darwin-arm64. Default: host.',
      '  --node=<dir>                bundled Node runtime directory (node[.exe] inside).',
      '  --use-local-node            embed the Node running this script instead of --node.',
      '  --out=<dir>                 output root (default dist-green).',
      '  --skip-build                skip `pnpm run build` (lib/ + web/dist must already exist).',
      '  --skip-smoke                do not boot the package for a smoke check.',
      '  --dry-run                   print commands without executing.',
      '  --help                      print this help.',
      '',
      'Produces dist-green/dsh-web-<version>-<platform>-<arch>/{node,app,data,...} + .tar.gz.',
    ].join('\n')
  }
}

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

class GreenPackageBuild {
  readonly packageDir: string
  readonly appDir: string
  readonly nodeDir: string
  readonly dataDir: string
  readonly outDir: string

  constructor(private readonly cli: BuildCli) {
    this.outDir = resolve(root, cli.outDir)
    this.packageDir = join(this.outDir, `dsh-web-${this.version}-${cli.target.dir}`)
    this.appDir = join(this.packageDir, 'app')
    this.nodeDir = join(this.packageDir, 'node')
    this.dataDir = join(this.packageDir, 'data')
  }

  private get version(): string {
    // Synchronous read is fine at construction time; tsx provides fs.
    const pkg = JSON.parse(stripBomSync(readFileSync(join(root, 'apps', 'cli', 'package.json'), 'utf8'))) as { version: string }
    return pkg.version
  }

  async build(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log('build-green-package: skipping pnpm run build (--skip-build)')
      return
    }
    await this.run('build', pnpmBin(), ['run', 'build'])
  }

  async deploy(): Promise<void> {
    if (this.appDir === root || root.startsWith(this.appDir + sep)) {
      throw new Error(`build-green-package: refusing to clear staging dir ${this.appDir}: it contains the repo root.`)
    }
    if (this.cli.dryRun) console.log(`build-green-package: [dry-run] rm -rf ${this.appDir}`)
    else await rm(this.appDir, { recursive: true, force: true })
    await this.run('deploy', pnpmBin(), [
      '--filter', DEPLOY_ROOT_PACKAGE,
      'deploy', '--prod',
      '--config.node-linker=hoisted',
      '--config.auto-install-peers=false',
      '--config.link-workspace-packages=true',
      this.appDir,
    ])
    await this.restoreLegacyHoists()
    await this.restoreWorkspacePeerHoists()
    await this.materializeStagedLinks()
  }

  /**
   * `pnpm deploy --prod` omits workspace packages that are only reachable
   * through a peerDependency (e.g. `@deepseek-ai/cordis-plugin-group`, imported
   * at runtime by `@deepseek-ai/dsh-app-boot` but declared only as a peer/dev
   * dep there). They resolve fine in the dev hoist but are absent from the flat
   * closure, surfacing as ERR_MODULE_NOT_FOUND at boot. Walk every package
   * already present in the closure, collect its runtime deps + peer deps, and
   * copy any missing `@deepseek-ai/*` workspace package from the root install.
   */
  private async restoreWorkspacePeerHoists(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-green-package: [dry-run] restore workspace peer hoists')
      return
    }
    const closureNM = join(this.appDir, 'node_modules')
    const restored: string[] = []
    // One pass resolves the immediate peer gaps; a second pass covers peers of
    // the newly added packages. Two passes are enough for this workspace depth.
    for (let pass = 0; pass < 2; pass++) {
      const declared = new Set<string>()
      for (const pkgDir of await this.walkPackageDirs(closureNM)) {
        const manifest = await this.readManifest(pkgDir)
        if (!manifest) continue
        for (const dep of [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]) {
          if (dep.startsWith('@deepseek-ai/')) declared.add(dep)
        }
      }
      for (const dep of [...declared].sort()) {
        const destination = join(closureNM, dep)
        if (existsSync(destination)) continue
        // Workspace packages that are only reachable through a peer/dev dep may
        // be absent from the root node_modules hoist (pnpm does not link them).
        // Fall back to the workspace source tree, matched by package name.
        const source = await this.findWorkspaceSource(dep)
        if (source === undefined) {
          console.log(`build-green-package: peer hoist ${dep} not found in root node_modules or workspace source; skipping`)
          continue
        }
        await mkdir(dirname(destination), { recursive: true })
        const nestedNodeModules = join(source, 'node_modules')
        await cp(source, destination, {
          recursive: true,
          dereference: true,
          filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
        })
        restored.push(dep)
      }
    }
    if (restored.length > 0) console.log(`build-green-package: restored workspace peer hoists: ${restored.join(', ')}`)
  }

  /** Locate a workspace package's source dir by its package name (vendored + packages + apps). */
  private async findWorkspaceSource(name: string): Promise<string | undefined> {
    const candidates = [
      join(root, 'node_modules', name),
      join(root, 'vendor', name.replace('@deepseek-ai/', '')),
    ]
    for (const c of candidates) if (existsSync(c)) return c
    const globs = ['vendor', 'packages', 'apps', 'native', 'examples', 'python']
    for (const g of globs) {
      const base = join(root, g)
      if (!existsSync(base)) continue
      const found = await this.findNamedPackage(base, name)
      if (found !== undefined) return found
    }
    return undefined
  }

  private async findNamedPackage(dir: string, name: string): Promise<string | undefined> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return undefined
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'lib') continue
      const child = join(dir, entry.name)
      const manifest = await this.readManifest(child)
      if (manifest && (manifest as { name?: string }).name === name) return child
      const nested = await this.findNamedPackage(child, name)
      if (nested !== undefined) return nested
    }
    return undefined
  }

  /** Enumerate every package directory directly under a node_modules tree (top + scoped). */
  private async walkPackageDirs(nodeModules: string): Promise<string[]> {
    if (!existsSync(nodeModules)) return []
    const dirs: string[] = []
    for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
      const top = join(nodeModules, entry.name)
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      if (entry.name.startsWith('@')) {
        for (const sub of await readdir(top, { withFileTypes: true })) {
          if (sub.isDirectory()) dirs.push(join(top, sub.name))
        }
      } else {
        dirs.push(top)
      }
    }
    return dirs
  }

  private async readManifest(dir: string): Promise<{ dependencies?: Record<string, string>; peerDependencies?: Record<string, string> } | undefined> {
    const path = join(dir, 'package.json')
    if (!existsSync(path)) return undefined
    try {
      return JSON.parse(await readFile(path, 'utf8')) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
    } catch {
      return undefined
    }
  }

  /**
   * Restore direct deps that pnpm's legacy hoister places beside the workspace
   * root install instead of in the target. The runtime manifest supplies every
   * peer, so package-local node_modules trees are omitted to keep one flat
   * Cordis instance and a symlink-free payload.
   */
  private async restoreLegacyHoists(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-green-package: [dry-run] restore direct dependencies omitted by legacy deploy')
      return
    }
    const manifestPath = join(this.appDir, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
    const sourceNodeModules = resolve(root, WORKSPACE_NODE_MODULES)
    const restored: string[] = []
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      const destination = join(this.appDir, 'node_modules', dependency)
      if (existsSync(destination)) continue
      const source = join(sourceNodeModules, dependency)
      if (!existsSync(source)) {
        throw new Error(`build-green-package: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`)
      }
      await mkdir(dirname(destination), { recursive: true })
      const nestedNodeModules = join(source, 'node_modules')
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      restored.push(dependency)
    }
    const stillMissing = Object.keys(manifest.dependencies ?? {})
      .filter(dependency => !existsSync(join(this.appDir, 'node_modules', dependency)))
    if (stillMissing.length > 0) {
      throw new Error(`build-green-package: staged dependencies remain missing: ${stillMissing.join(', ')}.`)
    }
    if (restored.length > 0) console.log(`build-green-package: restored legacy deploy hoists: ${restored.join(', ')}`)
  }

  /** Replace deploy-time package links with files and reject any remaining link. */
  private async materializeStagedLinks(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-green-package: [dry-run] materialize staged package links')
      return
    }
    const nodeModules = join(this.appDir, 'node_modules')
    let remaining = await this.findSymlink(nodeModules)
    while (remaining !== undefined) {
      const segments = remaining.slice(nodeModules.length + 1).split(sep)
      const binIndex = segments.lastIndexOf('.bin')
      if (binIndex >= 0) {
        await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
        remaining = await this.findSymlink(nodeModules)
        continue
      }
      const destination = remaining
      const source = await realpath(destination)
      const nestedNodeModules = join(source, 'node_modules')
      await rm(destination, { recursive: true, force: true })
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      remaining = await this.findSymlink(nodeModules)
    }
  }

  private async findSymlink(directory: string): Promise<string | undefined> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) return path
      if (metadata.isDirectory()) {
        const nested = await this.findSymlink(path)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }

  /** Ensure the frontend dist is present in the closure; deploy carries it, but copy as a fallback. */
  async ensureFrontend(): Promise<void> {
    const target = join(this.appDir, 'node_modules', FRONTEND_PACKAGE, 'dist')
    const index = join(target, 'index.html')
    if (existsSync(index)) {
      console.log(`build-green-package: frontend dist already in closure (${index})`)
      return
    }
    const source = join(root, 'apps', 'web', 'dist')
    if (!existsSync(source)) {
      throw new Error(`build-green-package: frontend dist missing from closure AND ${source} absent (run without --skip-build).`)
    }
    if (this.cli.dryRun) {
      console.log(`build-green-package: [dry-run] cp ${source} ${target}`)
      return
    }
    await mkdir(target, { recursive: true })
    await cp(source, target, { recursive: true, dereference: true })
    console.log(`build-green-package: copied frontend dist from ${source} into closure`)
  }

  /** Locate the node binary inside a runtime dir (handles `node`, `node.exe`, `bin/node` layouts). */
  private findNode(dir: string): string | undefined {
    const candidates = [
      join(dir, 'node'),
      join(dir, 'node.exe'),
      join(dir, 'bin', 'node'),
      join(dir, 'bin', 'node.exe'),
    ]
    return candidates.find(c => existsSync(c))
  }

  /** Copy the bundled Node runtime into the package. */
  async embedNode(): Promise<void> {
    const source = this.cli.nodeDir!
    const nodeBin = this.findNode(source)
    if (!nodeBin) {
      throw new Error(`build-green-package: ${source} has no node binary; pass a real Node runtime dir.`)
    }
    if (this.cli.dryRun) {
      console.log(`build-green-package: [dry-run] cp -r ${source} ${this.nodeDir}`)
      return
    }
    await mkdir(this.nodeDir, { recursive: true })
    // Merge the runtime's contents into nodeDir (cp into an existing dir nests as a subdir otherwise).
    for (const entry of await readdir(source)) {
      await cp(join(source, entry), join(this.nodeDir, entry), { recursive: true, dereference: true })
    }
    // Launchers and rebuild expect node/node (or node/node.exe) at the top of the package node dir.
    const embeddedBin = this.findNode(this.nodeDir)
    const wanted = join(this.nodeDir, process.platform === 'win32' ? 'node.exe' : 'node')
    if (embeddedBin && embeddedBin !== wanted) {
      await copyFile(embeddedBin, wanted)
    }
    console.log(`build-green-package: embedded Node from ${source}`)
  }

  /** Rebuild better-sqlite3 against the embedded Node so the native addon ABI matches at runtime. */
  async rebuildBetterSqlite3(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-green-package: [dry-run] rebuild better-sqlite3 for embedded Node')
      return
    }
    const nodeBin = join(this.nodeDir, process.platform === 'win32' ? 'node.exe' : 'node')
    const nodeGyp = join(this.nodeDir, 'lib', 'node_modules', 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
    if (!existsSync(nodeBin)) throw new Error(`build-green-package: embedded node missing at ${nodeBin}.`)
    let rebuilt = 0
    for (const bs of await this.findBetterSqlite3()) {
      console.log(`build-green-package: rebuilding better-sqlite3 in ${bs}`)
      await this.run('better-sqlite3', nodeBin, [nodeGyp, 'rebuild', '--release'], bs)
      const abi = (await this.nodeAbi(nodeBin)).trim()
      const prebuilt = join(bs, 'prebuilt')
      await mkdir(prebuilt, { recursive: true })
      const built = join(bs, 'build', 'Release', 'better_sqlite3.node')
      if (!existsSync(built)) {
        throw new Error(`build-green-package: better-sqlite3 build missing at ${built} after rebuild.`)
      }
      await copyFile(built, join(prebuilt, `better_sqlite3.abi${abi}.node`))
      console.log(`build-green-package: stamped prebuilt abi${abi}`)
      rebuilt++
    }
    if (rebuilt === 0) console.log('build-green-package: no better-sqlite3 found to rebuild (skipped)')
    else console.log(`build-green-package: rebuilt ${rebuilt} better-sqlite3 build(s)`)
  }

  private async findBetterSqlite3(): Promise<string[]> {
    const pnpmDir = join(this.appDir, 'node_modules', '.pnpm')
    if (!existsSync(pnpmDir)) return []
    const found: string[] = []
    for (const entry of await readdir(pnpmDir)) {
      if (!entry.startsWith('better-sqlite3@')) continue
      const candidate = join(pnpmDir, entry, 'node_modules', 'better-sqlite3')
      if (existsSync(candidate)) found.push(candidate)
    }
    return found
  }

  private async nodeAbi(nodeBin: string): Promise<string> {
    return new Promise<string>((resolvePromise, reject) => {
      const child = spawn(nodeBin, ['-p', 'process.versions.modules'], { stdio: ['ignore', 'pipe', 'ignore'] })
      let out = ''
      child.stdout?.on('data', d => (out += d.toString()))
      child.once('error', reject)
      child.once('exit', code => (code === 0 ? resolvePromise(out) : reject(new Error(`node abi probe exited ${code}`))))
    })
  }


  async verify(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-green-package: [dry-run] verify closure')
      return
    }
    const problems: string[] = []
    const bin = join(this.appDir, ENTRY_BIN)
    if (!existsSync(bin)) problems.push(`backend entry missing: ${bin}`)
    const frontend = join(this.appDir, 'node_modules', FRONTEND_DIST_INDEX)
    if (!existsSync(frontend)) problems.push(`frontend dist missing: ${frontend}`)
    // Native addons must be present for the target platform.
    for (const mod of ['node-pty', 'koffi', 'node-addon-require-builtin']) {
      const dir = join(this.appDir, 'node_modules', mod)
      if (!existsSync(dir)) problems.push(`native module missing: ${dir}`)
    }
    if (problems.length > 0) {
      throw new Error(`build-green-package: closure verification failed:\n  ${problems.join('\n  ')}`)
    }
    console.log('build-green-package: closure verification passed (entry, frontend, natives)')
  }

  /** Copy the two runtime loaders (better-sqlite3 abi resolver, node18 polyfills) into the package. */
  async copyLoaders(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-green-package: [dry-run] copy runtime loaders')
      return
    }
    const scriptsDir = join(this.packageDir, 'scripts')
    await mkdir(scriptsDir, { recursive: true })
    for (const name of ['better-sqlite3-abi-loader.mjs', 'node18-polyfills.mjs']) {
      const source = join(root, 'scripts', name)
      if (!existsSync(source)) throw new Error(`build-green-package: loader missing: ${source}`)
      await copyFile(source, join(scriptsDir, name))
    }
    console.log('build-green-package: copied runtime loaders into package')
  }


  async writeLaunchers(): Promise<void> {
    const isWin = this.cli.target.platform === 'win32'
    if (this.cli.dryRun) {
      console.log('build-green-package: [dry-run] write launchers')
      return
    }
    await mkdir(this.dataDir, { recursive: true })
    const scriptsDir = join(this.packageDir, 'scripts')
    await mkdir(scriptsDir, { recursive: true })
    const readme = [
      `dsh web — green package (${this.cli.target.dir})`,
      '',
      'Self-contained: bundled Node runtime in node/, production closure in app/, data in data/.',
      'No Node install or network required.',
      '',
      'Windows:  start-web.cmd   (or start-web.ps1)',
      'Unix:     ./start-web.sh',
      '',
      'The web UI serves on http://127.0.0.1:3080 by default.',
    ].join('\n')
    await writeFile(join(this.packageDir, 'README.txt'), readme + '\n')
    if (isWin) {
      const cmd = [
        '@echo off',
        'setlocal',
        'set "DSH_HOME=%~dp0data"',
        'set "PATH=%~dp0node;%PATH%"',
        '"%~dp0node\\node.exe" --import "%~dp0scripts\\better-sqlite3-abi-loader.mjs" --import "%~dp0scripts\\node18-polyfills.mjs" "%~dp0app\\lib\\bin.js" web %*',
        'endlocal',
      ].join('\r\n')
      await writeFile(join(this.packageDir, 'start-web.cmd'), cmd)
      const ps1 = [
        '$env:DSH_HOME = Join-Path $PSScriptRoot "data"',
        '$env:PATH = "$(Join-Path $PSScriptRoot "node");$env:PATH"',
        '& "$(Join-Path $PSScriptRoot "node/node.exe")" --import "$(Join-Path $PSScriptRoot "scripts/better-sqlite3-abi-loader.mjs")" --import "$(Join-Path $PSScriptRoot "scripts/node18-polyfills.mjs")" "$(Join-Path $PSScriptRoot "app/lib/bin.js")" web @args',
      ].join('\r\n')
      await writeFile(join(this.packageDir, 'start-web.ps1'), ps1)
    } else {
      const sh = [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'export DSH_HOME="$HERE/data"',
        'export PATH="$HERE/node:$PATH"',
        '"$HERE/node/node" --import "$HERE/scripts/better-sqlite3-abi-loader.mjs" --import "$HERE/scripts/node18-polyfills.mjs" "$HERE/app/lib/bin.js" web "$@"',
      ].join('\n')
      const shPath = join(this.packageDir, 'start-web.sh')
      await writeFile(shPath, sh + '\n')
      await chmod(shPath, 0o755)
    }
    console.log('build-green-package: wrote launchers')
  }

  async archive(): Promise<string> {
    const product = `${this.packageDir}.tar.gz`
    if (this.cli.dryRun) {
      console.log(`build-green-package: [dry-run] tar -czf ${product} ${this.packageDir}`)
      return product
    }
    if (existsSync(product)) await rm(product, { force: true })
    // tar from inside out-dir so the archive root is the package directory name.
    await this.run('archive', 'tar', [
      '-czf', product,
      '-C', this.outDir,
      basename(this.packageDir),
    ])
    if (!existsSync(product)) throw new Error(`build-green-package: ${product} missing after archive.`)
    const mb = statSync(product).size / (1024 * 1024)
    console.log(`build-green-package: archived ${product} (${mb.toFixed(1)} MB)`)
    return product
  }

  /** Optional boot smoke: start the package and probe the web surface. */
  async smoke(): Promise<void> {
    if (this.cli.skipSmoke) {
      console.log('build-green-package: skipping smoke (--skip-smoke)')
      return
    }
    if (this.cli.dryRun) {
      console.log('build-green-package: [dry-run] smoke boot')
      return
    }
    const nodeBin = join(this.nodeDir, process.platform === 'win32' ? 'node.exe' : 'node')
    const env = { ...process.env, DSH_HOME: this.dataDir, DSH_PERMISSION_MODE: 'danger-full-access', PATH: `${dirname(nodeBin)}${sep}${process.env.PATH ?? ''}` }
    const child = spawn(nodeBin, [
      '--import', join(this.packageDir, 'scripts', 'better-sqlite3-abi-loader.mjs'),
      '--import', join(this.packageDir, 'scripts', 'node18-polyfills.mjs'),
      join(this.appDir, 'lib', 'bin.js'), 'web',
      '--host', '127.0.0.1', '--port', '3080',
    ], { cwd: this.appDir, env, stdio: 'ignore', detached: true })
    const pid = child.pid ?? -1
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
    let code = ''
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch('http://127.0.0.1:3080/')
        if (res.status === 200) { code = '200'; break }
      } catch { /* not up yet */ }
      await wait(1000)
    }
    try { process.kill(-pid, 'SIGTERM') } catch { /* ignore */ }
    if (code !== '200') throw new Error(`build-green-package: smoke boot did not reach HTTP 200 (got ${code || 'no response'}).`)
    console.log('build-green-package: smoke boot reached HTTP 200')
  }

  private async run(label: string, command: string, args: string[], cwd: string = root): Promise<void> {
    const printable = formatCommand(command, args)
    if (this.cli.dryRun) {
      console.log(`build-green-package: [dry-run] ${printable}`)
      return
    }
    console.log(`build-green-package: ${label}: ${printable}`)
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' }, shell: process.platform === 'win32' })
      child.once('error', error => reject(new Error(`build-green-package: ${label} failed to spawn: ${error.message} (${printable})`)))
      child.once('exit', (code, signal) => {
        if (code === 0) return resolvePromise()
        reject(new Error(`build-green-package: ${label} exited ${code ?? signal} (${printable})`))
      })
    })
  }
}

function stripBomSync(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
}

async function main(): Promise<void> {
  const cli = BuildCli.parse(process.argv.slice(2))
  const build = new GreenPackageBuild(cli)
  await build.build()
  await build.deploy()
  await build.ensureFrontend()
  await build.embedNode()
  await build.rebuildBetterSqlite3()
  await build.verify()
  await build.copyLoaders()
  await build.writeLaunchers()
  const product = await build.archive()
  await build.smoke()
  console.log(`build-green-package: done -> ${product}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
