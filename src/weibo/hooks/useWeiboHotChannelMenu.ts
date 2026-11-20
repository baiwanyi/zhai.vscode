/**
 * 热门频道菜单：默认预设与上游频道池合成菜单，支持新增与移除，状态只在会话内保留。
 * 复用约定：视图标识统一走 layout/weiboNavGroups 的 toHotChannelView，频道数据来自 @shared/types/weibo；
 * 页面只消费 hotChannels / candidates 与两个动作，菜单渲染交给 layout/WeiboNav。
 * 关键约束：重复与超限一律忽略，且加不进菜单时不得切换视图，否则内容区会停在菜单没有入口的频道；
 * 固定频道不可移除；正停在被移除的频道上时必须回落到固定频道，否则用户找不到回程入口。
 */
import { useCallback, useMemo, useState } from 'react'
import { WEIBO_DEFAULT_HOT_CHANNELS, WEIBO_HOT_CHANNEL_LIMIT, WEIBO_PINNED_HOT_CHANNELS } from '@shared/types/weibo'
import type { WeiboHotChannel } from '@shared/types/weibo'
import type { WeiboView } from '../layout/weiboNavGroups'
import { toHotChannelView } from '../layout/weiboNavGroups'

interface UseWeiboHotChannelMenuOptions {
    /** allGroups 给出的频道池：只作候选来源，不直接全量上菜单 */
    pool: readonly WeiboHotChannel[]
    /** 当前视图：移除正在浏览的频道时要回落到固定频道 */
    view: WeiboView
    /** 切换视图：添加频道后直接进入，移除后可能需要回落 */
    onSelectView: (view: WeiboView) => void
}

export interface WeiboHotChannelMenu {
    /** 已上菜单的频道：顺序即菜单顺序，找不到的 gid 已被过滤 */
    hotChannels: readonly WeiboHotChannel[]
    /** 「＋」弹层的候选：已知集合里尚未上菜单的频道 */
    candidates: readonly WeiboHotChannel[]
    /** 添加频道：重复或超限时忽略，不切视图 */
    addChannel: (gid: string) => void
    /** 移除频道：固定频道忽略，正在浏览时回落到第一个固定频道 */
    removeChannel: (gid: string) => void
}

/** 热门频道菜单控制器：菜单上的 gid 顺序与会话内的增删都在此维护 */
export function useWeiboHotChannelMenu({
    pool,
    view,
    onSelectView,
}: UseWeiboHotChannelMenuOptions): WeiboHotChannelMenu {
    /**
     * 菜单上的热门频道 gid：初始即默认那 8 个。
     * 关键约束：不能只记「手动补充的」，小时榜等默认可移除项删掉后再加回来也要有位置。
     */
    const [hotChannelGids, setHotChannelGids] = useState<readonly string[]>(() =>
        WEIBO_DEFAULT_HOT_CHANNELS.map((channel) => channel.gid),
    )
    /** 已知频道全集：本地预设在前、上游池补充在后（同 gid 以预设为准，避免标题被顶掉） */
    const knownHotChannels = useMemo(() => {
        const extra = pool.filter((channel) => !WEIBO_DEFAULT_HOT_CHANNELS.some((preset) => preset.gid === channel.gid))
        return [...WEIBO_DEFAULT_HOT_CHANNELS, ...extra]
    }, [pool])
    /** 按 gid 顺序还原频道对象：删掉的 gid 不在已知集合里时直接跳过，不会渲染空按钮 */
    const hotChannels = useMemo(
        () =>
            hotChannelGids
                .map((gid) => knownHotChannels.find((channel) => channel.gid === gid))
                .filter((channel): channel is WeiboHotChannel => channel !== undefined),
        [hotChannelGids, knownHotChannels],
    )
    /** 「＋」弹层的候选：已知集合里尚未上菜单的频道（含被移除的默认项） */
    const candidates = useMemo(
        () => knownHotChannels.filter((channel) => !hotChannelGids.includes(channel.gid)),
        [hotChannelGids, knownHotChannels],
    )

    /** 添加热门频道：重复或超限一律忽略，加入后直接切到该频道 */
    const addChannel = useCallback(
        (gid: string): void => {
            // 先判定能不能加：加不进菜单就不切视图，否则内容区会停在一个菜单里没有入口的频道上
            if (hotChannelGids.includes(gid) || hotChannelGids.length >= WEIBO_HOT_CHANNEL_LIMIT) {
                return
            }
            setHotChannelGids((previous) => [...previous, gid])
            onSelectView(toHotChannelView(gid))
        },
        [hotChannelGids, onSelectView],
    )

    /** 移除热门频道：固定频道忽略；被移除的默认项会回到候选池，可以再加回来 */
    const removeChannel = useCallback(
        (gid: string): void => {
            if (WEIBO_PINNED_HOT_CHANNELS.some((channel) => channel.gid === gid)) {
                return
            }
            setHotChannelGids((previous) => previous.filter((item) => item !== gid))
            const fallback = WEIBO_PINNED_HOT_CHANNELS[0]
            if (fallback === undefined) {
                return
            }
            if (view === toHotChannelView(gid)) {
                onSelectView(toHotChannelView(fallback.gid))
            }
        },
        [onSelectView, view],
    )

    return { hotChannels, candidates, addChannel, removeChannel }
}
