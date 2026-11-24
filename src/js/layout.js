/**
 * The layout of the work area: the splitter between code and tree (dragged or moved with the
 * arrow keys, remembered), the side panel (a column on the desktop, closed at the start) and its
 * tabs, the views on narrow screens, and the closing of dialogs (their close buttons and a click
 * on the backdrop).
 */

import { state, ui, getElement, getElements, getClamped } from './state.js?v=2';
import { saveToStorage } from './storage.js?v=5';
import { syncScroll } from './code-view.js?v=5';
import { renderNode } from './node-panel.js?v=5';
import { renderConvert } from './convert-panel.js?v=5';
import { renderSchema } from './schema-panel.js?v=5';
import { openDialog } from './dialogs.js?v=5';

/** The smallest share of the width the code takes. */
const MIN_SPLIT = 0.15;
/** The largest share of the width the code takes. */
const MAX_SPLIT = 0.85;
/** How far an arrow key moves the splitter, as a share of the width. */
const SPLIT_STEP = 0.03;
/** The digits of the shares written into the grid. */
const SPLIT_DIGITS = 4;

const splitter = getElement('#splitter');

/**
 * Shows the split between code and tree in the grid of the work area.
 * @returns {void}
 */
export function showSplit() {
    ui.work.style.setProperty('--code-fr', state.split.toFixed(SPLIT_DIGITS) + 'fr');
    ui.work.style.setProperty('--view-fr', (1 - state.split).toFixed(SPLIT_DIGITS) + 'fr');
}

/**
 * Connects the splitter, the side panel's button and the views on narrow screens.
 * @returns {void}
 */
export function startLayout() {
    splitter.addEventListener('pointerdown', startSplitDrag);
    splitter.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { state.split = getClamped(state.split + (event.key === 'ArrowLeft' ? -SPLIT_STEP : SPLIT_STEP), MIN_SPLIT, MAX_SPLIT); showSplit(); saveToStorage(); }
    });
    getElements('[data-pane]').forEach(button => button.addEventListener('click', () => showPane(button.dataset.pane)));
    showSidePanel(false);
    getElement('#btn-panel').addEventListener('click', () => showSidePanel(ui.work.dataset.panel !== 'open'));
}

/**
 * Opens or closes the side panel's column.
 * @param {boolean} isOpen - true to open it.
 * @returns {void}
 */
export function showSidePanel(isOpen) {
    ui.work.dataset.panel = isOpen ? 'open' : 'closed';
    getElement('#btn-panel').setAttribute('aria-expanded', String(isOpen));
}

/**
 * Follows the pointer that drags the splitter until it is let go, then stores the split
 * (a pointerdown handler).
 * @param {PointerEvent} event - the pointer on the splitter.
 * @returns {void}
 */
function startSplitDrag(event) {
    splitter.setPointerCapture(event.pointerId);
    const bounds = ui.work.getBoundingClientRect();
    const available = bounds.width - getElement('.inspector').offsetWidth - splitter.offsetWidth;
    /**
     * Moves the split with the pointer.
     * @param {PointerEvent} moveEvent - the pointer's move.
     * @returns {void}
     */
    const moveSplit = moveEvent => { state.split = getClamped((moveEvent.clientX - bounds.left) / available, MIN_SPLIT, MAX_SPLIT); showSplit(); };
    /**
     * Ends the drag and stores the split.
     * @returns {void}
     */
    const stopSplitDrag = () => { splitter.removeEventListener('pointermove', moveSplit); splitter.removeEventListener('pointerup', stopSplitDrag); saveToStorage(); };
    splitter.addEventListener('pointermove', moveSplit);
    splitter.addEventListener('pointerup', stopSplitDrag);
}

/**
 * Connects the tabs of the side panel: each shows its area and draws it.
 * @returns {void}
 */
export function startPanelTabs() {
    getElements('[data-itab]').forEach(button => button.addEventListener('click', () => showPanelTab(button)));
}

/**
 * Shows a tab of the side panel and draws it.
 * @param {HTMLElement} tabButton - the tab's button.
 * @returns {void}
 */
function showPanelTab(tabButton) {
    getElements('[data-itab]').forEach(other => other.setAttribute('aria-selected', String(other === tabButton)));
    const tab = tabButton.dataset.itab;
    ui.node.hidden = tab !== 'node';
    ui.insert.hidden = tab !== 'insert';
    ui.convert.hidden = tab !== 'convert';
    ui.schema.hidden = tab !== 'schema';
    if (tab === 'convert') renderConvert();
    if (tab === 'schema') renderSchema();
    if (tab === 'node') renderNode();
}

/**
 * Shows one view on narrow screens: the code or the tree.
 * @param {string} pane - "code" or "draw".
 * @returns {void}
 */
export function showPane(pane) {
    ui.work.dataset.show = pane;
    getElements('[data-pane]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.pane === pane)));
    requestAnimationFrame(() => { if (pane === 'code') syncScroll(); });
}

/**
 * Connects the closing of dialogs (close buttons, a click on the backdrop) and the help button.
 * @returns {void}
 */
export function startDialogs() {
    getElements('dialog [data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
    getElements('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));
    getElement('#btn-help').addEventListener('click', () => openDialog(getElement('#help')));
}
