/**
 * 提示词目录的单测：覆盖未配置回落存储根、配置后指向自定义目录、空白配置视为未配置三种口径。
 * 复用约定：虚拟磁盘取 dev/test/stubs/vscode，词库目录经 zhai.prompt.rootPath 注入，与真实配置同一条读法。
 * 关键约束：三个子目录必须由同一父目录派生，改配置后 tags / images / rules 要一起跟着走，不能各拼各的。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetWorkspaceState, setConfigValue } from './stubs/vscode'
import { promptDirUri } from '../../src/modules/common/promptRoot'

const STORAGE_ROOT = 'd:/vault'
const STORE_PROMPT = path.join(STORAGE_ROOT, 'prompt')
const CUSTOM_PROMPT = 'd:/library/prompts'

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
})

describe('提示词目录', () => {
    it('未配置词库目录时落在存储根下的 prompt', () => {
        expect(promptDirUri('tags').fsPath).toBe(path.join(STORE_PROMPT, 'tags'))
        expect(promptDirUri('images').fsPath).toBe(path.join(STORE_PROMPT, 'images'))
        expect(promptDirUri('rules').fsPath).toBe(path.join(STORE_PROMPT, 'rules'))
    })

    it('配置词库目录后三个子目录一起改到新目录', () => {
        setConfigValue('prompt.rootPath', CUSTOM_PROMPT)

        expect(promptDirUri('tags').fsPath).toBe(path.join(CUSTOM_PROMPT, 'tags'))
        expect(promptDirUri('images').fsPath).toBe(path.join(CUSTOM_PROMPT, 'images'))
        expect(promptDirUri('rules').fsPath).toBe(path.join(CUSTOM_PROMPT, 'rules'))
    })

    it('配置为空白时按未配置处理', () => {
        setConfigValue('prompt.rootPath', '   ')

        expect(promptDirUri('tags').fsPath).toBe(path.join(STORE_PROMPT, 'tags'))
    })

    it('正斜杠写法的盘符路径同样可用', () => {
        setConfigValue('prompt.rootPath', 'D:/library/prompts/')

        expect(promptDirUri('tags').fsPath).toBe(path.join('D:/library/prompts', 'tags'))
    })
})
