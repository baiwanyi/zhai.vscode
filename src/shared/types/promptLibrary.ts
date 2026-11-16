/**
 * 提示词库契约：预览图基址、出图规则与词条的列举、新建、更新出入参。
 * 复用约定：规则与词条均为 {存储根}/prompt 下的 md 文件，全局共享、与作品无关；
 * 前端只持有标识，正文由宿主读盘并入，因此改文无需重新进页面。
 * 关键约束：词条标识由「分类::分组::名称」组成，改名即换标识；
 * 列举结果同时下发分组树与扁平列表，树用于面板导航，扁平列表用于内存搜索，二者须由同一批词条产出。
 */

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
 * 前端只持有标识，正文由宿主读盘并入。
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
