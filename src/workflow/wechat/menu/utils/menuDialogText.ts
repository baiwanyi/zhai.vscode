/**
 * 菜单编辑对话框文案：标题与说明按新建/层级/目录组合分派。
 * 复用约定：纯函数，只返回文案不决定 UI；调用方按返回值透传给 Dialog；
 * 关键约束：目录优先于新建态取说明，新建一级菜单强调内容留到编辑态配置。
 */

export interface MenuDialogText {
    title: string
    description: string
}

/** 按编辑语义取标题与说明：目录、新建一级、普通叶子三档互斥 */
export function readMenuDialogText(isNew: boolean, isTop: boolean, isGroup: boolean): MenuDialogText {
    const title = isNew ? (isTop ? '新建一级菜单' : '新建二级菜单') : isTop ? '编辑一级菜单' : '编辑二级菜单'
    const description = isGroup
        ? '展开子菜单，不发送内容'
        : isNew && isTop
          ? '先填名称，保存后再配内容'
          : '设置名称与点击后的内容'
    return { title, description }
}
