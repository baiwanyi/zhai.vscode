/**
 * 进入公众号页面时同步「用户选定模块」：让工作流侧栏出现公众号六分区。
 * 背景：公众号页走仪表盘页内路由，不经过「打开 wechat/ 目录文档」这一步，
 * 侧栏的分区归属只能靠宿主的 selectedModule 状态成立；不主动同步的话六分区在正常操作下不可达。
 * 关键约束：这是一次尽力而为的同步——失败不影响页面本身，因此不弹提示；
 * 每次挂载只发一次（依赖为空数组），页面内部的账号切换不会重复触发；
 * 使用 workflow/selectModule 而不是 workflow/open，后者会聚焦工作流面板、抢走当前焦点。
 */
import { useEffect } from 'react'
import { WECHAT_MODULE_KEY } from '@shared/types/workflow'
import { request } from '@shared/utils/bridge'

export function useWechatModuleSync(): void {
    useEffect(() => {
        void request('workflow/selectModule', { module: WECHAT_MODULE_KEY }).catch(() => undefined)
    }, [])
}
