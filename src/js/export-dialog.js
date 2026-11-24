/**
 * Export and saving: the Export dialog (the document as .toml, JSON, YAML, CSV or the tree as
 * text, to download, copy or get all as ZIP), "Copy" of the code, the
 * download button, and Ctrl+S, which saves to the server or the page around the editor when
 * one is set up and downloads the document otherwise.
 */

import { createZip } from './zip.js?v=4';
import { saveFile, getSafeName } from './util.js?v=3';
import { openDialog } from './dialogs.js?v=5';
import { state, areas, ui, EDITOR, getElement, showToast } from './state.js?v=2';
import { updateModel, getDocumentFormat } from './model.js?v=5';
import { getConvertedText } from './conversion.js?v=5';

/** The formats of the Export dialog with their file extension and media type. */
const EXPORT_FORMATS = {
    toml: { ext: 'toml', mime: 'application/toml' }, json: { ext: 'json', mime: 'application/json' },
    yaml: { ext: 'yaml', mime: 'application/yaml' }, csv: { ext: 'csv', mime: 'text/csv' }, txt: { ext: 'txt', mime: 'text/plain' },
};
/** The indentation of exported JSON and YAML. */
const EXPORT_INDENT = 2;

const dialog = getElement('#export');
const nameField = getElement('#ex-name'), formatMenu = getElement('#ex-format'), textField = getElement('#ex-text'), infoOutput = getElement('#ex-info');
const formulaGuard = getElement('#ex-guard');

/**
 * Returns the open document in an export format: the code as it is for this editor's format.
 * @param {string} format - a key of EXPORT_FORMATS.
 * @returns {Promise<import('./conversion.js').ConversionResult>} the text, or the error.
 */
async function getExportText(format) {
    if (format === EDITOR.editor) return { text: state.code };
    return getConvertedText(format, EXPORT_INDENT, format === 'csv' && formulaGuard.checked);
}

/**
 * Reads the code again and opens the Export dialog with the document's name.
 * @returns {void}
 */
export function showExportDialog() {
    updateModel();
    nameField.value = state.name;
    updateExportPreview();
    openDialog(dialog);
}

/**
 * Returns the file name the dialog's name field gives.
 * @returns {string} the safe file name, the document's name when the field is empty.
 */
function getExportName() {
    return getSafeName(nameField.value || state.name);
}

/**
 * Shows the chosen format's text and size in the dialog; the formula guard is used for CSV only
 * (it stays in place for every format).
 * @returns {Promise<void>} settles when the preview is shown.
 */
async function updateExportPreview() {
    if (formatMenu.value === 'convert') return;
    formulaGuard.disabled = formatMenu.value !== 'csv';
    const result = await getExportText(formatMenu.value);
    textField.value = result.text ?? '';
    infoOutput.textContent = result.error ? result.error : `${new Blob([result.text]).size.toLocaleString('en')} bytes`;
    getElement('#ex-download').disabled = !!result.error;
    getElement('#ex-copy').disabled = !!result.error;
}

/**
 * Returns the file name of an export format.
 * @param {string} baseName - the file name without extension.
 * @param {string} format - a key of EXPORT_FORMATS.
 * @returns {string} the name with the format's extension.
 */
function getExportFileName(baseName, format) {
    return `${baseName}.${EXPORT_FORMATS[format].ext}`;
}

/**
 * Connects the Export dialog, the Copy and download buttons of the code.
 * @returns {void}
 */
export function startExportDialog() {
    formulaGuard.addEventListener('change', updateExportPreview);
    formatMenu.addEventListener('change', updateExportPreview);
    nameField.addEventListener('input', updateExportPreview);
    getElement('#ex-download').addEventListener('click', saveExport);
    getElement('#ex-zip').addEventListener('click', saveAllFormatsAsZip);
    getElement('#ex-copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(textField.value); } catch (err) { textField.select(); document.execCommand('copy'); }
        showToast('Copied to the clipboard');
    });
    getElement('#btn-export').addEventListener('click', showExportDialog);
    getElement('#btn-copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(state.code); } catch (e) { ui.ta.select(); document.execCommand('copy'); }
        showToast('Code copied');
    });
    getElement('#btn-download').addEventListener('click', saveDocumentFile);
}

/**
 * Downloads the chosen format.
 * @returns {Promise<void>} settles when the file is saved or the error shown.
 */
async function saveExport() {
    const format = formatMenu.value;
    const result = await getExportText(format);
    if (result.error) { showToast(result.error); return; }
    saveFile(result.text, getExportFileName(getExportName(), format), EXPORT_FORMATS[format].mime);
    showToast('Downloaded');
}

/**
 * Downloads every format that can be made as one ZIP.
 * @returns {Promise<void>} settles when the ZIP is saved.
 */
async function saveAllFormatsAsZip() {
    const baseName = getExportName();
    const files = [];
    for (const format of Object.keys(EXPORT_FORMATS)) {
        const result = await getExportText(format);
        if (!result.error) files.push({ name: getExportFileName(baseName, format), data: result.text });
    }
    saveFile(await createZip(files), `${baseName}-all.zip`);
    showToast(`ZIP downloaded with ${files.length} files`);
}

/**
 * Downloads the document as it is (.toml).
 * @returns {void}
 */
function saveDocumentFile() {
    const format = getDocumentFormat();
    saveFile(state.code, `${getSafeName(state.name)}.${format.ext}`, format.mime);
    showToast(`.${format.ext} downloaded`);
}

/**
 * Ctrl+S: ends an edit in the tree, then saves to the server or the page around the editor
 * when one is set up, and downloads the document otherwise.
 * @returns {void}
 */
export function saveDocument() {
    if (areas.tree.isEditing()) areas.tree.stopEdit();
    if (areas.sync && areas.sync.isActive()) { areas.sync.save(); return; }
    saveDocumentFile();
}
