/**
 * Documents that arrive: from AI links and WebMCP tools (receiveDocument), and from the page
 * around the editor or ?src= (importExternalDocument, called by sync.js).
 */

import { parse, mergeData, getModelValue } from './datatree.js?v=12';
import { store } from './files.js?v=8';
import { VIEWER } from './sync.js?v=23';
import { state, ui, EDITOR, AI_DOCUMENT, showToast } from './state.js?v=2';
import { setCode } from './history.js?v=3';
import { createDocument, openDocument } from './documents.js?v=3';

/**
 * Which document a received document goes to.
 * @typedef {object} ReceiveTarget
 * @property {string} [file] - "new" for a new document, a name for that document (made when
 *   there is none), empty for the open one.
 * @property {string} [name] - the name of a new document.
 */

/**
 * Takes a document from an AI link or a WebMCP tool. With mode "add" the keys of the data are
 * merged into the root table (mergeTomlData() of toml-edit.js, each key replaces the one of the same
 * name); an addition that cannot be read or merged opens as a new document. The link says
 * which document (chosen with the prompt's buttons), so nothing is asked; "Undo" takes the
 * change back.
 * @param {string} text - the document's code.
 * @param {string} mode - "add", or anything else to replace the document.
 * @param {ReceiveTarget} [target] - which document.
 * @returns {Promise<void>} settles when the document is taken.
 */
export async function receiveDocument(text, mode, target = {}) {
    const wanted = String(target.file || '').trim();
    const isNew = wanted.toLowerCase() === 'new';
    const entry = isNew ? null : wanted ? store.findByName(wanted) : store.getEntry(state.fileId);
    let data = null;
    if (mode === 'add') {
        const model = parse(EDITOR.editor, text);
        if (model.broken) {
            if (createDocument(`${entry ? entry.name : AI_DOCUMENT} (AI)`, text)) showToast(`The addition is not valid ${EDITOR.name} - it is open as a new document "${state.name}"`);
            return;
        }
        data = getModelValue(model);
    }
    if (!entry) { openReceivedAsNew(text, isNew ? target.name || AI_DOCUMENT : wanted || AI_DOCUMENT); return; }
    if (entry.id !== state.fileId) openDocument(entry.id);
    if (!writeReceived(text, mode, data, entry)) return;
    const errors = state.problems.filter(problem => problem.kind === 'error').length;
    VIEWER || showToast(errors ? `Document received - ${errors} ${errors === 1 ? 'problem' : 'problems'} found, see above the code` : `"${state.name}" changed by the AI - "Undo" takes it back`);
}

/**
 * Opens a received document as a new document.
 * @param {string} text - the document's code.
 * @param {string} name - its name.
 * @returns {void}
 */
function openReceivedAsNew(text, name) {
    const id = store.create(name, text);
    openDocument(id);
    VIEWER || showToast(`New document "${state.name}" from the AI - your other documents are unchanged`);
}

/**
 * Writes a received document into the open document: replaced or merged. Returns whether it
 * was written there: an addition that cannot be merged opens as a new document.
 * @param {string} text - the document's code.
 * @param {string} mode - "add", or anything else to replace.
 * @param {*} data - the addition's data with mode "add".
 * @param {import('./files.js').FileEntry} entry - the document it is meant for.
 * @returns {boolean} true when the open document holds it.
 */
function writeReceived(text, mode, data, entry) {
    if (mode !== 'add') { setCode(text); return true; }
    try { setCode(mergeData(EDITOR.editor, state.code, data)); } catch (e) {
        if (createDocument(`${entry.name} (AI)`, text)) showToast(`${e.message} - the addition is open as a new document "${state.name}"`);
        return false;
    }
    return true;
}

/**
 * A document from the page around the editor or from ?src= (sync.js).
 * @typedef {object} ExternalDocument
 * @property {string} name - its name.
 * @property {string} content - its code.
 * @property {string} [into] - the id of the document to replace.
 * @property {boolean} [asNew] - true to always make a new document.
 * @property {string} [page] - the origin of the page it comes from.
 * @property {boolean} [temp] - true for a document the page handed over: kept in memory only, never stored.
 */

/**
 * Opens a document from the page around the editor or from ?src=: it replaces the document of
 * that name that came from the same page before (one undo step) or becomes a new document.
 * The user's own documents are never replaced.
 * @param {ExternalDocument} external - the document.
 * @returns {Promise<void>} settles when the document is open (sync.js waits for it).
 */
export async function importExternalDocument({ name, content, into, asNew, page, temp }) {
    const entry = asNew ? null : (into && store.getEntry(into)) || store.list().find(item => item.name === name && item.page && item.page === page && !!item.temp === !!temp);
    if (entry) {
        if (entry.id !== state.fileId) openDocument(entry.id);
        if (content !== state.code) setCode(content);
    } else {
        const id = createDocument(name, content, !!temp);
        if (id && page) try { store.setEntryFields(id, { page }); } catch (e) { /* storage full: it just is not recognized next time */ }
    }
    ui.ta.setSelectionRange(0, 0);
    ui.ta.scrollTop = 0;
}
