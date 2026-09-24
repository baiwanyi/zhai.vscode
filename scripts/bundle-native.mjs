/**
 * 原生模块随包脚本：把 esbuild external 的依赖装到 dist/node_modules/，让它们随 vsix 分发。
 *
 * 背景：vsce 打包时用 `npm list` 检测生产依赖，pnpm 的符号链接布局会让它报出大量
 * "npm error missing: ..." 并中止，所以 package 脚本使用 `--no-dependencies`；
 * 但 dist/extension.js 里对 better-sqlite3 的 require 是 external 的，必须能被解析到。
 *
 * 原理：Node 从 dist/extension.js 向上查找模块，`dist/node_modules/` 正好在查找路径上，
 * 因此用 npm 在 dist/ 下装一份生产依赖即可（与 pnpm 管理的开发依赖互不干扰）。
 * 注意：日常开发（F5）仍走根目录的 pnpm 依赖，本脚本只在打包时执行。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

/** 与根 package.json 的 dependencies 保持一致：仅收录 esbuild external 的运行时依赖 */
const NATIVE_DEPENDENCIES = {
    'better-sqlite3': '^13.0.3',
}

const distDir = path.resolve(import.meta.dirname, 'dist')
mkdirSync(distDir, { recursive: true })
writeFileSync(
    path.join(distDir, 'package.json'),
    `${JSON.stringify({ private: true, dependencies: NATIVE_DEPENDENCIES }, null, 4)}\n`,
    'utf-8',
)

// 经 shell 执行：Windows 下 npm 是 npm.cmd，Node 20+ 起不允许直接 spawn .cmd（CVE-2024-27980）
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: distDir,
    stdio: 'inherit',
    shell: true,
})

// better-sqlite3 基于 N-API（node-addon-api），二进制以 prebuilds/<platform>-<arch>.node 随包，
// 跨 Node / Electron ABI 稳定，无需按扩展宿主版本重建。缺失即为打包异常，直接失败以免产出坏包。
const binding = path.join(distDir, 'node_modules', 'better-sqlite3', 'prebuilds', `${process.platform}-${process.arch}.node`)
if (!existsSync(binding)) {
    throw new Error(`未找到 ${binding}：原生模块未能随包，请检查 better-sqlite3 的 prebuilds 目录`)
}
console.log(`[bundle-native] 原生模块已就绪：${path.relative(process.cwd(), binding)}`)
