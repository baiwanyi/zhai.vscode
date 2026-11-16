/**
 * 参考图契约：宿主文件选择流程的产出条目与选择结果。
 * 复用约定：路径由宿主登记后回传，前端只持有结果，不自行拼磁盘路径；
 * url 仅本次会话有效，供芯片缩略图与悬停预览使用。
 * 关键约束：path 是磁盘绝对路径，发送时原样回传，宿主须按登记表校验后才读取，
 * 前端不得据 name 或 url 反推路径。
 */

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
