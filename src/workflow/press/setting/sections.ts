/**
 * 设定分组元数据：把「基本信息 / 世界观 / 金手指 / 势力 / 地点 / 物品」的文案、图标与落点集中在一处。
 * 复用约定：字段分组图标取自 lucide-react，条目分组文案与图标取 constants 的 LORE_KIND_META，
 * 字段键必须存在于 ProjectSetting，切换栏与缺项判断都从此表读取。
 * 关键约束：SETTING_SECTION_ORDER 决定切换栏顺序，也是「AI 补齐设定」定位第一个缺项分组的依据；
 * 条目分组的 fields 恒为空——它们渲染条目列表而非字段表单，缺项判断与手动保存都不适用；
 * 各字段分组的 fields 必须与对应字段组件的输入项保持一致，否则缺项提示会与实际可填字段脱节。
 */
import { Globe2, Info, Sparkles } from 'lucide-react'
import type { LoreKind, ProjectSetting } from '../types'
import type { LucideIcon } from 'lucide-react'
import { LORE_KIND_META, LORE_KIND_ORDER } from '../constants'

/** 字段型分组键：手动保存与缺项判断只对它们生效 */
export type SettingFieldSectionKey = 'basic' | 'world' | 'power'

/** 设定分组键：字段分组 + 资料条目分类，条目分类直接复用 LoreKind */
export type SettingSectionKey = SettingFieldSectionKey | LoreKind

interface SettingSectionMeta {
    label: string
    icon: LucideIcon
    /** 保存落点文档名：与宿主 projectFactory 的命名保持一致 */
    fileName: string
    /** 缺项判断只看这些字段；条目分组为空表 */
    fields: readonly (keyof ProjectSetting)[]
}

/** 分组元数据：文案、图标与缺项判断依据 */
export const SETTING_SECTIONS: Readonly<Record<SettingSectionKey, SettingSectionMeta>> = {
    basic: {
        label: '基本信息',
        icon: Info,
        fileName: 'README.md',
        // 篇幅（wordGoal）0 表示不限，属合法取值，不参与缺项判断
        fields: [
            'title',
            'penName',
            'audience',
            'genres',
            'logline',
            'conflict',
            'ending',
            'perspective',
            'tone',
            'references',
            'banned',
        ],
    },
    world: {
        label: '世界观',
        icon: Globe2,
        fileName: '世界观.md',
        fields: ['worldview', 'geography', 'era', 'factions', 'powerSystem', 'concepts', 'taboo'],
    },
    power: {
        label: '金手指',
        icon: Sparkles,
        fileName: '金手指.md',
        fields: ['goldenFingerType', 'goldenFingerAbility', 'goldenFingerCost'],
    },
    faction: {
        label: LORE_KIND_META.faction.label,
        icon: LORE_KIND_META.faction.icon,
        fileName: '势力.md',
        fields: [],
    },
    place: {
        label: LORE_KIND_META.place.label,
        icon: LORE_KIND_META.place.icon,
        fileName: '地点.md',
        fields: [],
    },
    item: {
        label: LORE_KIND_META.item.label,
        icon: LORE_KIND_META.item.icon,
        fileName: '物品.md',
        fields: [],
    },
}

/** 字段分组顺序：缺项定位只看这三段，条目分组不参与 */
export const SETTING_FIELD_SECTION_ORDER: readonly SettingFieldSectionKey[] = ['basic', 'world', 'power']

/** 分组顺序：切换栏渲染顺序，字段分组在前、条目分类在后 */
export const SETTING_SECTION_ORDER: readonly SettingSectionKey[] = [
    ...SETTING_FIELD_SECTION_ORDER,
    ...LORE_KIND_ORDER,
]

/** 判断分组是否为条目分段：条目分段渲染列表与弹窗，字段分组渲染表单与保存按钮 */
export function isLoreSection(key: SettingSectionKey): key is LoreKind {
    return key === 'faction' || key === 'place' || key === 'item'
}

/** 字段组件入参：分组组件只读取设定并向上抛出补丁 */
export interface SettingFieldsProps {
    setting: ProjectSetting
    /** 当前作品目录：作品封面等只读资源从该目录回读 */
    dirPath: string
    onChange: (patch: Partial<ProjectSetting>) => void
}
