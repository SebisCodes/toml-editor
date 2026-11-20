/**
 * WebMCP: the editor offers its functions as tools to an AI agent that runs in the browser
 * (document.modelContext, in Chrome as an early preview). The tools run in this page only -
 * no server, no connector. Browsers without WebMCP skip this. Every change is a normal undo
 * step.
 *
 * The data tools work on the open document; list_files, open_file and new_file reach the
 * user's other documents ("My documents"). The tool names, descriptions and parameters are the
 * contract with the agents and stay as they are.
 *
 * createMcp() runs these steps:
 *   1. find WebMCP; without it, return null;
 *   2. wrap every tool so a call notes its time and tells the editor;
 *   3. register the tools;
 *   4. return { last() }, when an agent last used a tool (for the AI status in aistatus.js).
 */

const FORMAT = 'TOML';
/** The name of the document argument of set_document and new_file. */
const ARG = 'toml';
/** The length of a time as YYYY-MM-DDTHH:MM in list_files. */
const TIME_LENGTH = 16;

/**
 * What the editor hands to createMcp(); a function that cannot do its work returns an
 * error the tool reports to the agent.
 * @typedef {object} McpEditor
 * @property {function(): void} [onUse] - a tool was called.
 * @property {function(): object} getState - what the agent sees: name, code, selection and path.
 * @property {function(): Array<{line: number, col: number, kind: string, msg: string}>} getProblems - the problems.
 * @property {function(string, number): object} getValue - the value at a path: { path, type, line, value } or { error }.
 * @property {function(string, *, number): object} setValue - sets the value at a path: { path, added } or { error }.
 * @property {function(): Array<{name: string, updated: number, open: boolean}>} getFiles - the documents.
 * @property {function(string): boolean} openFileByName - opens a document by name; false when there is none.
 * @property {function(string, string): string} createFile - makes and opens a document; its name.
 * @property {function(string, string, object): Promise<void>} receiveDocument - takes a whole document.
 * @property {function(string, string, boolean): number} updateText - replaces text; the number of places.
 * @property {function(number): void} showLine - shows a line of the code.
 * @property {function(): void} undo - undoes the last change.
 */

/**
 * What createMcp() returns, read by the AI status.
 * @typedef {object} McpStatus
 * @property {function(): number} last - when an agent last used a tool (milliseconds since 1970), 0 for never.
 */

/**
 * Registers the editor's WebMCP tools (an initializeX: it returns the status object).
 * @param {McpEditor} editor - what the tools need of the editor.
 * @returns {McpStatus|null} the status, null without WebMCP.
 */
export function createMcp(editor) {
    const modelContext = document.modelContext || navigator.modelContext;
    if (!modelContext || typeof modelContext.registerTool !== 'function') return null;
    let lastCall = 0;
    for (const tool of createTools(editor)) {
        const run = tool.execute;
        /**
         * Notes the agent's call for the AI status, then runs the tool (the tool's execute).
         * @param {...*} args - the tool's arguments from the agent.
         * @returns {Promise<*>} the tool's answer, passed on unchanged.
         */
        const runTool = async (...args) => { lastCall = Date.now(); editor.onUse?.(); return run(...args); };
        tool.execute = runTool;
        addTool(modelContext, tool);
    }
    /**
     * Returns when an agent last used a tool (McpStatus.last).
     * @returns {number} milliseconds since 1970, 0 for never.
     */
    const getLastCall = () => lastCall;
    return { last: getLastCall };
}

/**
 * Registers one tool; a tool the browser refuses is left out.
 * @param {object} modelContext - the browser's WebMCP object.
 * @param {object} tool - the tool.
 * @returns {void}
 */
function addTool(modelContext, tool) {
    try {
        const result = modelContext.registerTool(tool);
        if (result && typeof result.catch === 'function') result.catch(() => { /* not available on this page */ });
    } catch (e) { /* the browser refused this tool */ }
}

/**
 * Creates the tools with their descriptions, input schemas and functions.
 * @param {McpEditor} editor - what the tools need of the editor.
 * @returns {object[]} the tools in the order they are registered.
 */
function createTools(editor) {
    /** TOML has one document per file, so the tools take no document number. */
    const docArg = {};
    return [
        {
            name: 'get_document',
            description: `Returns the name and the ${FORMAT} code of the document open in the editor, and the selected text.`,
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: getDocument,
        },
        {
            name: 'get_problems',
            description: 'Lists the syntax errors (keys or tables defined twice, invalid numbers or dates …), notes and JSON Schema problems of the document, with line and column.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true },
            execute: getProblems,
        },
        {
            name: 'get_value',
            description: 'Returns the value at a path of the data as JSON (dates and times as text), e.g. "$.items[0].name" (also "items[0].name" or a JSON Pointer "/items/0/name").',
            inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The path; "$" is the whole data.' }, ...docArg }, required: ['path'] },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: getValue,
        },
        {
            name: 'set_value',
            description: 'Sets the value at a path (any JSON value except null: string, number, boolean, object or array; written as TOML, a date as text in ISO form stays a TOML date where one was). A new key of an existing table, or the next index of an array, adds an entry. Only that place of the code changes; the rest keeps its formatting and comments.',
            inputSchema: {
                type: 'object',
                properties: { path: { type: 'string', description: 'The path, e.g. "$.settings.theme".' }, value: { description: 'The new value (JSON).' }, ...docArg },
                required: ['path', 'value'],
            },
            execute: setValue,
        },
        {
            name: 'set_document',
            description: `Replaces the whole open document with new ${FORMAT} code. Keep the user's existing data unless asked otherwise.`,
            inputSchema: { type: 'object', properties: { [ARG]: { type: 'string', description: `The complete ${FORMAT} code.` } }, required: [ARG] },
            execute: setDocument,
        },
        {
            name: 'replace_text',
            description: `Replaces an exact piece of the ${FORMAT} code with new text (the first match, or every match with all=true).`,
            inputSchema: {
                type: 'object',
                properties: {
                    find: { type: 'string', description: 'The exact text to find in the code.' },
                    replace: { type: 'string', description: 'The new text.' },
                    all: { type: 'boolean', description: 'Replace every match.' },
                },
                required: ['find', 'replace'],
            },
            execute: updateDocumentText,
        },
        {
            name: 'show_line',
            description: 'Moves the cursor to a line of the code and shows that place in the tree, so the user sees it.',
            inputSchema: { type: 'object', properties: { line: { type: 'number', description: 'Line number (1 = first line).' } }, required: ['line'] },
            execute: showLine,
        },
        {
            name: 'list_files',
            description: 'Lists the user\'s documents stored in the editor ("My documents"), most recently changed first, and which one is open.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: getFileList,
        },
        {
            name: 'open_file',
            description: 'Opens one of the user\'s documents by name; the other tools then work on it.',
            inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'The name from list_files.' } }, required: ['name'] },
            execute: openFile,
        },
        {
            name: 'new_file',
            description: `Creates a new document and opens it; the user's other documents stay unchanged. Without ${ARG} it starts empty.`,
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'A short name for the document.' },
                    [ARG]: { type: 'string', description: `Optional: the complete ${FORMAT} code.` },
                },
                required: ['name'],
            },
            execute: createFile,
        },
        {
            name: 'undo',
            description: 'Undoes the last change in the editor.',
            inputSchema: { type: 'object', properties: {} },
            execute: undo,
        },
    ];

    /**
     * get_document: the name, the kind and the code of the open document, with the selection.
     * @returns {Promise<string>} the answer for the agent.
     */
    async function getDocument() {
        const state = editor.getState();
        return `Document: "${state.name}" (${FORMAT})\n${state.path ? `Selected in the tree: ${state.path}\n` : ''}${state.sel ? `Selected text: ${state.sel}\n` : ''}\n${state.code}`;
    }

    /**
     * get_problems: the problems with line, column and kind.
     * @returns {Promise<string>} the answer for the agent.
     */
    async function getProblems() {
        const problems = editor.getProblems();
        return problems.length ? problems.map(problem => `line ${problem.line}, column ${problem.col} (${problem.kind}): ${problem.msg}`).join('\n') : 'No problems.';
    }

    /**
     * get_value: the value at a path as JSON.
     * @param {object} input - the tool's arguments.
     * @param {string} input.path - the path.
     * @param {number} [input.document] - which document (not offered in TOML).
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when there is no value at the path.
     */
    async function getValue({ path, document }) {
        const result = editor.getValue(String(path ?? '$'), document);
        if (result.error) throw new Error(result.error);
        return `${result.path} (${result.type}, line ${result.line}):\n${JSON.stringify(result.value, null, 2)}`;
    }

    /**
     * set_value: sets or adds the value at a path.
     * @param {object} input - the tool's arguments.
     * @param {string} input.path - the path.
     * @param {*} input.value - the new value.
     * @param {number} [input.document] - which document (not offered in TOML).
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when the value cannot be set.
     */
    async function setValue({ path, value, document }) {
        const result = editor.setValue(String(path ?? ''), value, document);
        if (result.error) throw new Error(result.error);
        return result.added ? `Added ${result.path}.` : `Changed ${result.path}.`;
    }

    /**
     * set_document: replaces the whole open document.
     * @param {object} input - the code under ARG.
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when the document is empty.
     */
    async function setDocument(input) {
        const text = String(input[ARG] || '');
        if (!text.trim()) throw new Error('The document is empty.');
        editor.receiveDocument(text, 'replace', { direct: true });
        const errors = editor.getProblems().filter(problem => problem.kind === 'error');
        return errors.length ? `Loaded, with ${errors.length} error(s) - see get_problems.` : 'The document is in the editor.';
    }

    /**
     * replace_text: replaces an exact piece of the code.
     * @param {object} input - the tool's arguments.
     * @param {string} input.find - the exact text.
     * @param {string} input.replace - its replacement.
     * @param {boolean} [input.all] - true to replace every match.
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when the text is not found.
     */
    async function updateDocumentText({ find, replace, all }) {
        const count = editor.updateText(String(find || ''), String(replace ?? ''), !!all);
        if (!count) throw new Error('The text was not found - call get_document to see the exact code.');
        return `Replaced ${count} time${count === 1 ? '' : 's'}.`;
    }

    /**
     * show_line: moves the cursor to a line and shows its place in the tree.
     * @param {object} input - the tool's arguments.
     * @param {number} input.line - the line, 1-based.
     * @returns {Promise<string>} the answer for the agent.
     */
    async function showLine({ line }) {
        editor.showLine(Math.max(1, Math.round(+line || 1)));
        return `Showing line ${line}.`;
    }

    /**
     * list_files: the user's documents, the open one marked.
     * @returns {Promise<string>} the answer for the agent.
     */
    async function getFileList() {
        return editor.getFiles().map(file => `${file.open ? '* ' : '  '}"${file.name}" (changed ${new Date(file.updated).toISOString().slice(0, TIME_LENGTH).replace('T', ' ')})`).join('\n') + '\n(* = open now)';
    }

    /**
     * open_file: opens a document by name.
     * @param {object} input - the tool's arguments.
     * @param {string} input.name - the name from list_files.
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when there is no document of that name.
     */
    async function openFile({ name }) {
        if (!editor.openFileByName(name)) throw new Error(`No document "${name}" - call list_files.`);
        return `"${name}" is open.`;
    }

    /**
     * new_file: makes a new document and opens it.
     * @param {object} input - the name and the code under ARG.
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when the browser storage is full.
     */
    async function createFile(input) {
        const made = editor.createFile(input.name, input[ARG]);
        if (!made) throw new Error('The browser storage is full.');
        return `New document "${made}" is open.`;
    }

    /**
     * undo: undoes the last change.
     * @returns {Promise<string>} the answer for the agent.
     */
    async function undo() {
        editor.undo();
        return 'Undone.';
    }
}
