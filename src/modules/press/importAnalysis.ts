/**
 * 导入素材抽取：扫描已落盘的章节文档，产出供 AI 归纳使用的中间素材，平铺在作品的 _import/ 下。
 * 素材分四类：章节清单与三段摘录（首/中/尾，供章节摘要）、人名候选与出场原文摘录（供角色卡）、
 * 金手指候选章与世界构建候选章（供设定归纳）。
 * 复用约定：Frontmatter 切分与标题读取取自 common/db/fileMeta，字数口径与索引库一致；
 * 路径构造复用 common/storagePath，素材目录名取自 shared/types/press 的 PRESS_IMPORT_DIR。
 * 关键约束：本模块只做统计与摘录，不做语义判断——角色名与设定线索都只是「候选」，是否成立由 AI 裁决；
 * 正文只在角色证据里以片段形式落盘，不整章复制，避免素材目录膨胀；
 * 摘录必须覆盖章节中段，只取首尾会让「中间发生了什么」在归纳阶段彻底丢失。
 */

import * as vscode from 'vscode'
import { PRESS_IMPORT_DIR } from '../../shared/types/press'
import { resolveStorageRoot } from '../common/config'
import { countWords, parseTitle, splitFrontmatter } from '../common/db/fileMeta'
import { logger } from '../common/logger'
import { buildStorageUri, isPathExisting } from '../common/storagePath'

/** 章节摘录长度：首、中、尾各取该字数；太短只能猜梗概，太长则素材与后续提示词一起膨胀 */
const DIGEST_LENGTH = 400

/** 中段摘录的取样位置：取正文正中，避开已被首尾覆盖的区间 */
const MIDDLE_RATIO = 0.5

/** 素材文件名：全部平铺在 _import/ 下，不使用子目录 */
const INDEX_FILE = 'chapter-index.tsv'
const HEADS_FILE = 'chapter-heads.tsv'
const CANDIDATES_FILE = 'characters-candidates.tsv'
const EVIDENCE_FILE = 'characters-evidence.md'
const GOLDEN_FINGER_FILE = 'golden-fingers.md'
const WORLD_CLUES_FILE = 'world-clues.md'

/** 人名候选的出现次数下限：低于该值视为偶然出现的词组 */
const MIN_NAME_HITS = 3

/** 人名候选上限：角色卡只取前 30 个，多留一批供人工挑选与证据摘录 */
const MAX_CANDIDATES = 40

/** 角色原文证据：每个角色摘几段、每段前后各取多少字 */
const EVIDENCE_PER_CHARACTER = 6
const EVIDENCE_CONTEXT = 220

/** 每章参与共现统计的候选人数上限 */
const CO_OCCURRENCE_TOP = 5

/** 金手指命中取前若干章，供后续 AI 重点阅读 */
const GOLDEN_FINGER_TOP = 20

/** 世界构建线索的取材上限：设定归纳一次只读得下这么多章 */
const WORLD_CLUE_TOP = 20

/** 关键词一个都没命中时的兜底取材章数 */
const SETTING_FALLBACK_TOP = 12

/** 常见单姓：覆盖网文角色名的绝大多数，宁可漏判也不冒险扩充造成大量误判 */
const SURNAMES = new Set(
    '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹喻柏窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房裘缪干解应宗丁宣邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊惠甄曲家封芮储靳松井段富巫乌焦巴弓牧隗山谷车侯全班秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸司韶郜黎薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳姬申扶堵冉宰郦雍桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越隆师巩聂晁融冷訾辛阚简饶空曾沙养鞠须丰巢关蒯相查后荆红游竺权盖益桓',
)

/**
 * 姓氏后紧跟的动作词：只有「候选名 + 人物动作」才算人名证据。
 * 关键约束：这里只收「需要人做主语」的动词（说、笑、点头、皱眉……），
 * 不收「爆、涌、散、亮」这类无主语也能成立的词——后者会把「能量」「金光」误判成人名。
 * 早期版本还接受「候选名 + 标点」，那条规则会产出「时候」「东西」「闻言」「解释」这类高频假角色，已移除。
 */
const ACTION_SUFFIX =
    '道说问答笑怒喝叹想吼叫骂哼哭嚷看点皱冷沉抬转开抱拱摆停站坐走跑冲扑低伸收抓握愣怔僵盯望瞧听念叨咳嗯唉嘶哂讥嘲瞪瞥瞄咽喝呸噢哦嘿嗨喂嗯嚎嚷'

/**
 * 非人名词表：由姓氏字眼开头、但实际是普通词或身份通称的组合。
 * 关键词表永远不全，它是候选筛选的第一道过滤，模型侧提示词与解析层各自还有一道。
 */
const NON_PERSON_WORDS = new Set([
    // 时间、方位、抽象名词（最容易被「姓氏 + 标点」误判的高频词）
    '时候',
    '时间',
    '时刻',
    '时辰',
    '时机',
    '时常',
    '时人',
    '东西',
    '东西方',
    '地方',
    '方向',
    '方式',
    '方面',
    '方位',
    '方案',
    // 高频连词与方位短语：它们后面常跟动作词（「于是笑道」「向前走去」「马上走了」），
    // 不列出来就会稳定产出假角色——命中次数远超阈值，光靠次数筛不掉
    '于是',
    '于此',
    '当然',
    '何况',
    '何处',
    '何时',
    '何人',
    '何故',
    '何必',
    '莫非',
    '向前',
    '向后',
    '向外',
    '向内',
    '向上',
    '向下',
    '马上',
    '关心',
    '关于',
    '陆续',
    '马车',
    '景象',
    '荀子',
    '过程',
    '结果',
    '关系',
    '身份',
    '声音',
    '声明',
    '名声',
    '脸色',
    '眼神',
    '心情',
    '念头',
    '力量',
    '气息',
    '修为',
    '境界',
    '位置',
    '距离',
    '速度',
    '温度',
    '光芒',
    '震动',
    '变化',
    '感觉',
    '想法',
    '问题',
    '答案',
    '情况',
    '事情',
    '消息',
    '名字',
    '能量',
    '能力',
    '闻言',
    '解释',
    '通红',
    '通体',
    '通常',
    '通明',
    '周身',
    '周天',
    '周围',
    '周围人',
    '方向感',
    '余地',
    '余波',
    '当下',
    '当时',
    '当日',
    '当年',
    '常人',
    '常理',
    '白日',
    '白衣',
    '白发',
    '石壁',
    '石阶',
    '石室',
    '毛发',
    '民间',
    '民众',
    '水汽',
    '水火',
    '木门',
    '山峰',
    '山谷',
    '田中',
    '田间',
    '文风',
    '文化',
    '文中',
    '武功',
    '武力',
    '武器',
    '甘愿',
    '甘心',
    '生死',
    '生气',
    '生机',
    '宁死',
    '宁静',
    '史书',
    '史上',
    '叶子',
    '叶片',
    '龙套',
    '龙王',
    '左右',
    '左臂',
    '右手',
    '左手',
    '右臂',
    '关中',
    '关闭',
    '关爱',
    '祖国',
    '祖师',
    '祖先',
    '祖宗',
    '包内',
    '包袱',
    '包裹',
    '程门',
    '程度',
    '程序',
    '陆路',
    '陆军',
    '陆地',
    '翁婿',
    '曲子',
    '曲调',
    '封号',
    '封印',
    '段落',
    '段落感',
    '车窗',
    '车轮',
    '车门',
    '秋季',
    '秋风',
    '秋色',
    '伊人',
    '宫门',
    '宫殿',
    '宁可',
    '宁愿',
    '祖传',
    '祖上',
    '武学',
    '符纸',
    '刘家',
    '景致',
    '景色',
    '龙脉',
    '龙族',
    '叶家',
    '华丽',
    '华服',
    '金家',
    '金色',
    '金黄',
    '钱包',
    '钱袋',
    // 身份通称与人群集合：不是具体角色
    '少年',
    '老者',
    '男子',
    '女子',
    '公子',
    '小姐',
    '先生',
    '夫人',
    '姑娘',
    '长老',
    '师兄',
    '师姐',
    '师弟',
    '师妹',
    '师父',
    '师尊',
    '弟子',
    '掌门',
    '宗主',
    '将军',
    '皇帝',
    '太子',
    '掌柜',
    '小二',
    '下人',
    '众人',
    '对方',
    '此子',
    '此人',
    '那人',
    '这人',
    '天下',
    '江湖',
    '中原',
    '边关',
    '京城',
    '宗门',
    '家族',
    '世家',
    '学院',
    '朝廷',
    '官府',
    '衙门',
    '酒楼',
    '客栈',
    '山门',
    '城门',
    '广场',
    '大殿',
    '书房',
    '卧房',
    '王朝',
    '王都',
    '王家',
    '王府',
    '王爷',
    '李府',
    '张家',
    '陈家',
    '林家',
    '赵家',
    '江家',
    '郭家',
    '黄家',
    '杨家',
    '周家',
    '吴家',
])

/**
 * 候选字数长度：从短到长尝试。先认两字名，再退让三字与四字，
 * 否则「薛牧笑道」会被切成「薛牧笑」、三字名也会被切走首字，产生大量「人名 + 动作字」的假候选。
 */
const NAME_LENGTHS: readonly number[] = [2, 3, 4]

/** 汉字候选校验 */
const HAN_NAME = /^[\u4e00-\u9fa5]{2,4}$/u

/**
 * 判断一个候选是否可能是人名：汉字 2–4 字且不在非人名词表内。
 * 关键约束：这是候选筛选与产物解析共用的口径——素材层用它过滤候选，
 * 归纳产物解析时用同一函数兜住模型自造的条目，两处不能各写一份。
 */
export function isLikelyPersonName(name: string): boolean {
    return HAN_NAME.test(name) && !NON_PERSON_WORDS.has(name)
}

/** 金手指关键词表：按题材归类，只用于定位「作者的设定最可能在哪几章交代」 */
const GOLDEN_FINGER_HINTS: readonly { category: string; words: readonly string[] }[] = [
    { category: '系统流', words: ['系统', '面板', '任务', '签到', '商城', '抽奖', '属性点', '加点', '升级'] },
    { category: '器物流', words: ['戒指', '玉佩', '残图', '古卷', '令牌', '空间', '储物袋', '玉简'] },
    { category: '传承流', words: ['老爷爷', '传承', '残魂', '记忆觉醒', '师父留下', '洞府'] },
    { category: '穿越流', words: ['重生', '回到', '前世', '穿越', '异界', '平行世界', '夺舍'] },
]

/**
 * 世界构建关键词表：与金手指分开统计，用于定位交代世界形态、地理、势力与规则体系的章节。
 * 金手指导向「主角为什么特殊」，这张表导向「这个世界怎么运转」，设定归纳两类素材都要取。
 */
const WORLD_HINTS: readonly { category: string; words: readonly string[] }[] = [
    {
        category: '世界形态',
        words: ['世界', '大陆', '位面', '诸天', '星域', '王朝', '帝国', '联邦', '城邦', '纪元'],
    },
    { category: '地理', words: ['山脉', '平原', '海域', '秘境', '遗迹', '王都', '边疆', '禁地', '洞天', '州郡'] },
    { category: '历史', words: ['千年前', '百年前', '上古', '远古', '传说', '史书', '灭国', '大战', '封印'] },
    { category: '势力', words: ['宗门', '门派', '家族', '世家', '朝廷', '军部', '教会', '公会', '长老会', '联盟'] },
    { category: '规则', words: ['境界', '等级', '品阶', '法则', '规则', '禁忌', '契约', '血脉', '天赋', '灵根'] },
    { category: '核心概念', words: ['灵气', '真气', '魔力', '元力', '序列', '异能', '术法', '神通', '功法', '丹药'] },
]

/** 单个章节的分析结果 */
interface ChapterDigest {
    order: number
    volumeDir: string
    title: string
    charCount: number
    relativePath: string
    /** 正文首段摘录 */
    head: string
    /** 正文中段摘录：首尾之间的情节靠它才能被归纳到 */
    middle: string
    /** 正文末段摘录 */
    tail: string
    /** 完整正文：仅用于人名、关键词统计与证据摘录，不整章落盘 */
    body: string
}

/** 待读取的章节条目：先排好序再逐个读，避免目录遍历顺序影响序号 */
interface PendingChapter {
    uri: vscode.Uri
    relativePath: string
    volumeDir: string
}

/**
 * 人名证据计数：hits 为「候选名 + 人物动作」的命中次数，chapters 记录出现过的章。
 * 没有「只靠标点也算一次」的弱信号——那条规则正是「时候」「东西」混进角色卡的来源。
 */
interface NameSignal {
    hits: number
    chapters: Set<number>
}

/** 素材抽取结果：写出的文件与统计量，供导入流程回到进度里展示 */
export interface AnalysisResult {
    chapterCount: number
    characterCount: number
    goldenFingerHits: number
    settingClueCount: number
}

/** 章节级证据片段：章序、标题与原文摘录 */
interface EvidenceSnippet {
    order: number
    title: string
    snippet: string
}

/** TSV 字段转义：制表符与换行会把列错开，统一压成空格 */
function toTsvField(value: string): string {
    return value.replace(/[\t\r\n]+/gu, ' ').trim()
}

/** 从章节文档中截出正文：优先取 `## 正文` 到下一个二级标题之间的内容 */
function extractBody(body: string): string {
    const start = body.indexOf('## 正文')
    if (start < 0) {
        // 没有四区块结构时退化为去掉首个一级标题后的全文
        return body.replace(/^#\s+.+$/mu, '').trim()
    }
    const rest = body.slice(start + '## 正文'.length)
    const next = rest.search(/^##\s+/mu)
    return (next < 0 ? rest : rest.slice(0, next)).trim()
}

/**
 * 三段摘录：首段、正中段与末段。
 * 章节短于两倍摘录长度时整段返回，避免三段内容互相重复。
 */
function buildDigests(body: string): { head: string; middle: string; tail: string } {
    const flat = body.replace(/\s*\n\s*/gu, ' ').trim()
    if (flat.length <= DIGEST_LENGTH * 2) {
        return { head: flat, middle: '', tail: '' }
    }
    const middleStart = Math.max(
        DIGEST_LENGTH,
        Math.min(flat.length - DIGEST_LENGTH * 2, Math.floor(flat.length * MIDDLE_RATIO) - DIGEST_LENGTH / 2),
    )
    return {
        head: flat.slice(0, DIGEST_LENGTH),
        middle: flat.slice(middleStart, middleStart + DIGEST_LENGTH),
        tail: flat.slice(-DIGEST_LENGTH),
    }
}

/** 读取一个章节文档 */
async function readChapter(item: PendingChapter, order: number): Promise<ChapterDigest> {
    const bytes = await vscode.workspace.fs.readFile(item.uri)
    const content = new TextDecoder('utf-8').decode(bytes)
    const { frontmatter, body } = splitFrontmatter(content)
    const chapterBody = extractBody(body)
    const fileName = item.relativePath.split('/').pop() ?? ''
    const fallbackTitle = fileName
        .replace(/\.md$/iu, '')
        .replace(/^\d+[-_.、\s]*/u, '')
        .trim()
    const digest = buildDigests(chapterBody)
    return {
        order,
        volumeDir: item.volumeDir,
        title: parseTitle(body, frontmatter) || fallbackTitle,
        charCount: countWords(chapterBody),
        relativePath: item.relativePath,
        head: digest.head,
        middle: digest.middle,
        tail: digest.tail,
        body: chapterBody,
    }
}

/**
 * 收集 Chapter 下的章节文档：只认一层卷目录，与目录视图的层级约定一致。
 * 排序规则：未分卷章节排在最前，其余按卷目录名、卷内文件名升序——
 * 与 projectRepository 的分组展示顺序同源，保证素材序号与界面一致。
 */
async function collectChapters(root: vscode.Uri, segments: string[]): Promise<ChapterDigest[]> {
    const chapterRoot = buildStorageUri(root, [...segments, 'Chapter'])
    if (!(await isPathExisting(chapterRoot))) {
        return []
    }
    const pending: PendingChapter[] = []
    const entries = await vscode.workspace.fs.readDirectory(chapterRoot)
    const files = entries
        .filter(([, type]) => type === vscode.FileType.File)
        .map(([name]) => name)
        .sort((left, right) => left.localeCompare(right, 'zh'))
    const directories = entries
        .filter(([, type]) => type === vscode.FileType.Directory)
        .map(([name]) => name)
        .sort((left, right) => left.localeCompare(right, 'zh'))
    for (const fileName of files) {
        if (!fileName.toLowerCase().endsWith('.md')) {
            continue
        }
        pending.push({
            uri: buildStorageUri(root, [...segments, 'Chapter', fileName]),
            relativePath: [...segments, 'Chapter', fileName].join('/'),
            volumeDir: '',
        })
    }
    for (const directoryName of directories) {
        const volumeEntries = await vscode.workspace.fs.readDirectory(
            buildStorageUri(root, [...segments, 'Chapter', directoryName]),
        )
        const volumeFiles = volumeEntries
            .filter(([, type]) => type === vscode.FileType.File)
            .map(([name]) => name)
            .sort((left, right) => left.localeCompare(right, 'zh'))
        for (const fileName of volumeFiles) {
            if (!fileName.toLowerCase().endsWith('.md')) {
                continue
            }
            pending.push({
                uri: buildStorageUri(root, [...segments, 'Chapter', directoryName, fileName]),
                relativePath: [...segments, 'Chapter', directoryName, fileName].join('/'),
                volumeDir: directoryName,
            })
        }
    }
    const chapters: ChapterDigest[] = []
    for (const item of pending) {
        chapters.push(await readChapter(item, chapters.length + 1))
    }
    return chapters
}

/**
 * 统计单章里的人名候选：只认「姓氏开头 + 紧跟人物动作词」的位置，返回候选名到命中次数。
 * 关键约束：命中后必须跳过整个名字，否则「薛牧笑道」会在下一个字上再命中「牧笑」这类尾巴；
 * 非人名词表在此处不判定——同一章里「时候」可能以多种形态出现，过滤留到全局候选筛选，
 * 那里才能用「总次数 + 是否在词表」一起判断。
 */
function collectNameHits(text: string): Map<string, number> {
    const hits = new Map<string, number>()
    let index = 0
    while (index < text.length) {
        const first = text[index]
        if (first === undefined || !SURNAMES.has(first)) {
            index += 1
            continue
        }
        let matched = 0
        for (const size of NAME_LENGTHS) {
            const candidate = text.slice(index, index + size)
            if (!HAN_NAME.test(candidate)) {
                continue
            }
            // 叠字几乎都是「冷冷笑道」这类状态词，不可能是人名
            if (size === 2 && candidate[0] === candidate[1]) {
                continue
            }
            const next = text[index + size]
            if (next === undefined || !ACTION_SUFFIX.includes(next)) {
                continue
            }
            hits.set(candidate, (hits.get(candidate) ?? 0) + 1)
            matched = size
            break
        }
        // 命中后跳过整个名字，否则「薛牧笑道」会在下一个字上再命中「牧笑」这类尾巴
        index += matched > 0 ? matched : 1
    }
    return hits
}

/** 统计关键词命中：返回该章命中的类别与词，用于定位设定登场章 */
function matchHints(text: string, hints: readonly { category: string; words: readonly string[] }[]): string[] {
    const hits: string[] = []
    for (const { category, words } of hints) {
        for (const word of words) {
            if (text.includes(word)) {
                hits.push(`${category}:${word}`)
            }
        }
    }
    return hits
}

/** 截取角色名首次出现位置前后的原文：前后各取固定字数，超出部分用省略号标记 */
function sliceAround(body: string, name: string): string {
    const at = body.indexOf(name)
    if (at < 0) {
        return ''
    }
    const start = Math.max(0, at - EVIDENCE_CONTEXT)
    const end = Math.min(body.length, at + name.length + EVIDENCE_CONTEXT)
    const prefix = start > 0 ? '…' : ''
    const suffix = end < body.length ? '…' : ''
    return `${prefix}${body
        .slice(start, end)
        .replace(/\s*\n\s*/gu, ' ')
        .trim()}${suffix}`
}

/**
 * 为一个角色挑选证据章：高频章优先，其次首现与末现，再按章序补足。
 * 关键约束：只取该角色真正出现过的章，避免把无关章节的原文塞进人物卡提示词。
 */
function collectEvidence(
    name: string,
    chapterHits: ReadonlyMap<number, number>,
    chaptersByOrder: ReadonlyMap<number, ChapterDigest>,
): EvidenceSnippet[] {
    const orders = [...chapterHits.keys()].sort((left, right) => {
        const diff = (chapterHits.get(right) ?? 0) - (chapterHits.get(left) ?? 0)
        return diff !== 0 ? diff : left - right
    })
    const firstOrder = Math.min(...chapterHits.keys())
    const lastOrder = Math.max(...chapterHits.keys())
    const preferred = [firstOrder, lastOrder, ...orders]
    const picked: number[] = []
    for (const order of preferred) {
        if (picked.length >= EVIDENCE_PER_CHARACTER) {
            break
        }
        if (!picked.includes(order)) {
            picked.push(order)
        }
    }
    const snippets: EvidenceSnippet[] = []
    for (const order of picked.sort((left, right) => left - right)) {
        const chapter = chaptersByOrder.get(order)
        if (chapter === undefined) {
            continue
        }
        const snippet = sliceAround(chapter.body, name)
        if (snippet.length > 0) {
            snippets.push({ order, title: chapter.title, snippet })
        }
    }
    return snippets
}

/** 写入单个素材文件 */
async function writeMaterial(target: vscode.Uri, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content))
}

/**
 * 抽取作品的导入素材：章节清单、三段摘录、人名候选与出场原文、金手指候选章、世界构建候选章。
 * 关键约束：素材全部写在 `_import/` 下并覆盖写入（重跑得到最新结果），
 * 该目录已被索引排除，不会污染作品字数。
 * @param dirPath 作品目录，形如 press/{作品名}
 */
export async function analyzeProject(dirPath: string): Promise<AnalysisResult> {
    const root = resolveStorageRoot()
    const segments = dirPath.split('/').filter((segment) => segment.length > 0)
    const chapters = await collectChapters(root, segments)
    const materialDirectory = buildStorageUri(root, [...segments, PRESS_IMPORT_DIR])
    await vscode.workspace.fs.createDirectory(materialDirectory)
    const nameSignals = new Map<string, NameSignal>()
    const coOccurrence = new Map<string, Map<string, number>>()
    /** 每个候选在各章的出现次数：用于给角色卡挑选最有代表性的章节与证据片段 */
    const chapterHits = new Map<string, Map<number, number>>()
    const goldenFingerRows: { order: number; title: string; hits: string[] }[] = []
    const worldClueRows: { order: number; title: string; hits: string[] }[] = []
    const chaptersByOrder = new Map(chapters.map((chapter) => [chapter.order, chapter]))
    for (const chapter of chapters) {
        const perChapter = collectNameHits(chapter.body)
        for (const [name, count] of perChapter) {
            const current = nameSignals.get(name) ?? { hits: 0, chapters: new Set<number>() }
            current.hits += count
            current.chapters.add(chapter.order)
            nameSignals.set(name, current)
            const bucket = chapterHits.get(name) ?? new Map<number, number>()
            bucket.set(chapter.order, count)
            chapterHits.set(name, bucket)
        }
        // 同章高频候选两两计数，作为人物关系强度的近似
        const topNames = [...perChapter.entries()]
            .sort((left, right) => right[1] - left[1])
            .slice(0, CO_OCCURRENCE_TOP)
            .map(([name]) => name)
        for (const from of topNames) {
            for (const to of topNames) {
                if (from === to) {
                    continue
                }
                const bucket = coOccurrence.get(from) ?? new Map<string, number>()
                bucket.set(to, (bucket.get(to) ?? 0) + 1)
                coOccurrence.set(from, bucket)
            }
        }
        const goldenHits = matchHints(chapter.body, GOLDEN_FINGER_HINTS)
        if (goldenHits.length > 0) {
            goldenFingerRows.push({ order: chapter.order, title: chapter.title, hits: goldenHits })
        }
        const worldHits = matchHints(chapter.body, WORLD_HINTS)
        if (worldHits.length > 0) {
            worldClueRows.push({ order: chapter.order, title: chapter.title, hits: worldHits })
        }
    }
    // 候选筛选同时看「命中次数」与「是否在非人名词表」：只靠次数会让「时候」这类高频词长期霸榜
    const candidates = [...nameSignals.entries()]
        .filter(([name, signal]) => signal.hits >= MIN_NAME_HITS && isLikelyPersonName(name))
        .map(([name, signal]) => ({ name, count: signal.hits, signal }))
        .sort((left, right) => right.count - left.count)
        .slice(0, MAX_CANDIDATES)
    const indexLines = ['序号\t卷\t标题\t字数\t路径']
    const headLines = ['序号\t标题\t首段摘录\t末段摘录\t中段摘录']
    for (const chapter of chapters) {
        indexLines.push(
            [
                String(chapter.order),
                toTsvField(chapter.volumeDir),
                toTsvField(chapter.title),
                String(chapter.charCount),
                chapter.relativePath,
            ].join('\t'),
        )
        headLines.push(
            [
                String(chapter.order),
                toTsvField(chapter.title),
                toTsvField(chapter.head),
                toTsvField(chapter.tail),
                toTsvField(chapter.middle),
            ].join('\t'),
        )
    }
    const candidateLines = ['候选名\t出现次数\t首次章\t末次章\t高频共现\t高频章']
    const evidenceLines = [
        '# 角色出场原文摘录',
        '',
        '> 由导入素材抽取生成：按人名候选摘出的原文片段，供人物卡归纳核对，未经原著编辑。',
        `> 每段取该角色在对应章节首次出现位置前后约 ${String(EVIDENCE_CONTEXT)} 字，同一角色最多 ${String(EVIDENCE_PER_CHARACTER)} 段。`,
        '',
    ]
    for (const { name, count, signal } of candidates) {
        const hits = chapterHits.get(name) ?? new Map<number, number>()
        const orders = [...hits.keys()].sort((left, right) => left - right)
        const partners = [...(coOccurrence.get(name)?.entries() ?? [])]
            .sort((left, right) => right[1] - left[1])
            .slice(0, 3)
            .map(([partner, times]) => `${partner}(${String(times)})`)
            .join(' ')
        const topChapters = [...hits.entries()]
            .sort((left, right) => right[1] - left[1])
            .slice(0, 3)
            .map(([order]) => String(order))
            .join(',')
        const firstOrder = orders[0] ?? 0
        const lastOrder = orders[orders.length - 1] ?? 0
        candidateLines.push(
            [name, String(count), String(firstOrder), String(lastOrder), toTsvField(partners), topChapters].join('\t'),
        )
        evidenceLines.push(`## ${name}`, '')
        evidenceLines.push(
            `- 统计：出场 ${String(count)} 次 · ${String(signal.chapters.size)} 章 · 首现第 ${String(firstOrder)} 章 · 末现第 ${String(lastOrder)} 章 · 高频共现 ${partners.length > 0 ? partners : '无'}`,
        )
        for (const item of collectEvidence(name, hits, chaptersByOrder)) {
            evidenceLines.push(`- 第 ${String(item.order)} 章 ${item.title}：${item.snippet}`)
        }
        evidenceLines.push('')
    }
    const goldenFingerLines = [
        '# 金手指候选章',
        '',
        '> 由导入素材抽取生成：按关键词命中的章节，仅表示「设定可能在此交代」，不代表命中词就是金手指。',
        '',
        `命中章节数：${String(goldenFingerRows.length)}`,
        '',
    ]
    for (const row of goldenFingerRows.slice(0, GOLDEN_FINGER_TOP)) {
        goldenFingerLines.push(`- 第 ${String(row.order)} 章 ${row.title}：${row.hits.join('、')}`)
    }
    const worldClueLines = [
        '# 设定候选章',
        '',
        '> 由导入素材抽取生成：按世界构建关键词（世界形态 / 地理 / 历史 / 势力 / 规则 / 核心概念）命中的章节。',
        '> 仅表示「设定可能在此交代」，是否成立由 AI 归纳环节裁决。',
        '',
        `命中章节数：${String(worldClueRows.length)}`,
        '',
    ]
    if (worldClueRows.length > 0) {
        for (const row of worldClueRows.slice(0, WORLD_CLUE_TOP)) {
            worldClueLines.push(`- 第 ${String(row.order)} 章 ${row.title}：${row.hits.join('、')}`)
        }
    } else {
        // 关键词一个都没命中（常见于日常流、都市流）：退化为代表章节，保证设定归纳永远有素材
        const fallback = chapters.filter((_, index) => index === 0 || index % 30 === 0).slice(0, SETTING_FALLBACK_TOP)
        worldClueLines.push('> 未命中任何世界构建关键词，以下按代表章节取材（首章与每 30 章取一章）。', '')
        for (const chapter of fallback) {
            worldClueLines.push(`- 第 ${String(chapter.order)} 章 ${chapter.title}：代表章节`)
        }
    }
    await writeMaterial(buildStorageUri(root, [...segments, PRESS_IMPORT_DIR, INDEX_FILE]), indexLines.join('\n'))
    await writeMaterial(buildStorageUri(root, [...segments, PRESS_IMPORT_DIR, HEADS_FILE]), headLines.join('\n'))
    await writeMaterial(
        buildStorageUri(root, [...segments, PRESS_IMPORT_DIR, CANDIDATES_FILE]),
        candidateLines.join('\n'),
    )
    await writeMaterial(
        buildStorageUri(root, [...segments, PRESS_IMPORT_DIR, EVIDENCE_FILE]),
        `${evidenceLines.join('\n')}\n`,
    )
    await writeMaterial(
        buildStorageUri(root, [...segments, PRESS_IMPORT_DIR, GOLDEN_FINGER_FILE]),
        `${goldenFingerLines.join('\n')}\n`,
    )
    await writeMaterial(
        buildStorageUri(root, [...segments, PRESS_IMPORT_DIR, WORLD_CLUES_FILE]),
        `${worldClueLines.join('\n')}\n`,
    )
    logger.info(
        `导入素材抽取完成：${dirPath}，${String(chapters.length)} 章，候选角色 ${String(candidates.length)} 个，设定候选章 ${String(worldClueRows.length)} 章`,
    )
    return {
        chapterCount: chapters.length,
        characterCount: candidates.length,
        goldenFingerHits: goldenFingerRows.length,
        settingClueCount: worldClueRows.length,
    }
}

/**
 * 素材目录的绝对路径：供后续 AI 归纳与合并环节拼接落点。
 * @param dirPath 作品目录，形如 press/{作品名}
 */
export function resolveMaterialDirectory(dirPath: string): vscode.Uri {
    const root = resolveStorageRoot()
    const segments = dirPath.split('/').filter((segment) => segment.length > 0)
    return buildStorageUri(root, [...segments, PRESS_IMPORT_DIR])
}

/** 素材文件的相对路径（相对作品目录），供 UI 展示或报告中引用 */
export const MATERIAL_FILE_NAMES = {
    index: `${PRESS_IMPORT_DIR}/${INDEX_FILE}`,
    heads: `${PRESS_IMPORT_DIR}/${HEADS_FILE}`,
    candidates: `${PRESS_IMPORT_DIR}/${CANDIDATES_FILE}`,
    /** 角色出场原文摘录：人物卡归纳的逐字依据 */
    evidence: `${PRESS_IMPORT_DIR}/${EVIDENCE_FILE}`,
    goldenFinger: `${PRESS_IMPORT_DIR}/${GOLDEN_FINGER_FILE}`,
    /** 世界构建候选章：设定归纳的取材依据 */
    worldClues: `${PRESS_IMPORT_DIR}/${WORLD_CLUES_FILE}`,
    /** AI 产出的章节摘要：序号 / 摘要 / 钩子 / 张力 / 关键节点 / 出场，由语义归纳阶段写入 */
    summaries: `${PRESS_IMPORT_DIR}/summaries.tsv`,
} as const
