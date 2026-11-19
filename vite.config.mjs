/**
 * Webview 构建配置：React 19 + Tailwind 4 打包为自包含静态资源，供仪表盘与 AI 对话 Webview 加载。
 * 产物输出 dist/webview/，宿主侧负责注入 CSP 与资源 URI 重写。
 * 采用 .mjs 扩展名以匹配 Vite 8 默认 native ESM config loader，避免 CJS 加载警告。
 * 关键约束：文件名须保持 vite.config.*——shadcn CLI 以该命名 glob 判定框架，改名将导致其命令不可用；
 * root 为 src，宿主与前端源码同处一层，打包范围只由四个 HTML 入口的依赖图决定，宿主 .ts 不参与；
 * Vite 8 底层为 Rolldown，rollupOptions 已废弃且没有 manualChunks，分包只能走 output.codeSplitting.groups。
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
        // 分包后单块远离上限，阈值保持 600 KB 仅作兜底提示；webview 走本地加载，成本在解析而非下载
        chunkSizeWarningLimit: 600,
        // 多入口 + 依赖分组：四个 HTML 入口各自独立成 chunk，node_modules 再按包族拆开，
        // 使只被少数入口引用的库（如 Tiptap）不进入其它入口的加载链。
        // 关键约束：test 正则必须用 [\\/] 匹配路径分隔符，写 / 在 Windows 上不命中；
        // priority 决定重叠时的归属（react 必须先于 vendor 命中）；
        // entriesAware 让共享组按「实际引用它的入口」再切，否则任一入口都会整块加载。
        rolldownOptions: {
            // 多入口：仪表盘（dashboard）、工作流（workflow）与编辑区富文本编辑器（editor）各自独立成入口；
            // 编辑器入口只由自定义编辑器 webview 加载，Tiptap 内核不会进入另两个入口的依赖图
            input: {
                index: resolve(import.meta.dirname, 'src/dashboard/index.html'),
                workflow: resolve(import.meta.dirname, 'src/workflow/index.html'),
                editor: resolve(import.meta.dirname, 'src/editor/index.html'),
                weibo: resolve(import.meta.dirname, 'src/weibo/index.html'),
            },
            output: {
                codeSplitting: {
                    groups: [
                        // 三入口共享的运行时：单独成块后浏览器只解析一次
                        { name: 'react', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/, priority: 30 },
                        // 浮层定位：radix 与 tiptap 共用，必须先于两者命中，否则会被 includeDependenciesRecursively
                        // 卷进 tiptap 组，导致只有 editor 用的 tiptap 块被其它入口连带预加载
                        { name: 'floating-ui', test: /node_modules[\\/]@floating-ui[\\/]/, priority: 25 },
                        // 编辑器内核只被 editor 入口引用，独立成块后另外两个入口不会带上；
                        // prosemirror 与 @tiptap 分两块，单块体积才落到提示线以下
                        { name: 'prosemirror', test: /node_modules[\\/]prosemirror-/, priority: 21 },
                        { name: 'tiptap', test: /node_modules[\\/]@tiptap[\\/]/, priority: 20 },
                        // 富文本渲染链路：体积大头是语法高亮与 md 转换
                        {
                            name: 'markdown',
                            test: /node_modules[\\/](?:react-markdown|remark-|rehype-|unified|shiki)[\\/]/,
                            priority: 20,
                        },
                        // 其余依赖兜底：小于 20 KB 的组不生成碎块，entriesAware 保证各入口只取自己那部分
                        {
                            name: 'vendor',
                            test: /node_modules[\\/]/,
                            priority: 10,
                            minSize: 20 * 1024,
                            entriesAware: true,
                        },
                    ],
                },
            },
        },
    },
})
