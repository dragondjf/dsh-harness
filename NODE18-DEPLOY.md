# dsh 在 Node 18 上的部署与构建流程（node18 分支）

`node18` 分支让 dsh 能在 **Node 18 (v18.20.8)** 上运行：后端 `lib/` 已预编译并提交，运行时直接加载，无需在 Node 18 上编译后端。

## 关键事实（均实测）

| 环节 | Node 18 能否 | 实测 / 证据 |
| --- | --- | --- |
| 包管理 `pnpm install` | ❌（当前 pnpm 版） | 当前 pnpm 拒绝 Node 18（需 ≥22.13）→ 纯 Node18 环境须用 **pnpm 9.x** |
| 前端 `pnpm build:web`（vite） | ✅ | 实测 `vite build` exit 0，正常产出 dist |
| 后端 `pnpm build:lib`（tsc + tsdown） | ❌ **永远不能** | tsdown 底层 rolldown 1.1.1 用到 Node 20.12+ 才有的 `node:util.styleText`，ESM 加载即 `SyntaxError` 硬崩 |
| 运行 dsh | ✅ | lib 已提交，Node 18 直接加载 |

结论：前端可在 Node 18 构建；后端**只能在 Node 22+ 构建**，其产物 `lib/` 须提交进分支。

## 场景一：仅运行（Node 18，免后端构建）

适用于直接使用已提交的 `lib/`，不需要改后端源码：

```sh
# 1) 纯 Node18 环境必须用兼容 Node18 的 pnpm（10+ 拒绝 Node18）
corepack prepare pnpm@9.15.0 --activate
# 2) 安装依赖（Node18 下仅打印 engines 警告，不影响）
pnpm install
# 3) 前端构建（vite，Node18 可跑，已实测）
pnpm build:web
# 4) 启动（lib 已提交，无需也不会执行 pnpm build:lib）
./scripts/start-dsh.sh
```

说明：`lib/` 已在分支中提交，运行时直接加载。**不要**执行 `pnpm build:lib`——在 Node 18 上会立即崩溃。

## 场景二：重编后端 lib（必须 Node 22+）

当你修改了 `packages/**/src` 下的后端源码、需要重新生成 `lib/` 时，后端编译**只能**在 Node 22+ 上完成，步骤如下：

```sh
# 1) 切到 Node 22+（例如 nvm use 22，或项目默认的 /home/yfjz/.hermes/node 的 v23）
nvm use 22
# 2) 用项目要求的 pnpm 版本（Node 22+ 下当前 pnpm 正常）
corepack enable
pnpm install
# 3) 后端构建（tsc -b + tsdown，仅在 Node 22+ 成功）
pnpm build:lib
# 4) 提交新生成的 lib（lib 被 .gitignore 忽略，须强制加入）
git add -f packages/*/lib apps/*/lib
git commit -m "build(node18): rebuild lib after <改动说明>"
# 5) 回到场景一，在 Node 18 上运行
```

⚠️ **禁止在 Node 18 上执行 `pnpm build:lib`**：会立即报 `SyntaxError: The requested module 'node:util' does not provide an export named 'styleText'`。

## 启动脚本

`./scripts/start-dsh.sh [start|stop|status|restart]` 已封装 Node 18 所需的双 `--import` 垫片（`better-sqlite3-abi-loader.mjs` + `node18-polyfills.mjs`）以及 `--patch` 参数顺序。DeepSeek provider overlay 见 `config/deepseek-official.yml`（仅存 `apiKeyEnv`，密钥从环境变量 `DEEPSEEK_API_KEY` 注入，不落盘）。

`DSH_PERMISSION_MODE` 合法值仅 `read-only` / `workspace-write` / `danger-full-access`（无 `ask`）。

## 已知差异

- `packages/llm/llm-deepseek/lib/index.js` 含工具调用真值修复（与已还原的 `src/translate.ts` 不一致）。若按场景二重编 lib，此修复会丢失，需重新打补丁后再提交。
- 原生模块（`better-sqlite3`、`lightningcss`、`node-pty` 等）为当前架构（linux arm64 glibc）专属；跨架构拷贝须重新 `pnpm install` 触发原生编译。
