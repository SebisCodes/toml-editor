/**
 * The side panel's "Value" tab: the path, key, type and value of the value selected in the
 * tree, its size and place, whether a table is inline or an array holds tables, and the
 * buttons to add, duplicate, move and remove it. TOML has no null, and dates and times are a
 * type of their own.
 */

import { escapeHtml, formatPath, getAliasTarget } from './datatree.js?v=13';
import { state, areas, ui, getElement, showToast, hasData, formatSize } from './state.js?v=2';
import { getLineIndex, getColumnIndex } from './text-position.js?v=2';
import { getTypedValue, editData, runEntryAction } from './tree-edit.js?v=4';
import { getTreeCodeRange } from './tree-views.js?v=1';

/** The types of the type menu, in its order. */
const TYPES = ['string', 'number', 'boolean', 'datetime', 'object', 'array'];
/** The label of each type in the type menu. */
const TYPE_LABEL = { string: 'string', number: 'number', boolean: 'boolean', datetime: 'date / time', object: 'table', array: 'array' };
/** The most rows the value field takes. */
const MAX_VALUE_ROWS = 10;
/** The fewest rows the value field takes. */
const MIN_VALUE_ROWS = 2;

/**
 * Returns the type of a value as the type menu names it: "datetime" for a date or time.
 * @param {object|null} node - the value's node.
 * @returns {string|undefined} the type, undefined without a node.
 */
function getValueType(node) {
    return node && node.style === 'datetime' ? 'datetime' : node && node.type;
}

/**
 * Draws the selected value in the side panel and sets the type menu above the tree. Leaves the
 * panel alone while a field in it is being typed into.
 * @returns {void}
 */
export function renderNode() {
    const info = areas.tree.getSelectedInfo();
    const typeMenu = getElement('#node-type');
    typeMenu.value = info && info.node && TYPE_LABEL[getValueType(info.node)] ? getValueType(info.node) : '';
    typeMenu.disabled = !info;
    if (ui.node.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;   // keep what is being typed
    if (!info || !info.node) {
        ui.node.innerHTML = `<p class="hint">${hasData() ? 'Click a key or a value in the tree.' : 'The document has no data yet.'}</p>`;
        return;
    }
    ui.node.innerHTML = renderNodeForm(info);
}

/**
 * Returns the form of a selected value.
 * @param {object} info - the selected entry (node, entry, path).
 * @returns {string} the HTML of the form.
 */
function renderNodeForm(info) {
    const { node, entry } = info;
    const resolved = getAliasTarget(node) || node;
    const isBox = resolved.type === 'object' || resolved.type === 'array';
    const hasKey = entry && entry.parent.type === 'object';
    const options = TYPES.map(type => `<option value="${type}"${type === getValueType(node) ? ' selected' : ''}>${TYPE_LABEL[type]}</option>`).join('');
    const value = !isBox && node.type !== 'alias' ? (node.type === 'string' ? node.value : node.raw || String(node.value)) : '';
    return `<div class="node-form">
        <label class="field"><span>Path</span><code data-no-i18n>${escapeHtml(formatPath(info.path))}</code></label>
        ${hasKey ? `<label class="field"><span>Key</span><input id="n-key" value="${escapeHtml(entry.key)}" spellcheck="false" data-no-i18n></label>` : ''}
        <label class="field"><span>Type</span><select id="n-type">${options}</select></label>
        ${!isBox && node.type !== 'alias' ? `<label class="field"><span>Value</span><textarea id="n-value" rows="${Math.min(MAX_VALUE_ROWS, Math.max(MIN_VALUE_ROWS, value.split('\n').length))}" spellcheck="${node.type === 'string'}" data-no-i18n>${escapeHtml(value)}</textarea></label>
        <div class="button-row"><button type="button" class="button primary" id="n-apply">Apply</button></div>` : ''}
        <div class="node-info">${escapeHtml(getNodeInfo(node, entry, resolved, isBox))}</div>
        ${getTableKindHint(resolved)}
        <div class="button-row two">
            <button type="button" class="button" data-n="add">${isBox ? 'Add an entry' : 'Add after it'}</button>
            <button type="button" class="button" data-n="dup"${entry ? '' : ' disabled'}>Duplicate</button>
            <button type="button" class="button" data-n="up"${entry && entry.index > 0 ? '' : ' disabled'}>Move up</button>
            <button type="button" class="button" data-n="down"${entry && entry.index < entry.parent.entries.length - 1 ? '' : ' disabled'}>Move down</button>
            <button type="button" class="button danger" data-n="remove"${entry ? '' : ' disabled'}>Remove</button>
        </div></div>`;
}

/**
 * Returns the hint on how a table or an array is written: an array of tables as [[…]]
 * sections, an inline table on one line.
 * @param {object} resolved - the value's node.
 * @returns {string} the HTML of the hint, "" for other values.
 */
function getTableKindHint(resolved) {
    if (resolved.type === 'array' && resolved.aot) return '<p class="hint">An array of tables, written as [[…]] sections.</p>';
    if (resolved.type === 'object' && resolved.inline) return '<p class="hint">An inline table, written as { … } on one line.</p>';
    return '';
}

/**
 * Returns the line below the form: the number of keys or entries, the place and the size.
 * @param {object} node - the value's node.
 * @param {object|null} entry - its entry, null for a root.
 * @param {object} resolved - the node an alias points to, or the node itself.
 * @param {boolean} isBox - true for an object or an array.
 * @returns {string} the text, e.g. "3 keys · line 4, column 3 · 120 B".
 */
function getNodeInfo(node, entry, resolved, isBox) {
    const range = getTreeCodeRange(entry ? entry.start : node.start, node.end);
    const start = getTreeCodeRange(node.start, node.end).start;
    const size = new Blob([state.code.slice(range.start, range.end)]).size;
    const count = isBox ? `${resolved.entries.length} ${resolved.type === 'object' ? (resolved.entries.length === 1 ? 'key' : 'keys') : resolved.entries.length === 1 ? 'entry' : 'entries'} · ` : '';
    return `${count}line ${getLineIndex(start) + 1}, column ${getColumnIndex(start) + 1} · ${formatSize(size)}`;
}

/**
 * Connects the "Value" tab: its buttons, Apply (Ctrl+Enter in the value), the key (Enter or
 * leaving it) and the type menu; leaving the panel draws it again.
 * @returns {void}
 */
export function startNodePanel() {
    ui.node.addEventListener('click', event => {
        const button = event.target.closest('[data-n]');
        if (button) { runEntryAction(button.dataset.n); return; }
        if (event.target.id === 'n-apply') writeNodeValue();
    });
    ui.node.addEventListener('change', editDataOnChange);
    ui.node.addEventListener('keydown', event => {
        if (event.target.id === 'n-value' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); writeNodeValue(); }
        if (event.target.id === 'n-key' && event.key === 'Enter') { event.preventDefault(); event.target.blur(); }
    });
    ui.node.addEventListener('focusout', () => setTimeout(() => { if (!ui.node.contains(document.activeElement)) renderNode(); }, 0));
}

/**
 * Writes a changed type or key of the "Value" tab into the code.
 * @param {Event} event - the change of the type menu or the key field.
 * @returns {void}
 */
function editDataOnChange(event) {
    const info = areas.tree.getSelectedInfo();
    if (!info) return;
    if (event.target.id === 'n-type') editData({ kind: 'type', node: info.node, type: event.target.value });
    if (event.target.id === 'n-key' && event.target.value !== String(info.entry.key)) editData({ kind: 'key', entry: info.entry, key: event.target.value });
}

/**
 * Writes the value typed into the "Value" field into the code.
 * @returns {void}
 */
function writeNodeValue() {
    const info = areas.tree.getSelectedInfo(), field = getElement('#n-value');
    if (!info || !field) return;
    const typed = getTypedValue(info.node, field.value);
    if (typed.error) { showToast(typed.error); return; }
    if (!typed.same) editData({ kind: 'value', node: info.node, value: typed.value, raw: typed.raw });
}
