/**
 * 角色卡产物解析：覆盖模型输出的常见形态——标准列表字段、省略 `-` 前缀的键值行、
 * 顿号与逗号混合分隔的特质、超量标签截断，以及重复键与无姓名块的处理。
 * 复用约定：直接调用宿主解析函数，不启动任务、不读写文件；模型输出一律视为不可信输入。
 * 关键约束：解析不得抛错，字段缺失只留空；首个二级标题之前的说明行不进入任何人物卡。
 */
import { describe, expect, it } from 'vitest'
import { parseCharacterDrafts } from '../src/modules/press/importSemanticService'

describe('parseCharacterDrafts', () => {
    it('按二级标题与键值行解析人物卡', () => {
        const content = [
            '# 角色卡',
            '',
            '> 由 AI 依据出场统计与章节摘要生成，未经原著核对。',
            '',
            '## 林尘',
            '- 姓名：林尘',
            '- 分类：主角',
            '- 性别：男',
            '- 身份：外门弟子',
            '- 特质：隐忍、护短',
            '- 欲望：为父报仇',
            '- 弱点：',
            '- 能力：剑意',
            '- 弧线：从隐忍到张扬',
            '- 关系：苏晚的师弟',
        ].join('\n')

        const drafts = parseCharacterDrafts(content)

        expect(drafts).toHaveLength(1)
        expect(drafts[0]).toMatchObject({
            name: '林尘',
            role: '主角',
            gender: '男',
            identity: '外门弟子',
            traits: ['隐忍', '护短'],
            desire: '为父报仇',
            weakness: '',
            ability: '剑意',
            arc: '从隐忍到张扬',
            relation: '苏晚的师弟',
        })
    })

    it('容忍省略列表符号的键值行，并把超量特质截断到上限', () => {
        const content = [
            '## 苏晚',
            '姓名：苏晚',
            '分类：配角',
            '性别：女',
            '特质：冷静,果断、克制、孤僻、固执、爽利、沉默、多疑、温吞、急躁',
        ].join('\n')

        const drafts = parseCharacterDrafts(content)

        expect(drafts).toHaveLength(1)
        expect(drafts[0]?.name).toBe('苏晚')
        expect(drafts[0]?.role).toBe('配角')
        expect(drafts[0]?.gender).toBe('女')
        expect(drafts[0]?.traits).toHaveLength(8)
    })

    it('无姓名的块回落为标题，重复键以首次出现为准', () => {
        const content = ['## 李四', '- 分类：反派', '- 姓名：李四', '- 姓名：别名李四'].join('\n')

        const drafts = parseCharacterDrafts(content)

        expect(drafts).toHaveLength(1)
        expect(drafts[0]?.name).toBe('李四')
        expect(drafts[0]?.identity).toBe('')
    })
})
