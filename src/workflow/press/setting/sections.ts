/**
 * 设定分组元数据：把「基本信息 / 世界观 / 金手指」的文案、图标与字段归属集中在一处。
 * 复用约定：图标取自 lucide-react，字段键必须存在于 ProjectSetting，切换栏与缺项判断都从此表读取。
 * 关键约束：SETTING_SECTION_ORDER 决定切换栏顺序，也是「AI 补齐设定」定位第一个缺项分组的依据；
 * 各分组的 fields 必须与对应字段组件的输入项保持一致，否则缺项提示会与实际可填字段脱节。
 */
import { Globe2, Info, Sparkles } from 'lucide-react'
import type { ProjectSetting } from '../types'
import type { LucideIcon } from 'lucide-react'

/** 设定分组键：与下方 SETTING_SECTIONS 一一对应 */
export type SettingSectionKey = 'basic' | 'world' | 'power'

interface SettingSectionMeta {
    label: string
    icon: LucideIcon
    /** 保存落点文档名：基本信息写 README，世界观与金手指各成一篇，与宿主 projectFactory 的命名一致 */
    fileName: string
    /** 缺项判断只看这些字段 */
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
}

/** 分组顺序：切换栏渲染顺序，也是缺项定位的优先顺序 */
export const SETTING_SECTION_ORDER: readonly SettingSectionKey[] = ['basic', 'world', 'power']

/** 字段组件入参：分组组件只读取设定并向上抛出补丁 */
export interface SettingFieldsProps {
    setting: ProjectSetting
    /** 当前作品目录：作品封面等只读资源从该目录回读 */
    dirPath: string
    onChange: (patch: Partial<ProjectSetting>) => void
}
