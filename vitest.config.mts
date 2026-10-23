/**
 * Vitest 配置：独立于 vite.config.mjs（不引入 tailwind / react 插件，避免与 webview 构建链路耦合）。
 * 复用约定：别名与 tsconfig 保持一致（@components → resources/shadcn、@shared → src/shared）；
 * `vscode` 在测试中解析到测试桩，使宿主代码可在 Node 下加载。
 * 约束：测试资产统一集中在 src/__test__（用例与桩同处一目录），只扫描其中的 *.test.ts；环境为 node，测试内不接触 DOM。
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const componentsDir = fileURLToPath(new URL('./resources/shadcn', import.meta.url))
const sharedDir = fileURLToPath(new URL('./src/shared', import.meta.url))
const vscodeStub = fileURLToPath(new URL('./src/__test__/stubs/vscode.ts', import.meta.url))

export default defineConfig({
    resolve: {
        alias: {
            '@components': componentsDir,
            '@shared': sharedDir,
            vscode: vscodeStub,
        },
    },
    test: {
        include: ['src/__test__/**/*.test.ts'],
        environment: 'node',
        restoreMocks: true,
    },
})
