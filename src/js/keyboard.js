/**
 * Shortcuts of the whole page: Ctrl+S save, Ctrl+E Export, Ctrl+O My documents, Ctrl+Shift+F
 * Format, Ctrl+F search in the tree, Ctrl+Z / Ctrl+Y undo and redo, ? help. Undo, redo and help
 * pause while typing into a field or while a dialog is open.
 */

import { openDialog } from './dialogs.js?v=5';
import { areas, ui, NARROW_SCREEN, TYPING_FIELDS, getElement } from './state.js?v=2';
import { undo, redo } from './history.js?v=3';
import { formatDocument } from './conversion.js?v=3';
import { saveDocument, showExportDialog } from './export-dialog.js?v=3';
import { applyNewMenuSwitch, isNewMenuOpen } from './documents.js?v=3';
import { showPane } from './layout.js?v=3';
import { selectSearchField } from './tree-view.js?v=3';

/** The keys of the shortcuts with Ctrl or Cmd, as KeyboardEvent.key gives them. */
const SAVE_KEY = 's', EXPORT_KEY = 'e', OPEN_KEY = 'o', SEARCH_KEY = 'f', REDO_KEY = 'y';
/** Keys that count in both cases, since Shift is part of the shortcut or changes the letter. */
const FORMAT_KEYS = ['F', 'f'], UNDO_KEYS = ['z', 'Z'];
/** The key that opens the help. */
const HELP_KEY = '?';

/**
 * Connects the shortcuts of the page.
 * @returns {void}
 */
export function startKeyboard() {
    window.addEventListener('keydown', handlePageKey);
}

/**
 * Answers a shortcut of the page (a keydown handler).
 * @param {KeyboardEvent} event - the key.
 * @returns {void}
 */
function handlePageKey(event) {
    const active = document.activeElement;
    const typing = active && active.matches(TYPING_FIELDS);
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key === SAVE_KEY) { event.preventDefault(); saveDocument(); return; }
    if (modifier && event.key === EXPORT_KEY) { event.preventDefault(); showExportDialog(); return; }
    if (modifier && event.key === OPEN_KEY) { event.preventDefault(); areas.files.open(); return; }
    if (modifier && event.shiftKey && FORMAT_KEYS.includes(event.key)) { event.preventDefault(); formatDocument(); return; }
    if (modifier && !event.shiftKey && event.key === SEARCH_KEY && active !== ui.ta) { event.preventDefault(); if (NARROW_SCREEN.matches) showPane('draw'); selectSearchField(); return; }
    if (event.key === 'Escape' && isNewMenuOpen()) { applyNewMenuSwitch(false); return; }
    if (typing || getElement('dialog[open]')) return;
    if (modifier && UNDO_KEYS.includes(event.key)) { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (modifier && event.key === REDO_KEY) { event.preventDefault(); redo(); return; }
    if (modifier) return;
    if (event.key === HELP_KEY) openDialog(getElement('#help'));
}
