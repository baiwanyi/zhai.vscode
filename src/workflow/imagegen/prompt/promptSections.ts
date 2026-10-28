/**
 * 生图提示词分段：把正文与角色卡快照合成为提示词，并把作品设定快照单独展开为一段上下文。
 * 复用约定：调用方传入已取到的快照，本文件只做「快照 → 文本」的纯转换，状态与请求由 useImageComposer 承担；
 * 与宿主 src/modules/ai/finalPrompt 的分工是「前端拼正文、角色段与上下文，宿主拼规则与画风」，
 * 故不与其同名。
 * 关键约束：空字段一律跳过、不落占位；每项独立成行，便于模型区分外形硬约束与气质描述；
 * 设定段不进提示词正文——它由 composeSettingContext 单独展开，随请求的 contexts 字段提交，
 * 因此不参与正文长度与增强请求；角色段只在角色图模式拼接——是否传 character 由调用方决定，本层不感知生成目标。
 */

/** 作品设定快照：只取与画面相关的字段，缺省项不参与拼装 */
export interface PromptSettingSnapshot {
    title?: string
    genres?: string[]
    logline?: string
    worldview?: string
    tone?: string
    perspective?: string
}

/** 角色快照：姓名、性别年龄、身份与外貌，字段缺失时只拼姓名 */
export interface PromptCharacterSnapshot {
    id: string
    name: string
    /** 外貌白描：角色图的主体描述，缺失时只拼姓名 */
    appearance?: string
    /** 身份 / 职业：补足画面语义 */
    identity?: string
    /** 性别：人像的硬约束，只在 male / female 时拼入 */
    gender?: 'male' | 'female'
    /** 年龄：自由文本，缺失或「未知」时不拼 */
    age?: string
}

/** 拼装入参：character 为 null 表示本次不并入角色段 */
export interface PromptSectionsInput {
    text: string
    character: PromptCharacterSnapshot | null
}

/** 性别文案：只在已知时拼入，避免把「未知」写成外貌 */
const GENDER_LABELS: Readonly<Record<'male' | 'female', string>> = {
    male: '男性',
    female: '女性',
}

/**
 * 角色段：姓名 + 性别年龄 + 身份 + 外貌，空项跳过。
 * 关键约束：每项独立成行，便于模型区分「外形硬约束」与「气质描述」；字段全部取自人物卡，此处不做推断。
 */
function composeCharacterSection(character: PromptCharacterSnapshot): string {
    const lines = [`角色：${character.name}`]
    const profile = [character.gender === undefined ? '' : GENDER_LABELS[character.gender], character.age ?? ''].filter(
        (part) => part.length > 0,
    )
    if (profile.length > 0) {
        lines.push(`外形：${profile.join('，')}`)
    }
    if (character.identity !== undefined && character.identity.length > 0) {
        lines.push(`身份：${character.identity}`)
    }
    if (character.appearance !== undefined && character.appearance.length > 0) {
        lines.push(`外貌：${character.appearance}`)
    }
    return lines.join('\n')
}

/** 把作品设定展开为一段文本：只输出有值的字段 */
function formatSettingSnapshot(setting: PromptSettingSnapshot): string {
    const lines: string[] = []
    if (setting.title !== undefined && setting.title.length > 0) {
        lines.push(`书名：${setting.title}`)
    }
    if (setting.genres !== undefined && setting.genres.length > 0) {
        lines.push(`题材：${setting.genres.join('、')}`)
    }
    if (setting.logline !== undefined && setting.logline.length > 0) {
        lines.push(`简介：${setting.logline}`)
    }
    if (setting.worldview !== undefined && setting.worldview.length > 0) {
        lines.push(`世界观：${setting.worldview}`)
    }
    if (setting.tone !== undefined && setting.tone.length > 0) {
        lines.push(`基调：${setting.tone}`)
    }
    if (setting.perspective !== undefined && setting.perspective.length > 0) {
        lines.push(`视角：${setting.perspective}`)
    }
    return lines.join('\n')
}

/**
 * 作品设定上下文：展开为一段独立文本，由调用方放进请求的 contexts。
 * 关键约束：与正文分开，模型侧看到的仍是背景信息，但协议里不再混入 prompt 字段。
 */
export function composeSettingContext(setting: PromptSettingSnapshot): string {
    return formatSettingSnapshot(setting)
}

/** 合成前端提示词：正文与角色段依次排布，段间空行分隔，空段不占位 */
export function composePromptSections({ text, character }: PromptSectionsInput): string {
    const sections: string[] = []
    const trimmed = text.trim()
    if (trimmed.length > 0) {
        sections.push(trimmed)
    }
    if (character !== null) {
        sections.push(composeCharacterSection(character))
    }
    return sections.join('\n\n')
}
