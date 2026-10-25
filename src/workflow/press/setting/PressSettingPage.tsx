/**
 * 作品设定页：写作流程的第二步，按「基本信息 / 故事内核 / 世界观 / 金手指 / 写作风格 / 封面」收集作品级输入。
 * 复用约定：外壳取 components/AppPage（作品名走 AppDescription 眉标、分组栏进 AppMenu、字段区走 AppContent 滚动），
 * 分组切换由 PressSettingRail（ui/toggle-group）承载，文案与缺项字段表来自 ./sections，
 * 各分组字段拆在 PressSetting*Fields 中，缺项判断来自 ../utils；封面分组自带 AI 出图能力。
 * 关键约束：页面只向上抛出字段补丁，不直接改文件；同一时刻只渲染一个分组，缺项判断覆盖全部分组；
 * 「AI 补齐设定」把素材归纳结果交给父级合并（只填空字段），提取不到时切到第一个缺项分组、不代替作者填写。
 */
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { PressExtractedSetting } from '@shared/types/press'
import {
    AppContent,
    AppDescription,
    AppFooter,
    AppHeader,
    AppMenu,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { PressSettingBasicFields } from './PressSettingBasicFields'
import { PressSettingCoverFields } from './PressSettingCoverFields'
import { PressSettingPowerFields } from './PressSettingPowerFields'
import { PressSettingRail } from './PressSettingRail'
import { PressSettingStoryFields } from './PressSettingStoryFields'
import { PressSettingStyleFields } from './PressSettingStyleFields'
import { PressSettingWorldFields } from './PressSettingWorldFields'
import { SETTING_SECTION_ORDER, SETTING_SECTIONS } from './sections'
import { useSettingExtract } from './useSettingExtract'
import type { SettingFieldsProps, SettingSectionKey } from './sections'
import type { ProjectSetting } from '../types'
import type { ComponentType, JSX } from 'react'
import { isSettingFieldMissing } from '../utils'

/** 分组与字段组件的映射：切换栏选中哪一段就渲染哪一段，顺序由 SETTING_SECTION_ORDER 决定 */
const SECTION_COMPONENTS: Readonly<Record<SettingSectionKey, ComponentType<SettingFieldsProps>>> = {
    basic: PressSettingBasicFields,
    story: PressSettingStoryFields,
    world: PressSettingWorldFields,
    power: PressSettingPowerFields,
    style: PressSettingStyleFields,
    cover: PressSettingCoverFields,
}

interface PressSettingPageProps {
    setting: ProjectSetting
    /** 当前作品目录：提取从该作品的 Materials 素材读起 */
    dirPath: string
    onChange: (patch: Partial<ProjectSetting>) => void
    /** 合并提取出的设定草案，返回实际填入的字段数（只填空字段） */
    onExtractSetting: (draft: PressExtractedSetting) => number
}

export function PressSettingPage({ setting, dirPath, onChange, onExtractSetting }: PressSettingPageProps): JSX.Element {
    const [activeSection, setActiveSection] = useState<SettingSectionKey>('basic')
    const { isExtracting, extract } = useSettingExtract(dirPath)

    const Fields = SECTION_COMPONENTS[activeSection]

    const isSectionIncomplete = (key: SettingSectionKey): boolean =>
        SETTING_SECTIONS[key].fields.some((field) => isSettingFieldMissing(setting, field))

    /** 切到第一个缺项分组：只把需要补的面板推到作者眼前，不代替作者填写 */
    const focusFirstMissing = (): void => {
        const missing = SETTING_SECTION_ORDER.find((key) => isSectionIncomplete(key))
        if (missing) {
            setActiveSection(missing)
        }
    }

    /**
     * AI 补齐设定：先用素材归纳结果填空字段，再切到第一个缺项分组；
     * 提取失败、无素材候选章或无可填字段时不改写任何内容，仅切换分组兜底，保证按钮始终有可见反馈。
     */
    const handleExtract = (): void => {
        const run = async (): Promise<void> => {
            const result = await extract()
            if (result === null) {
                focusFirstMissing()
                return
            }
            if (result.setting === null) {
                toast.info(result.message)
                focusFirstMissing()
                return
            }
            const filled = onExtractSetting(result.setting)
            if (filled === 0) {
                toast.info('提取到的字段都已填写，未改动现有内容')
                focusFirstMissing()
                return
            }
            toast.success(`已填入 ${String(filled)} 个空字段，共 ${String(result.setting.clues.length)} 章线索供核对`)
            focusFirstMissing()
        }
        void run()
    }

    return (
        <AppPage>
            <AppHeader>
                {/* 眉标：作品名与说明同用弱化小字，避免与页面标题争夺主视觉 */}
                <AppDescription>{setting.title}</AppDescription>
                <AppTitle>作品设定</AppTitle>
                <AppDescription>设定越具体，大纲与续写越不容易跑偏</AppDescription>
                <AppMenu>
                    <PressSettingRail activeSection={activeSection} onSelect={setActiveSection} />
                </AppMenu>
            </AppHeader>
            <AppContent isScrollable>
                <Fields setting={setting} dirPath={dirPath} onChange={onChange} />
            </AppContent>
            <AppFooter>
                <Button
                    variant="outline"
                    title="按设定候选章的摘录与摘要归纳世界观、规则与核心概念（调用 AI），只填空字段；提取不到时切到缺项分组"
                    disabled={isExtracting}
                    onClick={handleExtract}
                >
                    <Sparkles />
                    {isExtracting ? '提取中' : 'AI 补齐设定'}
                </Button>
            </AppFooter>
        </AppPage>
    )
}
