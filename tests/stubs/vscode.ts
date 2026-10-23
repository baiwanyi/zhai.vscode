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
/** 已创建的虚拟目录：fs.createDirectory 的登记处 */
const directories = new Set<string>()
/** 配置项：zhai.* 的键值，未配置的键返回调用方给定的默认值 */
const configValues = new Map<string, unknown>()
/** 可被 openTextDocument 打开的文档：按 fsPath 登记，未登记则打开失败（模拟文件缺失） */
const openableDocuments = new Map<string, vscode.TextDocument>()
/** showTextDocument 的调用记录：按打开顺序保存 fsPath，供用例断言 */
const openedDocumentPaths: string[] = []
/** fs.delete 的调用记录：按删除顺序保存 fsPath，供用例断言删除范围 */
const deletedPaths: string[] = []
/** 系统回收站可用性：置为 false 时 useTrash 删除一律失败，供用例覆盖「降级永久删除」的路径 */
let isTrashAvailable = true

/** 复位全部模块级状态（工作区根、虚拟磁盘、虚拟目录、配置、可打开文档），供 beforeEach 使用 */
export function resetWorkspaceState(): void {
    workspaceRoot = ''
    fileContents.clear()
    directories.clear()
    configValues.clear()
    openableDocuments.clear()
    openedDocumentPaths.length = 0
    deletedPaths.length = 0
    isTrashAvailable = true
}

/**
 * 设置系统回收站是否可用：Windows 上回收站被禁用、容量不足或目标卷不支持回收站时，
 * workspace.fs.delete 的 useTrash 会以「未能将…移动到回收站」失败，用例据此构造降级场景。
 */
export function setTrashAvailable(available: boolean): void {
    isTrashAvailable = available
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

/** 读取虚拟磁盘文件内容（未登记返回 undefined），供用例断言写入结果 */
export function readFileContent(path: string): string | undefined {
    return fileContents.get(path)
}

/** 判断虚拟目录是否已被 fs.createDirectory 创建 */
export function hasDirectory(path: string): boolean {
    return directories.has(path)
}

/** 预置虚拟目录：等价于已执行过 fs.createDirectory，供用例构造既有目录结构 */
export function setDirectory(path: string): void {
    directories.add(path)
}

/** 判断 path 是否等于或位于 dir 之下：兼容 / 与 \ 两种分隔符，且只按分隔符边界比对 */
function isNestedUnder(path: string, dir: string): boolean {
    if (path === dir) {
        return true
    }
    return path.startsWith(`${dir}/`) || path.startsWith(`${dir}\\`)
}

/** 登记可被编辑器打开的文档（内容按行传入），供 openTextDocument 解析 */
export function registerTextDocument(path: string, lines: string[]): void {
    openableDocuments.set(path, createTextDocument(lines, path))
}

/**
 * 登记一份已打开且含未保存修改的文档：写入 workspace.textDocuments，供删除前的脏文档拦截用例构造。
 * 关键约束：与 openableDocuments 分开登记，仅表示「编辑器里开着且有改动」，不代表磁盘文件存在。
 */
export function registerDirtyTextDocument(path: string, lines: string[]): void {
    const document: vscode.TextDocument = { ...createTextDocument(lines, path), isDirty: true }
    workspace.textDocuments.push(document)
}

/** 读取 showTextDocument 打开过的绝对路径序列，供用例断言打开目标 */
export function readOpenedDocumentPaths(): string[] {
    return [...openedDocumentPaths]
}

/** 读取 fs.delete 删除过的绝对路径序列，供用例断言删除范围 */
export function readDeletedPaths(): string[] {
    return [...deletedPaths]
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
        stat(uri: vscode.Uri): Promise<{ type: number; ctime: number; mtime: number; size: number }> {
            // 目录与文件分别按 FileType 语义返回，供「目标是否已存在」的判定覆盖两种形态
            if (directories.has(uri.fsPath)) {
                return Promise.resolve({ type: 2, ctime: 0, mtime: 0, size: 0 })
            }
            if (!fileContents.has(uri.fsPath)) {
                return Promise.reject(new Error(`ENOENT: ${uri.fsPath}`))
            }
            // 内存态文件统一视为普通文件（FileType.File = 1）
            return Promise.resolve({ type: 1, ctime: 0, mtime: 0, size: 0 })
        },
        readFile(uri: vscode.Uri): Promise<Uint8Array> {
            const content = fileContents.get(uri.fsPath)
            if (content === undefined) {
                return Promise.reject(new Error(`ENOENT: ${uri.fsPath}`))
            }
            return Promise.resolve(new TextEncoder().encode(content))
        },
        createDirectory(uri: vscode.Uri): Promise<void> {
            directories.add(uri.fsPath)
            return Promise.resolve()
        },
        writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
            fileContents.set(uri.fsPath, new TextDecoder().decode(content))
            return Promise.resolve()
        },
        rename(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }): Promise<void> {
            const sourcePath = source.fsPath
            const targetPath = target.fsPath
            if (!directories.has(sourcePath) && !fileContents.has(sourcePath)) {
                return Promise.reject(new Error(`ENOENT: ${sourcePath}`))
            }
            const isOccupied = directories.has(targetPath) || fileContents.has(targetPath)
            if (isOccupied && options?.overwrite !== true) {
                return Promise.reject(new Error(`EEXIST: ${targetPath}`))
            }
            // 目录重命名须连同其下已登记的文件与子目录一起搬迁，保持虚拟磁盘自洽；
            // 只按分隔符边界比对，避免 01-卷1 误命中 01-卷10
            const relocate = (path: string): string => `${targetPath}${path.slice(sourcePath.length)}`
            for (const [path, content] of [...fileContents]) {
                if (isNestedUnder(path, sourcePath)) {
                    fileContents.delete(path)
                    fileContents.set(relocate(path), content)
                }
            }
            for (const path of [...directories]) {
                if (isNestedUnder(path, sourcePath)) {
                    directories.delete(path)
                    directories.add(relocate(path))
                }
            }
            return Promise.resolve()
        },
        delete(uri: vscode.Uri, options?: { recursive?: boolean; useTrash?: boolean }): Promise<void> {
            const targetPath = uri.fsPath
            // 回收站不可用时按真实行为直接失败，且不产生任何删除副作用
            if (options?.useTrash === true && !isTrashAvailable) {
                return Promise.reject(new Error('Failed to perform delete operation'))
            }
            // 自身不算子项：删除文件时不存在「子项」，只有删目录才会因非递归而失败
            const childPaths = [
                ...[...fileContents.keys()].filter((path) => path !== targetPath && isNestedUnder(path, targetPath)),
                ...[...directories].filter((path) => path !== targetPath && isNestedUnder(path, targetPath)),
            ]
            const isExisting = directories.has(targetPath) || fileContents.has(targetPath) || childPaths.length > 0
            if (!isExisting) {
                return Promise.reject(new Error(`ENOENT: ${targetPath}`))
            }
            if (options?.recursive !== true && childPaths.length > 0) {
                return Promise.reject(new Error(`ENOTEMPTY: ${targetPath}`))
            }
            for (const path of childPaths) {
                fileContents.delete(path)
                directories.delete(path)
            }
            directories.delete(targetPath)
            fileContents.delete(targetPath)
            deletedPaths.push(targetPath)
            return Promise.resolve()
        },
    },
    openTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
        const document = openableDocuments.get(uri.fsPath)
        return document === undefined ? Promise.reject(new Error(`ENOENT: ${uri.fsPath}`)) : Promise.resolve(document)
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
    showTextDocument(document: vscode.TextDocument): Promise<vscode.TextEditor> {
        openedDocumentPaths.push(document.uri.fsPath)
        return Promise.resolve(createTextEditor(document))
    },
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
