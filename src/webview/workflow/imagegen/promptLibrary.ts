/**
 * 提示词库：按分类组织的常用画面词条，供输入卡片的提示词面板取用。
 * 复用约定：词条是纯文本片段，点击后插入输入框光标处，不参与任何持久化；
 * 分类与词条集中在此文件，增删词条只改清单，不改组件。
 * 关键约束：词条描述画面要素而非风格名，且与画风解耦——同一词条可叠加任意 STYLE_HINTS。
 */
import { Aperture, Droplets, PersonStanding, Trees } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface PromptCategory {
    id: string
    label: string
    icon: LucideIcon
}

interface PromptItem {
    id: string
    category: string
    title: string
    text: string
}

export const PROMPT_CATEGORIES: readonly PromptCategory[] = [
    { id: 'figure', label: '人物', icon: PersonStanding },
    { id: 'scene', label: '场景', icon: Trees },
    { id: 'light', label: '光影', icon: Droplets },
    { id: 'camera', label: '镜头', icon: Aperture },
]

export const PROMPT_ITEMS: readonly PromptItem[] = [
    { id: 'figure-standing', category: 'figure', title: '独立', text: '人物独立于画面中央，全身可见，双手自然垂落' },
    { id: 'figure-back', category: 'figure', title: '背影', text: '人物背对镜头，肩线与发丝细节清晰' },
    { id: 'figure-profile', category: 'figure', title: '侧颜', text: '四分之三侧脸，眼神望向画面外侧' },
    { id: 'figure-walk', category: 'figure', title: '行走', text: '人物侧身行走，衣摆与发梢带起轻微动态' },
    { id: 'figure-sit', category: 'figure', title: '端坐', text: '人物端坐于石阶，双手交叠置于膝上' },
    { id: 'scene-court', category: 'scene', title: '宫阙', text: '重檐建筑层叠向纵深，汉白玉台基与朱红立柱可见' },
    { id: 'scene-forest', category: 'scene', title: '林间', text: '林木高耸，地面铺满落叶，远处雾气层层退远' },
    { id: 'scene-town', category: 'scene', title: '长街', text: '湿漉漉的青石长街，两侧店铺灯笼低垂' },
    { id: 'scene-cliff', category: 'scene', title: '崖顶', text: '人物立于崖顶，脚下云海翻涌，远山只余轮廓' },
    { id: 'scene-room', category: 'scene', title: '室内', text: '木质室内空间，窗棂投下清晰的格子阴影' },
    { id: 'light-dusk', category: 'light', title: '夕照', text: '暖金夕照从侧后方打来，边缘光勾勒轮廓' },
    { id: 'light-rain', category: 'light', title: '阴雨', text: '阴天漫射光，色调偏冷，空气中有可见水汽' },
    { id: 'light-lantern', category: 'light', title: '灯火', text: '低照度环境，单一暖色光源在面部形成柔和过渡' },
    { id: 'light-moon', category: 'light', title: '月夜', text: '冷调月光作为主光，暗部保留层次不压成死黑' },
    { id: 'light-backlit', category: 'light', title: '逆光', text: '强逆光穿过介质形成体积光，人物呈半剪影' },
    { id: 'camera-eye', category: 'camera', title: '平视', text: '平视机位，人物与环境关系稳定' },
    { id: 'camera-low', category: 'camera', title: '仰角', text: '略微仰角拍摄，人物更显挺拔，背景向上收束' },
    { id: 'camera-close', category: 'camera', title: '特写', text: '胸像特写，背景大幅虚化为柔和光斑' },
    {
        id: 'camera-wide',
        category: 'camera',
        title: '远景',
        text: '大远景构图，人物作为尺度参照点出现在画面下三分之一',
    },
    { id: 'camera-occlude', category: 'camera', title: '前景遮挡', text: '前景有枝叶或帘幕遮挡，形成窥视感' },
]
