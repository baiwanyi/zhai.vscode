/**
 * 作品设定页：写作流程的第二步，按「基本信息 / 世界观 / 金手指」收集作品级输入，
 * 基本信息段内含作品信息、故事内核与写作风格三块。
 * 复用约定：外壳取 components/AppPage（作品名走 AppSummary 徽标行、分组栏进 AppMenu、字段区走 AppContent 滚动），
 * 分组切换由 PressSettingRail（ui/toggle-group）承载，文案与缺项字段表来自 ./sections，
 * 各分组字段拆在 PressSetting*Fields 中，缺项判断来自 ../utils；封面只在基本信息左列展示，出图与换图都在生图页完成。
 * 关键约束：页面只向上抛出字段补丁与保存动作，不直接改文件；字段改动只留在内存草稿，
 * 点「保存」才把当前分组写进对应文档（基本信息 → README.md，世界观 → 世界观.md，金手指 → 金手指.md）；
 * 同一时刻只渲染一个分组，缺项判断覆盖全部分组；
 * 「AI 补齐设定」把素材归纳结果交给父级合并（只填空字段），提取不到时切到第一个缺项分组、不代替作者填写；
 * 字段级 AI 生成的 hook 必须留在本页面——切分组会卸载字段组件，挂在下面会连带取消在途请求。
 */
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { PressExtractedSetting, SettingFieldKey } from '@shared/types/press'
import {
    AppAction,
    AppContent,
    AppDescription,
    AppFooter,
    AppHeader,
    AppMenu,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { AppSummary } from '@webview/components/AppSummary'
import { Button } from '@webview/components/Button'
import { PressSettingBasicFields } from './PressSettingBasicFields'
import { PressSettingPowerFields } from './PressSettingPowerFields'
import { PressSettingRail } from './PressSettingRail'
import { PressSettingWorldFields } from './PressSettingWorldFields'
import { SETTING_SECTION_ORDER, SETTING_SECTIONS } from './sections'
import { useSettingExtract } from './useSettingExtract'
import { useSettingFieldGenerate } from './useSettingFieldGenerate'
import type { SettingFieldsProps, SettingSectionKey } from './sections'
import type { ProjectSetting } from '../types'
import type { ComponentType, JSX } from 'react'
import { SETTING_FIELD_MAX_LENGTH } from '../constants'
import { isSettingFieldMissing, toSettingTextPatch } from '../utils'

/**
 * 分组与字段组件的映射：世界观与金手指按此渲染。
 * 基本信息段带字段级 AI 生成，入参比其它分组多一项，故不放进本表、在页面里单独渲染。
 */
const SECTION_COMPONENTS: Readonly<Record<Exclude<SettingSectionKey, 'basic'>, ComponentType<SettingFieldsProps>>> = {
    world: PressSettingWorldFields,
    power: PressSettingPowerFields,
}

interface PressSettingPageProps {
    setting: ProjectSetting
    /** 当前作品目录：提取从该作品的 Materials 素材读起 */
    dirPath: string
    onChange: (patch: Partial<ProjectSetting>) => void
    /** 合并提取出的设定草案，返回实际填入的字段数（只填空字段） */
    onExtractSetting: (draft: PressExtractedSetting) => number
    /** 保存当前分组：只写该分组对应的文档，结束后 resolve */
    onSaveSection: (section: SettingSectionKey) => Promise<void>
}

export function PressSettingPage({
    setting,
    dirPath,
    onChange,
    onExtractSetting,
    onSaveSection,
}: PressSettingPageProps): JSX.Element {
    const [activeSection, setActiveSection] = useState<SettingSectionKey>('basic')
    const [isSaving, setIsSaving] = useState(false)
    const { isExtracting, extract } = useSettingExtract(dirPath)
    const { generatingField, generate } = useSettingFieldGenerate()

    /** 非基本信息段的字段组件：基本信息段单独渲染，故此处为 null */
    const OtherFields = activeSection === 'basic' ? null : SECTION_COMPONENTS[activeSection]

    const isSectionIncomplete = (key: SettingSectionKey): boolean =>
        SETTING_SECTIONS[key].fields.some((field) => isSettingFieldMissing(setting, field))

    /** 生成单个设定字段：成功后立即写回草稿，结果按字段上限截断（与输入框 maxLength 同源） */
    const handleGenerateField = (field: SettingFieldKey): void => {
        const run = async (): Promise<void> => {
            const content = await generate(setting, field)
            if (content === null) {
                return
            }
            const value = content.slice(0, SETTING_FIELD_MAX_LENGTH[field])
            onChange(toSettingTextPatch(field, value))
            toast.success('已生成一版，可直接修改或继续生成')
        }
        void run()
    }

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
            toast.success(
                `已填入 ${String(filled)} 个空字段，共 ${String(result.setting.clues.length)} 章线索供核对，记得点保存`,
            )
            focusFirstMissing()
        }
        void run()
    }

    /** 保存当前分组：写盘期间禁用按钮，成功与失败的提示由 mutations 统一发出 */
    const handleSave = (): void => {
        const run = async (): Promise<void> => {
            setIsSaving(true)
            try {
                await onSaveSection(activeSection)
            } finally {
                setIsSaving(false)
            }
        }
        void run()
    }

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>作品设定</AppTitle>
                <AppAction>
                    <Button variant="outline" disabled={isExtracting} onClick={handleExtract}>
                        <Sparkles />
                        {isExtracting ? '提取中' : '提取设定'}
                    </Button>
                </AppAction>
                <AppDescription>设定越具体，大纲与续写越不容易跑偏</AppDescription>
                <AppSummary title={setting.title} path={dirPath} />
                <AppMenu>
                    <PressSettingRail activeSection={activeSection} onSelect={setActiveSection} />
                </AppMenu>
            </AppHeader>
            <AppContent isScrollable>
                {/* 基本信息段额外接字段级 AI 生成：其余分组没有生成入口 */}
                {OtherFields === null ? (
                    <PressSettingBasicFields
                        setting={setting}
                        dirPath={dirPath}
                        onChange={onChange}
                        fieldAi={{ generatingField, onGenerate: handleGenerateField }}
                    />
                ) : (
                    <OtherFields setting={setting} dirPath={dirPath} onChange={onChange} />
                )}
            </AppContent>
            <AppFooter className="pt-3">
                <Button variant="primary" isLoading={isSaving} onClick={handleSave}>
                    保存更改
                </Button>
            </AppFooter>
        </AppPage>
    )
}
