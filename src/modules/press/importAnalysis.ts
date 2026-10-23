/**
 * 导入素材抽取：扫描已落盘的章节文档，产出供 AI 归纳使用的中间素材，平铺在作品的 _import/ 下。
 * 复用约定：Frontmatter 切分与标题读取取自 common/db/fileMeta，字数口径与索引库一致；
 * 路径构造复用 common/storagePath，素材目录名取自 shared/types/press 的 PRESS_IMPORT_DIR。
 * 关键约束：本模块只做统计与摘录，不做任何语义判断——角色名与金手指都只是「候选」，
 * 是否成立由后续 AI 环节裁决；正文只用于统计，不整体落盘，避免素材目录膨胀。
 */

import * as vscode from 'vscode'
import { PRESS_IMPORT_DIR } from '../../shared/types/press'
import { resolveStorageRoot } from '../common/config'
import { countWords, parseTitle, splitFrontmatter } from '../common/db/fileMeta'
import { logger } from '../common/logger'
import { buildStorageUri, isPathExisting } from '../common/storagePath'

/** 章节正文摘录长度：首尾各取该字数，足以判断本章情节与章末钩子 */
const DIGEST_LENGTH = 300

/** 素材文件名：全部平铺在 _import/ 下，不使用子目录 */
const INDEX_FILE = 'chapter-index.tsv'
const HEADS_FILE = 'chapter-heads.tsv'
const CANDIDATES_FILE = 'characters-candidates.tsv'
const GOLDEN_FINGER_FILE = 'golden-fingers.md'

/** 人名候选的出现次数下限：低于该值视为偶然出现的词组 */
const MIN_NAME_HITS = 3

/** 每章参与共现统计的候选人数上限 */
const CO_OCCURRENCE_TOP = 5

/** 金手指命中取前若干章，供后续 AI 重点阅读 */
const GOLDEN_FINGER_TOP = 20

/** 常见单姓：覆盖网文角色名的绝大多数，宁可漏判也不冒险扩充造成大量误判 */
const SURNAMES = new Set(
    '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹喻柏窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房裘缪干解应宗丁宣邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊惠甄曲家封芮储靳松井段富巫乌焦巴弓牧隗山谷车侯全班秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸司韶郜黎薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳姬申扶堵冉宰郦雍桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越隆师巩聂晁融冷訾辛阚简饶空曾沙养鞠须丰巢关蒯相查后荆红游竺权盖益桓',
)

/** 姓氏后紧跟的动作词：用于区分「人名」与「同为首字的普通词」 */
const ACTION_SUFFIX = '道说问答笑怒喝叹想吼叫骂哼哭嚷'

/**
 * 候选字数长度：从短到长尝试。先认两字名，再退让三字与四字，
 * 否则「薛牧笑道」会被切成「薛牧笑」、三字名也会被切走首字，产生大量「人名 + 动作字」的假候选。
 */
const NAME_LENGTHS: readonly number[] = [2, 3, 4]

/** 汉字候选校验 */
const HAN_NAME = /^[\u4e00-\u9fa5]{2,4}$/u

/** 金手指关键词表：按题材归类，只用于定位「作者的设定最可能在哪几章交代」 */
const GOLDEN_FINGER_HINTS: readonly { category: string; words: readonly string[] }[] = [
    { category: '系统流', words: ['系统', '面板', '任务', '签到', '商城', '抽奖', '属性点', '加点', '升级'] },
    { category: '器物流', words: ['戒指', '玉佩', '残图', '古卷', '令牌', '空间', '储物袋', '玉简'] },
    { category: '传承流', words: ['老爷爷', '传承', '残魂', '记忆觉醒', '师父留下', '洞府'] },
    { category: '穿越流', words: ['重生', '回到', '前世', '穿越', '异界', '平行世界', '夺舍'] },
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
    /** 正文末段摘录 */
    tail: string
    /** 完整正文：仅用于人名与关键词统计，不落盘 */
    body: string
}

/** 待读取的章节条目：先排好序再逐个读，避免目录遍历顺序影响序号 */
interface PendingChapter {
    uri: vscode.Uri
    relativePath: string
    volumeDir: string
}

/** 素材抽取结果：写出的文件与统计量，供导入流程回到进度里展示 */
export interface AnalysisResult {
    chapterCount: number
    characterCount: number
    goldenFingerHits: number
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

/** 首尾摘录：章节过短时整段返回，避免首尾重复 */
function buildDigestPair(body: string): { head: string; tail: string } {
    const flat = body.replace(/\s*\n\s*/gu, ' ').trim()
    if (flat.length <= DIGEST_LENGTH * 2) {
        return { head: flat, tail: '' }
    }
    return { head: flat.slice(0, DIGEST_LENGTH), tail: flat.slice(-DIGEST_LENGTH) }
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
    const digest = buildDigestPair(chapterBody)
    return {
        order,
        volumeDir: item.volumeDir,
        title: parseTitle(body, frontmatter) || fallbackTitle,
        charCount: countWords(chapterBody),
        relativePath: item.relativePath,
        head: digest.head,
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

/** 统计人名候选：姓氏开头且紧跟动作词，才有资格进入候选表 */
function collectNameHits(text: string, counter: Map<string, number>, perChapter: Map<string, number>): void {
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
            counter.set(candidate, (counter.get(candidate) ?? 0) + 1)
            perChapter.set(candidate, (perChapter.get(candidate) ?? 0) + 1)
            matched = size
            break
        }
        // 命中后跳过整个名字，否则「薛牧笑道」会在下一个字上再命中「牧笑」这类尾巴
        index += matched > 0 ? matched : 1
    }
}

/** 统计金手指关键词命中：返回该章命中的类别与词，用于定位登场章 */
function matchGoldenFingers(text: string): string[] {
    const hits: string[] = []
    for (const { category, words } of GOLDEN_FINGER_HINTS) {
        for (const word of words) {
            if (text.includes(word)) {
                hits.push(`${category}:${word}`)
            }
        }
    }
    return hits
}

/** 写入单个素材文件 */
async function writeMaterial(target: vscode.Uri, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content))
}

/**
 * 抽取作品的导入素材：章节清单、首尾摘录、人名候选、金手指候选章。
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
    const nameCounter = new Map<string, number>()
    const firstOrder = new Map<string, number>()
    const lastOrder = new Map<string, number>()
    const coOccurrence = new Map<string, Map<string, number>>()
    /** 每个候选在各章的出现次数：用于给角色卡挑选最有代表性的章节 */
    const chapterHits = new Map<string, Map<number, number>>()
    const goldenFingerRows: { order: number; title: string; hits: string[] }[] = []
    for (const chapter of chapters) {
        const perChapter = new Map<string, number>()
        collectNameHits(chapter.body, nameCounter, perChapter)
        for (const [name, times] of perChapter) {
            if (!firstOrder.has(name)) {
                firstOrder.set(name, chapter.order)
            }
            lastOrder.set(name, chapter.order)
            const hits = chapterHits.get(name) ?? new Map<number, number>()
            hits.set(chapter.order, times)
            chapterHits.set(name, hits)
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
        const hits = matchGoldenFingers(chapter.body)
        if (hits.length > 0) {
            goldenFingerRows.push({ order: chapter.order, title: chapter.title, hits })
        }
    }
    const indexLines = ['序号\t卷\t标题\t字数\t路径']
    const headLines = ['序号\t标题\t首段摘录\t末段摘录']
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
            [String(chapter.order), toTsvField(chapter.title), toTsvField(chapter.head), toTsvField(chapter.tail)].join(
                '\t',
            ),
        )
    }
    const candidates = [...nameCounter.entries()]
        .filter(([, count]) => count >= MIN_NAME_HITS)
        .sort((left, right) => right[1] - left[1])
    const candidateLines = ['候选名\t出现次数\t首次章\t末次章\t高频共现\t高频章']
    for (const [name, count] of candidates) {
        const partners = [...(coOccurrence.get(name)?.entries() ?? [])]
            .sort((left, right) => right[1] - left[1])
            .slice(0, 3)
            .map(([partner, times]) => `${partner}(${String(times)})`)
            .join(' ')
        const topChapters = [...(chapterHits.get(name)?.entries() ?? [])]
            .sort((left, right) => right[1] - left[1])
            .slice(0, 3)
            .map(([order]) => String(order))
            .join(',')
        candidateLines.push(
            [
                name,
                String(count),
                String(firstOrder.get(name) ?? ''),
                String(lastOrder.get(name) ?? ''),
                toTsvField(partners),
                topChapters,
            ].join('\t'),
        )
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
        goldenFingerLines.push(
            `- 第 ${String(row.order)} 章 ${row.title}：${row.hits.join('、')}`,
        )
    }
    await writeMaterial(buildStorageUri(root, [...segments, PRESS_IMPORT_DIR, INDEX_FILE]), indexLines.join('\n'))
    await writeMaterial(buildStorageUri(root, [...segments, PRESS_IMPORT_DIR, HEADS_FILE]), headLines.join('\n'))
    await writeMaterial(
        buildStorageUri(root, [...segments, PRESS_IMPORT_DIR, CANDIDATES_FILE]),
        candidateLines.join('\n'),
    )
    await writeMaterial(
        buildStorageUri(root, [...segments, PRESS_IMPORT_DIR, GOLDEN_FINGER_FILE]),
        `${goldenFingerLines.join('\n')}\n`,
    )
    logger.info(
        `导入素材抽取完成：${dirPath}，${String(chapters.length)} 章，候选角色 ${String(candidates.length)} 个`,
    )
    return {
        chapterCount: chapters.length,
        characterCount: candidates.length,
        goldenFingerHits: goldenFingerRows.length,
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
    goldenFinger: `${PRESS_IMPORT_DIR}/${GOLDEN_FINGER_FILE}`,
    /** AI 产出的章节摘要：序号 / 摘要 / 钩子 / 张力，由语义归纳阶段写入 */
    summaries: `${PRESS_IMPORT_DIR}/summaries.tsv`,
} as const
