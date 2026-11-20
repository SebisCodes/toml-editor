/**
 * Format: one layout for a whole TOML document, comments kept. key = value with one space
 * around "=", headers and keys without indentation, one empty line before every table header,
 * at most one empty line in a row, inline tables as { a = 1 }, no spaces at the ends of lines.
 * Values are rewritten only where that cannot change them (spacing inside inline tables and
 * one-line arrays); strings over several lines and the lines of a multi-line array keep their
 * layout.
 *
 * formatToml() runs these steps:
 *   1. read the code (with \n line breaks);
 *   2. write the inline tables and one-line arrays anew, the outermost ones only;
 *   3. lay out every line: headers, comments and key = value lines.
 */

import { parseToml, isContainerNode, isTableNode } from './toml-read.js?v=3';

/**
 * Returns a TOML document in one layout (the flow in the header).
 * @param {string} text - the code.
 * @returns {string} the formatted code, ending with one line break.
 * @throws {Error} when the code has a syntax error.
 */
export function formatToml(text) {
    const model = parseToml(text);
    if (model.broken) throw new Error('The document has a syntax error - fix it first');
    const source = text.replace(/\r\n/g, '\n');
    const sourceModel = source === text ? model : parseToml(source);
    const respaced = getRespacedInlineValues(source, sourceModel);
    return getFormattedLines(respaced, parseToml(respaced)).join('\n') + '\n';
}

/**
 * Returns the code with the inline tables and one-line arrays written anew (the outermost
 * ones, those without comments and line breaks).
 * @param {string} source - the code with \n line breaks.
 * @param {import('./datatree-core.js').DataModel} model - the code as read.
 * @returns {string} the code.
 */
function getRespacedInlineValues(source, model) {
    const edits = [];
    addInlineRewrites(source, model.docs[0].root, edits);
    edits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const outer = [];
    for (const edit of edits) if (!outer.length || edit[0] >= outer[outer.length - 1][1]) outer.push(edit);
    let code = source;
    for (const [start, end, text] of outer.reverse()) code = code.slice(0, start) + text + code.slice(end);
    return code;
}

/**
 * Collects the rewrite of every inline value on one line without comments, the innermost first.
 * @param {string} source - the code.
 * @param {object} node - the node to go through.
 * @param {Array<[number, number, string]>} edits - the collector: start, end and new text of each rewrite.
 * @returns {void}
 */
function addInlineRewrites(source, node, edits) {
    if (!isContainerNode(node)) return;
    for (const entry of node.entries) addInlineRewrites(source, entry.node, edits);
    const written = source.slice(node.start, node.end);
    if (node.inline && !written.includes('\n') && !written.includes('#')) edits.push([node.start, node.end, getInlineText(source, node)]);
}

/**
 * Returns the ranges of the strings over several lines, whose lines stay as they are.
 * @param {object} node - the node to go through.
 * @returns {Array<number[]>} start and end of each such string.
 */
function getMultiLineStrings(node) {
    const ranges = [];
    addMultiLineStrings(node, ranges);
    return ranges;
}

/**
 * Adds the range of every string over several lines in a node and below it to a collector.
 * @param {object} node - the node to go through.
 * @param {Array<number[]>} ranges - the collector: start and end of each such string.
 * @returns {void}
 */
function addMultiLineStrings(node, ranges) {
    if (!node) return;
    if (node.type === 'string' && /^multi/.test(node.style || '')) ranges.push([node.start, node.end]);
    if (isContainerNode(node)) for (const entry of node.entries) addMultiLineStrings(entry.node, ranges);
}

/**
 * Returns the lines of the code in the layout of Format, without empty lines at the start and end.
 * @param {string} code - the code.
 * @param {import('./datatree-core.js').DataModel} model - the code as read.
 * @returns {string[]} the lines.
 */
function getFormattedLines(code, model) {
    const strings = getMultiLineStrings(model.docs[0].root);
    const lines = [];
    let position = 0, blankLines = 0;
    for (const line of code.split('\n')) {
        const lineStart = position;
        position += line.length + 1;
        if (strings.some(([start, end]) => lineStart > start && lineStart < end)) { lines.push(line); blankLines = 0; continue; }
        const trimmed = line.replace(/[ \t]+$/, '');
        if (!trimmed.trim()) { blankLines++; if (blankLines <= 1 && lines.length) lines.push(''); continue; }
        const indent = trimmed.match(/^[ \t]*/)[0];
        if (isInMultiLineArray(model, lineStart + indent.length)) lines.push(line.replace(/[ \t]+$/, ''));
        else addFormattedLine(lines, trimmed.slice(indent.length));
        blankLines = 0;
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    while (lines.length && lines[0] === '') lines.shift();
    return lines;
}

/**
 * Adds one line without its indentation: a header (with an empty line before it unless a
 * comment or an empty line is there), a comment, or a key = value line with one space around "=".
 * @param {string[]} lines - the lines so far; the line is added to them.
 * @param {string} body - the line without indentation and trailing spaces.
 * @returns {void}
 */
function addFormattedLine(lines, body) {
    if (/^\[/.test(body)) {
        if (lines.length && lines[lines.length - 1] !== '' && !/^#/.test(lines[lines.length - 1].trim())) lines.push('');
        lines.push(body.replace(/^\[\[\s*(.*?)\s*\]\]/, '[[$1]]').replace(/^\[(?!\[)\s*(.*?)\s*\]/, '[$1]'));
    } else if (/^#/.test(body)) lines.push(body);
    else lines.push(getSpacedAssignment(body));
}

/**
 * Tells whether a position lies inside a multi-line array (its continuation lines keep their layout).
 * @param {import('./datatree-core.js').DataModel} model - the code as read.
 * @param {number} position - the position.
 * @returns {boolean} true inside an inline array that holds the position.
 */
function isInMultiLineArray(model, position) {
    /**
     * Tells whether the position is inside an inline array in a node or below it.
     * @param {object} node - the node.
     * @returns {boolean} true when it is.
     */
    const isInside = node => {
        if (!isContainerNode(node)) return false;
        if (node.inline && node.type === 'array' && position > node.start && position < node.end) return true;
        return node.entries.some(entry => isInside(entry.node));
    };
    return isInside(model.docs[0].root);
}

/**
 * Returns "key=value" as "key = value": the first "=" outside quotes gets one space on each
 * side, and the dots of a dotted key lose their spaces.
 * @param {string} line - the line.
 * @returns {string} the line, as it is when it has no "=" outside quotes.
 */
function getSpacedAssignment(line) {
    let quote = '';
    for (let k = 0; k < line.length; k++) {
        const character = line[k];
        if (quote) { if (character === '\\' && quote === '"') k++; else if (character === quote) quote = ''; continue; }
        if (character === '"' || character === "'") { quote = character; continue; }
        if (character === '=') return line.slice(0, k).replace(/[ \t]+$/, '').replace(/[ \t]*\.[ \t]*/g, '.') + ' = ' + line.slice(k + 1).replace(/^[ \t]+/, '');
    }
    return line;
}

/**
 * Returns an inline table or array written anew: [a, b] and { a = 1, b = 2 }, the values as
 * they are written (nested inline values written anew too).
 * @param {string} source - the code.
 * @param {object} node - the inline table or array.
 * @returns {string} the new text.
 */
function getInlineText(source, node) {
    if (node.type === 'array') return node.entries.length ? `[${node.entries.map(entry => getWrittenValueText(source, entry.node)).join(', ')}]` : '[]';
    if (!node.members.length) return '{}';
    return `{ ${node.members.map(member => `${member.parts.map(part => source.slice(part.start, part.end)).join('.')} = ${getMemberValueText(source, node, member)}`).join(', ')} }`;
}

/**
 * Returns a value as written, an inline value written anew.
 * @param {string} source - the code.
 * @param {object} node - the value.
 * @returns {string} the text.
 */
function getWrittenValueText(source, node) {
    return isContainerNode(node) && node.inline ? getInlineText(source, node) : source.slice(node.start, node.end);
}

/**
 * Returns the value of a member of an inline table: the node whose entry the member writes,
 * or the text after its "=".
 * @param {string} source - the code.
 * @param {object} table - the inline table.
 * @param {object} member - the member.
 * @returns {string} the text of the value.
 */
function getMemberValueText(source, table, member) {
    const found = findMemberNode(table, member);
    return found ? getWrittenValueText(source, found) : source.slice(member.parts[member.parts.length - 1].end, member.end).replace(/^\s*=\s*/, '');
}

/**
 * Returns the node a member of an inline table writes, looking into the tables its dotted keys make.
 * @param {object} table - the table to look in.
 * @param {object} member - the member.
 * @returns {object|null} the node, null when none is found.
 */
function findMemberNode(table, member) {
    if (!table || !table.entries) return null;
    for (const entry of table.entries) {
        if (entry.member === member) return entry.node;
        const isDottedTable = isTableNode(entry.node) && (entry.node.inline === undefined || (entry.mode === 'inline' && entry.node.dotted));
        const found = isDottedTable ? findMemberNode(entry.node, member) : null;
        if (found) return found;
    }
    return null;
}
