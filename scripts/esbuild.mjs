/**
 * 扩展宿主打包脚本：将 src/extension.ts 及其依赖打包为 CommonJS 单文件。
 * better-sqlite3 为原生模块，保持 external 由运行时 require 加载。
 */
import { build } from 'esbuild'

const isWatch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    external: ['better-sqlite3', 'vscode'],
    logLevel: 'info',
}

if (isWatch) {
    const ctx = await build({ ...options, watch: true })
    await ctx.watch()
} else {
    await build(options)
}
