/**
 * 表情数据：内置常用子集，不引入第三方包——完整 emoji 数据集接近 1MB，进产物不划算。
 * 复用约定：每条带中文名与英文关键词，搜索时两者都匹配；分组仅用于展示。
 * 关键约束：只存 unicode 字符，插入正文后就是普通文本，Markdown 往返零风险
 * （不会被转义、不会变成节点、也不影响块级 diff 的判定）。
 */

export interface EmojiItem {
    char: string
    /** 中文名：既作搜索词也作悬停提示 */
    name: string
    /** 英文关键词：与中文名一起参与搜索 */
    keywords: string
}

export interface EmojiGroup {
    label: string
    items: readonly EmojiItem[]
}

export const EMOJI_GROUPS: readonly EmojiGroup[] = [
    {
        label: '常用',
        items: [
            { char: '😀', name: '笑脸', keywords: 'smile happy' },
            { char: '😂', name: '笑哭', keywords: 'laugh cry' },
            { char: '🥹', name: '感动', keywords: 'touched' },
            { char: '😊', name: '微笑', keywords: 'blush' },
            { char: '😍', name: '喜欢', keywords: 'love heart eyes' },
            { char: '🤔', name: '思考', keywords: 'think' },
            { char: '😅', name: '尴尬', keywords: 'sweat' },
            { char: '😭', name: '大哭', keywords: 'sob' },
            { char: '😴', name: '困', keywords: 'sleep' },
            { char: '🥳', name: '庆祝', keywords: 'party' },
            { char: '👍', name: '赞', keywords: 'thumbs up' },
            { char: '👎', name: '踩', keywords: 'thumbs down' },
            { char: '👏', name: '鼓掌', keywords: 'clap' },
            { char: '🙏', name: '拜托', keywords: 'pray thanks' },
            { char: '💪', name: '加油', keywords: 'muscle' },
            { char: '👌', name: '好的', keywords: 'ok' },
        ],
    },
    {
        label: '情绪',
        items: [
            { char: '😶', name: '无语', keywords: 'speechless' },
            { char: '😑', name: '无奈', keywords: 'expressionless' },
            { char: '🙃', name: '倒脸', keywords: 'upside down' },
            { char: '😤', name: '生气', keywords: 'angry' },
            { char: '😡', name: '愤怒', keywords: 'rage' },
            { char: '😱', name: '惊恐', keywords: 'scream' },
            { char: '😨', name: '害怕', keywords: 'fear' },
            { char: '😳', name: '脸红', keywords: 'flushed' },
            { char: '🥺', name: '可怜', keywords: 'pleading' },
            { char: '😏', name: '得意', keywords: 'smirk' },
            { char: '😌', name: '释然', keywords: 'relieved' },
            { char: '🤯', name: '爆炸头', keywords: 'mind blown' },
            { char: '😇', name: '天使', keywords: 'angel' },
            { char: '🤗', name: '拥抱', keywords: 'hug' },
            { char: '🫠', name: '融化', keywords: 'melting' },
            { char: '🥲', name: '含泪笑', keywords: 'smile tear' },
        ],
    },
    {
        label: '动作',
        items: [
            { char: '✍️', name: '书写', keywords: 'writing' },
            { char: '📝', name: '记录', keywords: 'memo note' },
            { char: '📖', name: '阅读', keywords: 'book read' },
            { char: '🔍', name: '查找', keywords: 'search' },
            { char: '💡', name: '灵感', keywords: 'idea bulb' },
            { char: '⚡', name: '灵感闪现', keywords: 'zap' },
            { char: '🎯', name: '目标', keywords: 'target' },
            { char: '🚀', name: '起飞', keywords: 'rocket launch' },
            { char: '⏰', name: '提醒', keywords: 'alarm clock' },
            { char: '📌', name: '重点', keywords: 'pin' },
            { char: '🔖', name: '书签', keywords: 'bookmark' },
            { char: '✅', name: '完成', keywords: 'check done' },
            { char: '❌', name: '错误', keywords: 'cross wrong' },
            { char: '⚠️', name: '注意', keywords: 'warning' },
            { char: '🛠️', name: '修改', keywords: 'tools fix' },
            { char: '🔄', name: '重来', keywords: 'refresh redo' },
        ],
    },
    {
        label: '自然',
        items: [
            { char: '🌙', name: '月亮', keywords: 'moon night' },
            { char: '☀️', name: '太阳', keywords: 'sun' },
            { char: '🌧️', name: '雨', keywords: 'rain' },
            { char: '❄️', name: '雪', keywords: 'snow' },
            { char: '🌊', name: '海浪', keywords: 'wave sea' },
            { char: '🔥', name: '火', keywords: 'fire' },
            { char: '🌸', name: '花', keywords: 'flower cherry' },
            { char: '🍂', name: '落叶', keywords: 'leaf autumn' },
            { char: '🌲', name: '树', keywords: 'tree' },
            { char: '⛰️', name: '山', keywords: 'mountain' },
            { char: '🌌', name: '星空', keywords: 'galaxy stars' },
            { char: '🕯️', name: '烛光', keywords: 'candle' },
            { char: '☕', name: '咖啡', keywords: 'coffee' },
            { char: '🍵', name: '茶', keywords: 'tea' },
            { char: '🍜', name: '面', keywords: 'noodles' },
            { char: '🐈', name: '猫', keywords: 'cat' },
        ],
    },
    {
        label: '符号',
        items: [
            { char: '❤️', name: '心', keywords: 'heart love' },
            { char: '💔', name: '心碎', keywords: 'broken heart' },
            { char: '✨', name: '闪光', keywords: 'sparkles' },
            { char: '⭐', name: '星', keywords: 'star' },
            { char: '🎵', name: '音符', keywords: 'music note' },
            { char: '💬', name: '对话', keywords: 'speech bubble' },
            { char: '❗', name: '感叹', keywords: 'exclamation' },
            { char: '❓', name: '疑问', keywords: 'question' },
            { char: '➕', name: '加', keywords: 'plus add' },
            { char: '➖', name: '减', keywords: 'minus' },
            { char: '➡️', name: '右箭头', keywords: 'arrow right' },
            { char: '🔗', name: '链接', keywords: 'link' },
            { char: '📎', name: '附件', keywords: 'paperclip' },
            { char: '🎬', name: '场景', keywords: 'clapper scene' },
            { char: '🏆', name: '成就', keywords: 'trophy' },
            { char: '🎁', name: '礼物', keywords: 'gift' },
        ],
    },
]

const ALL_EMOJIS: readonly EmojiItem[] = EMOJI_GROUPS.flatMap((group) => group.items)

/** 过滤：中文名按原文匹配，英文关键词按小写匹配；空查询返回全部 */
export function filterEmojis(query: string): readonly EmojiItem[] {
    const raw = query.trim()
    if (raw === '') {
        return ALL_EMOJIS
    }
    const lower = raw.toLowerCase()
    return ALL_EMOJIS.filter((item) => item.name.includes(raw) || item.keywords.includes(lower))
}
