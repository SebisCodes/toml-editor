/**
 * The places of the TOML code that a change from the tree writes to: where a new key = value
 * line or section goes, and the code with a line, a section, an inline item or a copy added,
 * with an entry's places removed, or with two places swapped. Every function returns new code
 * and leaves the code it gets as it is; toml-edit.js picks the right one for each change.
 */

import { getPath, getNodeAtPath } from './datatree.js?v=12';
import { parseToml, CONTROL_CHARACTER } from './toml-read.js?v=3';
import { formatTomlKey, formatInlineValue, formatArray, isDateTime, getHeaderText, getTableLines, isTableArray, isHeaderNeeded } from './toml-write.js?v=3';
import { getLineStart, getTrimmedEnd, mergeRanges, getSpliced } from './toml-text.js?v=2';


/**
 * Where new key = value lines of a table go.
 * @typedef {object} LinePlace
 * @property {number} at - the position.
 * @property {Array<string|number>} prefix - the keys written before the new key (a dotted key).
 * @property {boolean} [afterLine] - right after a line of the table.
 * @property {boolean} [beforeHeader] - before the first header (the root without lines).
 * @property {Array<string|number>} [newHeader] - the path of a header the table gets first.
 */

/**
 * Returns the text of a value for a place that takes one value (after = or inside [ ] / { }):
 * a date stays a date, a string in a literal string stays literal where it can, an array may
 * take several lines.
 * @param {*} value - the value.
 * @param {object} [old] - the node of the value it replaces.
 * @returns {string} the TOML text.
 */
export function getValueText(value, old) {
    if (old && old.style === 'datetime' && isDateTime(value)) return value;
    if (typeof value === 'string' && old && old.type === 'string' && old.style === 'literal' && !/['\n\r]/.test(value) && !CONTROL_CHARACTER.test(value)) return `'${value}'`;
    if (Array.isArray(value)) return formatArray(value, new Set());
    return formatInlineValue(value);
}

/**
 * Stops a change to null, which TOML cannot hold.
 * @param {*} value - the new value.
 * @returns {void}
 * @throws {Error} when the value is null or undefined.
 */
export function checkNotNull(value) {
    if (value === null || value === undefined) throw new Error('TOML has no empty value (null) - choose text, a number, true / false, a date, a table or an array');
}

/**
 * Returns where the next table header (with the comments above it) starts at or after a position.
 * @param {string} code - the code.
 * @param {object} model - the code as read.
 * @param {number} position - the position.
 * @returns {number} the start of that section, or the end of the code.
 */
export function getSectionBoundary(code, model, position) {
    const section = model.sections.find(item => item.lead >= position || item.start >= position);
    return section ? section.lead : code.length;
}

/**
 * Returns the table whose section holds the dotted keys of a table.
 * @param {object} table - a table made by dotted keys.
 * @returns {object} the table (or array of tables) that has the section.
 */
export function getSectionTable(table) {
    let section = table.entry.parent;
    while (section.entry && section.dotted && !section.headers) section = section.entry.parent;
    return section;
}

/**
 * Returns where new key = value lines of a table go and with which key prefix.
 * @param {string} code - the code.
 * @param {object} model - the code as read.
 * @param {object} table - the table.
 * @returns {LinePlace} the place.
 */
function getLinePlace(code, model, table) {
    if (!table.entry) {
        // the root: after its last line, otherwise before the first header (or at the end)
        const last = table.lines[table.lines.length - 1];
        if (last) return { at: last.end, prefix: [], afterLine: true };
        const first = model.sections[0];
        return { at: first ? first.lead : code.length, prefix: [], beforeHeader: !!first };
    }
    if (table.headers && table.headers.length) {
        const section = table.headers[0];
        const own = table.lines.filter(line => line.start >= section.start && line.start < section.span[1]);
        const last = own[own.length - 1];
        return { at: last ? last.end : section.lineEnd, prefix: [], afterLine: true };
    }
    if (table.dotted && !table.frozen) {
        // a table made by dotted keys: one more dotted key in the same section, after its last line
        const lines = table.entry.lineSpans;
        const last = lines[lines.length - 1];
        return { at: last[1], prefix: getPath(table).slice(getPath(getSectionTable(table)).length), afterLine: true };
    }
    // a table only named by headers below it: give it its own header
    return { at: table.entry.spans[0][0], prefix: [], newHeader: getPath(table) };
}

/**
 * Returns the line break a text needs before it at a position: none at the start of a line.
 * @param {string} code - the code.
 * @param {number} at - the position.
 * @returns {string} "\n" or "".
 */
function getLineBreakBefore(code, at) {
    return at > 0 && code[at - 1] !== '\n' ? '\n' : '';
}

/**
 * Returns the code with key = value as a new line of a table.
 * @param {string} code - the code.
 * @param {object} model - the code as read.
 * @param {object} table - the table.
 * @param {string|number} key - the new key.
 * @param {string} text - the value as TOML.
 * @returns {string} the new code.
 */
export function getCodeWithLine(code, model, table, key, text) {
    const place = getLinePlace(code, model, table);
    const keyText = [...place.prefix, key].map(formatTomlKey).join('.');
    if (place.newHeader) return getSpliced(code, place.at, place.at, `[${getHeaderText(place.newHeader)}]\n${keyText} = ${text}\n\n`);
    if (place.beforeHeader) return getSpliced(code, place.at, place.at, `${keyText} = ${text}\n\n`);
    return getSpliced(code, place.at, place.at, getLineBreakBefore(code, place.at) + `${keyText} = ${text}\n`);
}

/**
 * Returns the code with key = value in the table at a path; when that table is gone (it existed
 * only through what was removed), it comes back as a [header] at a header boundary.
 * @param {string} code - the code.
 * @param {Array<string|number>} path - the path of the table.
 * @param {string|number} key - the key.
 * @param {string} text - the value as TOML.
 * @param {number} at - the header boundary for a table that comes back.
 * @returns {string} the new code.
 */
export function getCodeWithLineIn(code, path, key, text, at) {
    const model = parseToml(code);
    const table = getNodeAtPath(model.docs[0].root, path);
    if (table && table.type === 'object') return getCodeWithLine(code, model, table, key, text);
    return getCodeWithSection(code, at, `[${getHeaderText(path)}]\n${formatTomlKey(key)} = ${text}\n`);
}

/**
 * Returns the code with a new section at a header boundary, with one empty line before and
 * after it.
 * @param {string} code - the code.
 * @param {number} at - the boundary.
 * @param {string} text - the section, ending with a line break.
 * @returns {string} the new code.
 */
export function getCodeWithSection(code, at, text) {
    let before = code.slice(0, at), section = text;
    const after = code.slice(at);
    if (before && !before.endsWith('\n')) before += '\n';
    if (before.trim() && !before.endsWith('\n\n')) before += '\n';
    if (after.trim() && !section.endsWith('\n\n')) section += '\n';
    return before + section + after;
}

/**
 * Returns the sections that write a table or an array of tables at a path.
 * @param {*} value - a table or an array of tables.
 * @param {Array<string|number>} path - its path.
 * @returns {string} the sections, ending with a line break.
 */
function getSectionsText(value, path) {
    const lost = new Set();
    if (isTableArray(value)) return value.map(item => [`[[${getHeaderText(path)}]]`, ...getTableLines(item, path, lost)].join('\n')).join('\n\n') + '\n';
    const body = getTableLines(value, path, lost);
    return (isHeaderNeeded(value) ? [`[${getHeaderText(path)}]`, ...body] : body).join('\n') + '\n';
}

/**
 * Returns the code with a table (or array of tables) as sections under a table, after the
 * table's own places at the next header (sections cannot cut into a section).
 * @param {string} code - the code.
 * @param {object} model - the code as read.
 * @param {object} box - the table it goes into.
 * @param {string} key - its key.
 * @param {*} value - the table or array of tables.
 * @returns {string} the new code.
 */
export function getCodeWithSections(code, model, box, key, value) {
    const text = getSectionsText(value, [...getPath(box), key]);
    const ends = box.entry ? mergeRanges(box.entry.spans).map(span => span[1]) : [code.length];
    const at = box.entry ? getSectionBoundary(code, model, getTrimmedEnd(code, Math.max(...ends))) : code.length;
    return getCodeWithSection(code, at, text);
}

/**
 * Returns the code with new content for a table written in sections (or for a value line that
 * becomes sections): its places go, the new sections come where the first one was.
 * @param {string} code - the code.
 * @param {object} entry - the entry that gets the content.
 * @param {*} value - the new table or array of tables.
 * @param {Array<string|number>} path - the path the change selects.
 * @returns {{code: string, path: Array<string|number>}} the new code and the path.
 */
export function getCodeWithReplacedSections(code, entry, value, path) {
    const first = mergeRanges(entry.spans)[0][0];
    const removed = getCodeWithoutSpans(code, entry);
    const model = parseToml(removed);
    const box = getNodeAtPath(model.docs[0].root, getPath(entry.parent)) || model.docs[0].root;
    // a line goes; the sections come at the next header after the table's other places
    if (entry.mode === 'line') return { code: getCodeWithSections(removed, model, box, entry.key, value), path };
    const at = getReplacementPlace(removed, model, first);
    const atBoundary = at === removed.length || model.sections.some(section => section.lead === at);
    if (!atBoundary && !entry.parent.aot) return { code: getCodeWithSections(removed, model, box, entry.key, value), path };
    const fullPath = [...getPath(entry.parent), entry.key];
    const text = entry.parent.aot ? [`[[${getHeaderText(fullPath)}]]`, ...getTableLines(value, fullPath, new Set())].join('\n') + '\n' : getSectionsText(value, fullPath);
    return { code: getCodeWithSection(removed, at, text), path };
}

/**
 * Returns where the sections of a replaced table go: at the header that follows the place of
 * its first section (removing the section may also take the empty line before it, so the place
 * can be inside the next line).
 * @param {string} code - the code without the table's places.
 * @param {object} model - that code as read.
 * @param {number} first - where the table's first place started.
 * @returns {number} the position.
 */
function getReplacementPlace(code, model, first) {
    const at = getLineStart(code, Math.min(first, code.length));
    const next = model.sections.find(section => section.lead >= at);
    if (next && !code.slice(at, next.lead).trim()) return next.lead;
    if (!next && !code.slice(at).trim()) return code.length;
    return at;
}

/**
 * Returns the code without the lines and sections of an entry; a section also takes the empty
 * line before it, so no gap of two lines stays.
 * @param {string} code - the code.
 * @param {object} entry - the entry.
 * @returns {string} the new code.
 */
export function getCodeWithoutSpans(code, entry) {
    let result = code;
    for (const [start, end] of mergeRanges(entry.spans || []).sort((a, b) => b[0] - a[0])) {
        let from = start;
        if (entry.mode !== 'line' && from > 1 && result[from - 1] === '\n' && result[from - 2] === '\n') from--;
        result = result.slice(0, from) + result.slice(end);
    }
    return result;
}

/**
 * Returns the code with two ranges swapped; as lines, both end with a line break so neither
 * runs into the next line.
 * @param {string} code - the code.
 * @param {number[]} first - one range.
 * @param {number[]} second - the other range.
 * @param {boolean} [lines] - true when the ranges are whole lines.
 * @returns {string} the new code.
 */
export function getSwappedCode(code, first, second, lines = false) {
    const [a, b] = first[0] < second[0] ? [first, second] : [second, first];
    let textA = code.slice(a[0], a[1]), textB = code.slice(b[0], b[1]);
    if (lines) {
        if (!textA.endsWith('\n')) textA += '\n';
        if (!textB.endsWith('\n')) { textB += '\n'; textA = textA.replace(/\n$/, ''); }
    }
    return code.slice(0, a[0]) + textB + code.slice(a[1], b[0]) + textA + code.slice(b[1]);
}

/**
 * Returns the code with a copy of an entry under another key, right after it: its lines after
 * its last line, its sections at the next header. The key is replaced at every place that names it.
 * @param {string} code - the code.
 * @param {object} model - the code as read.
 * @param {object} entry - the entry.
 * @param {string} key - the key of the copy.
 * @returns {string} the new code.
 */
export function getCodeWithCopy(code, model, entry, key) {
    const lines = mergeRanges(entry.lineSpans || []).map(range => getRenamedText(code, entry, range, key));
    const sections = mergeRanges(entry.secSpans || []).map(range => getRenamedText(code, entry, range, key));
    const inserts = [];
    if (lines.length) {
        const at = lines[lines.length - 1].end;
        inserts.push({ at, text: (code[at - 1] === '\n' || at === 0 ? '' : '\n') + lines.map(piece => piece.text.replace(/\n?$/, '\n')).join('') });
    }
    if (sections.length) {
        const at = getSectionBoundary(code, model, getTrimmedEnd(code, sections[sections.length - 1].end));
        inserts.push({ at, section: sections.map(piece => piece.text.replace(/\n*$/, '\n')).join('\n') });
    }
    let result = code;
    for (const insert of inserts.sort((a, b) => b.at - a.at)) result = insert.section ? getCodeWithSection(result, insert.at, insert.section) : getSpliced(result, insert.at, insert.at, insert.text);
    return result;
}

/**
 * Returns a range of the code with the entry's key replaced at each place in it.
 * @param {string} code - the code.
 * @param {object} entry - the entry.
 * @param {number[]} range - the range.
 * @param {string} key - the new key.
 * @returns {{end: number, text: string}} the end of the range and its text with the new key.
 */
function getRenamedText(code, entry, [start, end], key) {
    let text = code.slice(start, end);
    for (const [refStart, refEnd] of (entry.refs || []).filter(ref => ref[0] >= start && ref[1] <= end).sort((a, b) => b[0] - a[0])) text = text.slice(0, refStart - start) + formatTomlKey(key) + text.slice(refEnd - start);
    return { end, text };
}

/**
 * Returns the items of an inline table (its members) or of an array, with their places and commas.
 * @param {object} box - the inline table or the array.
 * @returns {Array<{start: number, end: number, comma: (number|undefined)}>} the items.
 */
function getInlineItems(box) {
    if (box.type === 'object') return box.members.map(member => ({ start: member.start, end: member.end, comma: member.comma }));
    return box.entries.map(entry => ({ start: entry.node.start, end: entry.node.end, comma: entry.comma }));
}

/**
 * Returns the code with a new item inside { } (one line) or [ ] at an index (the end when missing).
 * @param {string} code - the code.
 * @param {object} box - the inline table or the array.
 * @param {string|null} key - the key of a new member, null for an array item or a text written as it is.
 * @param {string} text - the value as TOML (or the whole member with raw).
 * @param {number} [at] - the index.
 * @param {boolean} [raw] - true when text is the whole member.
 * @returns {string} the new code.
 */
export function getCodeWithInlineItem(code, box, key, text, at, raw = false) {
    const itemText = key === null || raw ? text : `${formatTomlKey(key)} = ${text}`;
    const items = getInlineItems(box);
    const count = items.length;
    const index = Math.max(0, Math.min(at ?? count, count));
    if (!count) return getSpliced(code, box.start + 1, box.end - 1, box.type === 'object' ? ` ${itemText} ` : itemText);
    const multiLine = box.type === 'array' && code.slice(box.start, box.end).includes('\n');
    const indent = multiLine ? /^[ \t]*/.exec(code.slice(getLineStart(code, items[0].start)))[0] : '';
    if (index < count) { const position = items[index].start; return getSpliced(code, position, position, itemText + (multiLine ? ',\n' + indent : ', ')); }
    const last = items[count - 1];
    if (last.comma !== undefined) { const position = last.comma + 1; return getSpliced(code, position, position, (multiLine ? '\n' + indent : ' ') + itemText + (multiLine ? ',' : '')); }
    return getSpliced(code, last.end, last.end, (multiLine ? ',\n' + indent : ', ') + itemText);
}

/**
 * Returns the code without an item of { } or [ ]; a whole line of a multi-line array goes with
 * its line break.
 * @param {string} code - the code.
 * @param {object} box - the inline table or the array.
 * @param {object} entry - the entry to remove.
 * @returns {string} the new code.
 */
export function getCodeWithoutInlineItem(code, box, entry) {
    const items = getInlineItems(box);
    const index = box.type === 'object' ? box.members.indexOf(entry.member) : entry.index;
    const count = items.length, item = items[index];
    if (count === 1) return getSpliced(code, box.start + 1, box.end - 1, '');
    if (index < count - 1) {
        const to = items[index + 1].start;
        const lineStart = getLineStart(code, item.start);
        if (/^[ \t]*$/.test(code.slice(lineStart, item.start)) && /\n/.test(code.slice(item.end, to))) return getSpliced(code, lineStart, getLineStart(code, to), '');
        return getSpliced(code, item.start, to, '');
    }
    const previous = items[index - 1];
    const end = item.comma !== undefined ? item.comma + 1 : item.end;
    return getSpliced(code, previous.end, end, item.comma !== undefined ? ',' : '');
}
