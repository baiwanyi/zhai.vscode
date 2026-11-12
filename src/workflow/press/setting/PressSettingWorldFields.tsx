/**
 * 世界观字段组：世界观总述、地理、时代、势力、力量体系、核心概念与禁忌设定。
 * 复用约定：字段组容器取 @components/ui 的 field 之 FieldGroup，单列排布、每个字段独占一行；
 * 七个字段都是多句描述，统一取 @webview/components/AiTextareaField（多行输入 + 字段级 AI 生成）；
 * 字数上限与 AI 生成结果截断共用 constants 的 SETTING_FIELD_MAX_LENGTH。
 * 关键约束：同一时刻只允许一项生成，忙碌态由页面持有、本组件只按字段渲染按钮状态；
 * 多数值由 textarea 输入，写盘时折成单行键值行（见 serialize.ts），因此不要指望换行落到文档里；
 * 核心概念用分号分隔多个名词，续写注入时按同一规则切分，改写分隔符须同步宿主侧解析。
 */
import { FieldGroup } from '@components/ui/field'
import type { SettingFieldKey } from '@shared/types/press'
import { AiTextareaField } from '@webview/components/AiTextareaField'
import type { SettingFieldAi, SettingFieldsProps } from './sections'
import type { JSX } from 'react'
import { SETTING_FIELD_MAX_LENGTH } from '../constants'
import { toSettingTextPatch } from '../utils'

interface WorldFieldMeta {
    key: Extract<SettingFieldKey, 'worldview' | 'geography' | 'era' | 'factions' | 'powerSystem' | 'concepts' | 'taboo'>
    label: string
    placeholder: string
    /** 字段下方说明：只有需要解释填写口径的字段才写 */
    description?: string
}

/** 世界观字段的顺序与文案：与 SECTION_SECTIONS.world.fields 的键集合一致 */
const WORLD_FIELDS: readonly WorldFieldMeta[] = [
    {
        key: 'worldview',
        label: '世界观总述',
        placeholder: '世界的形态、历史沿革、种族与文明结构',
        description: '导入作品时会依据设定候选章归纳这一段，续写时的风格注入首先读它',
    },
    { key: 'geography', label: '地理格局', placeholder: '主要地域、场景与空间关系' },
    { key: 'era', label: '时代舞台', placeholder: '年代、技术或修炼水平、社会秩序' },
    { key: 'factions', label: '势力格局', placeholder: '主要势力、各方诉求与彼此关系' },
    { key: 'powerSystem', label: '力量体系', placeholder: '力量来源、层级划分与晋升条件' },
    {
        key: 'concepts',
        label: '核心概念',
        placeholder: '作品独有的名词与规则，如「灵气：天地间的能量，可被修士吸纳」',
        description: '独有名词是续写时不跑偏的关键，多个概念用分号分隔',
    },
    {
        key: 'taboo',
        label: '禁忌设定',
        placeholder: '写作时不得违反的硬约束：禁写桥段、必须遵守的设定规则',
    },
]

interface PressSettingWorldFieldsProps extends SettingFieldsProps {
    fieldAi: SettingFieldAi
}

export function PressSettingWorldFields({ setting, onChange, fieldAi }: PressSettingWorldFieldsProps): JSX.Element {
    const { generatingField, onGenerate } = fieldAi
    /** 任一字段在生成时按钮全部禁用：一次只跑一项，避免并发请求 */
    const isBusy = generatingField !== null

    return (
        <FieldGroup className="grid grid-cols-1 gap-3">
            {WORLD_FIELDS.map((field) => (
                <AiTextareaField
                    key={field.key}
                    id={`setting-${field.key}`}
                    label={field.label}
                    value={setting[field.key]}
                    placeholder={field.placeholder}
                    description={field.description}
                    maxLength={SETTING_FIELD_MAX_LENGTH[field.key]}
                    isGenerating={generatingField === field.key}
                    isDisabled={isBusy}
                    generateLabel={`AI 生成${field.label}`}
                    onChange={(value) => onChange(toSettingTextPatch(field.key, value))}
                    onGenerate={() => onGenerate(field.key)}
                />
            ))}
        </FieldGroup>
    )
}
