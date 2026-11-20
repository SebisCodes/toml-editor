/**
 * Opening files and pasting documents. Every file opened with "Open" or dropped on the page
 * becomes a new document; JSON, JSON Lines, YAML, CSV and XML are converted to TOML. A whole
 * TOML document pasted outside the code replaces the open one (one undo step).
 */

import { parse, importYamlLibrary, getModelValue } from './datatree.js?v=12';
import { convertFromYaml, convertFromCsv, convertFromXml, convertFromJsonl } from './convert.js?v=13';
import { convertToToml } from './toml.js?v=6';
import { EDITOR, DEFAULT_NAME, TYPING_FIELDS, getElement, showToast } from './state.js?v=2';
import { setCode } from './history.js?v=3';
import { createDocument } from './documents.js?v=3';

/** The largest file the editor opens, in bytes. */
const MAX_FILE_SIZE = 8 * 1024 * 1024;
/** The file names the editor opens. */
const OPENABLE_NAME = /\.(toml|json|jsonc|json5|geojson|jsonl|ndjson|txt|yaml|yml|csv|tsv|xml)$/i;
/** The media types the editor opens. */
const OPENABLE_TYPE = /toml|json|text|xml|yaml|csv/;
/** TOML from the clipboard: it starts (after comments) with a [table] or a key = value line. */
const DOCUMENT_START = /^(?:\s*#[^\n]*\n)*\s*(\[[^\]\n]+\]\s*(#.*)?$|[A-Za-z0-9_"'.-][^=\n]*=)/m;
/** AI links are taken by ai.js. */
const AI_LINK = /#(b64|z|toml)=/;

const fileInput = getElement('#file');
let dragDepth = 0;

/**
 * A file's text as this editor's code.
 * @typedef {object} ImportedCode
 * @property {string} code - the code.
 * @property {string} from - the format it was converted from, "" when it was not converted.
 * @property {string} [note] - what TOML cannot hold of the converted data, for the message.
 */

/**
 * Lets the user choose files to open.
 * @returns {void}
 */
export function openFilePicker() {
    fileInput.click();
}

/**
 * Connects "Open", dropping files on the page and pasting a whole document.
 * @returns {void}
 */
export function startFileImport() {
    getElement('#btn-open').addEventListener('click', openFilePicker);
    fileInput.addEventListener('change', async () => { await importFiles([...fileInput.files]); fileInput.value = ''; });
    window.addEventListener('dragenter', event => { if (event.dataTransfer.types.includes('Files')) { dragDepth++; document.body.classList.add('drop'); event.preventDefault(); } });
    window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drop'); } });
    window.addEventListener('drop', importDroppedFiles);
    window.addEventListener('paste', importPastedDocument);
}

/**
 * Opens the files dropped on the page (a drop handler).
 * @param {DragEvent} event - the drop.
 * @returns {void}
 */
function importDroppedFiles(event) {
    dragDepth = 0;
    document.body.classList.remove('drop');
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    event.preventDefault();
    importFiles(files);
}

/**
 * Replaces the open document with a whole TOML document pasted outside the code (a paste
 * handler). Text that is not a readable document with data, and AI links, are left to the others.
 * @param {ClipboardEvent} event - the paste.
 * @returns {void}
 */
function importPastedDocument(event) {
    const active = document.activeElement;
    if (active && active.matches(TYPING_FIELDS)) return;
    const text = event.clipboardData.getData('text');
    if (!DOCUMENT_START.test(text) || AI_LINK.test(text)) return;
    const model = parse(EDITOR.editor, text);
    if (model.broken || !model.docs[0].root?.entries.length) return;
    event.preventDefault();
    setCode(text);
    showToast(`${EDITOR.name} pasted from the clipboard - "Undo" brings the old data back`);
}

/**
 * Returns a file's text as this editor's code, converted from the format its name says.
 * @param {string} text - the file's text.
 * @param {string} fileName - the file's name.
 * @returns {Promise<ImportedCode>} the code.
 * @throws {Error} when the text cannot be read in its format.
 */
async function getImportedCode(text, fileName) {
    const ext = (/\.([a-z0-9]+)$/i.exec(fileName) || [])[1]?.toLowerCase() || '';
    await importYamlLibrary();
    if (/^(jsonl|ndjson)$/.test(ext)) return convertToCode(convertFromJsonl(text), 'JSON Lines');
    if (/^(json|jsonc|json5|geojson)$/.test(ext)) {
        const model = parse('json', text);
        if (model.broken) throw new Error(model.problems.find(problem => problem.kind === 'error').msg);
        return convertToCode(getModelValue(model), 'JSON');
    }
    if (ext === 'yaml' || ext === 'yml') return convertToCode(convertFromYaml(text), 'YAML');
    if (ext === 'csv' || ext === 'tsv') return convertToCode(convertFromCsv(text), 'CSV');
    if (ext === 'xml') return convertToCode(convertFromXml(text), 'XML');
    return { code: text, from: '' };
}

/**
 * Returns data written as TOML, with the note on what TOML cannot hold.
 * @param {*} value - the data.
 * @param {string} from - the format it was read from.
 * @returns {ImportedCode} the code.
 */
function convertToCode(value, from) {
    const written = convertToToml(value);
    return { code: written.text, from, note: getLostNote(written.lost) };
}

/**
 * Returns what TOML cannot hold of converted data, said at the end of the message: data that
 * is no table is put under the key "value", and null is left out.
 * @param {string[]} lost - what convertToToml() reports as lost ("root", "null").
 * @returns {string} the note with its leading comma, "" when nothing is lost.
 */
function getLostNote(lost) {
    return (lost.includes('root') ? ', under the key "value"' : '') + (lost.includes('null') ? ', without the empty values (null)' : '');
}

/**
 * Opens every file as a new document; files of other types or over 8 MB are refused with a message.
 * @param {File[]} files - the files.
 * @returns {Promise<void>} settles when every file is opened or refused.
 */
async function importFiles(files) {
    for (const file of files) {
        if (!OPENABLE_NAME.test(file.name) && !OPENABLE_TYPE.test(file.type)) { showToast(`"${file.name}" is not a file the editor can open`); continue; }
        if (file.size > MAX_FILE_SIZE) { showToast('The file is larger than 8 MB'); continue; }
        try { await importFile(file); } catch (e) { showToast(`"${file.name}" could not be opened: ${e.message}`); }
    }
}

/**
 * Opens one file as a new document.
 * @param {File} file - the file.
 * @returns {Promise<void>} settles when the document is open.
 * @throws {Error} when the file cannot be read in its format.
 */
async function importFile(file) {
    const imported = await getImportedCode(await file.text(), file.name);
    const name = file.name.replace(/\.[^.]+$/, '') || DEFAULT_NAME;
    if (createDocument(name, imported.code)) showToast(imported.from ? `Opened "${file.name}" - converted from ${imported.from}${imported.note || ''}` : `Opened "${file.name}" - it is now in "My documents"`);
}
