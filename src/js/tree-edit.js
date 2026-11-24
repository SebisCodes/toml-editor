/**
 * Changes from the tree and the side panel: a key, a value, a type, an entry added, duplicated,
 * moved or removed. Each one is written into the code by datatree.js editCode() as one undo
 * step and keeps the rest of the code and its comments as they are (editTomlCode() of toml-edit.js);
 * then the changed entry is selected. What TOML cannot write in place is refused with a message.
 * In the example view of a template a change leads back to the template's own nodes
 * (tree-views.js); a change of text that holds an example is refused with a message.
 */

import { editCode, getDocIndex, getAliasTarget } from './datatree.js?v=13';
import { isDateTime } from './toml.js?v=7';
import {
    state, areas, EDITOR, SYNTAX_ERROR_FIRST, CHOOSE_VALUE, ROOT_IS_VALUE, hasData, showToast,
} from './state.js?v=2';
import { setCode, addPendingHistoryStep } from './history.js?v=4';
import { showCodePosition } from './code-view.js?v=4';
import { renderNode } from './node-panel.js?v=4';
import { getTreeCodeRange, getTreePlace, getTemplateChange } from './tree-views.js?v=1';

/**
 * A number as typed into the tree, as TOML writes it: decimal with "_" between digits, a
 * fraction and an exponent, hexadecimal, octal or binary, inf and nan, each with an optional sign.
 */
const NUMBER_TEXT = /^[-+]?(\d[\d_]*(\.[\d_]+)?([eE][-+]?[\d_]+)?|0x[\da-fA-F_]+|0o[0-7_]+|0b[01_]+|inf|nan)$/;
/** inf and nan with an optional sign. */
const SPECIAL_FLOAT_TEXT = /^[-+]?(inf|nan)$/;
/** The longest piece of a wrong value quoted in its message. */
const MAX_QUOTED_LENGTH = 40;
/** The first key of an empty document. */
const FIRST_KEY_CODE = 'key = ""\n';

/**
 * A change of the data, as datatree.js editCode() takes it.
 * @typedef {object} DataChange
 * @property {string} kind - "key", "value", "type", "add", "duplicate", "move" or "remove".
 * @property {object} [node] - the value that changes.
 * @property {object} [entry] - the entry (key and value) that changes.
 * @property {object} [box] - the object or array an entry is added to.
 * @property {*} [value] - the new value.
 * @property {string} [raw] - the new value as written (a number as typed).
 * @property {string} [key] - the new key.
 * @property {string} [type] - the new type.
 * @property {number} [at] - where the entry is added.
 * @property {number} [by] - how far the entry moves (-1 up, 1 down).
 */

/**
 * What was typed into a value, as a value of the value's type.
 * @typedef {object} TypedValue
 * @property {*} [value] - the value.
 * @property {string} [raw] - a number as written.
 * @property {boolean} [same] - true when nothing changes (a null stays null).
 * @property {string} [error] - why the text is no value of the type.
 */

/**
 * Returns what was typed into a value in the tree as a value of the same type; a date or time
 * stays a date or time.
 * @param {object} node - the value's node.
 * @param {string} text - the typed text.
 * @returns {TypedValue} the value, or the reason it is none.
 */
export function getTypedValue(node, text) {
    const trimmed = text.trim();
    if (node.style === 'datetime') {
        if (isDateTime(trimmed)) return { value: trimmed };
        return { error: `"${text.slice(0, MAX_QUOTED_LENGTH)}" is not a date or time (e.g. 2026-11-15, 2026-11-15T08:30:00Z, 08:30:00) - choose another type above the tree to change the type` };
    }
    switch (node.type) {
        case 'string': return { value: text };
        case 'number': return getTypedNumber(text, trimmed);
        case 'boolean':
            if (/^(true|false)$/i.test(trimmed)) return { value: trimmed.toLowerCase() === 'true' };
            return { error: 'A boolean is true or false - choose another type above the tree to change the type' };
        case 'null':
            if (!trimmed || trimmed === 'null') return { same: true };
            return { error: 'null has no value - choose another type above the tree to change the type' };
        default: return { error: 'This value is changed in the code' };
    }
}

/**
 * Returns a number typed into the tree, as TOML writes it; the text is kept as the number's raw form.
 * @param {string} text - the typed text.
 * @param {string} trimmed - the text without spaces around it.
 * @returns {TypedValue} the number, or the reason it is none.
 */
function getTypedNumber(text, trimmed) {
    if (NUMBER_TEXT.test(trimmed)) {
        const isNan = trimmed.endsWith('nan');
        const number = SPECIAL_FLOAT_TEXT.test(trimmed) ? (isNan ? NaN : trimmed[0] === '-' ? -Infinity : Infinity) : Number(trimmed.replace(/_/g, ''));
        if (!Number.isNaN(number) || isNan) return { value: number, raw: trimmed };
    }
    return { error: `"${text.slice(0, MAX_QUOTED_LENGTH)}" is not a number - choose another type above the tree to change the type` };
}

/**
 * Writes one change of the data into the code as one undo step and selects the changed entry.
 * Returns whether it took place, as the tree and the tools need to know.
 * @param {DataChange} change - the change.
 * @param {object} [options] - where the change belongs.
 * @param {number} [options.doc] - the index of the document (0, TOML has one).
 * @returns {true|string} true, or the reason the change did not take place.
 */
export function editData(change, { doc } = {}) {
    let templateChange;
    try { templateChange = getTemplateChange(change); } catch (e) { showToast(e.message); return e.message; }
    const docIndex = doc ?? getChangeDocIndex(templateChange);
    if (state.model.broken || state.model.docs[docIndex]?.broken) { showToast(SYNTAX_ERROR_FIRST); return 'broken'; }
    let result;
    try { result = editCode(EDITOR.editor, state.code, templateChange); } catch (e) { showToast(e.message); return e.message; }
    addPendingHistoryStep();
    setCode(result.code);
    areas.tree.select(getTreePlace(docIndex, result.path));
    showSelectedEntry();
    renderNode();
    return true;
}

/**
 * Returns the index of the document a change belongs to.
 * @param {DataChange} change - the change.
 * @returns {number} the index in the model's documents.
 */
function getChangeDocIndex(change) {
    if (change.node) return getDocIndex(state.model, change.node);
    if (change.entry) return getDocIndex(state.model, change.entry.node);
    if (change.box) return getDocIndex(state.model, change.box);
    return 0;
}

/**
 * Selects the entry selected in the tree in the code (without focusing the code).
 * @returns {void}
 */
function showSelectedEntry() {
    const info = areas.tree.getSelectedInfo();
    if (!info) return;
    const range = getTreeCodeRange(info.entry ? info.entry.start : info.node.start, info.node.end);
    showCodePosition(range.start, false, range.end);
}

/**
 * Runs a button above the tree or the Delete key on the selected entry: add, dup, up, down or
 * remove. An empty document gets its first key.
 * @param {string} action - "add", "dup", "up", "down" or "remove".
 * @param {object|null} [info] - the selected entry (createTree().getSelectedInfo()).
 * @returns {void}
 */
export function runEntryAction(action, info = areas.tree.getSelectedInfo()) {
    if (action === 'add' && state.model && !state.model.broken && !hasData()) { addFirstKey(); return; }
    if (!info || !info.node) { showToast(CHOOSE_VALUE); return; }
    if (action === 'add') { addEntryAfter(info); return; }
    const { entry } = info;
    if (!entry) { showToast(action === 'remove' ? 'The root cannot be removed - "Start this document over" in the New menu empties it' : 'The root has no place to move to'); return; }
    if (action === 'dup') editData({ kind: 'duplicate', entry });
    else if (action === 'up' || action === 'down') editData({ kind: 'move', entry, by: action === 'up' ? -1 : 1 });
    else if (action === 'remove') editData({ kind: 'remove', entry });
}

/**
 * Gives an empty document its first key and opens the key for typing.
 * @returns {void}
 */
function addFirstKey() {
    setCode(FIRST_KEY_CODE);
    areas.tree.select({ doc: 0, path: ['key'] });
    areas.tree.edit('key');
}

/**
 * Adds an empty entry into the selected object or array, or after the selected entry; a key
 * of an object opens for typing.
 * @param {object} info - the selected entry.
 * @returns {void}
 */
function addEntryAfter(info) {
    const { node, entry } = info;
    const resolved = getAliasTarget(node);
    const box = resolved.type === 'object' || resolved.type === 'array' ? node : entry ? entry.parent : null;
    if (!box || box.type === 'alias') { showToast(ROOT_IS_VALUE); return; }
    const at = box === node ? box.entries.length : entry.index + 1;
    if (editData({ kind: 'add', box, at, value: '' }) === true && box.type === 'object') areas.tree.edit('key');
}
