/**
 * 大纲分层导航的读写往返：八个功能模块各自成段，顺序与段落标题必须与宿主 writer 的落点表一致。
 * 复用约定：序列化与解析直接调生产代码，测试只拼文档外壳（一级标题与二级段落标题）；
 * 断言覆盖全书纲、结构纲、人物纲、设定纲、节奏、线索、时间线与分卷规划八个段落。
 * 关键约束：段落漏测等于回写静默丢字段——每个段落都必须有往返断言；
 * 章纲与场景有同名键（结果 / 情绪），必须证明剥离场景块后两者互不污染。
 */
import { describe, expect, it } from 'vitest'
import type { CharacterCard, OutlinePlan, OutlineVolume } from '../src/workflow/press/types'
import { parseProjectWorkspace } from '../src/workflow/press/document'
import { serializeOutlineSections } from '../src/workflow/press/serialize'

/** 设定分组文档留空：本用例只关心大纲段落 */
const EMPTY_SETTING_SECTIONS = { world: '', power: '', faction: '', place: '', item: '' }

/** 角色文档的最小写法：大纲里的人物纲与触发者按姓名回填 id，必须有姓名索引 */
const CHARACTER_DOC = `# 角色设定

## 林岚

- id：12345678
- 姓名：林岚
- 分类：主角
`

const CHARACTERS: CharacterCard[] = [
    {
        id: '12345678',
        name: '林岚',
        alias: '七号',
        role: 'protagonist',
        gender: 'male',
        age: '27',
        height: '一米七八',
        bodyType: 'average',
        identity: '修表匠',
        appearanceTags: [],
        appearance: '',
        traits: [],
        background: '',
        desire: '查清妹妹失踪',
        weakness: '不信人',
        catchphrase: '',
        ability: '',
        arc: '从独行到结盟',
        relation: '顾青：情报盟友',
        portraits: [],
        coverPortraitId: null,
        portraitStyle: 'auto',
    },
]

const PLAN: OutlinePlan = {
    book: {
        logline: '修表匠为了查清妹妹失踪，必须拆开整座旧城，但真相会毁掉他仅剩的亲人。',
        conflict: '底层手艺人 vs 地产集团',
        theme: '记忆与代价',
        ending: '开放',
        arc: '从独行到结盟',
    },
    acts: [
        { id: 'act-1', name: '开端', position: '打破平衡', event: '旧表送来，编号与妹妹一致' },
        { id: 'act-2', name: '中点', position: '真相翻面', event: '顾青的档案是伪造的' },
        { id: 'act-3', name: '高潮', position: '迫使选择', event: '揭发集团即失去妹妹线索' },
    ],
    characters: [
        {
            id: 'cline-1',
            characterId: '12345678',
            name: '林岚',
            desire: '查清妹妹失踪',
            fear: '再一次失去家人',
            flaw: '不信人',
            secret: '他听过妹妹的求救声',
            relation: '顾青：情报盟友',
            arc: '从独行到结盟',
        },
    ],
    setting: [
        {
            id: 'snote-1',
            name: '听声异能',
            rule: '触碰机械可听见残留声响',
            cost: '每次读取失聪数分钟',
            note: '第一卷用于锁定旧表',
        },
    ],
    pacing: [
        { id: 'pacing-1', chapterOrder: 1, kind: 'tension', tension: 4 },
        { id: 'pacing-2', chapterOrder: 2, kind: 'breath', tension: 2 },
    ],
    clues: [
        {
            id: 'clue-1',
            name: '旧表编号',
            plant: { volumeOrder: 1, chapterOrder: 1 },
            payoff: { volumeOrder: 1, chapterOrder: 2 },
            triggerId: '12345678',
            status: 'planted',
            note: '编号与妹妹一致',
        },
        {
            id: 'clue-2',
            name: '顾青的名片',
            plant: { volumeOrder: 1, chapterOrder: 1 },
            payoff: null,
            triggerId: '',
            status: 'paid-off',
            note: '',
        },
    ],
    timeline: [
        {
            id: 'tline-1',
            when: '事发当夜',
            title: '妹妹失踪',
            refs: [
                { volumeOrder: 1, chapterOrder: 1 },
                { volumeOrder: 1, chapterOrder: 2 },
            ],
            characterIds: ['12345678'],
        },
    ],
}

const VOLUMES: OutlineVolume[] = [
    {
        id: 'vol-1',
        name: '第1卷 断线之始',
        goal: '从被动谋生转向主动追查',
        conflict: '底层手艺人 vs 地产集团',
        plotline: '客人送来旧表，编号指向失踪的妹妹。',
        turningPoints: ['编号确认', '档案被抽走'],
        result: '线索断在旧城医院',
        granularity: 'medium',
        chapters: [
            {
                id: 'ch-1-1',
                order: 1,
                title: '修表铺的客人',
                summary: '客人送来一块停摆的旧表。',
                actualSummary: '林岚拆开后盖，看见妹妹的编号。',
                status: 'written',
                beats: [{ id: 'beat-1', text: '拆开后盖', isDone: true }],
                scenes: [
                    {
                        id: 'scene-1-1-1',
                        order: 1,
                        title: '修表铺',
                        desire: '赶在关门前修完表',
                        obstacle: '旧表结构不认识',
                        choice: '冒险拆开后盖',
                        result: '发现妹妹的编号',
                        emotion: '平静到失手',
                    },
                ],
                pov: '林岚',
                goal: '修好这块旧表',
                obstacle: '没有图纸',
                turn: '后盖内侧刻着编号',
                result: '确认是妹妹的表',
                emotion: '紧张',
                characterIds: ['12345678'],
                location: '城南修表铺',
                wordGoal: 2500,
                wordCount: 2680,
                hook: 'suspense',
                tension: 4,
                granularity: 'fine',
            },
        ],
    },
]

/** 拼出八段落的大纲文档：段落标题必须与 writer 落点表一致 */
function buildOutlineDocument(): string {
    const sections = serializeOutlineSections(PLAN, VOLUMES, CHARACTERS)
    return [
        '# 大纲',
        '',
        '## 全书纲',
        '',
        sections.book,
        '',
        '## 结构纲',
        '',
        sections.structure,
        '',
        '## 人物纲',
        '',
        sections.characters,
        '',
        '## 设定纲',
        '',
        sections.setting,
        '',
        '## 节奏情绪',
        '',
        sections.pacing,
        '',
        '## 伏笔线索',
        '',
        sections.clues,
        '',
        '## 时间线',
        '',
        sections.timeline,
        '',
        '## 主线',
        '',
        '林岚追查妹妹失踪的真相。',
        '',
        '## 分卷规划',
        '',
        sections.volumes,
        '',
    ].join('\n')
}

/** 只留卷章的旧文档：用于验证四态迁移 */
function buildLegacyOutline(status: string): string {
    return `# 大纲

## 分卷规划

### 第1卷 旧卷

- 卷目标：旧目标

#### 第1章 旧章

- 状态：${status}
- 梗概：旧梗概
`
}

describe('大纲八段落往返', () => {
    it('全书纲、结构纲、人物纲与设定纲可原样解析', () => {
        const parsed = parseProjectWorkspace(
            { readme: '', setting: '', characters: CHARACTER_DOC, outline: buildOutlineDocument() },
            EMPTY_SETTING_SECTIONS,
            '未命名',
        )

        expect(parsed.plan.book).toMatchObject({
            logline: PLAN.book.logline,
            conflict: PLAN.book.conflict,
            theme: PLAN.book.theme,
            ending: PLAN.book.ending,
            arc: PLAN.book.arc,
        })
        expect(parsed.plan.acts.map((act) => act.name)).toEqual(['开端', '中点', '高潮'])
        expect(parsed.plan.acts[1]).toMatchObject({ position: '真相翻面', event: '顾青的档案是伪造的' })
        expect(parsed.plan.characters).toHaveLength(1)
        expect(parsed.plan.characters[0]).toMatchObject({
            characterId: '12345678',
            name: '林岚',
            desire: '查清妹妹失踪',
            fear: '再一次失去家人',
            flaw: '不信人',
            secret: '他听过妹妹的求救声',
            relation: '顾青：情报盟友',
            arc: '从独行到结盟',
        })
        expect(parsed.plan.setting[0]).toMatchObject({
            name: '听声异能',
            rule: '触碰机械可听见残留声响',
            cost: '每次读取失聪数分钟',
            note: '第一卷用于锁定旧表',
        })
    })

    it('节奏、线索与时间线按章节引用往返，触发者与人物按姓名回填', () => {
        const parsed = parseProjectWorkspace(
            { readme: '', setting: '', characters: CHARACTER_DOC, outline: buildOutlineDocument() },
            EMPTY_SETTING_SECTIONS,
            '未命名',
        )

        expect(parsed.plan.pacing).toHaveLength(2)
        expect(parsed.plan.pacing[0]).toMatchObject({ chapterOrder: 1, kind: 'tension', tension: 4 })
        expect(parsed.plan.pacing[1]).toMatchObject({ chapterOrder: 2, kind: 'breath', tension: 2 })

        expect(parsed.plan.clues).toHaveLength(2)
        expect(parsed.plan.clues[0]).toMatchObject({
            name: '旧表编号',
            plant: { volumeOrder: 1, chapterOrder: 1 },
            payoff: { volumeOrder: 1, chapterOrder: 2 },
            triggerId: '12345678',
            status: 'planted',
            note: '编号与妹妹一致',
        })
        expect(parsed.plan.clues[1]).toMatchObject({ name: '顾青的名片', payoff: null, status: 'paid-off' })

        expect(parsed.plan.timeline).toHaveLength(1)
        expect(parsed.plan.timeline[0]).toMatchObject({
            when: '事发当夜',
            title: '妹妹失踪',
            refs: [
                { volumeOrder: 1, chapterOrder: 1 },
                { volumeOrder: 1, chapterOrder: 2 },
            ],
            characterIds: ['12345678'],
        })
    })

    it('卷章的章纲卡与场景纲往返，场景字段不污染章纲', () => {
        const parsed = parseProjectWorkspace(
            { readme: '', setting: '', characters: CHARACTER_DOC, outline: buildOutlineDocument() },
            EMPTY_SETTING_SECTIONS,
            '未命名',
        )

        expect(parsed.volumes).toHaveLength(1)
        const volume = parsed.volumes[0]
        expect(volume).toMatchObject({
            name: '第1卷 断线之始',
            goal: '从被动谋生转向主动追查',
            result: '线索断在旧城医院',
            granularity: 'medium',
        })
        const chapter = volume?.chapters[0]
        expect(chapter).toMatchObject({
            order: 1,
            title: '修表铺的客人',
            summary: '客人送来一块停摆的旧表。',
            actualSummary: '林岚拆开后盖，看见妹妹的编号。',
            status: 'written',
            pov: '林岚',
            goal: '修好这块旧表',
            obstacle: '没有图纸',
            turn: '后盖内侧刻着编号',
            result: '确认是妹妹的表',
            emotion: '紧张',
            hook: 'suspense',
            tension: 4,
            granularity: 'fine',
            wordCount: 2680,
        })
        // 章纲的「结果 / 情绪」与场景的「结果 / 情绪变化」同名不同层，必须各归其位
        expect(chapter?.scenes[0]).toMatchObject({
            title: '修表铺',
            desire: '赶在关门前修完表',
            obstacle: '旧表结构不认识',
            choice: '冒险拆开后盖',
            result: '发现妹妹的编号',
            emotion: '平静到失手',
        })
    })

    it('八个段落各自成文：任一段落的内容不会出现在其它段落里', () => {
        const sections = serializeOutlineSections(PLAN, VOLUMES, CHARACTERS)
        expect(Object.keys(sections)).toHaveLength(8)
        expect(sections.clues).toContain('旧表编号')
        expect(sections.clues).not.toContain('修表铺的客人')
        expect(sections.volumes).toContain('修表铺的客人')
        expect(sections.volumes).not.toContain('旧表编号')
        expect(sections.book).toContain('修表匠为了查清妹妹失踪')
        expect(sections.timeline).toContain('妹妹失踪')
    })
})

describe('大纲状态迁移', () => {
    it('旧状态归一到四态：published 与 draft 进「已写」，stale 进「待改」，废弃单独保留', () => {
        const parseStatus = (status: string): string => {
            const parsed = parseProjectWorkspace(
                { readme: '', setting: '', characters: '', outline: buildLegacyOutline(status) },
                EMPTY_SETTING_SECTIONS,
                '未命名',
            )
            return parsed.volumes[0]?.chapters[0]?.status ?? ''
        }

        expect(parseStatus('published')).toBe('written')
        expect(parseStatus('done')).toBe('written')
        expect(parseStatus('draft')).toBe('written')
        expect(parseStatus('待写')).toBe('planned')
        expect(parseStatus('stale')).toBe('revise')
        expect(parseStatus('需复核')).toBe('revise')
        expect(parseStatus('废弃')).toBe('discarded')
    })
})
