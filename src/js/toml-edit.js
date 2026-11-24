/**
 * Changes from the tree as small edits of the TOML code (the applyEdit of datatree.js's
 * format contract): a value, a type, a key, an entry added, duplicated, moved or removed.
 * Comments and the rest of the formatting stay; a key is renamed at every place that names
 * it. What TOML cannot write in place is refused with a message for the user.
 *
 * editTomlCode() runs these steps:
 *   1. read the code; a syntax error stops the change;
 *   2. find the changed node again in the code as read (the tree may hold an older model);
 *   3. write the change at its places (toml-places.js) and return the new code with the path
 *      to select.
 */

import { getPath, getNodeAtPath, convertValue, getFreeKey, checkTemplateEdit } from './datatree.js?v=13';
import { isTableNode } from './toml-read.js?v=3';
import { readTomlTemplate } from './toml-template.js?v=1';
import { formatTomlKey, formatInlineValue, formatArray, convertToToml, isDateTime, isPlainObject, isTableArray, getHeaderText, getTableLines } from './toml-write.js?v=4';
import {
    getValueText, checkNotNull, getSectionBoundary, getSectionTable, getCodeWithLine, getCodeWithLineIn, getCodeWithSection,
    getCodeWithSections, getCodeWithReplacedSections, getCodeWithoutSpans, getSwappedCode, getCodeWithCopy,
    getCodeWithInlineItem, getCodeWithoutInlineItem,
} from './toml-places.js?v=4';
import { getLineStart, getTrimmedEnd, mergeRanges, mergeLooseRanges, getSpliced } from './toml-text.js?v=2';

/** A number as typed, which a change keeps as it is written when it means the same value. */
const NUMBER_TEXT = /^[+-]?(\d[\d_]*(\.\d+)?([eE][+-]?\d+)?|0x[\da-fA-F_]+|0o[0-7_]+|0b[01_]+|inf|nan)$/;
/** A table shorter than this on one line stays inline where a value was. */
const MAX_INLINE_TABLE_LENGTH = 60;
const DIFFERENT_PLACES = 'This entry is written in several places of the code - move it there';

/**
 * The result of a change (EditResult of datatree-core.js).
 * @typedef {object} TomlEditResult
 * @property {string} code - the new code.
 * @property {Array<string|number>} path - the path to select after the change.
 */

/**
 * Returns the code after one change from the tree (the flow in the header).
 * @param {string} code - the code.
 * @param {import('./datatree-core.js').TreeEdit} change - the change.
 * @returns {TomlEditResult} the new code and the path to select.
 * @throws {Error} with a message for the user when the change is not possible in TOML.
 */
export function editTomlCode(code, change) {
    const model = readTomlTemplate(code);
    if (model.broken) throw new Error('The code has a syntax error - fix it first');
    switch (change.kind) {
        case 'type': return getCodeWithType(code, change);
        case 'value': return getCodeWithValue(code, model, change);
        case 'key': return getCodeWithKey(code, model, change);
        case 'add': return getCodeWithAddedEntry(code, model, change);
        case 'duplicate': return getCodeWithDuplicate(code, model, change);
        case 'move': return getCodeWithMovedEntry(code, model, change);
        case 'remove': return getCodeWithoutEntry(code, model, change);
        default: throw new Error('unknown change');
    }
}

/**
 * Returns a node of an older model in the model just read.
 * @param {object} model - the model just read.
 * @param {object|null} node - the node.
 * @returns {object|null} the node at the same path, null when there is none.
 */
function findInModel(model, node) {
    return node ? getNodeAtPath(model.docs[0].root, getPath(node)) : null;
}

/**
 * Returns the code after a change of a value's type: the value converted to the type (a date
 * or time keeps its text as a string, a new date or time is now in UTC).
 * @param {string} code - the code.
 * @param {import('./datatree-core.js').TreeEdit} change - the change with node and type.
 * @returns {TomlEditResult} the new code and path.
 * @throws {Error} for null, which TOML cannot hold.
 */
function getCodeWithType(code, change) {
    if (change.type === 'null') checkNotNull(null);
    const node = change.node;
    if (change.type === 'datetime') {
        const value = node.type === 'string' && isDateTime(node.value) ? node.value : new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        return editTomlCode(code, { kind: 'value', node, value, datetime: true });
    }
    let value = convertValue(node, change.type);
    if (change.type === 'string' && node.style === 'datetime') value = node.value;
    return editTomlCode(code, { kind: 'value', node, value });
}

/**
 * Returns the number as the user typed it when it means the same value, so the change keeps
 * its form (0xFF, 1_000).
 * @param {*} value - the new value.
 * @param {*} raw - the text as typed.
 * @returns {string|null} the text, null when the value is written anew.
 */
function getRawNumber(value, raw) {
    return typeof value === 'number' && typeof raw === 'string' && Number(raw.replace(/_/g, '')) === value && NUMBER_TEXT.test(raw) ? raw : null;
}

/**
 * Returns the code after a change of a value. The root gets a whole new document; a value in
 * a line or in { } / [ ] changes in place (a long table or tables in a line become sections);
 * a table written in sections gets new sections, or a key = value line when it becomes another type.
 * @param {string} code - the code.
 * @param {object} model - the code as read.
 * @param {import('./datatree-core.js').TreeEdit} change - the change with node, value, raw and datetime.
 * @returns {TomlEditResult} the new code and path.
 * @throws {Error} when TOML cannot hold the value there.
 */
function getCodeWithValue(code, model, change) {
    const node = findInModel(model, change.node) || change.node, entry = node.entry, value = change.value;
    checkNotNull(value);
    const path = getPath(node);
    if (!entry) {
        if (!isPlainObject(value)) throw new Error('A TOML document is a table - its root cannot be another type');
        return { code: convertToToml(value).text, path };
    }
    const raw = getRawNumber(value, change.raw);
    const asDate = (change.datetime || node.style === 'datetime') && isDateTime(value);
    if (entry.mode === 'inline' && node.dotted) throw new Error('This key is written as a dotted key inside { } - change it in the code');
    if (entry.mode === 'line' || entry.mode === 'inline') {
        if (isSectionsInLine(entry, node, value, change)) return getCodeWithReplacedSections(code, entry, value, path);
        return { code: getSpliced(code, node.start, node.end, raw ?? (asDate ? value : getValueText(value, node))), path };
    }
    if (entry.parent.aot && !isPlainObject(value)) throw new Error('Every entry of an array of tables [[…]] is a table - change it to an array [ ] in the code first');
    if (isTableNode(node) && isPlainObject(value)) return getCodeWithReplacedSections(code, entry, value, path);
    if (node.type === 'array' && node.aot && isTableArray(value)) return getCodeWithReplacedSections(code, entry, value, path);
    // another type: the table's places go, a key = value line takes its place
    const removed = getCodeWithoutSpans(code, entry);
    const sectionPath = isDottedLinesOnly(entry) ? getPath(getSectionTable(entry.parent)) : null;
    return { code: getCodeWithLineIn(removed, getPath(entry.parent), entry.key, raw ?? (asDate ? value : getValueText(value)), Math.min(mergeRanges(entry.spans)[0][0], removed.length), sectionPath), path };
}

/**
 * Tells whether an entry stands only in lines of a table made by dotted keys (`x.y.c = 1`), so
 * that table's section holds all of it.
 * @param {object} entry - the entry.
 * @returns {boolean} true for an entry written only in lines of a dotted table.
 */
function isDottedLinesOnly(entry) {
    const table = entry.parent;
    return !!(table.entry && table.dotted && !table.headers && (entry.mode === 'line' || (getPlaceKind(entry) === 'line' && !isLineAndSection(entry))));
}

/**
 * Tells whether a value line gets sections in its place: a table that is long on one line, or
 * an array of tables, where the line's table can take sections.
 * @param {object} entry - the entry of the line.
 * @param {object} node - its value.
 * @param {*} value - the new value.
 * @param {import('./datatree-core.js').TreeEdit} change - the change (inline: true keeps it on the line).
 * @returns {boolean} true when the line becomes sections.
 */
function isSectionsInLine(entry, node, value, change) {
    const isTableValue = (isPlainObject(value) && Object.keys(value).length && !node.inline) || isTableArray(value);
    if (entry.mode !== 'line' || !isTableValue || entry.parent.frozen || entry.parent.inline || change.inline) return false;
    return formatInlineValue(value).length > MAX_INLINE_TABLE_LENGTH || isTableArray(value);
}

/**
 * Returns the code with a key renamed at every place that names it.
 * @param {string} code - the code.
 * @param {object} model - the code as read.
 * @param {import('./datatree-core.js').TreeEdit} change - the change with entry and key.
 * @returns {TomlEditResult} the new code and path.
 * @throws {Error} for an array entry or a key that is taken.
 */
function getCodeWithKey(code, model, change) {
    const key = String(change.key);
    const entry = findInModel(model, change.entry.node)?.entry || change.entry;
    if (entry.parent.type !== 'object') throw new Error('Entries of an array have no key');
    if (entry.parent.entries.some(other => other !== entry && other.key === key)) throw new Error(`There is already a key "${key}" here`);
    const refs = mergeRanges(entry.refs || [[entry.keyStart, entry.keyEnd]]).sort((a, b) => b[0] - a[0]);
    let result = code;
    for (const [start, end] of refs) result = getSpliced(result, start, end, formatTomlKey(key));
    return { code: result, path: [...getPath(entry.parent), key] };
}

/**
 * Returns the code with a new entry in a table or an array: inside { } or [ ] as an item, in
 * an array of tables as one more [[table]], in a table as a key = value line or as sections.
 * @param {string} code - the code.
 * @param {object} model - the code as read.
 * @param {import('./datatree-core.js').TreeEdit} change - the change with box, key, value and at.
 * @returns {TomlEditResult} the new code and path.
 * @throws {Error} when the key is taken or the table is written inside { }.
 */
function getCodeWithAddedEntry(code, model, change) {
    const box = findInModel(model, change.box) || change.box;
    const isObject = box.type === 'object';
    let value = change.value === undefined ? '' : change.value;
    if (value === null) value = '';
    if (box.type === 'array' && box.aot && !isPlainObject(value)) value = {};
    const key = isObject ? String(change.key ?? getFreeKey(box)) : (box.aot ? box.entries.length : Math.max(0, Math.min(change.at ?? box.entries.length, box.entries.length)));
    if (isObject && box.entries.some(entry => entry.key === key)) throw new Error(`There is already a key "${key}" here`);
    const path = [...getPath(box), key];
    if (box.inline || box.frozen) {
        if (isObject && box.frozen && !box.inline) throw new Error('This table is written inside { } - add the key there in the code');
        return { code: getCodeWithInlineItem(code, box, isObject ? key : null, getValueText(value), change.at), path };
    }
    if (box.type === 'array' && box.aot) return { code: getCodeWithArrayTable(code, model, box, value), path: [...getPath(box), box.entries.length] };
    // a table: a key = value line, or a section for a table with keys / tables
    if ((isPlainObject(value) && Object.keys(value).length) || isTableArray(value) || (isPlainObject(value) && !box.dotted)) return { code: getCodeWithSections(code, model, box, key, value), path };
    return { code: getCodeWithLine(code, model, box, key, Array.isArray(value) ? formatArray(value, new Set()) : getValueText(value)), path };
}

/**
 * Returns the code with one more table in an array of tables, after its last table.
 * @param {string} code - the code.
 * @param {object} model - the code as read.
 * @param {object} box - the array of tables.
 * @param {Object<string, *>} value - the new table.
 * @returns {string} the new code.
 */
function getCodeWithArrayTable(code, model, box, value) {
    const spans = mergeRanges(box.entries[box.entries.length - 1].spans);
    const at = getSectionBoundary(code, model, getTrimmedEnd(code, spans[spans.length - 1][1]));
    const body = getTableLines(value, getPath(box), new Set());
    return getCodeWithSection(code, at, `[[${getHeaderText(getPath(box))}]]\n` + (body.length ? body.join('\n') + '\n' : ''));
}

/**
 * Returns the code with a copy of an entry right after it: under a free key "<key> copy" in a
 * table, as the next item in an array.
 * @param {string} code - the code.
 * @param {object} model - the code as read.
 * @param {import('./datatree-core.js').TreeEdit} change - the change with entry.
 * @returns {TomlEditResult} the new code and path.
 * @throws {Error} for a dotted key inside { }.
 */
function getCodeWithDuplicate(code, model, change) {
    const entry = findInModel(model, change.entry.node)?.entry || change.entry;
    const box = entry.parent, isObject = box.type === 'object';
    const key = isObject ? getFreeKey(box, entry.key + ' copy') : entry.index + 1;
    const path = [...getPath(box), key];
    if (entry.mode === 'inline') {
        if (isObject && (!entry.member || entry.member.parts.length > 1)) throw new Error('This key is written as a dotted key inside { } - copy it in the code');
        const written = code.slice(entry.node.start, entry.node.end);
        return { code: getCodeWithInlineItem(code, box, null, isObject ? formatTomlKey(key) + ' = ' + written : written, entry.index + 1, true), path };
    }
    if (box.type === 'array' && box.aot) {
        const spans = mergeRanges(entry.spans);
        const text = spans.map(span => code.slice(span[0], span[1])).join('');
        return { code: getCodeWithSection(code, spans[spans.length - 1][1], text.replace(/\n*$/, '\n')), path };
    }
    return { code: getCodeWithCopy(code, model, entry, key), path };
}

/**
 * Returns the code with an entry swapped with the one before or after it.
 * @param {string} code - the code.
 * @param {object} model - the code as read.
 * @param {import('./datatree-core.js').TreeEdit} change - the change with entry and by (-1 up, 1 down).
 * @returns {TomlEditResult} the new code and path.
 * @throws {Error} at the first or last entry, or when the entries cannot be swapped in TOML.
 */
function getCodeWithMovedEntry(code, model, change) {
    const entry = findInModel(model, change.entry.node)?.entry || change.entry;
    const box = entry.parent, otherIndex = entry.index + change.by;
    if (otherIndex < 0 || otherIndex >= box.entries.length) throw new Error(change.by < 0 ? 'This entry is the first already' : 'This entry is the last already');
    const [first, second] = change.by < 0 ? [box.entries[otherIndex], entry] : [entry, box.entries[otherIndex]];
    const path = [...getPath(box), box.type === 'array' ? otherIndex : entry.key];
    if (first.mode === 'inline' && second.mode === 'inline') return { code: getCodeWithSwappedItems(code, box, first, second), path };
    return { code: getCodeWithSwappedPlaces(code, first, second), path };
}

/**
 * Returns the code with two items of { } or [ ] swapped.
 * @param {string} code - the code.
 * @param {object} box - the inline table or the array.
 * @param {object} first - the entry that comes first.
 * @param {object} second - the entry after it.
 * @returns {string} the new code.
 * @throws {Error} for a dotted key inside { }.
 */
function getCodeWithSwappedItems(code, box, first, second) {
    if (box.type !== 'object') return getSwappedCode(code, [first.node.start, first.node.end], [second.node.start, second.node.end]);
    if (!first.member || !second.member || first.member.parts.length > 1 || second.member.parts.length > 1) throw new Error('A dotted key inside { } - move it in the code');
    return getSwappedCode(code, [first.member.start, first.member.end], [second.member.start, second.member.end]);
}

/**
 * Returns the code with two entries of lines or sections swapped: each must be written in one
 * place, and keys with a value cannot move past a table. Sections swap their own text only
 * (the empty lines between them stay).
 * @param {string} code - the code.
 * @param {object} first - the entry that comes first.
 * @param {object} second - the entry after it.
 * @returns {string} the new code.
 * @throws {Error} when the entries cannot be swapped in TOML.
 */
function getCodeWithSwappedPlaces(code, first, second) {
    const firstSpans = mergeLooseRanges(code, first.spans || []), secondSpans = mergeLooseRanges(code, second.spans || []);
    if (firstSpans.length !== 1 || secondSpans.length !== 1 || isLineAndSection(first) || isLineAndSection(second)) throw new Error(DIFFERENT_PLACES);
    if (getPlaceKind(first) !== getPlaceKind(second)) throw new Error('In TOML the keys with a value stand above the tables - this entry cannot move past a table');
    if (first.mode === 'line' && first.line && second.line && (first.line[0] !== firstSpans[0][0] || second.line[0] !== secondSpans[0][0])) throw new Error(DIFFERENT_PLACES);
    const firstRange = [firstSpans[0][0], first.mode === 'line' ? firstSpans[0][1] : getPositionAfterLineBreak(code, getTrimmedEnd(code, firstSpans[0][1]))];
    const secondRange = [secondSpans[0][0], second.mode === 'line' ? secondSpans[0][1] : getPositionAfterLineBreak(code, getTrimmedEnd(code, secondSpans[0][1]))];
    return getSwappedCode(code, firstRange, secondRange, true);
}

/**
 * Tells whether an entry is written both in lines and in sections.
 * @param {object} entry - the entry.
 * @returns {boolean} true when it has both.
 */
function isLineAndSection(entry) {
    return !!(entry.lineSpans && entry.lineSpans.length && entry.secSpans && entry.secSpans.length);
}

/**
 * Returns whether an entry is written in lines or in sections.
 * @param {object} entry - the entry.
 * @returns {string} "line" or "section".
 */
function getPlaceKind(entry) {
    return entry.lineSpans && entry.lineSpans.length ? 'line' : 'section';
}

/**
 * Returns a position moved past the line break that follows it.
 * @param {string} code - the code.
 * @param {number} position - the position.
 * @returns {number} the position after "\n", or the position itself.
 */
function getPositionAfterLineBreak(code, position) {
    return code[position] === '\n' ? position + 1 : position;
}

/**
 * Returns the code without an entry; the entry after it (or before it) is selected. A table
 * or array of tables that existed only through the entry stays, empty.
 * @param {string} code - the code.
 * @param {object} model - the code as read.
 * @param {import('./datatree-core.js').TreeEdit} change - the change with entry.
 * @returns {TomlEditResult} the new code and path.
 * @throws {Error} for a dotted key inside { }.
 */
function getCodeWithoutEntry(code, model, change) {
    const entry = findInModel(model, change.entry.node)?.entry || change.entry;
    const box = entry.parent, count = box.entries.length;
    const next = count === 1 ? [] : box.type === 'array' ? [Math.min(entry.index, count - 2)] : [box.entries[entry.index + 1 < count ? entry.index + 1 : entry.index - 1].key];
    const path = [...getPath(box), ...next];
    if (entry.mode === 'inline') {
        if (box.type === 'object' && (!entry.member || entry.member.parts.length > 1 || entry.members.length > 1)) throw new Error('This key is written as a dotted key inside { } - remove it in the code');
        return { code: getCodeWithoutInlineItem(code, box, entry), path };
    }
    let result = getCodeWithoutSpans(code, entry);
    if (count === 1 && box.entry && !box.headers && box.type === 'object' && !box.inline) result = getCodeWithEmptyTable(result, entry, box);
    if (box.type === 'array' && box.aot && count === 1) result = getCodeWithEmptyArray(result, entry, box);
    return { code: result, path };
}

/**
 * Returns the code with a table that existed only through a removed entry written back, empty:
 * as "key = {}" where dotted keys made it, else as a [header].
 * @param {string} code - the code without the entry.
 * @param {object} entry - the removed entry.
 * @param {object} box - its table.
 * @returns {string} the new code.
 */
function getCodeWithEmptyTable(code, entry, box) {
    if (getNodeAtPath(readTomlTemplate(code).docs[0].root, getPath(box))) return code;
    const at = getLineStart(code, Math.min(mergeRanges(entry.spans)[0][0], code.length));
    if (isDottedLinesOnly(entry)) {
        const relativePath = getPath(box).slice(getPath(getSectionTable(box)).length);
        return getSpliced(code, at, at, `${getHeaderText(relativePath)} = {}\n`);
    }
    return getSpliced(code, at, at, `[${getHeaderText(getPath(box))}]\n`);
}

/**
 * Returns the code with an array of tables whose last table was removed written back as an
 * empty array.
 * @param {string} code - the code without the table.
 * @param {object} entry - the removed table's entry.
 * @param {object} box - the array of tables.
 * @returns {string} the new code.
 */
function getCodeWithEmptyArray(code, entry, box) {
    if (getNodeAtPath(readTomlTemplate(code).docs[0].root, getPath(box))) return code;
    return getCodeWithLineIn(code, getPath(box.entry.parent), box.entry.key, '[]', getLineStart(code, Math.min(mergeRanges(entry.spans)[0][0], code.length)));
}

/**
 * Returns the code with the keys of a table added to the root table (&mode=add): a key that is
 * there gets the new value, null is left out; every template tag outside the changed values stays.
 * @param {string} code - the code.
 * @param {*} data - the data to add.
 * @returns {string} the new code.
 * @throws {Error} when the data is no table, the code has a syntax error, or a change would change a template tag.
 */
export function mergeTomlData(code, data) {
    if (!isPlainObject(data)) throw new Error('Only a table (an object) can be added to a TOML document');
    let result = code;
    for (const key of Object.keys(data)) {
        const model = readTomlTemplate(result);
        if (model.broken) throw new Error('The document has a syntax error - fix it first');
        const root = model.docs[0].root;
        const entry = root.entries.find(item => item.key === key);
        if (data[key] === null || data[key] === undefined) continue;
        const change = entry ? { kind: 'value', node: entry.node, value: data[key] } : { kind: 'add', box: root, key, value: data[key] };
        const code = editTomlCode(result, change).code;
        checkTemplateEdit(result, change, code);
        result = code;
    }
    return result;
}
