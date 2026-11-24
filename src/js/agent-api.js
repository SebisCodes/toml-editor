/**
 * What the AI Assistant (ai.js) and the WebMCP tools (mcp.js) read and change: the state for
 * the prompt, the problems, values by path, the user's documents and text replacements.
 * Every change goes through setCode() or a change of the data, so each one is an undo step.
 */

import { formatPath, parsePath, getNodeAtPath, getPlainValue, getAliasTarget } from './datatree.js?v=13';
import { BLANK } from './samples.js?v=4';
import { store } from './files.js?v=8';
import { state, areas, ui, AI_DOCUMENT } from './state.js?v=2';
import { getLineIndex, getColumnIndex, getLinePosition } from './text-position.js?v=2';
import { getSchemaInfo } from './model.js?v=4';
import { setCode } from './history.js?v=4';
import { showCodePosition } from './code-view.js?v=4';
import { editData } from './tree-edit.js?v=4';
import { selectNodeAtCursor } from './tree-view.js?v=4';
import { openDocument } from './documents.js?v=4';
import { getTemplatePath } from './tree-views.js?v=1';

/**
 * A problem with its line and column, for the prompt and the tools.
 * @typedef {object} ListedProblem
 * @property {number} pos - the position in the code.
 * @property {string} kind - "error", "warn" or "schema".
 * @property {string} msg - the message.
 * @property {number} line - the line, 1-based.
 * @property {number} col - the column, 1-based.
 */

/**
 * A value found by its path.
 * @typedef {object} PathValue
 * @property {string[]} [segs] - the path's segments.
 * @property {number} [di] - the index of the document (0, TOML has one).
 * @property {object} [d] - that document of the model.
 * @property {object|null} [node] - the value's node, null when there is none at the path.
 * @property {string} [error] - why the path cannot be used.
 */

/**
 * Returns the problems with line and column.
 * @returns {ListedProblem[]} the problems.
 */
export function getProblemList() {
    return state.problems.map(problem => ({ ...problem, line: getLineIndex(problem.pos) + 1, col: getColumnIndex(problem.pos) + 1 }));
}

/**
 * Returns what the prompt and the tools tell about the open document.
 * @returns {object} code, name, document names, selection, selected path, schema, problems as
 *   text and the page's context.
 */
export function getPromptState() {
    const selected = getTemplatePath(areas.tree.getSelectedInfo());
    const schema = getSchemaInfo();
    return {
        code: state.code, name: state.name, files: store.getSortedEntries().map(entry => entry.name),
        sel: state.code.slice(ui.ta.selectionStart, ui.ta.selectionEnd),
        path: selected.length ? formatPath(selected) : '',
        schema: schema && schema.name ? schema.name : '',
        problems: getProblemList().map(problem => `line ${problem.line}, column ${problem.col}: ${problem.msg}`),
        context: areas.sync?.getContext() || null,
    };
}

/**
 * Returns the value at a path of a document.
 * @param {string} path - the path ("$.items[0].name", "items[0].name" or a JSON Pointer).
 * @param {number} [doc] - which document, 1 = the first (the only one in TOML).
 * @returns {PathValue} the value, or why the path cannot be used.
 */
function getValueAt(path, doc) {
    const segments = parsePath(path);
    if (!segments) return { error: `"${path}" is not a path - write it like $.items[0].name` };
    const docIndex = Math.max(0, (Number(doc) || 1) - 1);
    const targetDoc = state.model.docs[docIndex];
    if (!targetDoc || !targetDoc.root) return { error: 'The document has no data yet.' };
    return { segs: segments, di: docIndex, d: targetDoc, node: getNodeAtPath(targetDoc.root, segments) };
}

/**
 * Returns the value at a path for the get_value tool.
 * @param {string} path - the path.
 * @param {number} [doc] - which document, 1 = the first (the only one in TOML).
 * @returns {{path?: string, type?: string, line?: number, value?: *, error?: string}} the value
 *   with its path, type and line, or the error.
 */
export function getAgentValue(path, doc) {
    const found = getValueAt(path, doc);
    if (found.error) return found;
    if (!found.node) return { error: `There is no value at ${formatPath(found.segs)} - call get_document to see the data.` };
    return { path: formatPath(found.segs), type: found.node.type, line: getLineIndex(found.node.start) + 1, value: getPlainValue(found.node) };
}

/**
 * Sets the value at a path for the set_value tool: a value that is there changes; a new key of
 * a table or the next index of an array is added. Returns what it did, as the tool reports
 * it.
 * @param {string} path - the path.
 * @param {*} value - the new value.
 * @param {number} [doc] - which document, 1 = the first (the only one in TOML).
 * @returns {{path?: string, added?: boolean, error?: string}} the changed path (added: true for
 *   a new entry), or the error.
 */
export function setAgentValue(path, value, doc) {
    if (state.model.broken) return { error: 'The code has a syntax error - fix it first (get_problems).' };
    const found = getValueAt(path, doc);
    if (found.error) return found;
    if (value === undefined) return { error: 'A value is needed.' };
    if (found.node) {
        const done = editData({ kind: 'value', node: found.node, value }, { doc: found.di });
        return done === true ? { path: formatPath(found.segs) } : { error: done };
    }
    return addAgentValue(found, value);
}

/**
 * Adds a new key to an object or the next entry to an array for the set_value tool.
 * @param {PathValue} found - the path, whose last segment is the new key or index.
 * @param {*} value - the new value.
 * @returns {{path?: string, added?: boolean, error?: string}} the added path, or the error.
 */
function addAgentValue(found, value) {
    if (!found.segs.length) return { error: 'The document has no data yet.' };
    const parent = getNodeAtPath(found.d.root, found.segs.slice(0, -1));
    const last = found.segs[found.segs.length - 1];
    const box = getAliasTarget(parent);
    if (!box || (box.type !== 'object' && box.type !== 'array')) return { error: `There is no object or array at ${formatPath(found.segs.slice(0, -1))}.` };
    if (parent.type === 'alias') return { error: 'This place is an alias - change the anchor it points to.' };
    if (box.type === 'array' && !(Number(last) === box.entries.length)) return { error: `The array has ${box.entries.length} entries - only index ${box.entries.length} can be added.` };
    const done = editData({ kind: 'add', box, key: box.type === 'object' ? String(last) : undefined, value }, { doc: found.di });
    return done === true ? { path: formatPath(found.segs), added: true } : { error: done };
}

/**
 * Returns the user's documents for the list_files tool, the most recently changed first.
 * @returns {Array<{name: string, updated: number, open: boolean}>} name, change time and whether it is open.
 */
export function getFileList() {
    return store.getSortedEntries().map(entry => ({ name: entry.name, updated: entry.updated, open: entry.id === state.fileId }));
}

/**
 * Opens a document by name for the open_file tool. Returns whether there is one.
 * @param {string} name - the document's name.
 * @returns {boolean} true when the document exists (and is open).
 */
export function openFileByName(name) {
    const entry = store.findByName(name);
    if (entry && entry.id !== state.fileId) openDocument(entry.id);
    return !!entry;
}

/**
 * Creates and opens a document for the new_file tool. A command that returns the name it got,
 * as the tool reports it.
 * @param {string} name - the wanted name.
 * @param {string} [code] - the code; an empty document without it.
 * @returns {string} the name of the new document.
 * @throws {DOMException} when the browser storage is full.
 */
export function createFile(name, code) {
    const id = store.create(name || AI_DOCUMENT, code || BLANK);
    openDocument(id);
    return state.name;
}

/**
 * Replaces an exact piece of the code for the replace_text tool: the first match, or every
 * match. Returns how many places changed, as the tool reports it.
 * @param {string} find - the exact text.
 * @param {string} replacement - the new text.
 * @param {boolean} all - true to replace every match.
 * @returns {number} the number of replaced places, 0 when the text is not there.
 */
export function updateText(find, replacement, all) {
    if (!find) return 0;
    const count = state.code.split(find).length - 1;
    if (!count) return 0;
    setCode(all ? state.code.split(find).join(replacement) : state.code.replace(find, () => replacement));
    return all ? count : 1;
}

/**
 * Moves the cursor to a line for the show_line tool and selects its value in the tree.
 * @param {number} line - the line, 1-based.
 * @returns {void}
 */
export function showAgentLine(line) {
    showCodePosition(getLinePosition(line));
    selectNodeAtCursor();
}
