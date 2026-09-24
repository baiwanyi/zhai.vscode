/**
 * 测试用 vscode 模块桩：只实现宿主代码在单元测试中触达的最小 API，随被测代码按需扩展。
 * 复用约定：由 vitest.config.mts 的 alias 注入，测试文件不直接 import 本模块（宿主代码照常 import 'vscode'）。
 * 关键约束：桩对象按完整接口构造，不用类型断言绕过检查；workspace / 配置 / 密钥为模块级可变状态，
 * 用例须在 beforeEach 调用 resetWorkspaceState 复位，避免用例间互相污染。
 */
import type * as vscode from 'vscode'

/** 工作区根：asRelativePath 依此裁剪出相对路径 */
let workspaceRoot = ''
/** 虚拟磁盘内容：fs.readFile 的数据源，未登记的路径读取时抛错（模拟文件失效） */
const fileContents = new Map<string, string>()
/** 配置项：zhai.* 的键值，未配置的键返回调用方给定的默认值 */
const configValues = new Map<string, unknown>()

/** 复位全部模块级状态（工作区根、虚拟磁盘、配置），供 beforeEach 使用 */
export function resetWorkspaceState(): void {
    workspaceRoot = ''
    fileContents.clear()
    configValues.clear()
}

/** 设置工作区根路径 */
export function setWorkspaceRoot(root: string): void {
    workspaceRoot = root
}

/** 登记虚拟磁盘文件内容 */
export function setFileContent(path: string, content: string): void {
    fileContents.set(path, content)
}

/** 设置 zhai.* 配置项 */
export function setConfigValue(key: string, value: unknown): void {
    configValues.set(key, value)
}

/** 构造 file 协议的 Uri */
export function createUri(fsPath: string, scheme = 'file'): vscode.Uri {
    const path = fsPath.replaceAll('\\', '/')
    return {
        scheme,
        authority: '',
        path,
        query: '',
        fragment: '',
        fsPath,
        with(change: { scheme?: string; path?: string }): vscode.Uri {
            return createUri(change.path ?? fsPath, change.scheme ?? scheme)
        },
        toString(): string {
            return `${scheme}://${fsPath}`
        },
        toJSON(): { scheme: string; path: string; fsPath: string } {
            return { scheme, path, fsPath }
        },
    }
}

export function createPosition(line: number, character: number): vscode.Position {
    return {
        line,
        character,
        isEqual: (other) => other.line === line && other.character === character,
        isBefore: (other) => line < other.line || (line === other.line && character < other.character),
        isBeforeOrEqual: (other) => line < other.line || (line === other.line && character <= other.character),
        isAfter: (other) => line > other.line || (line === other.line && character > other.character),
        isAfterOrEqual: (other) => line > other.line || (line === other.line && character >= other.character),
        compareTo: (other) => (line === other.line ? character - other.character : line - other.line),
        translate: (lineDelta?: number | { lineDelta?: number; characterDelta?: number }, characterDelta?: number) =>
            typeof lineDelta === 'object'
                ? createPosition(line + (lineDelta?.lineDelta ?? 0), character + (lineDelta?.characterDelta ?? 0))
                : createPosition(line + (lineDelta ?? 0), character + (characterDelta ?? 0)),
        with: (lineOrChange?: number | { line?: number; character?: number }, characterOrNothing?: number) =>
            typeof lineOrChange === 'number'
                ? createPosition(lineOrChange, characterOrNothing ?? character)
                : createPosition(lineOrChange?.line ?? line, lineOrChange?.character ?? character),
    }
}

export function createRange(
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
): vscode.Range {
    const start = createPosition(startLine, startCharacter)
    const end = createPosition(endLine, endCharacter)
    return {
        start,
        end,
        isEmpty: startLine === endLine && startCharacter === endCharacter,
        isSingleLine: startLine === endLine,
        isEqual: (other) => start.isEqual(other.start) && end.isEqual(other.end),
        contains: (other: vscode.Position | vscode.Range): boolean => {
            const otherStart = 'start' in other ? other.start : other
            const otherEnd = 'end' in other ? other.end : other
            return !start.isAfter(otherStart) && !end.isBefore(otherEnd)
        },
        intersection: () => undefined,
        union: (other) => other,
        with: (
            startOrChange?: vscode.Position | { start?: vscode.Position; end?: vscode.Position },
            endPosition?: vscode.Position,
        ): vscode.Range => {
            const change = startOrChange && 'start' in startOrChange ? startOrChange : undefined
            const startPosition = startOrChange && 'line' in startOrChange ? startOrChange : undefined
            return createRange(
                startPosition?.line ?? change?.start?.line ?? startLine,
                startPosition?.character ?? change?.start?.character ?? startCharacter,
                endPosition?.line ?? change?.end?.line ?? endLine,
                endPosition?.character ?? change?.end?.character ?? endCharacter,
            )
        },
    }
}

export function createSelection(
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
): vscode.Selection {
    const anchor = createPosition(startLine, startCharacter)
    const active = createPosition(endLine, endCharacter)
    const range = createRange(startLine, startCharacter, endLine, endCharacter)
    return {
        start: range.start,
        end: range.end,
        isEmpty: range.isEmpty,
        isSingleLine: range.isSingleLine,
        isEqual: (other: vscode.Range) => range.isEqual(other),
        contains: (other: vscode.Position | vscode.Range) => range.contains(other),
        intersection: (other: vscode.Range) => range.intersection(other),
        union: (other: vscode.Range) => range.union(other),
        with: (
            startOrChange?: vscode.Position | { start?: vscode.Position; end?: vscode.Position },
            endPosition?: vscode.Position,
        ): vscode.Selection => {
            if (startOrChange === undefined) {
                return createSelection(startLine, startCharacter, endLine, endCharacter)
            }
            const next = 'line' in startOrChange ? range.with(startOrChange, endPosition) : range.with(startOrChange)
            return createSelection(next.start.line, next.start.character, next.end.line, next.end.character)
        },
        anchor,
        active,
        isReversed: active.isBefore(anchor),
    }
}

/** 由文本行构造测试文档：getText 支持整篇与 Range 两种调用 */
export function createTextDocument(lines: string[], fsPath: string): vscode.TextDocument {
    const uri = createUri(fsPath)
    const text = lines.join('\n')
    return {
        uri,
        fileName: fsPath,
        isUntitled: false,
        languageId: 'markdown',
        version: 1,
        isDirty: false,
        isClosed: false,
        eol: 1,
        encoding: 'utf8',
        lineCount: lines.length,
        save: () => Promise.resolve(true),
        lineAt(lineOrPosition: number | vscode.Position): vscode.TextLine {
            const line = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line
            const content = lines[line] ?? ''
            return {
                lineNumber: line,
                text: content,
                range: createRange(line, 0, line, content.length),
                rangeIncludingLineBreak: createRange(line, 0, line, content.length + 1),
                firstNonWhitespaceCharacterIndex: content.length - content.trimStart().length,
                isEmptyOrWhitespace: content.trim().length === 0,
            }
        },
        offsetAt: (position) => position.character,
        positionAt: (offset) => createPosition(0, offset),
        getText(range?: vscode.Range): string {
            if (!range) {
                return text
            }
            return lines.slice(range.start.line, range.end.line + 1).join('\n')
        },
        getWordRangeAtPosition: () => undefined,
        validateRange: (range) => range,
        validatePosition: (position) => position,
    }
}

/** 由文档与选区构造测试编辑器（未传选区时表示光标态，即无选区） */
export function createTextEditor(
    document: vscode.TextDocument,
    selections: vscode.Selection[] = [],
): vscode.TextEditor {
    const emptySelection = createSelection(0, 0, 0, 0)
    const current = selections.length > 0 ? selections : [emptySelection]
    return {
        document,
        selection: current[0] ?? emptySelection,
        selections: current,
        visibleRanges: [createRange(0, 0, 0, 0)],
        options: { tabSize: 4, insertSpaces: true, cursorStyle: 1, lineNumbers: 1 },
        viewColumn: 1,
        edit: () => Promise.resolve(true),
        insertSnippet: () => Promise.resolve(true),
        setDecorations: () => undefined,
        revealRange: () => undefined,
        show: () => undefined,
        hide: () => undefined,
    }
}

/** 可注入的密钥存储桩 */
export function createSecretStorage(initial: Record<string, string> = {}): vscode.SecretStorage {
    const store = new Map<string, string>(Object.entries(initial))
    const emitter = new EventEmitter<vscode.SecretStorageChangeEvent>()
    return {
        get: (key: string) => Promise.resolve(store.get(key)),
        store: (key: string, value: string): Promise<void> => {
            store.set(key, value)
            emitter.fire({ key })
            return Promise.resolve()
        },
        delete: (key: string): Promise<void> => {
            store.delete(key)
            emitter.fire({ key })
            return Promise.resolve()
        },
        onDidChange: emitter.event,
        keys: () => Promise.resolve([...store.keys()]),
    }
}

export class EventEmitter<T> {
    private readonly listeners = new Set<(value: T) => void>()

    public readonly event = (listener: (value: T) => void): vscode.Disposable => {
        this.listeners.add(listener)
        return { dispose: (): boolean => this.listeners.delete(listener) }
    }

    public fire(value: T): void {
        for (const listener of this.listeners) {
            listener(value)
        }
    }

    public dispose(): void {
        this.listeners.clear()
    }
}

export const Uri: Pick<typeof vscode.Uri, 'file' | 'parse' | 'joinPath' | 'from'> = {
    file(path: string): vscode.Uri {
        return createUri(path)
    },
    parse(value: string): vscode.Uri {
        return createUri(value.replace(/^file:\/\//, ''))
    },
    joinPath(base: vscode.Uri, ...pathSegments: string[]): vscode.Uri {
        return createUri([base.fsPath, ...pathSegments].join('/'))
    },
    from(components: { scheme?: string; path?: string }): vscode.Uri {
        return createUri(components.path ?? '', components.scheme ?? 'file')
    },
}

export const workspace = {
    textDocuments: [] as vscode.TextDocument[],
    fs: {
        readFile(uri: vscode.Uri): Promise<Uint8Array> {
            const content = fileContents.get(uri.fsPath)
            if (content === undefined) {
                return Promise.reject(new Error(`ENOENT: ${uri.fsPath}`))
            }
            return Promise.resolve(new TextEncoder().encode(content))
        },
    },
    asRelativePath(pathOrUri: string | vscode.Uri): string {
        const value = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath
        if (workspaceRoot.length > 0 && value.startsWith(workspaceRoot)) {
            return value.slice(workspaceRoot.length).replace(/^[\\/]/, '')
        }
        return value
    },
    getConfiguration(): { get<T>(key: string, fallback: T): T } {
        return {
            get<T>(key: string, fallback: T): T {
                const value = configValues.get(key)
                return value === undefined ? fallback : (value as T)
            },
        }
    },
}

export const window = {
    activeTextEditor: undefined as vscode.TextEditor | undefined,
    createOutputChannel(name: string): vscode.OutputChannel {
        return {
            name,
            append: () => undefined,
            appendLine: () => undefined,
            replace: () => undefined,
            clear: () => undefined,
            show: () => undefined,
            hide: () => undefined,
            dispose: () => undefined,
        }
    },
    showInformationMessage: (): Promise<undefined> => Promise.resolve(undefined),
    showWarningMessage: (): Promise<undefined> => Promise.resolve(undefined),
    showErrorMessage: (): Promise<undefined> => Promise.resolve(undefined),
    setStatusBarMessage: (): vscode.Disposable => ({ dispose: (): void => undefined }),
}
