/**
 * 作品设定页：写作流程的第二步，按「基本信息 / 世界观 / 金手指 / 势力 / 地点 / 物品」收集作品级输入，
 * 前三个分组是字段表单，后三个分组是资料条目列表。
 * 复用约定：外壳取 components/AppPage（作品名走 AppSummary 徽标行、分组栏进 AppMenu、内容区走 AppContent 滚动），
 * 分组切换由 PressSettingRail 承载，文案与缺项字段表来自 ./sections，字段分组拆在 PressSetting*Fields，
 * 条目分组交给 ./lore/PressSettingLoreSection，缺项判断来自 ../utils；
 * 封面只在基本信息左列展示，出图与换图都在生图页完成。
 * 关键约束：页面只向上抛出字段补丁、保存动作与条目增删改，不直接改文件；
 * 字段改动只留在内存草稿，点「保存」才写进对应文档；条目在弹窗保存时立即写盘，因此条目分段不显示保存按钮；
 * 同一时刻只渲染一个分组，缺项判断只覆盖三个字段分组；
 * 「AI 补齐设定」把素材归纳结果交给父级合并（只填空字段），提取不到时切到第一个缺项分组、不代替作者填写；
 * 字段级 AI 生成的 hook 必须留在本页面——切分组会卸载字段组件，挂在下面会连带取消在途请求；
 * 条目描述的生成 hook 挂在弹窗内，关闭即取消，与字段级生成互不影响。
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
import { PressSettingLoreSection } from './lore/PressSettingLoreSection'
import { PressSettingBasicFields } from './PressSettingBasicFields'
import { PressSettingPowerFields } from './PressSettingPowerFields'
import { PressSettingRail } from './PressSettingRail'
import { PressSettingWorldFields } from './PressSettingWorldFields'
import { isLoreSection, SETTING_SECTION_ORDER, SETTING_SECTIONS } from './sections'
import { useSettingExtract } from './useSettingExtract'
import { useSettingFieldGenerate } from './useSettingFieldGenerate'
import type { SettingFieldSectionKey, SettingFieldsProps, SettingSectionKey } from './sections'
import type { CharacterCard, LoreEntry, LoreSeed, ProjectSetting } from '../types'
import type { ComponentType, JSX } from 'react'
import { SETTING_FIELD_MAX_LENGTH } from '../constants'
import { isSettingFieldMissing, toSettingTextPatch } from '../utils'

/**
 * 字段分组与组件的映射：世界观与金手指按此渲染。
 * 基本信息段带字段级 AI 生成，入参比其它分组多一项，故不放进本表、在页面里单独渲染；
 * 条目分组不进本表，由 PressSettingLoreSection 承担列表编排。
 */
const SECTION_COMPONENTS: Readonly<
    Record<Exclude<SettingFieldSectionKey, 'basic'>, ComponentType<SettingFieldsProps>>
> = {
    world: PressSettingWorldFields,
    power: PressSettingPowerFields,
}

interface PressSettingPageProps {
    setting: ProjectSetting
    /** 人物卡：条目弹窗的关联人物选择器按它取候选 */
    characters: readonly CharacterCard[]
    /** 三类资料条目的全量列表，各分段自行按分类过滤 */
    lore: readonly LoreEntry[]
    /** 当前作品目录：提取从该作品的 Materials 素材读起 */
    dirPath: string
    onChange: (patch: Partial<ProjectSetting>) => void
    /** 合并提取出的设定草案，返回实际填入的字段数（只填空字段） */
    onExtractSetting: (draft: PressExtractedSetting) => number
    /** 保存当前字段分组：只写该分组对应的文档，结束后 resolve */
    onSaveSection: (section: SettingFieldSectionKey) => Promise<void>
    /** 新建条目并返回标识 */
    onCreateLore: (seed: LoreSeed) => string
    onUpdateLore: (loreId: string, patch: Partial<LoreEntry>) => void
    onDeleteLore: (loreId: string) => void
}

export function PressSettingPage({
    setting,
    characters,
    lore,
    dirPath,
    onChange,
    onExtractSetting,
    onSaveSection,
    onCreateLore,
    onUpdateLore,
    onDeleteLore,
}: PressSettingPageProps): JSX.Element {
    const [activeSection, setActiveSection] = useState<SettingSectionKey>('basic')
    const [isSaving, setIsSaving] = useState(false)
    const { isExtracting, extract } = useSettingExtract(dirPath)
    const { generatingField, generate } = useSettingFieldGenerate()

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

    /** 保存当前字段分组：写盘期间禁用按钮，成功与失败的提示由 mutations 统一发出 */
    const handleSave = (): void => {
        if (isLoreSection(activeSection)) {
            return
        }
        const section = activeSection
        const run = async (): Promise<void> => {
            setIsSaving(true)
            try {
                await onSaveSection(section)
            } finally {
                setIsSaving(false)
            }
        }
        void run()
    }

    /** 内容区按分组类型分流：条目分段渲染列表，其余渲染字段表单 */
    const renderContent = (): JSX.Element => {
        if (isLoreSection(activeSection)) {
            return (
                <PressSettingLoreSection
                    kind={activeSection}
                    entries={lore}
                    characters={characters}
                    setting={setting}
                    dirPath={dirPath}
                    onCreate={onCreateLore}
                    onUpdate={onUpdateLore}
                    onDelete={onDeleteLore}
                />
            )
        }
        if (activeSection === 'basic') {
            // 基本信息段额外接字段级 AI 生成：其余分组没有生成入口
            return (
                <PressSettingBasicFields
                    setting={setting}
                    dirPath={dirPath}
                    onChange={onChange}
                    fieldAi={{ generatingField, onGenerate: handleGenerateField }}
                />
            )
        }
        const Fields = SECTION_COMPONENTS[activeSection]
        return <Fields setting={setting} dirPath={dirPath} onChange={onChange} />
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
            <AppContent isScrollable>{renderContent()}</AppContent>
            {/* 条目在弹窗保存时立即写盘，只有字段分组才需要这个保存按钮 */}
            {isLoreSection(activeSection) ? null : (
                <AppFooter className="pt-3">
                    <Button variant="primary" isLoading={isSaving} onClick={handleSave}>
                        保存更改
                    </Button>
                </AppFooter>
            )}
        </AppPage>
    )
}
