/**
 * 扩展宿主打包脚本：把 src/extension.ts 及其依赖打成 CommonJS 单文件 dist/extension.js。
 * 复用约定：compile 走一次性构建、watch 带 `--watch` 常驻；external 清单取自同目录的 externals.mjs。
 * 关键约束：监听只能走 context() + ctx.watch()（build() 传 `watch` 会报 Invalid option 并退出）；
 * esbuild 的监听由独立 service 子进程承载，它不响应 Ctrl+C，退出前必须 dispose 以免留下孤儿进程。
 */
import { build, context } from 'esbuild'
import * as path from 'node:path'
import { EXTERNALS } from './externals.mjs'

const isWatch = process.argv.includes('--watch')

// 以脚本位置为基准，保证从任意工作目录执行都落在同一产物上（脚本在 dev/scripts，根目录需上溯两级）
const rootDir = path.resolve(import.meta.dirname, '..', '..')

/** @type {import('esbuild').BuildOptions} */
const options = {
    absWorkingDir: rootDir,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    external: EXTERNALS,
    logLevel: 'info',
}

/** 常驻监听：构建错误只打印不退出，Ctrl+C / SIGTERM 时释放上下文并优雅收尾 */
async function runWatch() {
    const ctx = await context(options)
    let isShuttingDown = false

    const shutdown = async (signal) => {
        if (isShuttingDown) return
        isShuttingDown = true
        console.log(`[esbuild] 收到 ${signal}，正在退出`)
        try {
            await ctx.dispose()
        } catch (error) {
            console.error('[esbuild] 释放构建上下文失败：', error instanceof Error ? error.message : error)
        }
        process.exit(0)
    }

    // 先挂信号再监听：首次构建期间被中断时同样能走到 dispose
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => void shutdown(signal))
    }

    try {
        await ctx.watch()
    } catch (error) {
        await ctx.dispose()
        throw error
    }
    console.log('[esbuild] 已进入监听模式：修改 src/ 下的文件将自动重建 dist/extension.js')
}

try {
    if (isWatch) {
        await runWatch()
    } else {
        await build(options)
    }
} catch (error) {
    console.error('[esbuild] 构建失败：', error instanceof Error ? error.message : error)
    process.exit(1)
}
