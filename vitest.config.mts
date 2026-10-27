/**
 * Vitest 配置：独立于 vite.config.mjs（不引入 tailwind / react 插件，避免与 webview 构建链路耦合）。
 * 复用约定：别名与 tsconfig 保持一致（@components → resources/shadcn、@modules → src/modules、
 * @resources → resources、@shared → src/shared、@webview → src）；`vscode` 在测试中解析到测试桩，
 * 使宿主代码可在 Node 下加载。
 * 约束：用例集中在 dev/test（桩位于 dev/test/stubs），扫描 *.test.ts 与 *.test.tsx；全局环境固定为 node，
 * 需要 DOM 的用例在文件首行以 `// @vitest-environment jsdom` 单独声明，不在此处整体切换，
 * 以免宿主侧用例意外拿到 window 而掩盖对 Node API 的错误依赖。
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const componentsDir = fileURLToPath(new URL('./resources/shadcn', import.meta.url))
const modulesDir = fileURLToPath(new URL('./src/modules', import.meta.url))
const resourcesDir = fileURLToPath(new URL('./resources', import.meta.url))
const sharedDir = fileURLToPath(new URL('./src/shared', import.meta.url))
const appDir = fileURLToPath(new URL('./src', import.meta.url))
const vscodeStub = fileURLToPath(new URL('./dev/test/stubs/vscode.ts', import.meta.url))

export default defineConfig({
    resolve: {
        alias: {
            '@components': componentsDir,
            '@modules': modulesDir,
            '@resources': resourcesDir,
            '@shared': sharedDir,
            '@webview': appDir,
            vscode: vscodeStub,
        },
    },
    // 不显式配置转换选项：Vite 8 的转换器已切到 oxc，esbuild 字段会被忽略并告警，
    // tsx 用例的 JSX 运行时由 tsconfig 的 jsx: react-jsx 决定，无需在此重复声明
    test: {
        include: ['dev/test/**/*.test.{ts,tsx}'],
        environment: 'node',
        restoreMocks: true,
    },
})
