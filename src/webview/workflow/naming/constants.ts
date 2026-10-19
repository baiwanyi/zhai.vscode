/**
 * 取名页常量：默认条件、分类图标与界面文案。
 * 复用约定：分类与选项以宿主下发的 NamingCatalog 为准，本文件只保留前端展示用映射与兜底默认值。
 * 关键约束：默认条件必须落在宿主归一化允许的枚举内，否则首屏请求会被回落值改写导致表单抖动。
 */
import { Flag, Gem, Ghost, MapPin, ScrollText, Shield, Swords, UserRound } from 'lucide-react'
import type { NamingCategory, NamingRequest } from '@/shared/types/naming'
import type { LucideIcon } from 'lucide-react'

/** 默认取名条件：首屏即人物 · 中国 · 现代 · 男 · 不限字数 */
export const DEFAULT_REQUEST: NamingRequest = {
    category: 'person',
    source: 'local',
    variant: 'cn',
    era: 'modern',
    reference: 'none',
    gender: 'male',
    length: 'any',
    surnameKind: 'single',
    surname: '',
    suffix: '',
    requirement: '',
    count: 24,
}

/** 分类图标：与左侧栏图标一一对应 */
export const CATEGORY_ICONS: Readonly<Record<NamingCategory, LucideIcon>> = {
    person: UserRound,
    place: MapPin,
    faction: Flag,
    move: Swords,
    equipment: Shield,
    monster: Ghost,
    item: Gem,
}

/** 分类栏无障碍标题 */
export const CATEGORY_RAIL_LABEL = '取名分类'

/** 结果区空态文案 */
export const EMPTY_TITLE = '还没有生成名字'

export const EMPTY_DESCRIPTION = '设置左侧条件后点击「随机取名」，结果会显示在这里。'

/** 生成按钮文案 */
export const GENERATE_LABEL = '随机取名'

/** 具体要求长度上限（与宿主归一化一致） */
export const MAX_REQUIREMENT_LENGTH = 150

/** 姓氏输入长度上限（与宿主归一化一致） */
export const MAX_SURNAME_LENGTH = 8

/** 后缀输入长度上限（与宿主归一化一致） */
export const MAX_SUFFIX_LENGTH = 4

/** 占位图标兜底：分类表新增但未登记图标时使用 */
export const FALLBACK_ICON = ScrollText
