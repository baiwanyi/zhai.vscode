/**
 * 进入公众号账号页时同步「用户选定模块」：让工作流侧栏出现公众号六分区。
 * 背景：账号页走仪表盘页内路由，不经过「打开 wechat/ 目录文档」这一步，
 * 侧栏的分区归属只能靠宿主的 selectedModule 状态成立；不主动同步的话六分区在正常操作下不可达。
 * 关键约束：只在账号页调用——列表页只做账号导航，不应感知工作流区；
 * 这是一次尽力而为的同步——失败不影响页面本身，因此不弹提示；
 * 每次挂载只发一次（依赖为空数组），账号切换由路由外壳重挂载本页后重新触发；
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
