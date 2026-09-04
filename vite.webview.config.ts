/**
 * Webview 构建配置：React 19 + Tailwind 4 打包为自包含静态资源，供搜索面板 Webview 加载。
 * 产物输出 dist/webview/，宿主侧负责注入 CSP 与资源 URI 重写。
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
    root: 'src/webview',
    base: './',
    plugins: [react(), tailwindcss()],
    build: {
        outDir: resolve(__dirname, 'dist/webview'),
        emptyOutDir: true,
        target: 'es2022',
        // VSCode Webview 环境无法使用运行时 import map，保持单文件产物
        rollupOptions: {
            input: resolve(__dirname, 'src/webview/index.html'),
        },
    },
})
