/**
 * Webview 构建配置：React 19 + Tailwind 4 打包为自包含静态资源，供搜索面板 Webview 加载。
 * 产物输出 dist/webview/，宿主侧负责注入 CSP 与资源 URI 重写。
 * 采用 .mjs 扩展名以匹配 Vite 8 默认 native ESM config loader，避免 CJS 加载警告。
 * 关键约束：文件名须保持 vite.config.*——shadcn CLI 以该命名 glob 判定框架，改名将导致其命令不可用。
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
    root: 'src/webview',
    base: './',
    plugins: [react(), tailwindcss()],
    // shadcn/ui 组件位于 src/components 与 src/lib，需与 tsconfig 的 @/* 别名保持一致
    resolve: {
        alias: {
            '@': resolve(import.meta.dirname, 'src'),
        },
    },
    build: {
        outDir: resolve(import.meta.dirname, 'dist/webview'),
        emptyOutDir: true,
        target: 'es2022',
        // VSCode Webview 环境无法使用运行时 import map，保持单文件产物
        rollupOptions: {
            // 多入口：搜索面板（index.html）与工作区（workspace.html）均由 Vite 构建
            input: {
                index: resolve(import.meta.dirname, 'src/webview/index.html'),
                workspace: resolve(import.meta.dirname, 'src/webview/workspace.html'),
            },
        },
    },
})
