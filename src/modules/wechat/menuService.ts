/**
 * 自定义菜单服务：读取平台菜单、整棵覆盖保存。
 * 复用约定：Token 走 accountToken.requireWechatToken，接口调用与报文收窄走 openapi，
 * 结构校验走 shared/types/wechat 的 readWechatMenuButtons（纯函数，单测覆盖）。
 * 关键约束：平台没有增量更新，保存即整棵覆盖，因此保存前必须校验通过、不做部分提交；
 * 本期只支持 click / view / miniprogram 三种动作，其它动作在读取时按 click 保留名称，
 * 用户可改名或重选动作，避免「读出来的菜单保存不回去」；
 * 保存成功后回读一次，返回平台侧真实结构，界面据此判断是否真的生效。
 */
import {
    readWechatMenuButtons,
    type WechatMenuResult,
    type WechatMenuSaveRequest,
    type WechatMenuSaveResult,
} from '@shared/types/wechat'
import { requireWechatToken } from './accountToken'
import { fetchWechatMenu, saveWechatMenu } from './openapi'
import type { WechatTokenAccessDeps } from './accountToken'

export class WechatMenuService {
    public constructor(private readonly deps: WechatTokenAccessDeps) {}

    /** 读取当前菜单：未配置时返回空数组，由界面引导新建 */
    public async get(accountId: string): Promise<WechatMenuResult> {
        const { accessToken } = await requireWechatToken(this.deps, accountId)
        const outcome = await fetchWechatMenu(accessToken)
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        return { hasMenu: outcome.data.length > 0, buttons: outcome.data }
    }

    /**
     * 保存菜单：整棵覆盖。
     * 关键约束：结构非法时一次性说明限制，不逐条报错——用户面对的是一个整体结构，逐条提示反而难改。
     */
    public async save(request: WechatMenuSaveRequest): Promise<WechatMenuSaveResult> {
        const buttons = readWechatMenuButtons(request.buttons)
        if (buttons === null) {
            throw new Error(
                '菜单结构不合法：一级最多 3 个、每个最多 5 个二级；名称不能为空且一级不超过 16 字节；' +
                    '发送消息需要 key，跳转网页需要 url，跳转小程序需要 appid 与页面路径',
            )
        }
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const saved = await saveWechatMenu(accessToken, buttons)
        if (!saved.ok) {
            throw new Error(saved.message)
        }
        // 回读一次：平台对菜单有二次校验，回读能确认真的生效
        const applied = await fetchWechatMenu(accessToken)
        return { published: true, buttons: applied.ok ? applied.data : buttons }
    }
}
