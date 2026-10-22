/// <reference types="vite/client" />

/**
 * 静态资源模块声明：webview 侧经 Vite 导入的 SVG 结果是资源 URL（小文件会被内联为 data URI）。
 * 关键约束：仅用于 tsc 类型检查，运行期由 Vite 处理；CSP 已允许 webview 资源与 data:，
 * 因此本地打包的图标无需放开远程域名。
 */
declare module '*.svg' {
    const src: string
    export default src
}
