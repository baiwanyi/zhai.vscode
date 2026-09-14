/**
 * ESLint 扁平配置：同时覆盖扩展宿主（Node 环境）与 Webview（React + DOM 环境）两类源码。
 * 复用约定：类型感知检查以 tsconfig.json 为项目源；import 分组按 builtin → external → internal →
 * sibling → index → type 排列，组内字母升序、组间不留空行、导入块后留空行；格式类规则交由 Prettier。
 * 关键约束：全局禁用 inline 配置（不得用 eslint-disable 规避规则）；`src/components/ui` 与
 * `src/hooks` 属 shadcn/ui 托管源码，仅做语法与安全性检查，避免 CLI 覆盖后约束反复失效。
 */
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import { defineConfig, globalIgnores } from 'eslint/config'
import importX from 'eslint-plugin-import-x'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** shadcn/ui 托管源码：不施加项目自有的命名、类型标注、导入排序与上游 any 收窄约束 */
const vendoredUi = ['src/components/ui/**/*.tsx', 'src/hooks/**/*.ts']

export default defineConfig([
    globalIgnores(['dist/**', 'node_modules/**', 'docs/**']),
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            globals: {
                ...globals.node,
                ...globals.browser,
            },
            parserOptions: {
                projectService: {
                    // 根目录 .mjs 构建脚本不在任何 tsconfig 的 include 内，
                    // 显式登记为默认项目，否则 ESLint 解析直接报错
                    allowDefaultProject: ['*.mjs'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        linterOptions: {
            // 项目约定：不得使用 eslint-disable 注释规避规则，问题须通过重构解决
            noInlineConfig: true,
        },
    },
    {
        files: ['**/*.mjs'],
        // 构建脚本无类型信息，关闭依赖类型服务的规则
        extends: [tseslint.configs.disableTypeChecked],
    },
    {
        files: ['**/*.{ts,tsx}'],
        plugins: {
            'import-x': importX,
        },
        settings: {
            'import-x/resolver-next': [createTypeScriptImportResolver({ project: 'tsconfig.json' })],
        },
        rules: {
            ...importX.flatConfigs.recommended.rules,
            ...importX.flatConfigs.typescript.rules,
            'import-x/first': 'error',
            'import-x/no-duplicates': 'error',
            'import-x/newline-after-import': 'error',
            'import-x/order': [
                'error',
                {
                    groups: [
                        'builtin', // 1. 核心库（node 内置）
                        'external', // 2. 第三方依赖（npm 包）
                        'internal', // 3. 绝对路径导入（@ 别名）
                        'sibling', // 4. 同级相对路径（./）
                        'index', // 5. 索引文件
                        'type', // 6. 类型导入
                    ],
                    pathGroups: [
                        { pattern: '@/**', group: 'internal', position: 'before' },
                        { pattern: '@shared/**', group: 'internal', position: 'before' },
                        {
                            pattern: '*.{css,scss,sass,less}',
                            patternOptions: { matchBase: true },
                            group: 'unknown',
                            position: 'after',
                        },
                    ],
                    pathGroupsExcludedImportTypes: ['builtin'],
                    'newlines-between': 'never',
                    alphabetize: { order: 'asc', caseInsensitive: true },
                    distinctGroup: false,
                },
            ],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/explicit-function-return-type': 'error',
            // 命名规范：变量与函数 camelCase（常量允许 UPPER_CASE），类型 PascalCase，
            // 接口禁止 I 前缀，布尔量带 is/has/can 等前缀，枚举成员 UPPER_CASE，
            // 属性放宽以兼容外部接口（如微博 API 的 snake_case 字段）
            '@typescript-eslint/naming-convention': [
                'error',
                {
                    selector: 'default',
                    format: ['camelCase', 'PascalCase'],
                    leadingUnderscore: 'allow',
                    trailingUnderscore: 'allow',
                },
                {
                    selector: 'variable',
                    format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
                },
                {
                    selector: 'variable',
                    types: ['boolean'],
                    format: ['camelCase', 'PascalCase'],
                    prefix: ['is', 'should', 'has', 'can', 'did', 'will'],
                },
                {
                    selector: 'typeLike',
                    format: ['PascalCase'],
                },
                {
                    selector: 'interface',
                    format: ['PascalCase'],
                    custom: { regex: '^I[A-Z]', match: false },
                },
                {
                    selector: 'enumMember',
                    format: ['UPPER_CASE'],
                },
                {
                    selector: 'function',
                    format: ['camelCase', 'PascalCase'],
                },
                {
                    selector: 'memberLike',
                    format: ['camelCase', 'snake_case'],
                    leadingUnderscore: 'allowDouble',
                },
                {
                    selector: 'objectLiteralProperty',
                    format: null,
                },
            ],
        },
    },
    {
        files: ['**/*.tsx'],
        plugins: {
            react,
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        settings: {
            react: { version: 'detect' },
        },
        rules: {
            ...react.configs.flat.recommended.rules,
            ...react.configs.flat['jsx-runtime'].rules,
            // props 校验交由 TypeScript 类型系统，无需运行时 propTypes
            'react/prop-types': 'off',
            // 开发者模式下保持组件模块的 HMR 边界（webview:serve）
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
            // react-hooks v7 的预设为 eslintrc 形态，这里按 flat 方式启用经典两条；
            // 其余规则属 React Compiler 语义（如 preserve-manual-memoization），项目未启用编译器故关闭
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
            'react-hooks/preserve-manual-memoization': 'off',
        },
    },
    {
        // 环境变量声明文件：Vite 内置标识与 VITE_* 契约为大写蛇形，按 typeProperty 放宽命名约束
        files: ['**/*.d.ts'],
        rules: {
            '@typescript-eslint/naming-convention': ['error', { selector: 'typeProperty', format: null }],
        },
    },
    {
        files: vendoredUi,
        rules: {
            // 官方组件不标注函数返回类型，强制标注会产生大量与上游源码风格相关的噪音
            '@typescript-eslint/explicit-function-return-type': 'off',
            // 组件内部存在类型体操与兼容层，这些 any 由上游维护，不在此处收窄
            '@typescript-eslint/no-explicit-any': 'off',
            // 官方命名自成约定（如 slider 的 _values 下划线前缀），不套用项目命名规范
            '@typescript-eslint/naming-convention': 'off',
            // 以下七条为类型感知规则：recharts 等上游 API 返回 any，会沿传播链连环报错；
            // 托管源码的改动会被 CLI 覆盖，故整体豁免，同规则在项目自有代码中仍然生效
            // 把 any 赋值给变量或属性
            '@typescript-eslint/no-unsafe-assignment': 'off',
            // 访问 any 值的成员（如 payload.fill）
            '@typescript-eslint/no-unsafe-member-access': 'off',
            // 把 any 作为实参传给已声明类型的函数
            '@typescript-eslint/no-unsafe-argument': 'off',
            // 调用类型为 any 的函数或构造器
            '@typescript-eslint/no-unsafe-call': 'off',
            // 把 any 作为函数返回值向外传出
            '@typescript-eslint/no-unsafe-return': 'off',
            // 在模板字符串中插值 string/number 之外的类型
            '@typescript-eslint/restrict-template-expressions': 'off',
            // 对可能产出 "[object Object]" 的值做隐式字符串化
            '@typescript-eslint/no-base-to-string': 'off',
            // 导入顺序由 CLI 生成且与项目分组规则不同，强制重排会让组件偏离上游源码
            'import-x/order': 'off',
            // 组件刻意同时导出组件与常量（如 buttonVariants），属 shadcn 既定写法
            'react-refresh/only-export-components': 'off',
        },
    },
    prettier,
])
