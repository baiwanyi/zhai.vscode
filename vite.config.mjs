/**
 * Webview 构建配置：React 19 + Tailwind 4 打包为自包含静态资源，供仪表盘与 AI 对话 Webview 加载。
 * 产物输出 dist/webview/，宿主侧负责注入 CSP 与资源 URI 重写。
 * 采用 .mjs 扩展名以匹配 Vite 8 默认 native ESM config loader，避免 CJS 加载警告。
 * 关键约束：文件名须保持 vite.config.*——shadcn CLI 以该命名 glob 判定框架，改名将导致其命令不可用；
 * root 为 src，宿主与前端源码同处一层，打包范围只由两个 HTML 入口的依赖图决定，宿主 .ts 不参与。
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
    root: 'src',
    base: './',
    plugins: [react(), tailwindcss()],
    // 别名只暴露五个边界：@components 为 shadcn 托管源码、@modules 为宿主业务模块、@webview 为前端业务层（src 根）、
    // @resources 与 @shared 为静态资源与跨进程共享类型；与 tsconfig 的 paths 逐项保持一致
    resolve: {
        alias: {
            '@components': resolve(import.meta.dirname, 'resources/shadcn'),
            '@modules': resolve(import.meta.dirname, 'src/modules'),
            '@resources': resolve(import.meta.dirname, 'resources'),
            '@shared': resolve(import.meta.dirname, 'src/shared'),
            '@webview': resolve(import.meta.dirname, 'src'),
        },
    },
    build: {
        outDir: resolve(import.meta.dirname, 'dist/webview'),
        emptyOutDir: true,
        target: 'es2022',
        // VSCode Webview 环境无法使用运行时 import map，保持单文件产物
        rollupOptions: {
            // 多入口：仪表盘（dashboard/index.html）与工作流 AI 对话（workflow/index.html）均由 Vite 构建
            input: {
                index: resolve(import.meta.dirname, 'src/dashboard/index.html'),
                workflow: resolve(import.meta.dirname, 'src/workflow/index.html'),
            },
        },
    },
})
