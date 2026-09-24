/**
 * Vitest 配置：独立于 vite.config.mjs（不引入 tailwind / react 插件，避免与 webview 构建链路耦合）。
 * 复用约定：别名与 tsconfig 保持一致（@ → src）；`vscode` 在测试中解析到测试桩，使宿主代码可在 Node 下加载。
 * 约束：只扫描 src 下就近存放的 *.test.ts；环境为 node，测试内不接触 DOM。
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))
const vscodeStub = fileURLToPath(new URL('./src/tests/stubs/vscode.ts', import.meta.url))

export default defineConfig({
    resolve: {
        alias: {
            '@': srcDir,
            vscode: vscodeStub,
        },
    },
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
        restoreMocks: true,
    },
})
