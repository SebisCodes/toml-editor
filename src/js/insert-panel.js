/**
 * The side panel's "Insert" tab: empty values added to the selected table or array (through
 * the tree, one undo step; a date is today's), and TOML snippets written at the cursor in the code.
 */

import { escapeHtml, getAliasTarget, getIndentUnit } from './datatree.js?v=13';
import { state, areas, ui, CHOOSE_VALUE, ROOT_IS_VALUE, showToast } from './state.js?v=2';
import { editData } from './tree-edit.js?v=5';
import { writeCodeRange } from './code-input.js?v=5';
import { addHistoryStep } from './history.js?v=5';

/** The empty value of each type the tab adds; "today" stands for today's date. */
const ADD_VALUES = { string: '', number: 0, boolean: true, datetime: 'today', object: {}, array: [] };
/** The value in ADD_VALUES that stands for today's date. */
const TODAY = 'today';
/** The length of a date as YYYY-MM-DD. */
const DATE_LENGTH = 10;
/** Where the cursor goes in a snippet. */
const CURSOR_MARK = '|';

/**
 * Returns today's date as YYYY-MM-DD.
 * @returns {string} the date.
 */
function getToday() {
    return new Date().toISOString().slice(0, DATE_LENGTH);
}

/**
 * Returns today's date as YYYY-MM-DD with the cursor mark after it.
 * @returns {string} the snippet.
 */
function getDateSnippet() {
    return `${getToday()}|`;
}

/**
 * Returns the date and time now (UTC, without milliseconds) with the cursor mark after it.
 * @returns {string} the snippet.
 */
function getDateTimeSnippet() {
    return `${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}|`;
}

/** The snippets: the text ("|" marks the cursor, a function gives it when used) and whether it is a block. */
const SNIPPETS = {
    kv: ['|key = "value"', false],
    table: ['[|table]\nkey = "value"\n', true],
    tables: ['[[|items]]\nname = "one"\n\n[[items]]\nname = "two"\n', true],
    inline: ['|point = { x = 1, y = 2 }', false],
    array: ['|list = ["one", "two"]', false],
    dotted: ['|server.host = "localhost"', false],
    multi: ['|text = """\nfirst line\nsecond line\n"""', true],
    literal: ["|path = 'C:\\Users\\name'", false],
    comment: ['# |', false],
    date: [getDateSnippet, false],
    datetime: [getDateTimeSnippet, false],
    true: ['true|', false], false: ['false|', false],
};

/**
 * Returns a button that adds an empty value.
 * @param {string} type - the key in ADD_VALUES.
 * @param {string} label - the button's text.
 * @param {string} title - its tooltip.
 * @returns {string} the HTML of the button.
 */
function renderAddButton(type, label, title) {
    return `<button type="button" class="button" data-add="${type}" title="${escapeHtml(title)}">${label}</button>`;
}

/**
 * Returns a button that writes a snippet at the cursor.
 * @param {string} snippet - the key in SNIPPETS.
 * @param {string} label - the button's text.
 * @param {string} title - its tooltip.
 * @returns {string} the HTML of the button.
 */
function renderSnippetButton(snippet, label, title) {
    return `<button type="button" class="button" data-ins="${snippet}" title="${escapeHtml(title)}">${label}</button>`;
}

/**
 * Draws the "Insert" tab.
 * @returns {void}
 */
export function renderInsert() {
    const b = renderAddButton, s = renderSnippetButton;
    ui.insert.innerHTML = `
        <div class="insert-group"><h3>Add to the selected value</h3>
            <p class="hint">Into the selected object or array, otherwise after the selected entry. One step for Undo.</p>
            <div class="insert-grid">
            ${b('string', 'Text', 'A new string')}${b('number', 'Number', 'A new number')}${b('boolean', 'True / false', 'A new boolean')}${b('datetime', 'Date', 'Today\'s date')}
            ${b('object', 'Table [ ]', 'A new empty table')}${b('array', 'Array [ ]', 'A new empty array')}
        </div></div>
        <div class="insert-group"><h3>At the cursor in the code</h3><div class="insert-grid">
            ${s('kv', 'Key and value', 'key = value')}${s('table', 'Table [name]', 'A table with one key')}
            ${s('tables', 'Array of tables [[name]]', 'Two tables of the same array')}${s('inline', 'Inline table { }', 'A small table on one line')}
            ${s('array', 'Array', 'A key with an array')}${s('dotted', 'Dotted key', 'A key inside a table, written as table.key')}
            ${s('multi', 'Text over several lines', 'A string in three quotes, kept with its line breaks')}${s('literal', 'Literal text (\' \')', 'A string without escapes, e.g. a Windows path')}
            ${s('comment', 'Comment (#)', 'A comment')}${s('date', 'Today\'s date', 'The date as YYYY-MM-DD')}
            ${s('datetime', 'Date and time', 'The date and time (UTC)')}${s('true', 'true', 'The boolean true')}
        </div></div>`;
}

/**
 * Connects the "Insert" tab; a snippet button keeps the focus in the code.
 * @returns {void}
 */
export function startInsertPanel() {
    ui.insert.addEventListener('mousedown', event => { if (event.target.closest('[data-ins]')) event.preventDefault(); });
    ui.insert.addEventListener('click', addOnClick);
}

/**
 * Adds what the clicked button of the "Insert" tab stands for: an empty value or a snippet.
 * @param {MouseEvent} event - the click in the tab.
 * @returns {void}
 */
function addOnClick(event) {
    const addButton = event.target.closest('[data-add]');
    if (addButton) { addEmptyValue(addButton.dataset.add); return; }
    const snippetButton = event.target.closest('[data-ins]');
    if (snippetButton) addSnippet(...SNIPPETS[snippetButton.dataset.ins]);
}

/**
 * Adds an empty value of a type into the selected object or array, or after the selected
 * entry; a new key of an object opens for typing.
 * @param {string} type - the key in ADD_VALUES.
 * @returns {void}
 */
function addEmptyValue(type) {
    const info = areas.tree.getSelectedInfo();
    if (!info) { showToast(CHOOSE_VALUE); return; }
    const resolved = getAliasTarget(info.node);
    const box = resolved && (resolved.type === 'object' || resolved.type === 'array') ? info.node : info.entry ? info.entry.parent : null;
    if (!box) { showToast(ROOT_IS_VALUE); return; }
    const at = box === info.node ? box.entries.length : info.entry.index + 1;
    const value = ADD_VALUES[type] === TODAY ? getToday() : ADD_VALUES[type];
    if (editData({ kind: 'add', box, at, value: value && typeof value === 'object' ? (Array.isArray(value) ? [] : {}) : value }) === true && box.type === 'object') areas.tree.edit('key');
}

/**
 * Writes a snippet at the cursor: "|" marks where the cursor goes; a block snippet gets the
 * line's indentation and the document's indentation unit. One undo step.
 * @param {string|function(): string} snippet - the text, or a function that gives it.
 * @param {boolean} isBlock - true for a snippet of several lines.
 * @returns {void}
 */
function addSnippet(snippet, isBlock) {
    const ta = ui.ta;
    const start = ta.selectionStart, end = ta.selectionEnd;
    let text = typeof snippet === 'function' ? snippet() : snippet;
    const lineStart = state.code.lastIndexOf('\n', start - 1) + 1;
    const indent = /^[ \t]*/.exec(state.code.slice(lineStart))[0];
    const unit = getIndentUnit(state.code);
    if (isBlock) text = text.replace(/\n {2}/g, '\n' + unit).split('\n').map((line, index) => (index ? indent + line : line)).join('\n');
    let cursor = text.indexOf(CURSOR_MARK);
    text = text.replace(CURSOR_MARK, '');
    if (cursor < 0) cursor = text.length;
    writeCodeRange(start, end, text, start + cursor);
    addHistoryStep();
}
