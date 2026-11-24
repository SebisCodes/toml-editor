/**
 * The tree of the data (datatree.js createTree()) and the bar above it: a click in the tree
 * selects that entry in the code, the code cursor selects its value in the tree; keys and
 * values are edited in place; the buttons add, duplicate, move and remove entries; search
 * in keys and values; open and close all; copy the path. In the example view of a template the
 * tree shows the filled data (tree-views.js): its places lead back to the code, and a key or value
 * whose text holds an example is read-only.
 */

import { createTree, formatPath, getTemplateEditRefusal } from './datatree.js?v=13';
import { state, areas, ui, getElement, showToast, translate, SYNTAX_ERROR_FIRST, CHOOSE_VALUE } from './state.js?v=2';
import { showCodePosition, showLineBand } from './code-view.js?v=5';
import { renderNode } from './node-panel.js?v=5';
import { getTypedValue, editData, runEntryAction } from './tree-edit.js?v=5';
import { getTreeCodeRange, getTreeNodeAtCode, getExampleEditRefusal } from './tree-views.js?v=1';

/** How long the search waits after typing, in milliseconds. */
const SEARCH_DELAY = 160;
/** How long the tree waits for the code cursor to rest, in milliseconds. */
const CURSOR_DELAY = 120;

const searchField = getElement('#tree-search'), hitsOutput = getElement('#tree-hits');
let searchTimer = 0;
let cursorTimer = 0;

/**
 * Creates the tree with the editor's answers to a pick, an edit and an action (an
 * initializeX: it returns the tree).
 * @returns {object} the tree (datatree.js createTree()).
 */
export function createTreeArea() {
    return createTree({
        el: ui.tree, pathEl: getElement('#path'), t: translate,
        onPick: showPickedEntry,
        onEdit: editInTree,
        onAction: removeFromTree,
    });
}

/**
 * Selects the entry picked in the tree in the code and shows it in the side panel.
 * @param {object} info - the picked entry (node, entry, docStart).
 * @param {string} how - how it was picked ("search", "path", a click …).
 * @returns {void}
 */
function showPickedEntry(info, how) {
    if (!info.node) { if (info.docStart != null) showCodePosition(getTreeCodeRange(info.docStart, info.docStart).start, false); return; }
    const range = getTreeCodeRange(info.entry ? info.entry.start : info.node.start, info.node.end);
    showCodePosition(range.start, false, range.end);
    renderNode();
    if (how === 'search' || how === 'path') ui.tree.focus({ preventScroll: true });
}

/**
 * Answers an edit in the tree: whether it may start, and the typed key or value written into
 * the code. The shape is the one createTree() asks for.
 * @param {object} edit - the edit.
 * @param {string} edit.what - "key" or a value.
 * @param {object} edit.info - the entry.
 * @param {string} edit.text - the typed text.
 * @param {string} edit.phase - "start", or the end of the edit.
 * @returns {true|string} true when it may start or took place, else the reason.
 */
function editInTree({ what, info, text, phase }) {
    if (phase === 'start') {
        if (state.model.broken || state.model.docs[info.doc]?.broken) { showToast(SYNTAX_ERROR_FIRST); return 'broken'; }
        const refusal = getExampleEditRefusal(what, info) || getTemplateEditRefusal(what, info.node);
        if (refusal) { showToast(refusal); return refusal; }
        return true;
    }
    if (what === 'key') return editData({ kind: 'key', entry: info.entry, key: text });
    const typed = getTypedValue(info.node, text);
    if (typed.error) { showToast(typed.error); return typed.error; }
    if (typed.same) return true;
    return editData({ kind: 'value', node: info.node, value: typed.value, raw: typed.raw });
}

/**
 * Answers an action of the tree on an entry: "remove" (the Delete key) removes it.
 * @param {string} action - the action.
 * @param {object} info - the entry.
 * @returns {void}
 */
function removeFromTree(action, info) {
    if (action === 'remove') runEntryAction('remove', info);
}

/**
 * Connects the bar above the tree, the type menu, Alt+Up / Alt+Down, the search and the code
 * cursor that selects its value in the tree.
 * @returns {void}
 */
export function startTreeBar() {
    getElement('#node-add').addEventListener('click', () => runEntryAction('add'));
    getElement('#node-dup').addEventListener('click', () => runEntryAction('dup'));
    getElement('#node-up').addEventListener('click', () => runEntryAction('up'));
    getElement('#node-down').addEventListener('click', () => runEntryAction('down'));
    getElement('#node-del').addEventListener('click', () => runEntryAction('remove'));
    getElement('#node-type').addEventListener('change', event => {
        const info = areas.tree.getSelectedInfo();
        if (!info) { showToast(CHOOSE_VALUE); return; }
        editData({ kind: 'type', node: info.node, type: event.target.value });
    });
    ui.tree.addEventListener('keydown', event => {
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); event.stopPropagation(); runEntryAction(event.key === 'ArrowUp' ? 'up' : 'down'); }
    }, true);
    getElement('#tree-open').addEventListener('click', () => areas.tree.openAll());
    getElement('#tree-close').addEventListener('click', () => areas.tree.closeAll());
    getElement('#path-copy').addEventListener('click', copyPath);
    startSearch();
    document.addEventListener('selectionchange', handleSelectionChange);
}

/**
 * Copies the path of the selected value ($ without one).
 * @returns {Promise<void>} settles when the path is copied.
 */
async function copyPath() {
    const info = areas.tree.getSelectedInfo();
    const path = formatPath(info ? info.path : []);
    try { await navigator.clipboard.writeText(path); } catch (e) { /* the path is shown anyway */ }
    showToast(`Path copied: ${path}`);
}

/**
 * Connects the search: typing searches after a pause, Enter goes to the next match (Shift+Enter
 * the one before), Escape clears it.
 * @returns {void}
 */
function startSearch() {
    searchField.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { areas.tree.find(searchField.value); showHits(); }, SEARCH_DELAY); });
    searchField.addEventListener('keydown', findOnKey);
    getElement('#tree-next').addEventListener('click', () => { areas.tree.selectNextHit(1); showHits(); });
    getElement('#tree-prev').addEventListener('click', () => { areas.tree.selectNextHit(-1); showHits(); });
}

/**
 * Enter in the search goes to the next match (Shift+Enter the one before) or searches when
 * nothing is found yet; Escape clears the search.
 * @param {KeyboardEvent} event - the key in the search field.
 * @returns {void}
 */
function findOnKey(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        if (areas.tree.getHits().count) areas.tree.selectNextHit(event.shiftKey ? -1 : 1); else areas.tree.find(searchField.value);
        showHits();
    }
    if (event.key === 'Escape') { searchField.value = ''; areas.tree.find(''); showHits(); }
}

/**
 * Shows the number of matches of the tree search and which one is selected.
 * @returns {void}
 */
function showHits() {
    const hits = areas.tree.getHits();
    hitsOutput.textContent = searchField.value.trim() ? (hits.count ? `${hits.index + 1} / ${hits.count}` : '0') : '';
}

/**
 * Puts the search field in focus with its text selected (Ctrl+F).
 * @returns {void}
 */
export function selectSearchField() {
    searchField.focus();
    searchField.select();
}

/**
 * Moves the band of the cursor's line and, once the cursor rests, selects its value in the
 * tree (a selectionchange handler).
 * @returns {void}
 */
function handleSelectionChange() {
    if (document.activeElement !== ui.ta) return;
    showLineBand();
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(selectNodeAtCursor, CURSOR_DELAY);
}

/**
 * Selects the value at the code cursor in the tree, unless the tree is being edited.
 * @returns {void}
 */
export function selectNodeAtCursor() {
    if (!state.model || areas.tree.isEditing()) return;
    const node = getTreeNodeAtCode(ui.ta.selectionStart);
    if (node) { areas.tree.selectNode(node); renderNode(); }
}
