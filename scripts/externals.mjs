/**
 * 扩展宿主外部依赖清单：esbuild 打包与随包分发脚本的唯一来源。
 * 复用约定：esbuild.mjs 取 EXTERNALS 作为 esbuild external，bundle-native.mjs 取 RUNTIME_DEPENDENCIES 作为随 vsix 安装的清单。
 * 关键约束：清单在此维护即同时作用于打包与随包两条链路；新增随包依赖必须在根 package.json 的 dependencies 中声明版本，
 * 否则随包脚本会直接失败。
 */

/** 由扩展宿主注入、绝不可打进产物的模块 */
export const HOST_PROVIDED_MODULES = ['vscode']

/**
 * 含原生模块、或运行时会拉起随包 CLI 子进程的依赖：必须保持 external，由运行时从 dist/node_modules 解析，
 * 并由 scripts/bundle-native.mjs 安装到 dist/node_modules/ 随 vsix 分发。
 */
export const RUNTIME_DEPENDENCIES = ['better-sqlite3', '@tencent-ai/agent-sdk']

/** esbuild 的 external 全集 */
export const EXTERNALS = [...HOST_PROVIDED_MODULES, ...RUNTIME_DEPENDENCIES]
