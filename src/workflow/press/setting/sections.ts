/**
 * 设定分组元数据：把「基本信息 / 故事内核 / 世界观 / 金手指 / 写作风格 / 封面」的文案、图标与字段归属集中在一处。
 * 复用约定：图标取自 lucide-react，字段键必须存在于 ProjectSetting，切换栏与缺项判断都从此表读取。
 * 关键约束：SETTING_SECTION_ORDER 决定切换栏顺序，也是「AI 补齐设定」定位第一个缺项分组的依据；
 * 各分组的 fields 必须与对应字段组件的输入项保持一致，否则缺项提示会与实际可填字段脱节；
 * 封面不属于作品设定字段（产物是图片而非 Markdown 数据），因此 fields 为空、不参与缺项判断。
 */
import { BookOpen, Globe2, Image, Info, PenLine, Sparkles } from 'lucide-react'
import type { ProjectSetting } from '../types'
import type { LucideIcon } from 'lucide-react'

/** 设定分组键：与下方 SETTING_SECTIONS 一一对应 */
export type SettingSectionKey = 'basic' | 'story' | 'world' | 'power' | 'style' | 'cover'

interface SettingSectionMeta {
    label: string
    icon: LucideIcon
    /** 缺项判断只看这些字段 */
    fields: readonly (keyof ProjectSetting)[]
}

/** 分组元数据：文案、图标与缺项判断依据 */
export const SETTING_SECTIONS: Readonly<Record<SettingSectionKey, SettingSectionMeta>> = {
    basic: {
        label: '基本信息',
        icon: Info,
        fields: ['title', 'penName', 'audience', 'wordGoal', 'genres'],
    },
    story: {
        label: '故事内核',
        icon: BookOpen,
        fields: ['logline', 'conflict', 'ending'],
    },
    world: {
        label: '世界观',
        icon: Globe2,
        fields: ['worldview', 'geography', 'era', 'factions', 'powerSystem', 'concepts', 'taboo'],
    },
    power: {
        label: '金手指',
        icon: Sparkles,
        fields: ['goldenFingerType', 'goldenFingerAbility', 'goldenFingerCost'],
    },
    style: {
        label: '写作风格',
        icon: PenLine,
        fields: ['perspective', 'tone', 'references', 'banned'],
    },
    cover: {
        label: '封面',
        icon: Image,
        fields: [],
    },
}

/** 分组顺序：切换栏渲染顺序，也是缺项定位的优先顺序（封面排在最后，等设定写完再出图） */
export const SETTING_SECTION_ORDER: readonly SettingSectionKey[] = [
    'basic',
    'story',
    'world',
    'power',
    'style',
    'cover',
]

/** 字段组件入参：分组组件只读取设定并向上抛出补丁 */
export interface SettingFieldsProps {
    setting: ProjectSetting
    /** 当前作品目录：封面等需要读写作品资源的字段组使用 */
    dirPath: string
    onChange: (patch: Partial<ProjectSetting>) => void
}
