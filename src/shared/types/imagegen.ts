/**
 * 生图模块契约：按提示词生成、生成参数、参考图与提示词词库/规则的出入参。
 * 复用约定：图片风格沿用 ./press 的 PortraitStyle 与 PORTRAIT_STYLES，作品目录口径与 press 一致；
 * 生成结果直接复用 ./media 的 MediaItem，不另立图库契约。
 * 关键约束：文件名不承载语义，出处与出图参数一律进媒体索引；
 * 图库的列举、删除、设封面与详情全部由 media/* 协议承担，本文件不再定义图片标识规则。
 */
import type { MediaItem } from './media'
import type { PortraitStyle } from './press'

/**
 * 生成意图：角色卡、设定条目与其他图片三种，只用于标注出处类别。
 * 「作品封面」不是生成意图——任意一张非角色图都可以在媒体页设为封面。
 */
export type ImageGenerateKind = 'portrait' | 'lore' | 'photo'

/** 画面比例 */
export type ImageRatio = '1:1' | '3:4' | '4:3' | '16:9' | '9:16'

/** 比例白名单：前端选项与宿主入参校验共用同一份 */
export const IMAGE_RATIOS: readonly ImageRatio[] = ['1:1', '3:4', '4:3', '16:9', '9:16']

/** 比例到像素的固定映射：通道只接受 WxH，换算集中在此，避免前后端各算一套 */
export const IMAGE_RATIO_SIZE: Readonly<Record<ImageRatio, string>> = {
    '1:1': '1024x1024',
    '3:4': '768x1024',
    '4:3': '1024x768',
    '16:9': '1280x720',
    '9:16': '720x1280',
}

/** 比例收窄：非白名单值一律不通过 */
export function isImageRatio(value: unknown): value is ImageRatio {
    return typeof value === 'string' && IMAGE_RATIOS.some((item) => item === value)
}

/**
 * 生成结果：只回传新图本身，生成不影响作品封面。
 * 角色封面不在此回传——前端在生成回执后按「该角色尚无封面」自行写回人物卡，避免两套写回口径。
 */
export interface ImageGenerateResult {
    image: MediaItem
}

/**
 * 参考图条目：由宿主文件选择流程产出，前端只持有回传结果，不自行拼路径。
 * url 仅本次会话有效，供芯片缩略图与悬停预览使用。
 */
export interface ImageReferenceItem {
    /** 磁盘绝对路径：发送时原样回传，宿主按登记表校验后才读取 */
    path: string
    /** 文件名：芯片主文案 */
    name: string
    /** webview 可访问的完整 URL */
    url: string
}

/** 选择参考图结果：用户取消选择框时 reference 为 null，前端静默忽略 */
export interface ImageReferencePickResult {
    reference: ImageReferenceItem | null
}

/** 生成参数：作品级可覆盖项，配额与超时不在此列 */
export interface ImageSettings {
    /** 每次打开 composer 时默认选中的比例 */
    defaultRatio: ImageRatio
    /** 角色图与普通图默认画风 */
    portraitStyle: PortraitStyle
    /** 附加风格补充：拼在提示词末尾 */
    promptSuffix: string
    /** 负向约束：拼在提示词末尾的「避免」段 */
    negative: string
}

/** 参数默认值：前端选项与宿主回落共用同一份，避免两处口径分叉 */
export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
    defaultRatio: '3:4',
    portraitStyle: 'auto',
    promptSuffix: '',
    negative: '',
}

/** 参数读取结果：overrides 列出本作品已覆盖的键，其余跟随全局配置 */
export interface ImageSettingsResult {
    settings: ImageSettings
    overrides: ReadonlyArray<keyof ImageSettings>
}

/**
 * 提示词预览图基址：词条数据只存文件名，宿主把图库目录转成 webview 可访问的 URL 后由前端拼接。
 * baseUrl 为 null 表示目录不存在或没有任何图片，此时面板不渲染缩略图，只显示文字按钮。
 */
export interface PromptImageBase {
    /** 图库目录的 webview URL，不带结尾斜杠；目录为空时为 null */
    baseUrl: string | null
    /** 图库目录的本地绝对路径：空态直接展示，用户据此把图片放进去 */
    dirPath: string
}

/**
 * 出图规则：{存储根}/prompt/rules 下的 md 文件，全局共享、与作品无关。
 * 前端只持有标识，正文由宿主读盘并入，因此规则改文无需重新进页面。
 */
export interface PromptRule {
    /** 规则标识：文件名去掉 .md，芯片与出图请求都用它回查 */
    id: string
    /** 显示名：与标识同源，即文件名主干 */
    name: string
}

/** 规则列举结果：dirPath 始终回传，空态据此提示用户把 md 放到哪里 */
export interface PromptRuleListResult {
    rules: PromptRule[]
    dirPath: string
}

/** 规则保存请求：只新建、不覆盖，同名文件已存在时由宿主拒绝 */
export interface PromptRuleSaveRequest {
    /** 规则名，可带 .md 后缀，宿主统一去后缀后落盘 */
    name: string
    /** 规则正文：md 原文，选中后整段作为约束并入提示词 */
    content: string
}

/** 规则正文：仅供编辑弹窗回填，列表与出图请求都不携带 */
export interface PromptRuleDetail {
    /** 规则名：与文件名主干一致 */
    name: string
    /** 规则正文：md 原文（已去首尾空白） */
    content: string
}

/** 规则更新请求：整段替换正文，改名时以新名落盘并清理旧文件 */
export interface PromptRuleUpdateRequest {
    /** 原规则名：定位待改写的 md 文件 */
    previousName: string
    /** 新规则名：与原名不同即视为改名，重名由宿主拒绝 */
    name: string
    /** 新正文：md 原文，整段替换旧内容 */
    content: string
}

/**
 * 提示词词条：{存储根}/prompt/tags/*.md 中的一条，全局共享、与作品无关。
 * 标识由「分类::分组::名称」组成，改名即换标识；芯片只携带标识，原文由宿主按标识回查。
 */
export interface PromptTag {
    /** 词条标识：{分类}::{分组}::{名称}，芯片与出图请求都用它回查 */
    id: string
    /** 一级分类：md 文件的 `#` 标题，同时是文件名主干 */
    object: string
    /** 二级分组：md 文件内的 `##` 标题 */
    attribute: string
    /** 词条名：md 文件内的 `###` 标题，同组内唯一 */
    name: string
    /** 提示词原文：md 中标题下的正文，发送时归一化后并入提示词 */
    prompt: string
    /** 预览图相对 prompt/images 的路径（正斜杠），null 表示没有图 */
    preview: string | null
}

/** 二级分组：count 为该组词条数 */
export interface PromptTagAttribute {
    name: string
    count: number
}

/** 一级分类：attributes 为分类下的分组，顺序与 md 一致 */
export interface PromptTagObject {
    name: string
    attributes: PromptTagAttribute[]
}

/** 词库列举结果：tags 为扁平列表，关键词搜索在前端内存中完成 */
export interface PromptTagListResult {
    objects: PromptTagObject[]
    tags: PromptTag[]
    /** tags 目录本地路径：空态据此提示用户把 md 放到哪里 */
    dirPath: string
    /** images 目录本地路径：无图时提示图片该放到哪里 */
    imageDirPath: string
}

/** 词条新建请求：分类或分组不存在时由宿主新建 */
export interface PromptTagSaveRequest {
    object: string
    attribute: string
    name: string
    prompt: string
}

/** 词条更新请求：previousId 定位原块，改名或换组即整块移动 */
export interface PromptTagUpdateRequest {
    /** 原词条标识：定位待改写的块 */
    previousId: string
    object: string
    attribute: string
    name: string
    prompt: string
}
