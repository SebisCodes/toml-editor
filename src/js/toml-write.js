/**
 * Writing data as TOML: keys and strings as TOML writes them, values on one line, whole
 * documents (convertToToml), and reading TOML back into plain data (convertFromToml). TOML has
 * no null: null is left out and noted as lost; data that is no table is written under the key
 * "value".
 */

import { getPlainValue } from './datatree.js?v=13';
import { parseToml, readDateTime } from './toml-read.js?v=3';

/** A key that needs no quotes. */
const BARE_KEY = /^[A-Za-z0-9_-]+$/;
/** The text of a date or time on its own: date, date and time with an optional offset, or time. */
const DATE_TIME_TEXT = /^(\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(\.\d+)?)$/;
/** The escapes of characters that a basic string cannot hold as they are. */
const STRING_ESCAPES = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\t': '\\t', '\r': '\\r', '\b': '\\b', '\f': '\\f' };
const FIRST_PRINTABLE = 0x20;
const DELETE_CHARACTER = 0x7f;
const UNICODE_ESCAPE_DIGITS = 4;
/** The largest integer TOML holds (64 bits); larger whole numbers are written as floats. */
const MAX_INTEGER = 9223372036854775807;
/** An array longer than this on one line is written over several lines. */
const MAX_ARRAY_LINE = 80;
const ARRAY_ITEM_INDENT = '    ';
/** The key that holds data that is no table. */
const ROOT_VALUE_KEY = 'value';

/**
 * Returns a key as TOML writes it: bare when it can be, else in quotes.
 * @param {string|number} key - the key.
 * @returns {string} the key.
 */
export function formatTomlKey(key) {
    return BARE_KEY.test(String(key)) ? String(key) : formatTomlString(String(key));
}

/**
 * Returns text as a basic TOML string, with escapes for quotes, backslashes and control characters.
 * @param {string} text - the text.
 * @returns {string} the string in double quotes.
 */
function formatTomlString(text) {
    let quoted = '"';
    for (const character of text) {
        const codePoint = character.codePointAt(0);
        if (character in STRING_ESCAPES) quoted += STRING_ESCAPES[character];
        else if (codePoint < FIRST_PRINTABLE || codePoint === DELETE_CHARACTER) quoted += '\\u' + codePoint.toString(16).padStart(UNICODE_ESCAPE_DIGITS, '0');
        else quoted += character;
    }
    return quoted + '"';
}

/**
 * Tells whether text is a valid TOML date or time on its own.
 * @param {*} text - the text.
 * @returns {boolean} true for a date, a date and time, or a time that exists.
 */
export function isDateTime(text) {
    if (typeof text !== 'string' || !DATE_TIME_TEXT.test(text)) return false;
    const match = readDateTime(text, 0);
    return !!match && !match.bad && match.end === text.length;
}

/**
 * Returns a number as TOML writes it: whole numbers as integers while TOML can hold them,
 * larger ones and fractions as floats, and inf, -inf, nan and -0.0.
 * @param {number} number - the number.
 * @returns {string} the number.
 */
function formatNumber(number) {
    if (Number.isNaN(number)) return 'nan';
    if (number === Infinity) return 'inf';
    if (number === -Infinity) return '-inf';
    if (Object.is(number, -0)) return '-0.0';
    const text = String(number);
    if (Number.isInteger(number) && Math.abs(number) < MAX_INTEGER && !/e/.test(text)) return text;
    if (Number.isInteger(number) && !/e/.test(text)) return number.toExponential().replace(/e\+?/, 'e').replace(/^(-?\d+)e/, '$1.0e');
    if (/e/.test(text)) return text.replace(/e\+?/, 'e').replace(/^(-?\d+)e/, '$1.0e');
    return text;
}

/**
 * Tells whether a value is left out of TOML: null and undefined, since TOML has no null.
 * @param {*} value - the value.
 * @returns {boolean} true when the value is left out.
 */
function isLeftOut(value) {
    return value === null || value === undefined;
}

/**
 * Notes "null" as lost when one of the values is left out of TOML.
 * @param {Array<*>} values - the values of an array or table.
 * @param {Set<string>} lost - the collector of what TOML cannot hold; "null" is added to it.
 * @returns {void}
 */
function addLeftOutValues(values, lost) {
    if (values.some(isLeftOut)) lost.add('null');
}

/**
 * Returns a value on one line (inline tables and arrays as { } and [ ]). What TOML cannot
 * hold (null) is left out and added to the collector.
 * @param {*} value - the value.
 * @param {Set<string>} [lost] - the collector of what TOML cannot hold.
 * @returns {string} the value as TOML ('""' for null at the top).
 */
export function formatInlineValue(value, lost = new Set()) {
    if (value === null || value === undefined) { lost.add('null'); return '""'; }
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'number') return formatNumber(value);
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'string') return formatTomlString(value);
    if (Array.isArray(value)) {
        addLeftOutValues(value, lost);
        return `[${value.filter(item => !isLeftOut(item)).map(item => formatInlineValue(item, lost)).join(', ')}]`;
    }
    addLeftOutValues(Object.values(value), lost);
    const keys = Object.keys(value).filter(key => !isLeftOut(value[key]));
    return keys.length ? `{ ${keys.map(key => `${formatTomlKey(key)} = ${formatInlineValue(value[key], lost)}`).join(', ')} }` : '{}';
}

/**
 * Tells whether a value is a plain object (a table).
 * @param {*} value - the value.
 * @returns {boolean} true for an object that is no array and not null.
 */
export function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Tells whether a value is an array of tables: a non-empty array of plain objects.
 * @param {*} value - the value.
 * @returns {boolean} true when every item is a table.
 */
export function isTableArray(value) {
    return Array.isArray(value) && value.length > 0 && value.every(isPlainObject);
}

/**
 * Tells whether a value is a table with keys.
 * @param {*} value - the value.
 * @returns {boolean} true for a plain object with at least one key.
 */
function isFilledTable(value) {
    return isPlainObject(value) && Object.keys(value).length > 0;
}

/**
 * Tells whether a table needs its own [header]: it is empty or has keys that are no tables.
 * @param {Object<string, *>} table - the table.
 * @returns {boolean} true when a header is written.
 */
export function isHeaderNeeded(table) {
    return !Object.keys(table).length || Object.keys(table).some(key => !isFilledTable(table[key]) && !isTableArray(table[key]));
}

/**
 * Returns an array on one line, or over several lines (one item per line) when it is long.
 * @param {Array<*>} value - the array.
 * @param {Set<string>} lost - the collector of what TOML cannot hold.
 * @returns {string} the array as TOML.
 */
export function formatArray(value, lost) {
    const oneLine = formatInlineValue(value, lost);
    if (oneLine.length <= MAX_ARRAY_LINE || !value.length) return oneLine;
    return '[\n' + value.filter(item => !isLeftOut(item)).map(item => ARRAY_ITEM_INDENT + formatInlineValue(item, lost) + ',').join('\n') + '\n]';
}

/**
 * Returns the header text of a path: the keys, without the indexes of arrays of tables (a
 * header after [[a]] belongs to its last table).
 * @param {Array<string|number>} path - the path of the table.
 * @returns {string} the keys joined with dots.
 */
export function getHeaderText(path) {
    return path.filter(key => typeof key !== 'number').map(key => formatTomlKey(key)).join('.');
}

/**
 * Returns the lines of a table's body: its key = value lines, then its tables as [header]
 * sections and its arrays of tables as [[header]] sections. What TOML cannot hold is left out
 * and added to the collector.
 * @param {Object<string, *>} table - the table.
 * @param {Array<string|number>} path - the keys of the table, for the headers.
 * @param {Set<string>} lost - the collector of what TOML cannot hold.
 * @returns {string[]} the lines.
 */
export function getTableLines(table, path, lost) {
    const lines = [], later = [];
    addLeftOutValues(Object.values(table), lost);
    for (const key of Object.keys(table)) {
        const value = table[key];
        if (isLeftOut(value)) continue;
        if (isFilledTable(value)) later.push([key, value, 'table']);
        else if (isTableArray(value)) later.push([key, value, 'array']);
        else lines.push(`${formatTomlKey(key)} = ${Array.isArray(value) ? formatArray(value, lost) : formatInlineValue(value, lost)}`);
    }
    for (const [key, value, kind] of later) {
        const subPath = [...path, key];
        if (kind === 'table') addSubTableLines(lines, value, subPath, lost);
        else for (const item of value) addTableArrayItemLines(lines, item, subPath, lost);
    }
    return lines;
}

/**
 * Adds the section of a table below a body: an empty line, its [header] when it needs one, its body.
 * @param {string[]} lines - the lines so far; the section is added to them.
 * @param {Object<string, *>} table - the table.
 * @param {Array<string|number>} path - its path.
 * @param {Set<string>} lost - the collector of what TOML cannot hold.
 * @returns {void}
 */
function addSubTableLines(lines, table, path, lost) {
    if (lines.length) lines.push('');
    if (isHeaderNeeded(table)) lines.push(`[${getHeaderText(path)}]`);
    lines.push(...getTableLines(table, path, lost));
}

/**
 * Adds one table of an array of tables below a body: an empty line, its [[header]], its body.
 * @param {string[]} lines - the lines so far; the section is added to them.
 * @param {Object<string, *>} table - the table.
 * @param {Array<string|number>} path - the path of the array.
 * @param {Set<string>} lost - the collector of what TOML cannot hold.
 * @returns {void}
 */
function addTableArrayItemLines(lines, table, path, lost) {
    if (lines.length) lines.push('');
    lines.push(`[[${getHeaderText(path)}]]`);
    lines.push(...getTableLines(table, path, lost));
}

/**
 * Returns data as a TOML document. A value that is no table at the top is written under the
 * key "value"; null has no form in TOML and is left out.
 * @param {*} value - the data.
 * @returns {{text: string, lost: string[]}} the TOML text and what it cannot hold ("root", "null").
 */
export function convertToToml(value) {
    const lost = new Set();
    let table = value;
    if (!isPlainObject(table)) { lost.add('root'); table = { [ROOT_VALUE_KEY]: table }; }
    const lines = getTableLines(table, [], lost);
    while (lines.length && lines[0] === '') lines.shift();
    return { text: lines.join('\n') + (lines.length ? '\n' : ''), lost: [...lost] };
}

/**
 * Returns the plain data of TOML text.
 * @param {string} text - the TOML code.
 * @returns {Object<string, *>} the data (dates and times as text).
 * @throws {Error} with the line and message of the first error.
 */
export function convertFromToml(text) {
    const model = parseToml(text);
    const error = model.problems.find(problem => problem.kind === 'error');
    if (error) throw new Error(`Line ${text.slice(0, error.pos).split('\n').length}: ${error.msg}`);
    return getPlainValue(model.docs[0].root);
}
