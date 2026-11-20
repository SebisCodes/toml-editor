/**
 * The data of the open document: the code read into a model (datatree.js with the TOML reader
 * of toml.js), its problems (syntax, keys or tables defined twice, notes, and the JSON Schema
 * check when a schema document is chosen), and everything drawn from them.
 *
 * updateModel() runs these steps:
 *   1. read the code;
 *   2. show the download format (.toml) on the download button;
 *   3. collect the problems, with the schema check;
 *   4. draw the tree, the problems, the selected value and the open side panel tab.
 */

import { parse, getModelValue, getSchemaProblems, TooManyValues } from './datatree.js?v=12';
import { store } from './files.js?v=8';
import { state, areas, ui, EDITOR, getElement } from './state.js?v=2';
import { getLineIndexIn } from './text-position.js?v=2';
import { renderProblems } from './problems.js?v=3';
import { renderMarks } from './code-view.js?v=3';
import { renderNode } from './node-panel.js?v=3';
import { renderSchema } from './schema-panel.js?v=3';
import { renderConvertResult } from './convert-panel.js?v=3';

/** How long the model waits after typing, in milliseconds. */
const DEFAULT_MODEL_DELAY = 200;

/**
 * The schema chosen for the open document, as getSchemaInfo() returns it.
 * @typedef {object} SchemaInfo
 * @property {string} [id] - the schema document's id.
 * @property {string} [name] - its name.
 * @property {*} [value] - the schema as data, null when it cannot be read.
 * @property {number|null} [error] - the line (1-based) of its syntax error, null without one.
 * @property {boolean} [missing] - true when the chosen document is not there.
 */

/** The last schema code that was read, with its value or the line of its error. */
const schemaCache = { code: null, value: null, error: null };

/**
 * Forgets the schema that was read, so the next check reads it again.
 * @returns {void}
 */
export function clearSchemaCache() {
    schemaCache.code = null;
}

/**
 * Returns the schema document chosen for the open document. Reads it only when its code
 * changed (a query that fills a cache).
 * @returns {SchemaInfo|null} the schema, { missing: true } when its document is gone, null without one.
 */
export function getSchemaInfo() {
    const id = store.getEntry(state.fileId)?.schema;
    if (!id) return null;
    const entry = store.getEntry(id);
    if (!entry) return { missing: true };
    const code = id === state.fileId ? state.code : store.code(id) || '';
    if (schemaCache.code !== code) readSchema(code);
    return { id, name: entry.name, value: schemaCache.value, error: schemaCache.error };
}

/**
 * Reads a schema's code into the cache. The cache changes in one step, so a schema that cannot
 * be read never leaves the old one in use.
 * @param {string} code - the schema document's code.
 * @returns {void}
 * @throws {Error} any error of the reader other than TooManyValues.
 */
function readSchema(code) {
    const model = parse(EDITOR.editor, code);
    const syntaxError = model.problems.find(problem => problem.kind === 'error');
    let value = null, error = syntaxError ? getLineIndexIn(code, syntaxError.pos) + 1 : null;
    if (!syntaxError) {
        try { value = getModelValue(model); } catch (e) {
            if (!(e instanceof TooManyValues)) throw e;
            error = getLineIndexIn(code, Math.max(0, code.indexOf('*'))) + 1;   // aliases that expand too far
        }
    }
    Object.assign(schemaCache, { code, value, error });
}

/**
 * Reads the code into the model, collects the problems and draws what depends on them (the
 * flow in the header).
 * @returns {void}
 */
export function updateModel() {
    clearTimeout(state.modelTimer);
    state.model = parse(EDITOR.editor, state.code);
    showDownloadFormat();
    state.problems = getProblems();
    areas.tree.render(state.model);
    renderProblems();
    renderNode();
    if (!ui.schema.hidden) renderSchema();
    if (!ui.convert.hidden) renderConvertResult();
}

/**
 * Returns the problems of the model and of the schema check, sorted by position.
 * @returns {import('./state.js').Problem[]} the problems.
 */
function getProblems() {
    const problems = [...state.model.problems];
    const schema = getSchemaInfo();
    if (schema && schema.error) problems.push({ pos: 0, end: 0, kind: 'warn', msg: `The schema "${schema.name}" has a syntax error in line ${schema.error} - it is not used` });
    else if (schema && schema.value !== null && schema.value !== undefined && !state.model.broken) {
        for (const doc of state.model.docs) if (doc.root) problems.push(...getSchemaProblems(doc.root, schema.value));
    }
    problems.sort((a, b) => a.pos - b.pos);
    return problems;
}

/**
 * Returns the file format of the open document.
 * @returns {{ext: string, mime: string}} the file extension and the media type.
 */
export function getDocumentFormat() {
    return { ext: EDITOR.ext, mime: EDITOR.mime };
}

/**
 * Shows the file extension of the open document on the download button.
 * @returns {void}
 */
function showDownloadFormat() {
    const button = getElement('#btn-download');
    const ext = getDocumentFormat().ext;
    if (button.dataset.ext === ext) return;
    button.dataset.ext = ext;
    button.textContent = `Download .${ext}`;
    button.title = `Save the document as a .${ext} file (Ctrl+S)`;
}

/**
 * Reads the code again after a pause, and redraws the problem marks.
 * @param {number} [delay] - the pause in milliseconds.
 * @returns {void}
 */
export function startModelUpdate(delay = DEFAULT_MODEL_DELAY) {
    clearTimeout(state.modelTimer);
    state.modelTimer = setTimeout(() => { updateModel(); renderMarks(); }, delay);
}
