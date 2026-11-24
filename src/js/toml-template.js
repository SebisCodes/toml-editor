/**
 * The roles of template placeholders in TOML, for the data tree (datatree-template.js): for every
 * tag, what it stands for at its place in the code.
 *
 * - "text": inside a string (basic, literal, multi-line) or a comment; it stays as written.
 * - "value": a placeholder where a value stands (`port = {{port}}`, an entry of an array, a value
 *   in an inline table).
 * - "key": a placeholder in a key (`{{k}} = 1`, `a.{{k}} = 1`, `[servers.{{name}}]`, a key in an
 *   inline table).
 * - "section": a section tag or a tag with a sign outside the syntax outside text; it reads as
 *   spaces, so the text between the tags of a section counts once.
 *
 * findTomlTagPlaces reads the code once, keeping the place it stands in: the key part of a line,
 * a [header], the value part, and the arrays and inline tables open there, and the kind of string
 * or comment a tag of the role text stands in. writeTomlFill writes an example for the place of a
 * tag in the example view (datatree-examples.js). readTomlTemplate is the reader the TOML edits
 * use: the code read with its placeholders as the data tree reads them.
 */

import { parseToml } from './toml-read.js?v=3';
import { readTemplateCode } from './datatree.js?v=13';
import { TemplateExpansionError } from './template-expansion.js?v=2';

/** A line break in any form. */
const LINE_BREAK = /\r\n|\r|\n/g;

/**
 * One open array or inline table.
 * @typedef {object} TomlBracket
 * @property {string} type - 'array' or 'table'.
 * @property {string} part - for an inline table: 'key' before its =, 'value' after it.
 */

/**
 * Where the reader stands in the code.
 * @typedef {object} TomlPlace
 * @property {string} linePart - outside brackets: 'key', 'header', 'value' or 'rest' (after a header).
 * @property {TomlBracket[]} brackets - the open arrays and inline tables, innermost last.
 */

/**
 * Reads TOML into a model; with a template syntax set, the placeholders read as the data tree
 * reads them (datatree-template.js).
 * @param {string} code - the code.
 * @returns {DataModel} the model.
 */
export function readTomlTemplate(code) {
    return readTemplateCode(code, findTomlTagRoles, parseToml);
}

/**
 * Returns the role of every tag of a TOML text.
 * @param {string} src - the code.
 * @param {import('./template-tags.js').TemplateTag[]} tags - the tags of the code, in order.
 * @returns {string[]} the role of each tag: text, value, key or section.
 */
export function findTomlTagRoles(src, tags) {
    return findTomlTagPlaces(src, tags).map(place => place.role);
}

/**
 * Returns the place of every tag of a TOML text: its role and, for text, the kind of text it
 * stands in: "basic", "literal", "multi-basic", "multi-literal" (strings) or "comment".
 * @param {string} src - the code.
 * @param {import('./template-tags.js').TemplateTag[]} tags - the tags of the code, in order.
 * @returns {import('./datatree-template-roles.js').TagPlace[]} the place of each tag.
 */
export function findTomlTagPlaces(src, tags) {
    const indexByStart = new Map(tags.map((tag, index) => [tag.start, index]));
    const places = tags.map(() => ({ role: 'text', style: 'comment' }));
    const strings = [];
    const place = { linePart: 'key', brackets: [] };
    let index = 0;
    while (index < src.length) {
        const tagIndex = indexByStart.get(index);
        if (tagIndex !== undefined) {
            places[tagIndex] = { role: getTomlTagRole(tags[tagIndex], getCurrentPart(place)), style: null };
            index = tags[tagIndex].end;
            continue;
        }
        const next = moveOverTomlCharacter(src, index, place);
        if (src[index] === '"' || src[index] === "'") strings.push({ start: index, end: next, style: getTomlStringStyle(src, index) });
        index = next;
    }
    for (const string of strings) setStringStyle(places, tags, string);
    return places;
}

/**
 * Returns the kind of a TOML string by its opening quotes.
 * @param {string} src - the code.
 * @param {number} start - the offset of the first quote.
 * @returns {string} "basic", "literal", "multi-basic" or "multi-literal".
 */
function getTomlStringStyle(src, start) {
    const quote = src[start];
    const kind = quote === '"' ? 'basic' : 'literal';
    return src.startsWith(quote.repeat(3), start) ? 'multi-' + kind : kind;
}

/**
 * A string of the code with its kind.
 * @typedef {object} TomlString
 * @property {number} start - the offset of its first quote.
 * @property {number} end - the offset after it.
 * @property {string} style - "basic", "literal", "multi-basic" or "multi-literal".
 */

/**
 * Gives the tags inside a string the string's kind.
 * @param {import('./datatree-template-roles.js').TagPlace[]} places - the places of the tags; changed in place.
 * @param {import('./template-tags.js').TemplateTag[]} tags - the tags, in order.
 * @param {TomlString} string - the string's place and kind.
 * @returns {void} nothing; the places of the tags in the string get its kind.
 */
function setStringStyle(places, tags, string) {
    tags.forEach((tag, index) => {
        if (tag.start > string.start && tag.start < string.end) places[index] = { role: 'text', style: string.style, stringStart: /^multi/.test(string.style) && tag.start === string.start + 3 };
    });
}

/**
 * Returns the role of a tag at a part of the code.
 * @param {import('./template-tags.js').TemplateTag} tag - the tag.
 * @param {string} part - 'key', 'header', 'value' or 'rest'.
 * @returns {string} value, key or section.
 */
function getTomlTagRole(tag, part) {
    if (tag.kind !== 'value') return 'section';
    return part === 'key' || part === 'header' ? 'key' : 'value';
}

/**
 * Returns the part of the code the reader stands in.
 * @param {TomlPlace} place - where the reader stands.
 * @returns {string} 'key', 'header', 'value' or 'rest'.
 */
function getCurrentPart(place) {
    const inner = place.brackets[place.brackets.length - 1];
    if (!inner) return place.linePart;
    return inner.type === 'array' ? 'value' : inner.part;
}

/**
 * Moves the reader over one character, a string or a comment, and notes where it stands then.
 * @param {string} src - the code.
 * @param {number} index - the offset of the character.
 * @param {TomlPlace} place - where the reader stands; changed in place.
 * @returns {number} the offset after what was read.
 */
function moveOverTomlCharacter(src, index, place) {
    const char = src[index];
    if (char === '#') { const end = src.indexOf('\n', index); return end < 0 ? src.length : end; }
    if (char === '"' || char === "'") return getTomlStringEnd(src, index);
    if (char === '\n') { if (!place.brackets.length) place.linePart = 'key'; return index + 1; }
    applyTomlPunctuation(char, place);
    return index + 1;
}

/**
 * Notes what a punctuation character changes: = starts a value, a bracket opens or closes an
 * array, an inline table or a header, a comma in an inline table starts the next key.
 * @param {string} char - the character.
 * @param {TomlPlace} place - where the reader stands; changed in place.
 * @returns {void}
 */
function applyTomlPunctuation(char, place) {
    const inner = place.brackets[place.brackets.length - 1];
    const part = getCurrentPart(place);
    if (char === '=' && part === 'key') { if (inner) inner.part = 'value'; else place.linePart = 'value'; }
    else if (char === '[' && part === 'key' && !inner) place.linePart = 'header';
    else if (char === ']' && part === 'header') place.linePart = 'rest';
    else if (char === '[' && part === 'value') place.brackets.push({ type: 'array', part: 'value' });
    else if (char === '{' && part === 'value') place.brackets.push({ type: 'table', part: 'key' });
    else if ((char === ']' && inner?.type === 'array') || (char === '}' && inner?.type === 'table')) place.brackets.pop();
    else if (char === ',' && inner?.type === 'table') inner.part = 'key';
}

/**
 * Returns where a string that starts at an offset ends: basic and literal strings end with their
 * quote or the line, multi-line strings with three quotes (and up to two quotes more).
 * @param {string} src - the code.
 * @param {number} start - the offset of the first quote.
 * @returns {number} the offset after the string.
 */
function getTomlStringEnd(src, start) {
    const quote = src[start];
    const isBasic = quote === '"';
    const isMultiLine = src.startsWith(quote.repeat(3), start);
    let index = start + (isMultiLine ? 3 : 1);
    while (index < src.length) {
        const char = src[index];
        if (char === '\\' && isBasic) { index += 2; continue; }
        if (!isMultiLine && (char === quote || char === '\n')) return char === quote ? index + 1 : index;
        if (isMultiLine && src.startsWith(quote.repeat(3), index)) return getClosingQuotesEnd(src, index + 3, quote);
        index++;
    }
    return src.length;
}

/**
 * Returns the end of the closing quotes of a multi-line string, which may hold up to two quotes more.
 * @param {string} src - the code.
 * @param {number} index - the offset after three closing quotes.
 * @param {string} quote - the quote character.
 * @returns {number} the offset after the last closing quote.
 */
function getClosingQuotesEnd(src, index, quote) {
    let end = index;
    while (end < index + 2 && src[end] === quote) end++;
    return end;
}

/**
 * Writes an example for the place of a value tag in TOML (datatree-examples.js FillWriter): a bare
 * value as a TOML literal when it reads as a number, boolean, date or string there, else as a basic
 * string; a key as a basic string; text in the escaping of its string (a multi-line basic string
 * takes the escapes of a basic one, so its line breaks are escapes). A literal string has no
 * escaping: the example goes in as it is, and one it cannot hold stops the filling; a multi-line
 * literal string whose example starts with a line break right after its opening quotes gets one
 * line break more, since TOML drops the line break that follows them.
 * @param {string} text - the example text, the picture's name or the label in brackets.
 * @param {import('./datatree-template-roles.js').TagPlace} place - the tag's role and kind of text.
 * @param {string} indent - the spaces and tabs the tag's line starts with.
 * @param {string} kind - "value" for an example text; "image" and "label" for text that is always a string.
 * @returns {string} the example as TOML text.
 * @throws {TemplateExpansionError} when a literal string cannot hold the example: a quote or a line
 *     break in a one-line literal string, three quotes in a multi-line one.
 */
export function writeTomlFill(text, place, indent, kind) {
    if (place.role === 'value' && place.bare !== false) return kind === 'value' && isTomlScalarLiteral(text) ? text : JSON.stringify(text);
    if (place.role === 'key') return JSON.stringify(text);
    if (place.style === 'basic' || place.style === 'multi-basic') return JSON.stringify(text).slice(1, -1);
    if (place.style === 'multi-literal') return (place.stringStart && /^[\r\n]/.test(text) ? '\n' : '') + checkLiteralText(text, /'''/);
    if (place.style === 'literal') return checkLiteralText(text, /['\r\n]/);
    return text.replace(LINE_BREAK, ' ');
}

/**
 * Returns an example for a literal string, which takes text as it is.
 * @param {string} text - the example.
 * @param {RegExp} end - what would end the string early.
 * @returns {string} the example as it is.
 * @throws {TemplateExpansionError} when the example holds what would end the string.
 */
function checkLiteralText(text, end) {
    if (end.test(text)) throw new TemplateExpansionError('An example ends a TOML literal string');
    return text;
}

/**
 * Tells whether a text is one TOML value that is no array or table: a string, number, boolean or
 * date, on one line, without a comment.
 * @param {string} text - the text.
 * @returns {boolean} true when TOML reads `key = <text>` as one such value without a problem.
 */
export function isTomlScalarLiteral(text) {
    if (!text || text !== text.trim() || /[\r\n]/.test(text)) return false;
    const model = parseToml(`key = ${text}\n`);
    const entries = model.docs[0].root.entries;
    if (model.broken || model.comments || model.problems.some(problem => problem.kind === 'error') || entries.length !== 1) return false;
    const node = entries[0].node;
    return node.type !== 'object' && node.type !== 'array';
}
