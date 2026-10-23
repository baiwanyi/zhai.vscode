/**
 * 大纲模块对外出口：向写作管理工作流页暴露设定、人物、大纲三个页面组件与作品未打开时的初始页。
 * 复用约定：页面只依赖同目录下的类型与纯函数，不感知宿主协议；工作流页通过这些导出做分区渲染。
 * 关键约束：新增页面须在此登记，否则工作流页无法引用；不要在此重导出内部子组件，避免调用方绕过页面编排。
 */
export { PressCharacterPage } from './character/PressCharacterPage'
export { PressOutlinePage } from './outline/PressOutlinePage'
export { PressSettingPage } from './setting/PressSettingPage'
export { PressWorkspaceStart } from './layout/PressWorkspaceStart'
