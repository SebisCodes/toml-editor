/**
 * The open document in other formats (convert.js), Format (the document written anew by
 * formatToml() of toml.js, comments kept, one undo step), and the tidied code of a document a
 * page hands over with ?tidy=1 (sync.js). A template that holds placeholders (?template=)
 * stays as written: Format, Tidy and the conversions wait for the filled data.
 */

import { parse, importYamlLibrary, getModelValue, hasTemplateTags, TEMPLATE_FORMAT_MESSAGE } from './datatree.js?v=13';
import { formatToml } from './toml.js?v=7';
import { convertToJson, convertToYaml, convertToCsv, convertToXml, convertToJsonl, getTreeText } from './convert.js?v=14';
import { state, areas, EDITOR, FIX_SYNTAX_ERROR, NO_DATA, hasData, showToast, translate } from './state.js?v=2';
import { setCode } from './history.js?v=5';

/** The indentation YAML gets when none is chosen. */
const YAML_INDENT = 2;
/** The indentation of a conversion when the caller gives none. */
const DEFAULT_INDENT = 2;

/**
 * A conversion's result.
 * @typedef {object} ConversionResult
 * @property {string} [text] - the converted text.
 * @property {string} [note] - a note on the result.
 * @property {string} [error] - why there is no result.
 */

/**
 * Returns why the open document cannot be converted or written anew.
 * @returns {string|null} the message, null when it can.
 */
function getConversionBlocker() {
    if (!hasData()) return NO_DATA;
    if (state.model.broken) return FIX_SYNTAX_ERROR;
    if (hasTemplateTags(state.code)) return TEMPLATE_FORMAT_MESSAGE;
    return null;
}

/**
 * Returns the code that "Open in another editor" converts (convert-to.js).
 * @returns {string} the open document's code.
 * @throws {Error} TEMPLATE_FORMAT_MESSAGE while the document holds template placeholders.
 */
export function getConvertibleCode() {
    if (hasTemplateTags(state.code)) throw new Error(TEMPLATE_FORMAT_MESSAGE);
    return state.code;
}

/**
 * Returns the open document's data in another format, or its code for "toml".
 * @param {string} kind - "json", "jsonl", "yaml", "csv", "xml", "txt" (the tree as text) or "toml".
 * @param {number|string} [indent] - the indentation of JSON and YAML: a number of spaces or "\t".
 * @param {boolean} [guard] - CSV: protect cells a spreadsheet would run as formulas.
 * @returns {Promise<ConversionResult>} the text (and a note), or the error.
 */
export async function getConvertedText(kind, indent = DEFAULT_INDENT, guard = false) {
    const blocker = getConversionBlocker();
    if (blocker) return { error: blocker };
    const value = getModelValue(state.model);
    if (kind === 'jsonl') return getJsonLines(value);
    if (kind === 'json') return { text: convertToJson(value, indent === '\t' ? '\t' : indent), note: 'Dates and times become text.' };
    if (kind === 'toml') return { text: state.code };
    if (kind === 'yaml') { await importYamlLibrary(); return { text: convertToYaml(value, typeof indent === 'number' ? indent : YAML_INDENT) }; }
    if (kind === 'csv') return convertToCsv(value, ',', guard);
    if (kind === 'xml') return { text: convertToXml(value) };
    if (kind === 'txt') return { text: getTreeText(state.model, translate) };
    return { error: 'unknown format' };
}

/**
 * Returns the data as JSON Lines: one line per entry of an array of tables that is the only
 * key at the top, otherwise the whole table on one line.
 * @param {Object<string, *>} value - the document's data.
 * @returns {ConversionResult} the text with a note on the lines.
 */
function getJsonLines(value) {
    const keys = Object.keys(value);
    const rows = keys.length === 1 && Array.isArray(value[keys[0]]) ? value[keys[0]] : null;
    return { ...convertToJsonl(rows || [value]), note: rows ? `One line per entry of "${keys[0]}".` : 'The table is one line.' };
}

/**
 * Writes the whole document anew with Format (one undo step): key = value, no indentation, an
 * empty line before each table; comments stay. The selection in the tree stays where it was.
 * @returns {void}
 */
export function formatDocument() {
    if (!state.model || state.model.broken) { showToast(FIX_SYNTAX_ERROR); return; }
    if (!hasData()) { showToast(NO_DATA); return; }
    if (hasTemplateTags(state.code)) { showToast(TEMPLATE_FORMAT_MESSAGE); return; }
    let formatted;
    try { formatted = formatToml(state.code); } catch (e) { showToast(e.message); return; }
    if (formatted === state.code) { showToast('The document is formatted already'); return; }
    const selected = areas.tree.getSelectedPlace();
    setCode(formatted);
    if (selected) areas.tree.select(selected);
    showToast('Formatted');
}

/**
 * Returns a document's code as Format writes it, for a document the page hands over with
 * ?tidy=1 (sync.js); code with a syntax error, without data or with template placeholders comes
 * back as it is.
 * @param {string} code - the code.
 * @returns {Promise<string>} the tidied code.
 */
export async function formatCodeAsStep(code) {
    if (hasTemplateTags(code)) return code;
    const model = parse(EDITOR.editor, code);
    if (model.broken || !model.docs.some(doc => doc.root)) return code;
    try { return formatToml(code); } catch (e) { return code; }
}
