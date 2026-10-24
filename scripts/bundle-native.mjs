/**
 * 运行时依赖随包脚本：把 esbuild external 的依赖装进 dist/node_modules/，使其随 vsix 分发。
 * 复用约定：清单取自 scripts/externals.mjs 的 RUNTIME_DEPENDENCIES，版本取自根 package.json 的 dependencies。
 * 关键约束：vsce 用 --no-dependencies 打包，产物里这些 require 必须能被 dist/node_modules 解析到，
 * 因此安装后逐项校验目录与 better-sqlite3 的 prebuilds 原生二进制，缺任一即失败，避免产出坏包。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { RUNTIME_DEPENDENCIES } from './externals.mjs'

// 脚本位于 scripts/，根目录与 dist 均需上溯一级
const rootDir = path.resolve(import.meta.dirname, '..')
const distDir = path.join(rootDir, 'dist')

const rootPkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf-8'))

/** 版本一律取自根 dependencies：清单里出现未声明的依赖即视为配置错误 */
function resolveVersion(name) {
    const version = rootPkg.dependencies?.[name]
    if (typeof version !== 'string' || version.length === 0) {
        throw new Error(`根 package.json 的 dependencies 缺少 ${name}，无法随包分发`)
    }
    return version
}

/** 校验路径存在：缺失说明安装未成功，直接失败以免产出 require 不到的坏包 */
function assertPresent(target, hint) {
    if (!existsSync(target)) {
        throw new Error(`未找到 ${target}：${hint}`)
    }
}

const runtimeDependencies = Object.fromEntries(
    RUNTIME_DEPENDENCIES.map((name) => [name, resolveVersion(name)]),
)

mkdirSync(distDir, { recursive: true })
writeFileSync(
    path.join(distDir, 'package.json'),
    `${JSON.stringify({ private: true, dependencies: runtimeDependencies }, null, 4)}\n`,
    'utf-8',
)

console.log(`[bundle-native] 正在安装运行时依赖：${RUNTIME_DEPENDENCIES.join(', ')}`)
// 用 npm 而非 pnpm：需要 dist/ 下的扁平 node_modules，pnpm 的符号链接会被 vsce 打成坏包。
// Windows 下 npm 是 npm.cmd，Node 20+ 不允许不经 shell 直接 spawn .cmd（CVE-2024-27980），
// 故显式经 cmd.exe 执行；参数全为硬编码常量，不拼接任何外部输入，也不触发 shell 选项的弃用告警。
const isWindows = process.platform === 'win32'
const installArgs = ['install', '--omit=dev', '--no-audit', '--no-fund']
execFileSync(
    isWindows ? (process.env.ComSpec ?? 'cmd.exe') : 'npm',
    isWindows ? ['/d', '/s', '/c', `npm ${installArgs.join(' ')}`] : installArgs,
    { cwd: distDir, stdio: 'inherit' },
)

for (const name of RUNTIME_DEPENDENCIES) {
    assertPresent(path.join(distDir, 'node_modules', name), '依赖未能随包，请检查 npm install 的输出')
}

// better-sqlite3 基于 N-API（node-addon-api），二进制以 prebuilds/<platform>-<arch>.node 随包，
// 跨 Node / Electron ABI 稳定，无需按扩展宿主版本重建；缺失即为打包异常。
assertPresent(
    path.join(distDir, 'node_modules', 'better-sqlite3', 'prebuilds', `${process.platform}-${process.arch}.node`),
    '原生模块未能随包，请检查 better-sqlite3 的 prebuilds 目录',
)

console.log(`[bundle-native] 运行时依赖已就绪：${RUNTIME_DEPENDENCIES.join(', ')}`)
