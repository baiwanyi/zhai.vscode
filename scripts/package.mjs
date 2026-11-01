/**
 * 打包脚本：把随包的运行时依赖装进 dist/node_modules → vsce 产出 vsix 到 releases/ → 可选覆盖安装本机。
 * 复用约定：本文件同时是 esbuild external 清单的唯一来源（esbuild.mjs 只取 EXTERNALS）；
 * 由 `pnpm run package` 调用，依赖 node_modules/.bin 提供的 vsce，版本取自根 package.json 的 dependencies。
 * 关键约束：better-sqlite3 带原生二进制、agent-sdk 运行时要拉起随包 CLI，两者必须保持 external 并真实落在
 * dist/node_modules（vsce 用 --no-dependencies，根 node_modules 的 pnpm 符号链接布局不可随包），缺任一即失败；
 * 装好后先按当前平台裁剪多平台二进制与编译期源码（ripgrep / genie-trash / prebuilds 各留一份，deps 整块删除），
 * 否则 vsix 会带上其它平台的几十 MB 冗余，且体积随平台数量线性增长；
 * 输出目录须先建立且 --out 传完整文件名，同版本重装必须 --force，code 不可用只提示不改退出码；
 * 被 esbuild.mjs import 时靠入口判断隔离，不得执行打包流程。
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 由扩展宿主注入、绝不可打进产物的模块 */
export const HOST_PROVIDED_MODULES = ['vscode']

/** 含原生模块、或运行时会拉起随包 CLI 子进程的依赖：必须 external，并从 dist/node_modules 解析 */
export const RUNTIME_DEPENDENCIES = ['better-sqlite3', '@tencent-ai/agent-sdk']

/** esbuild 的 external 全集 */
export const EXTERNALS = [...HOST_PROVIDED_MODULES, ...RUNTIME_DEPENDENCIES]

/** 失败即退出：随包或打包缺件时立即停下，避免产出装得上却跑不起的坏包 */
function fail(message) {
    console.error(`✗ ${message}`)
    process.exit(1)
}

/** 校验路径存在：缺失说明安装未成功 */
function assertPresent(target, hint) {
    if (!existsSync(target)) {
        fail(`未找到 ${target}：${hint}`)
    }
}

/** 读取根清单：版本与包名一律以它为准，避免脚本里另存一份会漂移的常量 */
function readManifest() {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
}

/** 版本一律取自根 dependencies：清单里出现未声明的依赖即视为配置错误 */
function resolveVersion(name, manifest) {
    const version = manifest.dependencies?.[name]
    if (typeof version !== 'string' || version.length === 0) {
        fail(`根 package.json 的 dependencies 缺少 ${name}，无法随包分发`)
    }
    return version
}

/** 把 external 的运行时依赖装进 dist/node_modules，使随 vsix 的 require 能被解析 */
function installRuntimeDependencies() {
    const manifest = readManifest()
    const distDir = join(ROOT, 'dist')
    const runtimeDependencies = Object.fromEntries(
        RUNTIME_DEPENDENCIES.map((name) => [name, resolveVersion(name, manifest)]),
    )

    mkdirSync(distDir, { recursive: true })
    writeFileSync(
        join(distDir, 'package.json'),
        `${JSON.stringify({ private: true, dependencies: runtimeDependencies }, null, 4)}\n`,
        'utf-8',
    )

    console.log(`→ 安装运行时依赖：${RUNTIME_DEPENDENCIES.join(', ')}`)
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
        assertPresent(join(distDir, 'node_modules', name), '依赖未能随包，请检查 npm install 的输出')
    }

    // better-sqlite3 基于 N-API（node-addon-api），二进制以 prebuilds/<platform>-<arch>.node 随包，
    // 跨 Node / Electron ABI 稳定，无需按扩展宿主版本重建；缺失即为打包异常。
    assertPresent(
        join(distDir, 'node_modules', 'better-sqlite3', 'prebuilds', `${process.platform}-${process.arch}.node`),
        '原生模块未能随包，请检查 better-sqlite3 的 prebuilds 目录',
    )
    console.log(`✓ 运行时依赖已就绪：${RUNTIME_DEPENDENCIES.join(', ')}`)
}

/** 用 vsce 打包到 releases/，并按需调用 code CLI 覆盖安装 */
function packageVsix() {
    const shouldInstall = !process.argv.includes('--no-install')
    const manifest = readManifest()
    const outDir = join(ROOT, 'releases')
    const vsix = join(outDir, `${manifest.name}-${manifest.version}.vsix`)

    // 输出目录必须先建立：vsce 在目标目录缺失时会把 "releases/" 当成文件名，
    // 生成一个叫 releases 的 vsix，后续按目录查找产物就会全部落空
    mkdirSync(outDir, { recursive: true })
    execSync(`vsce package --no-dependencies --out "${vsix}"`, { cwd: ROOT, stdio: 'inherit' })
    console.log(`✓ 已生成 ${relative(ROOT, vsix)}`)

    if (!shouldInstall) {
        return
    }
    try {
        // 同版本重装必须带 --force，否则 code CLI 判定「已安装」后直接返回、并不覆盖
        execSync(`code --install-extension "${vsix}" --force`, { cwd: ROOT, stdio: 'inherit' })
        console.log('✓ 已安装到本机，重载窗口后生效')
    } catch {
        console.log(`⚠ 自动安装失败，请手动执行：code --install-extension ${relative(ROOT, vsix)}`)
    }
}

/** 删除目录里不属于目标平台的条目，缺失目录直接跳过；返回删除的条目数 */
function pruneMismatchedEntries(dir, shouldKeep) {
    if (!existsSync(dir)) {
        return 0
    }
    let removed = 0
    for (const name of readdirSync(dir)) {
        if (shouldKeep(name)) {
            continue
        }
        rmSync(join(dir, name), { recursive: true, force: true })
        removed += 1
    }
    return removed
}

/**
 * 裁剪随包依赖里与当前平台无关的文件：三个 vendor 组件与 better-sqlite3 都按平台分目录，只留宿主机那一份；
 * better-sqlite3 的 deps / src / build 是编译期物料，运行时用不到。
 * 关键约束：Linux 同时保留 glibc 与 musl 两份 prebuild，避免在 musl 环境（如 Alpine）里缺二进制；
 * 裁剪只针对 dist/node_modules，不碰根依赖，重复打包命中的仍是同一份已安装内容。
 */
function pruneRuntimePayload() {
    const rgPlatform = `${process.arch}-${process.platform}`
    const vendorPlatform = `${process.platform}-${process.arch}`
    const sqlitePrebuild = `${process.platform}-${process.arch}.node`
    const vendorDir = join(ROOT, 'dist', 'node_modules', '@tencent-ai', 'agent-sdk', 'cli', 'vendor')
    const sqliteDir = join(ROOT, 'dist', 'node_modules', 'better-sqlite3')

    // ripgrep：目录名是 <arch>-<platform>，当前平台与其授权文件以外的都删掉
    const ripgrepDir = join(vendorDir, 'ripgrep')
    const hasRipgrepTarget = existsSync(join(ripgrepDir, rgPlatform))
    const ripgrepRemoved = pruneMismatchedEntries(ripgrepDir, (name) => name === rgPlatform || name === 'COPYING')
    // 命名规则若随 agent-sdk 升级而变，上面的白名单会连当前平台一起删光，这里兜住提示
    if (!hasRipgrepTarget) {
        console.warn(`⚠ ripgrep 里没有 ${rgPlatform}，检查 agent-sdk 的平台目录命名`)
    }
    // genie-trash：除 Windows 是单个 win32-x64.exe 文件外，其余平台都是同名目录
    const trashRemoved = pruneMismatchedEntries(
        join(vendorDir, 'genie-trash'),
        (name) => name === vendorPlatform || name === `${vendorPlatform}.exe`,
    )
    // sandbox：macOS 专属的 toybox / zsh 只在 darwin 上保留
    const sandboxRemoved =
        process.platform === 'darwin'
            ? 0
            : pruneMismatchedEntries(
                  join(vendorDir, 'sandbox-center-runtime-kit'),
                  (name) => name !== 'toybox-macos' && name !== 'zsh-macos',
              )

    for (const dir of ['deps', 'src', 'build']) {
        rmSync(join(sqliteDir, dir), { recursive: true, force: true })
    }
    pruneMismatchedEntries(
        join(sqliteDir, 'prebuilds'),
        (name) =>
            name === sqlitePrebuild || (process.platform === 'linux' && name === `linuxmusl-${process.arch}.node`),
    )

    console.log(`✓ 已裁剪跨平台冗余 ${ripgrepRemoved + trashRemoved + sandboxRemoved} 项，并清理 sqlite 编译期物料`)
}

/** 打包主流程：依赖先就位、裁剪完跨平台冗余，vsce 才能把它们收进 vsix */
function main() {
    installRuntimeDependencies()
    pruneRuntimePayload()
    packageVsix()
}

// 仅当本文件被直接执行时才打包：esbuild.mjs 会 import 清单常量，不能被副作用带跑
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === entry) {
    main()
}
