/**
 * The side panel's "Schema" tab: the JSON Schema to check the document against is one of the
 * user's documents (stored as schema in the document's entry); the editor never downloads a
 * schema. The tab shows whether the data fits, opens the schema, and makes a schema from the data.
 */

import { escapeHtml, findKey, getModelValue } from './datatree.js?v=12';
import { getInferredSchema } from './convert.js?v=13';
import { convertToToml } from './toml.js?v=6';
import { store } from './files.js?v=8';
import { state, ui, STORAGE_FULL, FIX_SYNTAX_ERROR, showToast } from './state.js?v=2';
import { getSchemaInfo, clearSchemaCache, updateModel } from './model.js?v=3';
import { openDocument, createDocument } from './documents.js?v=3';

/** The longest part of a $schema address the tab shows. */
const MAX_SCHEMA_ADDRESS_LENGTH = 200;

/**
 * Draws the "Schema" tab.
 * @returns {void}
 */
export function renderSchema() {
    const chosen = store.getEntry(state.fileId)?.schema || '';
    const documents = store.getSortedEntries().filter(entry => entry.id !== state.fileId);
    const schema = getSchemaInfo();
    const named = state.model?.docs[0]?.root?.type === 'object' ? findKey(state.model.docs[0].root, '$schema') : null;
    ui.schema.innerHTML = `
        <p class="hint">Check this document against a JSON Schema that is one of your documents (open or paste it as a new document first). The editor never downloads a schema.</p>
        <label class="field"><span>Schema</span><select id="sc-doc"><option value="">No schema</option>${documents.map(entry => `<option value="${escapeHtml(entry.id)}"${entry.id === chosen ? ' selected' : ''} data-no-i18n>${escapeHtml(entry.name)}</option>`).join('')}</select></label>
        ${renderSchemaStatus(schema)}
        ${named && named.node.type === 'string' ? `<p class="hint">The document names the schema <code data-no-i18n>${escapeHtml(named.node.value.slice(0, MAX_SCHEMA_ADDRESS_LENGTH))}</code> - it is not loaded from there.</p>` : ''}
        <div class="button-row stack">
            <button type="button" class="button" id="sc-open"${schema && !schema.missing ? '' : ' disabled'}>Open the schema</button>
            <button type="button" class="button" id="sc-make" title="A new document with a schema that this data fits">Make a schema from this data</button>
        </div>`;
}

/**
 * Returns the status of the schema check: gone, broken, waiting for a fix, problems or fits.
 * @param {import('./model.js').SchemaInfo|null} schema - the chosen schema.
 * @returns {string} the HTML of the status, "" without a schema.
 */
function renderSchemaStatus(schema) {
    if (!schema) return '';
    if (schema.missing) return `<div class="schema-status bad">The chosen schema document is not there any more.</div>`;
    if (schema.error) return `<div class="schema-status bad">The schema has a syntax error in line ${schema.error} - open it and fix it first.</div>`;
    if (state.model?.broken) return '<div class="schema-status">Checked again once the syntax error is fixed.</div>';
    const count = state.problems.filter(problem => problem.kind === 'schema').length;
    return count ? `<div class="schema-status bad"><b>${count}</b> ${count === 1 ? 'place does' : 'places do'} not fit the schema - see above the code.</div>` : `<div class="schema-status good">The data fits the schema.</div>`;
}

/**
 * Connects the "Schema" tab: the schema menu, "Open the schema" and "Make a schema from this data".
 * @returns {void}
 */
export function startSchemaPanel() {
    ui.schema.addEventListener('change', setSchemaOnChange);
    ui.schema.addEventListener('click', event => {
        if (event.target.id === 'sc-open') openSchemaDocument();
        if (event.target.id === 'sc-make') createSchemaDocument();
    });
}

/**
 * Stores the schema chosen in the schema menu for the open document and checks the data again.
 * @param {Event} event - the change in the "Schema" tab.
 * @returns {void}
 */
function setSchemaOnChange(event) {
    if (event.target.id !== 'sc-doc') return;
    try { store.setEntryFields(state.fileId, { schema: event.target.value || null }); } catch (err) { showToast(STORAGE_FULL); }
    clearSchemaCache();
    updateModel();
    renderSchema();
}

/**
 * Opens the schema chosen for the open document.
 * @returns {void}
 */
function openSchemaDocument() {
    const id = store.getEntry(state.fileId)?.schema;
    if (id && store.getEntry(id)) { openDocument(id); showToast(`"${state.name}" opened`); }
}

/**
 * Makes a schema that the data fits as a new document (written as TOML), and checks the
 * document against it.
 * @returns {void}
 */
function createSchemaDocument() {
    if (!state.model || state.model.broken || !state.model.docs.some(doc => doc.root)) { showToast(FIX_SYNTAX_ERROR); return; }
    const fromId = state.fileId, name = state.name;
    const schema = getInferredSchema(getModelValue(state.model));
    const code = convertToToml(schema).text;
    const id = createDocument(`${name} schema`, code);
    if (!id) return;
    try { store.setEntryFields(fromId, { schema: id }); } catch (err) { /* storage full */ }
    showToast(`New document "${state.name}" - "${name}" is checked against it`);
}
