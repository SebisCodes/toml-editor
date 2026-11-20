/**
 * The "My documents" dialog: a card per document with the start of its code, searchable by
 * name; open, rename, duplicate, download and delete a document, start a new one, open a file
 * and download all as ZIP. It follows changes of the list made in other editor tabs.
 */

import { openDialog, openConfirmation } from './dialogs.js?v=5';
import { createZip } from './zip.js?v=4';
import { saveFile, getSafeName } from './util.js?v=3';
import { store, LIST } from './files.js?v=8';

/** The number of lines of a document its card shows. */
const SUMMARY_LINES = 14;
/** The number of characters of a line its card shows. */
const SUMMARY_LINE_LENGTH = 60;
const SECOND = 1000;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const TWO_DAYS = 172800;
const KILOBYTE = 1024;
/** Sizes below this many bytes get one decimal in KB. */
const DECIMAL_LIMIT = 10240;

/** The paths of the card buttons' icons. */
const ICONS = {
    rename: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    download: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
    delete: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
};

/**
 * What the editor hands to createFilesDialog().
 * @typedef {object} FilesEditor
 * @property {function(): {id: string, name: string, code: string}} getCurrent - the open document.
 * @property {function(string): void} openDocument - opens a document by id.
 * @property {function(string): void} createDocument - makes a new document of a kind ("blank").
 * @property {function(string, string): void} renameDocument - renames a document (id, free name).
 * @property {function(string): void} removeDocument - follows a deleted document (id).
 * @property {function(): void} importFile - lets the user open a file.
 * @property {function(string): void} showToast - shows a short message.
 */

/**
 * Returns how long ago a time was, for a card.
 * @param {number} time - the time in milliseconds since 1970.
 * @returns {string} "just now", "5 min ago", "3 h ago", "yesterday" or the date.
 */
function getTimeAgo(time) {
    const seconds = (Date.now() - time) / SECOND;
    if (seconds < MINUTE) return 'just now';
    if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)} min ago`;
    if (seconds < DAY) return `${Math.floor(seconds / HOUR)} h ago`;
    if (seconds < TWO_DAYS) return 'yesterday';
    return new Date(time).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Returns the first lines of a document for its card.
 * @param {string} code - the document's code.
 * @returns {string} at most 14 lines of at most 60 characters.
 */
function getSummary(code) {
    return code.split('\n').slice(0, SUMMARY_LINES).map(line => line.slice(0, SUMMARY_LINE_LENGTH)).join('\n');
}

/**
 * Returns a size for a card: bytes, or KB.
 * @param {number} bytes - the size in bytes.
 * @returns {string} e.g. "512 bytes", "1.5 KB", "24 KB".
 */
function formatFileSize(bytes) {
    return bytes < KILOBYTE ? `${bytes} bytes` : `${(bytes / KILOBYTE).toFixed(bytes < DECIMAL_LIMIT ? 1 : 0)} KB`;
}

/**
 * Returns the SVG icon of a card button.
 * @param {string} name - the key in ICONS.
 * @returns {string} the SVG.
 */
function renderIcon(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

/**
 * Connects the "My documents" dialog (an initializeX: it returns the dialog's API).
 * @param {FilesEditor} editor - what the dialog needs of the editor.
 * @returns {{open: function(): void, render: function(): void}} opens the dialog; draws it again while it is open.
 */
export function createFilesDialog(editor) {
    const dialog = document.getElementById('files');
    const grid = document.getElementById('files-grid');
    const search = document.getElementById('files-search');
    const info = document.getElementById('files-info');

    grid.addEventListener('click', runCardButton);
    search.addEventListener('input', renderCards);
    document.getElementById('files-new').addEventListener('click', () => { dialog.close(); editor.createDocument('blank'); });
    document.getElementById('files-import').addEventListener('click', () => { dialog.close(); editor.importFile(); });
    document.getElementById('files-zip').addEventListener('click', saveAllAsZip);
    // Another editor tab changed the list.
    addEventListener('storage', event => { if (event.key === LIST && dialog.open) renderCards(); });

    return {
        /**
         * Opens the dialog with an empty search and the open document's card in focus.
         * @returns {void}
         */
        open() { search.value = ''; renderCards(); openDialog(dialog); grid.querySelector('.current .file-open')?.focus(); },
        /**
         * Draws the cards again while the dialog is open.
         * @returns {void}
         */
        render() { if (dialog.open) renderCards(); },
    };

    /**
     * Draws the cards of the documents that match the search, and the count and size below them.
     * @returns {void}
     */
    function renderCards() {
        const current = editor.getCurrent();
        const all = store.getSortedEntries();
        const query = search.value.trim().toLowerCase();
        const shown = query ? all.filter(entry => entry.name.toLowerCase().includes(query)) : all;
        grid.replaceChildren(...shown.map(entry => createCard(entry, entry.id === current.id ? current.code : store.code(entry.id) || '', entry.id === current.id)));
        if (!shown.length) {
            const empty = document.createElement('p');
            empty.className = 'muted file-empty';
            empty.textContent = query ? `No document named "${search.value.trim()}".` : 'No documents yet.';
            grid.append(empty);
        }
        const total = all.reduce((sum, entry) => sum + (entry.size || 0), 0);
        info.textContent = `${all.length} ${all.length === 1 ? 'document' : 'documents'} · ${formatFileSize(total)} in this browser`;
    }

    /**
     * Creates the card of a document.
     * @param {import('./files.js').FileEntry} entry - the document's entry.
     * @param {string} code - its code.
     * @param {boolean} isCurrent - true for the open document.
     * @returns {HTMLLIElement} the card.
     */
    function createCard(entry, code, isCurrent) {
        const card = document.createElement('li');
        card.className = 'file-card' + (isCurrent ? ' current' : '');
        card.dataset.id = entry.id;
        card.innerHTML = `<button type="button" class="file-open"><span class="file-picture doc"><pre class="mini-code" data-no-i18n></pre></span></button>
            <div class="file-text"><span class="file-name" data-no-i18n></span><span class="file-info muted"></span></div>
            <div class="file-buttons">
                <button type="button" class="item-button" data-act="rename" title="Rename" aria-label="Rename">${renderIcon('rename')}</button>
                <button type="button" class="item-button" data-act="copy" title="Duplicate" aria-label="Duplicate">${renderIcon('copy')}</button>
                <button type="button" class="item-button" data-act="download" title="Download as .toml" aria-label="Download">${renderIcon('download')}</button>
                <button type="button" class="item-button danger" data-act="delete" title="Delete" aria-label="Delete">${renderIcon('delete')}</button>
            </div>`;
        card.title = isCurrent ? 'This document is open' : 'Click to open this document';
        card.querySelector('.mini-code').textContent = getSummary(code);
        card.querySelector('.file-name').textContent = entry.name;
        card.querySelector('.file-open').setAttribute('aria-label', isCurrent ? `${entry.name} (open now)` : `Open ${entry.name}`);
        card.querySelector('.file-info').textContent = isCurrent ? `Open now · ${formatFileSize(entry.size || 0)}` : `${getTimeAgo(entry.updated)} · ${formatFileSize(entry.size || 0)}`;
        return card;
    }

    /**
     * Puts a field for the new name in place of a card's name: Enter or leaving it renames,
     * Escape keeps the name.
     * @param {HTMLLIElement} card - the card.
     * @returns {void}
     */
    function startRename(card) {
        const id = card.dataset.id;
        const nameElement = card.querySelector('.file-name');
        const field = document.createElement('input');
        field.className = 'file-rename';
        field.value = store.getEntry(id)?.name || '';
        field.setAttribute('aria-label', 'New name');
        nameElement.replaceWith(field);
        field.focus();
        field.select();
        let finished = false;
        /**
         * Ends the rename once: renames when wanted and the field is not empty, then draws the cards.
         * @param {boolean} keep - true to take the typed name.
         * @returns {void}
         */
        const stopRename = keep => {
            if (finished) return;
            finished = true;
            const name = field.value.trim();
            if (keep && name) editor.renameDocument(id, store.getUniqueName(name, id));
            renderCards();
            grid.querySelector(`[data-id="${id}"] .file-open`)?.focus();
        };
        field.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); stopRename(true); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stopRename(false); }
        });
        field.addEventListener('blur', () => stopRename(true));
    }

    /**
     * Runs a click on a card: open the document, or one of its buttons (a click handler).
     * @param {MouseEvent} event - the click.
     * @returns {Promise<void>} settles when the button's work is done.
     */
    async function runCardButton(event) {
        const card = event.target.closest('.file-card');
        if (!card) return;
        const id = card.dataset.id;
        const entry = store.getEntry(id);
        if (!entry) { renderCards(); return; }
        const action = event.target.closest('[data-act]')?.dataset.act;
        if (!action && !event.target.closest('input')) {
            dialog.close();
            if (id !== editor.getCurrent().id) editor.openDocument(id);
        } else if (action === 'rename') startRename(card);
        else if (action === 'copy') copyDocument(entry);
        else if (action === 'download') saveFile(getDocumentCode(id), `${getSafeName(entry.name)}.toml`, 'application/toml');
        else if (action === 'delete') await removeCardDocument(entry);
    }

    /**
     * Returns a document's code: the open one's as it is in the editor.
     * @param {string} id - the document's id.
     * @returns {string} the code.
     */
    function getDocumentCode(id) {
        return id === editor.getCurrent().id ? editor.getCurrent().code : store.code(id) || '';
    }

    /**
     * Makes a copy of a document under a free name.
     * @param {import('./files.js').FileEntry} entry - the document's entry.
     * @returns {void}
     */
    function copyDocument(entry) {
        try {
            store.create(store.getUniqueName(entry.name + ' copy'), getDocumentCode(entry.id));
            editor.showToast(`"${entry.name}" duplicated`);
        } catch (err) { editor.showToast('The browser storage is full - delete or download some documents first'); }
        renderCards();
    }

    /**
     * Deletes a document after asking, and opens the dialog again.
     * @param {import('./files.js').FileEntry} entry - the document's entry.
     * @returns {Promise<void>} settles when the document is deleted or kept.
     */
    async function removeCardDocument(entry) {
        const confirmed = await openConfirmation({
            title: `Delete "${entry.name}"?`,
            text: 'The document is removed from this browser for good. Download it first if you want to keep a copy.',
            ok: 'Delete',
        });
        openDialog(dialog);
        if (!confirmed) return;
        store.remove(entry.id);
        editor.removeDocument(entry.id);
        editor.showToast(`"${entry.name}" deleted`);
        renderCards();
    }

    /**
     * Downloads every document as a ZIP, each under a free file name.
     * @returns {Promise<void>} settles when the ZIP is saved.
     */
    async function saveAllAsZip() {
        const current = editor.getCurrent();
        const used = new Set();
        const files = [];
        const entries = store.getSortedEntries();
        for (const entry of entries) {
            let name = getSafeName(entry.name);
            for (let k = 2; used.has(name.toLowerCase()); k++) name = `${getSafeName(entry.name)}-${k}`;
            used.add(name.toLowerCase());
            files.push({ name: `${name}.toml`, data: entry.id === current.id ? current.code : store.code(entry.id) || '' });
        }
        saveFile(await createZip(files), 'toml-documents.zip');
        editor.showToast(`ZIP with ${entries.length} ${entries.length === 1 ? 'document' : 'documents'} downloaded`);
    }
}
