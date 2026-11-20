/**
 * The TOML reader: reads TOML 1.0 into the model of datatree.js and keeps the place of every
 * key, value and table in the code. It stays one file because it is one parser: its steps share
 * the reader's position and the model it builds.
 *
 * A table can be written in several places ([a.b] headers, dotted keys a.b.c = 1), so every
 * entry also knows
 *   refs   the places of its key in the code (every header and dotted key that names it),
 *   spans  the parts of the code that belong to it (its lines and sections),
 *   mode   'line' (key = value), 'inline' (inside { } or [ ]), 'section' (a [header] or
 *          [[header]] table), 'implicit' (a table only named by other keys or headers).
 * The rules for defining a table twice are those of TOML 1.0 (as Python's tomllib). Dates and
 * times stay text (type string, style 'datetime', a tag with their kind).
 *
 * The reader builds the model as it reads: its read and add steps move the position and return
 * the nodes and entries they add to the model (a reader that consumes its input).
 *
 * parseToml() runs these steps:
 *   1. read the code line by line: comments, [headers] and [[headers]], key = value lines;
 *      the first error stops the reading and is kept as a problem;
 *   2. give every section its span (with the comments right above its header);
 *   3. let every table cover the spans of its places;
 *   4. return the model with the problems and at(), which finds the value at a position.
 */

import { getLineStart, getLineEnd, getTrimmedEnd, mergeRanges } from './toml-text.js?v=2';

/** A bare key: letters, digits, - and _. */
const BARE_KEY = /[A-Za-z0-9_-]+/y;
/** Control characters that a string or comment may not hold as they are (a tab may). */
export const CONTROL_CHARACTER = /[\u0000-\u0008\u000a-\u001f\u007f]/;
/** The one-letter escapes of a basic string. */
const ESCAPES = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
const DATE = /(\d{4})-(\d{2})-(\d{2})/y;
const TIME = /(\d{2}):(\d{2}):(\d{2})(\.\d+)?/y;
const TIME_OFFSET = /[Zz]|[+-](\d{2}):(\d{2})/y;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MAX_SECOND = 59;
/** A decimal integer, or the integer part of a float. */
const DECIMAL = /[+-]?(?:0|[1-9](?:_?\d)*)/y;
/** The fraction and the exponent of a float. */
const FLOAT_TAIL = /(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?/y;
/** Hexadecimal, octal and binary integers, by the letter after the 0. */
const PREFIXED_INTEGER = { x: /0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*/y, o: /0o[0-7](?:_?[0-7])*/y, b: /0b[01](?:_?[01])*/y };
/** The tag the tree shows for each kind of date and time. */
const DATE_TIME_TAG = { 'offset date-time': 'date-time', 'local date-time': 'date-time', 'local date': 'date', 'local time': 'time' };
/** The largest and the smallest integer TOML holds (64 bits). */
const MAX_INTEGER = 9223372036854775807n;
const MIN_INTEGER = -9223372036854775808n;
/** Arrays and inline tables nest at most this deep. */
const MAX_DEPTH = 300;
/** The first id of a node, far from the ids of the JSON and YAML readers. */
const FIRST_NODE_ID = 1e9;
const BYTE_ORDER_MARK = 0xfeff;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** The longest key and word quoted in a message. */
const MAX_QUOTED_LENGTH = 60;
const MAX_UNQUOTED_KEY_LENGTH = 20;
const INTEGER_TOO_LARGE = 'This integer is too large for TOML (more than 64 bits)';
const INTEGER_NOT_EXACT = 'This integer is larger than a browser can hold exactly - in a conversion its last digits change';
const INLINE_TABLE_CLOSED = 'is an inline table { } - it cannot get more keys afterwards';
const NOT_A_TABLE = 'already has a value - it cannot be a table too';
/** Thrown by stopWithError(): the first error ends the reading. */
const STOP = {};

let nextNodeId = FIRST_NODE_ID;

/**
 * A node of the model (DataNode of datatree-core.js) with the fields the TOML reader adds.
 * @typedef {object} TomlNode
 * @property {number} id - a number no other node has.
 * @property {string} type - "object", "array", "string", "number" or "boolean".
 * @property {number} start - where the value starts in the code.
 * @property {number} end - where it ends.
 * @property {TomlEntry[]|null} entries - the entries of a table or an array.
 * @property {TomlEntry|null} entry - the entry that holds the node, null for the root.
 * @property {*} [value] - the value of a string, number or boolean.
 * @property {string} [raw] - a number or a date as written.
 * @property {string} [style] - "basic", "literal", "multi-basic", "multi-literal" or "datetime".
 * @property {boolean} [inline] - a table or array written inside { } or [ ].
 * @property {boolean} [aot] - an array of tables written as [[header]] sections.
 * @property {boolean} [explicit] - a table defined by a header (or closed by its section).
 * @property {boolean} [dotted] - a table made by dotted keys.
 * @property {boolean} [frozen] - a table that takes no more keys.
 * @property {Array<object>} [lines] - the key = value lines written in the table's own section.
 * @property {TomlSection[]} [headers] - the sections of the headers that name the table.
 * @property {Array<object>} [members] - the key = value members of an inline table.
 */

/**
 * An entry of a table or an array: a key (or index) and its value, with its places in the code.
 * @typedef {object} TomlEntry
 * @property {string|number} key - the key, or the index in an array.
 * @property {number} start - where the entry starts.
 * @property {TomlNode} node - its value.
 * @property {TomlNode} parent - the table or array that holds it.
 * @property {number} index - its place among the parent's entries.
 * @property {string} mode - "line", "inline", "section" or "implicit".
 * @property {Array<number[]>} [refs] - the places of its key.
 * @property {Array<number[]>} [spans] - the parts of the code that belong to it.
 * @property {Array<number[]>} [lineSpans] - the key = value lines among them.
 * @property {Array<number[]>} [secSpans] - the sections among them.
 * @property {number[]} [line] - the key = value line of a value.
 * @property {object} [member] - the member of an inline table that writes it.
 * @property {number} [comma] - where the comma after it is.
 */

/**
 * A [header] or [[header]] and the lines below it.
 * @typedef {object} TomlSection
 * @property {number} start - where the header starts.
 * @property {number} headerEnd - where the header's closing bracket ends.
 * @property {number} lineEnd - where the header's line ends.
 * @property {number} end - where the section's last line ends.
 * @property {Array<object>} parts - the parts of the header's key.
 * @property {boolean} aot - true for a [[header]].
 * @property {TomlEntry[]} entries - the entries the header names.
 * @property {number} [lead] - where the section starts with the comments above its header.
 * @property {number[]} [span] - the section from its lead to its end.
 */

/**
 * A date, a time or both as read by readDateTime().
 * @typedef {object} DateTimeMatch
 * @property {number} end - where it ends.
 * @property {string} [kind] - "offset date-time", "local date-time", "local date" or "local time".
 * @property {string} [bad] - why it is no valid date or time.
 */

/**
 * Returns the number of days of a month.
 * @param {number} year - the year.
 * @param {number} month - the month, 1-based.
 * @returns {number} the days.
 */
function getDaysInMonth(year, month) {
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return month === 2 && isLeapYear ? 29 : DAYS_IN_MONTH[month - 1];
}

/**
 * Returns the time (HH:MM:SS with an optional fraction) at a position when it exists.
 * @param {string} text - the code.
 * @param {number} position - where the time starts.
 * @returns {RegExpExecArray|null} the match, null when there is no valid time.
 */
function getTimeMatch(text, position) {
    TIME.lastIndex = position;
    const match = TIME.exec(text);
    if (!match || +match[1] > MAX_HOUR || +match[2] > MAX_MINUTE || +match[3] > MAX_SECOND) return null;
    return match;
}

/**
 * Reads a date, a time or both at a position.
 * @param {string} text - the code.
 * @param {number} position - where it starts.
 * @returns {DateTimeMatch|null} its end and kind, or why it is not valid; null when no date or time starts there.
 */
export function readDateTime(text, position) {
    DATE.lastIndex = position;
    const date = DATE.exec(text);
    if (date) return readDateAndTime(text, date);
    if (/^\d{2}:\d{2}/.test(text.slice(position, position + 5))) {
        const time = getTimeMatch(text, position);
        if (!time) return { bad: /^\d{2}:\d{2}(?!:\d{2})/.test(text.slice(position, position + 8)) ? 'A time needs seconds in TOML 1.0 (HH:MM:SS)' : 'This time does not exist', end: position + 5 };
        return { end: position + time[0].length, kind: 'local time' };
    }
    return null;
}

/**
 * Reads a date and the time and offset that may follow it.
 * @param {string} text - the code.
 * @param {RegExpExecArray} date - the date as matched by DATE.
 * @returns {DateTimeMatch} its end and kind, or why it is not valid.
 */
function readDateAndTime(text, date) {
    const dateEnd = date.index + date[0].length;
    if (+date[2] < 1 || +date[2] > 12 || +date[3] < 1 || +date[3] > getDaysInMonth(+date[1], +date[2])) return { bad: 'This date does not exist', end: dateEnd };
    const separator = text[dateEnd];
    const time = (separator === 'T' || separator === 't' || (separator === ' ' && /\d/.test(text[dateEnd + 1] || ''))) && getTimeMatch(text, dateEnd + 1);
    if (!time) {
        if (separator === 'T' || separator === 't') return { bad: 'A time is expected after the T (HH:MM:SS)', end: dateEnd + 1 };
        return { end: dateEnd, kind: 'local date' };
    }
    const end = dateEnd + 1 + time[0].length;
    TIME_OFFSET.lastIndex = end;
    const offset = TIME_OFFSET.exec(text);
    if (!offset) return { end, kind: 'local date-time' };
    if (offset[1] !== undefined && (+offset[1] > MAX_HOUR || +offset[2] > MAX_MINUTE)) return { bad: 'This time offset does not exist', end: end + offset[0].length };
    return { end: end + offset[0].length, kind: 'offset date-time' };
}

/**
 * Creates a node of the model.
 * @param {string} type - "object", "array", "string", "number" or "boolean".
 * @param {number} start - where the value starts in the code.
 * @param {number} [end] - where it ends.
 * @returns {TomlNode} the node, with an id no other node has.
 */
function createNode(type, start, end = start) {
    return { id: nextNodeId++, type, start, end, entries: null, entry: null };
}

/**
 * Tells whether a node is a table or an array.
 * @param {TomlNode|null} node - the node.
 * @returns {boolean} true for a table or an array.
 */
export function isContainerNode(node) {
    return !!node && (node.type === 'object' || node.type === 'array');
}

/**
 * Tells whether a node is a table.
 * @param {TomlNode|null} node - the node.
 * @returns {boolean} true for a table.
 */
export function isTableNode(node) {
    return !!node && node.type === 'object';
}

/**
 * Returns the parts of a key as TOML writes them for a message: bare parts as they are, others in quotes.
 * @param {Array<object>} parts - the parts of the key, each with its key.
 * @returns {string} the key, e.g. a."b c".d.
 */
function formatKeyParts(parts) {
    return parts.map(part => (/^[A-Za-z0-9_-]+$/.test(part.key) ? part.key : JSON.stringify(part.key))).join('.');
}

/**
 * Returns the entry of a key in a table.
 * @param {TomlNode} table - the table.
 * @param {string} key - the key.
 * @returns {TomlEntry|undefined} the entry, undefined when the table has none.
 */
function findEntry(table, key) {
    return table.entries.find(entry => entry.key === key);
}

/**
 * Creates the entry of a key and adds it to its table; the node learns its entry. A factory
 * that links what it builds into the model.
 * @param {TomlNode} table - the table.
 * @param {object} part - the key as read: its key, start and end.
 * @param {TomlNode} node - the value.
 * @param {string} mode - "line", "inline", "section" or "implicit".
 * @returns {TomlEntry} the new entry.
 */
function createEntry(table, part, node, mode) {
    const entry = { key: part.key, keyStart: part.start, keyEnd: part.end, start: part.start, node, parent: table, index: table.entries.length, mode, refs: [], spans: [] };
    node.entry = entry;
    table.entries.push(entry);
    return entry;
}

/**
 * Marks a table or an array and everything inside it as taking no more keys.
 * @param {TomlNode} node - the table or array.
 * @returns {void}
 */
function setNodeLocked(node) {
    node.frozen = true;
    if (node.entries) for (const entry of node.entries) if (isContainerNode(entry.node)) setNodeLocked(entry.node);
}

/**
 * Reads TOML code into the model of datatree.js (the steps in the header).
 * @param {string} text - the code.
 * @returns {import('./datatree-core.js').DataModel} one document, its problems, the number of
 *   values and comments, the sections and at(position).
 */
export function parseToml(text) {
    const reader = new TomlReader(text);
    reader.readDocument();
    setSectionSpans(text, reader.sections, reader.root);
    setTableRanges(text, reader.root);
    reader.root.start = 0;
    reader.root.end = text.length;
    reader.problems.sort((a, b) => a.pos - b.pos);
    if (!reader.broken && !text.trim()) reader.problems.push({ pos: 0, end: 0, kind: 'warn', msg: 'The document is empty' });
    return {
        format: 'toml', docs: [{ root: reader.root, start: 0, end: text.length }], problems: reader.problems, broken: reader.broken,
        count: reader.count, comments: reader.comments, sections: reader.sections, at: createNodeFinder(reader.root),
    };
}

/**
 * Reads the code from start to end and builds the model as it goes. Its read methods move the
 * position and return what they read (a reader that consumes its input).
 */
class TomlReader {
    /**
     * Creates a reader at the start of the code, with an empty root table.
     * @param {string} text - the code.
     * @returns {void}
     */
    constructor(text) {
        this.src = text;
        this.length = text.length;
        this.position = 0;
        this.count = 0;
        this.comments = 0;
        this.depth = 0;
        /** @type {Array<object>} the problems found. */
        this.problems = [];
        /** @type {TomlNode[]} tables made by dotted keys in this section: explicit when it ends. */
        this.pending = [];
        /** @type {TomlSection[]} */
        this.sections = [];
        this.root = this.createTable(0);
        this.root.end = text.length;
        this.root.explicit = true;
        /** The table that key = value lines go into, and its section. */
        this.current = this.root;
        this.section = null;
        this.broken = false;
    }

    /**
     * Notes an error at a place and stops the reading.
     * @param {number} position - where the error starts.
     * @param {string} message - the message for the user.
     * @param {number} [end] - where the place ends.
     * @returns {never} it always throws.
     * @throws {object} STOP, caught by readDocument().
     */
    stopWithError(position, message, end = position + 1) {
        this.problems.push({ pos: position, end: Math.min(Math.max(end, position + 1), Math.max(this.length, position + 1)), kind: 'error', msg: message });
        throw STOP;
    }

    /**
     * Returns what stands at a position, for a message.
     * @param {number} position - the position.
     * @returns {string} "the end of the text", "the end of the line" or the character in quotes.
     */
    getFoundText(position) {
        const src = this.src;
        if (position >= this.length) return 'the end of the text';
        if (src[position] === '\n' || src[position] === '\r') return 'the end of the line';
        return `"${String.fromCodePoint(src.codePointAt(position))}"`;
    }

    /**
     * Creates an empty table and counts it.
     * @param {number} start - where it starts.
     * @returns {TomlNode} the table.
     */
    createTable(start) {
        const table = createNode('object', start);
        table.entries = [];
        table.lines = [];
        this.count++;
        return table;
    }

    /**
     * Reads the whole code: line breaks, comments, headers and key = value lines. The first
     * error ends the reading and marks the model as broken.
     * @returns {void}
     * @throws {Error} any error other than the reader's own stop.
     */
    readDocument() {
        try {
            if (this.src.charCodeAt(0) === BYTE_ORDER_MARK) this.position = 1;
            while (this.position < this.length) this.readLine();
        } catch (error) {
            if (error !== STOP) throw error;
            this.broken = true;
        }
        for (const table of this.pending) table.explicit = true;
    }

    /**
     * Reads one line (or what follows the spaces at the position): a line break, a comment, a
     * header or a key = value line.
     * @returns {void}
     */
    readLine() {
        const src = this.src;
        this.moveOverSpaces();
        const character = src[this.position];
        if (character === '\n') { this.position++; return; }
        if (character === '\r' && src[this.position + 1] === '\n') { this.position += 2; return; }
        if (character === '#') { this.moveOverComment(); return; }
        if (this.position >= this.length) return;
        if (character === '[') { this.readHeader(); return; }
        this.readKeyValueLine();
    }

    /**
     * Reads a key = value line into the current table.
     * @returns {void}
     */
    readKeyValueLine() {
        const src = this.src;
        const lineStart = getLineStart(src, this.position);
        const parts = this.readKey();
        if (src[this.position] !== '=') {
            const atLineEnd = this.position >= this.length || src[this.position] === '\n' || src[this.position] === '\r';
            this.stopWithError(this.position, atLineEnd ? `A "=" and a value are missing after the key "${formatKeyParts(parts).slice(0, MAX_QUOTED_LENGTH)}"` : `A "=" is missing after the key "${formatKeyParts(parts).slice(0, MAX_QUOTED_LENGTH)}"`);
        }
        this.position++;
        this.moveOverSpaces();
        const line = [lineStart, 0];
        const value = this.readValue();
        this.moveOverLineEnd('the value');
        line[1] = this.position;
        const entry = this.addValue(this.current, parts, value, { line });
        this.current.lines.push({ start: lineStart, end: this.position, entry, parts });
        if (this.section) this.section.end = this.position;
    }

    // --- Spaces, comments and line ends ---

    /**
     * Moves past spaces and tabs.
     * @returns {void}
     */
    moveOverSpaces() {
        while (this.src[this.position] === ' ' || this.src[this.position] === '\t') this.position++;
    }

    /**
     * Moves past spaces, comments and line breaks (inside arrays).
     * @returns {void}
     */
    moveOverSpacesAndLines() {
        const src = this.src;
        for (;;) {
            this.moveOverSpaces();
            if (src[this.position] === '#') this.moveOverComment();
            else if (src[this.position] === '\n') this.position++;
            else if (src[this.position] === '\r' && src[this.position + 1] === '\n') this.position += 2;
            else return;
        }
    }

    /**
     * Moves past a comment up to its line break, and counts it.
     * @returns {void}
     */
    moveOverComment() {
        const src = this.src;
        this.comments++;
        while (this.position < this.length && src[this.position] !== '\n' && !(src[this.position] === '\r' && src[this.position + 1] === '\n')) {
            const character = src[this.position];
            if (CONTROL_CHARACTER.test(character) && character !== '\t') this.stopWithError(this.position, character === '\r' ? 'A line break needs \\n (a carriage return alone is not allowed)' : 'A control character is not allowed in a comment');
            this.position++;
        }
    }

    /**
     * Moves past the end of a line: spaces, an optional comment, then a line break or the end.
     * @param {string} what - what stands before it, for the message ("the value", "the table header").
     * @returns {void}
     */
    moveOverLineEnd(what) {
        const src = this.src;
        this.moveOverSpaces();
        if (src[this.position] === '#') this.moveOverComment();
        if (this.position >= this.length) return;
        if (src[this.position] === '\n') { this.position++; return; }
        if (src[this.position] === '\r' && src[this.position + 1] === '\n') { this.position += 2; return; }
        this.stopWithError(this.position, `Extra text after ${what} - one key = value or [table] per line`, getLineEnd(src, this.position));
    }

    // --- Strings ---

    /**
     * Reads an escape (\n, \uXXXX …) inside a basic string.
     * @returns {string} the character it stands for.
     */
    readEscape() {
        const src = this.src, letter = src[this.position + 1];
        if (letter in ESCAPES) { this.position += 2; return ESCAPES[letter]; }
        if (letter === 'u' || letter === 'U') return this.readUnicodeEscape(letter);
        return this.stopWithError(this.position, `Unknown escape \\${letter === undefined || letter === '\n' ? '' : letter} in a string - write \\\\ for a backslash`, this.position + 2);
    }

    /**
     * Reads a \uXXXX or \UXXXXXXXX escape.
     * @param {string} letter - "u" (4 digits) or "U" (8 digits).
     * @returns {string} the character it stands for.
     */
    readUnicodeEscape(letter) {
        const digits = letter === 'u' ? 4 : 8;
        const hex = this.src.slice(this.position + 2, this.position + 2 + digits);
        if (!new RegExp(`^[0-9a-fA-F]{${digits}}$`).test(hex)) this.stopWithError(this.position, `\\${letter} needs ${digits} hexadecimal digits`, this.position + 2);
        const codePoint = parseInt(hex, 16);
        if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) this.stopWithError(this.position, `\\${letter}${hex} is not a Unicode character`, this.position + 2 + digits);
        this.position += 2 + digits;
        return String.fromCodePoint(codePoint);
    }

    /**
     * Reads a basic string "…" on one line.
     * @param {number} start - where it starts.
     * @returns {string} its value.
     */
    readBasicString(start) {
        const src = this.src;
        this.position++;
        let value = '';
        for (;;) {
            if (this.position >= this.length || src[this.position] === '\n' || (src[this.position] === '\r' && src[this.position + 1] === '\n')) this.stopWithError(start, 'This string is never closed - a " is missing at the end of the line', this.position);
            const character = src[this.position];
            if (character === '"') { this.position++; return value; }
            if (character === '\\') { value += this.readEscape(); continue; }
            if (CONTROL_CHARACTER.test(character) && character !== '\t') this.stopWithError(this.position, 'A control character in a string must be written as an escape, e.g. \\n or \\u0001');
            value += character;
            this.position++;
        }
    }

    /**
     * Reads a literal string '…' on one line.
     * @param {number} start - where it starts.
     * @returns {string} its value.
     */
    readLiteralString(start) {
        const src = this.src;
        this.position++;
        const valueStart = this.position;
        for (;;) {
            if (this.position >= this.length || src[this.position] === '\n' || (src[this.position] === '\r' && src[this.position + 1] === '\n')) this.stopWithError(start, "This string is never closed - a ' is missing at the end of the line", this.position);
            if (src[this.position] === "'") { this.position++; return src.slice(valueStart, this.position - 1); }
            if (CONTROL_CHARACTER.test(src[this.position]) && src[this.position] !== '\t') this.stopWithError(this.position, 'A control character is not allowed in a literal string');
            this.position++;
        }
    }

    /**
     * Reads a multi-line string """…""" or '''…'''; a line break right after the opening
     * quotes is left out.
     * @param {number} start - where it starts.
     * @param {string} quote - '"' or "'".
     * @returns {string} its value (line breaks as \n).
     */
    readMultiLineString(start, quote) {
        const src = this.src;
        this.position += 3;
        if (src[this.position] === '\n') this.position++;
        else if (src[this.position] === '\r' && src[this.position + 1] === '\n') this.position += 2;
        let value = '';
        for (;;) {
            if (this.position >= this.length) this.stopWithError(start, `This string is never closed - ${quote}${quote}${quote} is missing`, this.length);
            const character = src[this.position];
            if (character === quote && src[this.position + 1] === quote && src[this.position + 2] === quote) return value + this.readClosingQuotes(quote);
            if (character === '\\' && quote === '"') { value += this.readMultiLineEscape(); continue; }
            if (character === '\r' && src[this.position + 1] === '\n') { value += '\n'; this.position += 2; continue; }
            if (character !== '\n' && character !== '\t' && CONTROL_CHARACTER.test(character)) this.stopWithError(this.position, character === '\r' ? 'A line break needs \\n (a carriage return alone is not allowed)' : 'A control character in a string must be written as an escape');
            value += character;
            this.position++;
        }
    }

    /**
     * Reads the closing quotes of a multi-line string: up to two quotes right before the
     * closing three belong to the string.
     * @param {string} quote - '"' or "'".
     * @returns {string} the quotes that belong to the string ("", one or two).
     */
    readClosingQuotes(quote) {
        let length = 3;
        while (this.src[this.position + length] === quote && length < 5) length++;
        this.position += length;
        return quote.repeat(length - 3);
    }

    /**
     * Reads a backslash in a multi-line basic string: at the end of a line it removes the line
     * break and the spaces after it, otherwise it starts an escape.
     * @returns {string} the character of the escape, "" for a line ending backslash.
     */
    readMultiLineEscape() {
        const src = this.src;
        let next = this.position + 1;
        while (src[next] === ' ' || src[next] === '\t') next++;
        if (src[next] !== '\n' && !(src[next] === '\r' && src[next + 1] === '\n')) return this.readEscape();
        this.position = next;
        while (src[this.position] === ' ' || src[this.position] === '\t' || src[this.position] === '\n' || (src[this.position] === '\r' && src[this.position + 1] === '\n')) this.position += src[this.position] === '\r' ? 2 : 1;
        return '';
    }

    /**
     * Reads a string of any of the four kinds.
     * @returns {{value: string, start: number, end: number, style: string}} its value, place
     *   and style ("basic", "literal", "multi-basic", "multi-literal").
     */
    readString() {
        const start = this.position, quote = this.src[this.position];
        const triple = this.src[this.position + 1] === quote && this.src[this.position + 2] === quote;
        const value = triple ? this.readMultiLineString(start, quote) : quote === '"' ? this.readBasicString(start) : this.readLiteralString(start);
        return { value, start, end: this.position, style: (triple ? 'multi-' : '') + (quote === '"' ? 'basic' : 'literal') };
    }

    // --- Keys ---

    /**
     * Reads a key with all the parts of a dotted key.
     * @returns {Array<{key: string, start: number, end: number, quoted?: boolean}>} the parts.
     */
    readKey() {
        const parts = [];
        for (;;) {
            this.moveOverSpaces();
            parts.push(this.readKeyPart());
            this.moveOverSpaces();
            if (this.src[this.position] !== '.') return parts;
            this.position++;
        }
    }

    /**
     * Reads one part of a key: a string in quotes or a bare key.
     * @returns {{key: string, start: number, end: number, quoted?: boolean}} the part.
     */
    readKeyPart() {
        const src = this.src, start = this.position, character = src[this.position];
        if (character === '"' || character === "'") {
            if (src[this.position + 1] === character && src[this.position + 2] === character) this.stopWithError(this.position, 'A key cannot be a multi-line string');
            const string = this.readString();
            return { key: string.value, start, end: this.position, quoted: true };
        }
        BARE_KEY.lastIndex = this.position;
        const match = BARE_KEY.exec(src);
        if (!match) {
            if (character === '=' || character === '.') this.stopWithError(this.position, 'A key is missing here');
            this.stopWithError(this.position, this.position >= this.length || character === '\n' || character === '\r' ? 'A key is missing here' : `A key has only letters, digits, - and _ - put "${src.slice(this.position, this.position + MAX_UNQUOTED_KEY_LENGTH).split(/[\s=]/)[0]}" in quotes`);
        }
        this.position += match[0].length;
        return { key: match[0], start, end: this.position };
    }

    // --- Values ---

    /**
     * Reads a value of any type.
     * @returns {TomlNode} the value's node.
     */
    readValue() {
        const src = this.src, character = src[this.position];
        if (this.position >= this.length || character === '\n' || character === '\r' || character === '#') this.stopWithError(this.position, 'A value is missing after =');
        if (character === '"' || character === "'") return this.readStringValue();
        if (character === '[') return this.readArray();
        if (character === '{') return this.readInlineTable();
        if (/^(true|false)(?![\w-])/.test(src.slice(this.position, this.position + 6))) return this.readBoolean();
        const dateTime = /\d/.test(character) ? readDateTime(src, this.position) : null;
        if (dateTime) return this.readDateTimeValue(dateTime);
        const special = /^[+-]?(inf|nan)(?![\w.-])/.exec(src.slice(this.position, this.position + 5));
        if (special) return this.readSpecialFloat(special);
        if (character === '0' && /[xob]/.test(src[this.position + 1] || '')) return this.readPrefixedInteger();
        if (/[+\-\d]/.test(character)) {
            DECIMAL.lastIndex = this.position;
            if (DECIMAL.exec(src)) return this.readDecimalNumber();
        }
        return this.stopAtUnknownValue();
    }

    /**
     * Reads a string value.
     * @returns {TomlNode} the string's node.
     */
    readStringValue() {
        const start = this.position;
        const string = this.readString(), node = createNode('string', start, string.end);
        node.value = string.value;
        node.style = string.style;
        this.count++;
        return node;
    }

    /**
     * Reads true or false.
     * @returns {TomlNode} the boolean's node.
     */
    readBoolean() {
        const start = this.position, isTrue = this.src[this.position] === 't';
        this.position += isTrue ? 4 : 5;
        const node = createNode('boolean', start, this.position);
        node.value = isTrue;
        this.count++;
        return node;
    }

    /**
     * Reads a date or time, kept as its text (style "datetime") with the tag of its kind.
     * @param {DateTimeMatch} dateTime - the date or time as matched at the position.
     * @returns {TomlNode} its node.
     */
    readDateTimeValue(dateTime) {
        const start = this.position;
        if (dateTime.bad) this.stopWithError(this.position, dateTime.bad, dateTime.end);
        this.position = dateTime.end;
        const node = createNode('string', start, this.position);
        node.value = this.src.slice(start, this.position);
        node.raw = node.value;
        node.style = 'datetime';
        node.tag = DATE_TIME_TAG[dateTime.kind];
        node.dtKind = dateTime.kind;
        this.count++;
        return node;
    }

    /**
     * Reads inf or nan with an optional sign.
     * @param {RegExpExecArray} match - the match at the position.
     * @returns {TomlNode} the float's node.
     */
    readSpecialFloat(match) {
        const start = this.position;
        this.position += match[0].length;
        const node = createNode('number', start, this.position);
        node.value = match[1] === 'nan' ? NaN : this.src[start] === '-' ? -Infinity : Infinity;
        node.raw = match[0];
        node.float = true;
        this.count++;
        return node;
    }

    /**
     * Reads a hexadecimal, octal or binary integer (0x…, 0o…, 0b…).
     * @returns {TomlNode} the integer's node.
     */
    readPrefixedInteger() {
        const src = this.src, start = this.position;
        const pattern = PREFIXED_INTEGER[src[this.position + 1]];
        pattern.lastIndex = this.position;
        const match = pattern.exec(src);
        if (!match || /[\w.]/.test(src[pattern.lastIndex] || '')) this.stopWithError(this.position, 'This number is not written correctly - e.g. 0xFF, 0o17, 0b101 (an _ only between digits)', this.position + 2);
        this.position = pattern.lastIndex;
        const node = createNode('number', start, this.position);
        node.raw = match[0];
        const big = BigInt(match[0].replace(/_/g, ''));
        node.value = Number(big);
        if (big > MAX_INTEGER) this.stopWithError(start, INTEGER_TOO_LARGE, this.position);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) this.problems.push({ pos: start, end: this.position, kind: 'warn', msg: INTEGER_NOT_EXACT });
        this.count++;
        return node;
    }

    /**
     * Reads a decimal integer or a float; DECIMAL has matched at the position.
     * @returns {TomlNode} the number's node.
     */
    readDecimalNumber() {
        const src = this.src, start = this.position;
        FLOAT_TAIL.lastIndex = DECIMAL.lastIndex;
        const tail = FLOAT_TAIL.exec(src);
        const end = FLOAT_TAIL.lastIndex;
        const next = src[end] || '';
        if (/[\w.+-]/.test(next)) {
            if (/^[+-]?0\d/.test(src.slice(this.position, end + 1))) this.stopWithError(this.position, 'A number cannot start with 0 - write it without the leading 0', end + 1);
            this.stopWithError(this.position, next === '_' || src[end - 1] === '_' ? 'An _ in a number must stand between two digits' : 'This number is not written correctly', end + 1);
        }
        if (src[end - 1] === '.' || /\.$|[eE][+-]?$/.test(src.slice(this.position, end))) this.stopWithError(this.position, 'A point or an exponent needs digits after it', end);
        const raw = src.slice(this.position, end);
        this.position = end;
        const node = createNode('number', start, end);
        node.raw = raw;
        node.float = !!tail[0];
        const digits = raw.replace(/_/g, '');
        if (!node.float) this.checkIntegerSize(BigInt(digits), start, end);
        node.value = Number(digits);
        this.count++;
        return node;
    }

    /**
     * Stops at an integer TOML cannot hold, and notes one a browser cannot hold exactly.
     * @param {bigint} big - the integer.
     * @param {number} start - where it starts.
     * @param {number} end - where it ends.
     * @returns {void}
     */
    checkIntegerSize(big, start, end) {
        if (big > MAX_INTEGER || big < MIN_INTEGER) this.stopWithError(start, INTEGER_TOO_LARGE, end);
        if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < -BigInt(Number.MAX_SAFE_INTEGER)) this.problems.push({ pos: start, end, kind: 'warn', msg: INTEGER_NOT_EXACT });
    }

    /**
     * Stops at text that is no value, with a message that names the remedy.
     * @returns {never} it always throws.
     * @throws {object} STOP.
     */
    stopAtUnknownValue() {
        const word = /^[^\s,\]}#=]+/.exec(this.src.slice(this.position, this.position + MAX_QUOTED_LENGTH));
        if (word && /^[A-Za-z]/.test(word[0])) this.stopWithError(this.position, `"${word[0]}" is no value - text needs quotes ("…"); other values are numbers, true, false, dates, [ ] or { }`, this.position + word[0].length);
        return this.stopWithError(this.position, `A value is expected here - found ${this.getFoundText(this.position)}`);
    }

    /**
     * Goes one level deeper into an array or inline table; stops when the data is nested too deeply.
     * @returns {void}
     */
    addNestingLevel() {
        if (++this.depth > MAX_DEPTH) this.stopWithError(this.position, 'The data is nested too deeply');
    }

    /**
     * Reads an array [ … ]; it may span several lines and hold comments.
     * @returns {TomlNode} the array's node.
     */
    readArray() {
        const src = this.src;
        const node = createNode('array', this.position);
        node.entries = [];
        node.inline = true;
        this.count++;
        this.addNestingLevel();
        this.position++;
        for (;;) {
            this.moveOverSpacesAndLines();
            if (src[this.position] === ']') { this.position++; break; }
            if (this.position >= this.length) this.stopWithError(node.start, 'This [ is never closed - a ] is missing', node.start + 1);
            if (src[this.position] === ',') this.stopWithError(this.position, 'One comma too many - a value is missing here');
            if (this.readArrayItem(node)) break;
        }
        this.depth--;
        node.end = this.position;
        return node;
    }

    /**
     * Reads one item of an array and the comma or "]" after it. Returns whether the array ends.
     * @param {TomlNode} array - the array.
     * @returns {boolean} true when the "]" closed the array.
     */
    readArrayItem(array) {
        const src = this.src;
        const entry = { key: array.entries.length, start: this.position, parent: array, index: array.entries.length, mode: 'inline' };
        entry.node = this.readValue();
        entry.node.entry = entry;
        array.entries.push(entry);
        this.moveOverSpacesAndLines();
        if (src[this.position] === ',') { entry.comma = this.position; this.position++; return false; }
        if (src[this.position] === ']') { this.position++; return true; }
        if (this.position >= this.length) this.stopWithError(array.start, 'This [ is never closed - a ] is missing', array.start + 1);
        return this.stopWithError(this.position, `A comma is missing between the values of the array - found ${this.getFoundText(this.position)}`);
    }

    /**
     * Reads an inline table { … } on one line.
     * @returns {TomlNode} the table's node.
     */
    readInlineTable() {
        const node = createNode('object', this.position);
        node.entries = [];
        node.inline = true;
        node.frozen = true;
        node.members = [];
        this.count++;
        this.addNestingLevel();
        this.position++;
        this.moveOverSpaces();
        if (this.src[this.position] === '}') { this.position++; this.depth--; node.end = this.position; return node; }
        while (!this.readInlineMember(node));
        this.depth--;
        node.end = this.position;
        return node;
    }

    /**
     * Reads one key = value member of an inline table and the comma or "}" after it. Returns
     * whether the table ends.
     * @param {TomlNode} table - the inline table.
     * @returns {boolean} true when the "}" closed the table.
     */
    readInlineMember(table) {
        const src = this.src;
        this.moveOverSpaces();
        if (src[this.position] === '\n' || src[this.position] === '\r') this.stopWithError(this.position, 'An inline table { } must stay on one line in TOML 1.0 - use a [table] for more lines');
        if (src[this.position] === '}') this.stopWithError(this.position, 'A comma after the last entry of an inline table is not allowed');
        const memberStart = this.position;
        const parts = this.readKey();
        if (src[this.position] !== '=') this.stopWithError(this.position, `A "=" is missing after the key "${parts.map(part => part.key).join('.').slice(0, MAX_QUOTED_LENGTH)}"`);
        this.position++;
        this.moveOverSpaces();
        const value = this.readValue();
        const member = { start: memberStart, end: value.end, parts };
        table.members.push(member);
        this.addValue(table, parts, value, { member });
        this.moveOverSpaces();
        if (src[this.position] === ',') { member.comma = this.position; this.position++; return false; }
        if (src[this.position] === '}') { this.position++; return true; }
        if (src[this.position] === '\n' || src[this.position] === '\r' || this.position >= this.length) this.stopWithError(table.start, 'This { is never closed on its line - a } is missing', table.start + 1);
        return this.stopWithError(this.position, `"," or "}" is expected here - found ${this.getFoundText(this.position)}`);
    }

    // --- Tables ---

    /**
     * Adds a value under a key to a table (a section's table or an inline table); the parts of
     * a dotted key make or extend tables on the way. Builds the model as the code is read and
     * returns the new entry, which the line keeps.
     * @param {TomlNode} table - the table.
     * @param {Array<object>} parts - the parts of the key.
     * @param {TomlNode} value - the value.
     * @param {object} [places] - where the value is written.
     * @param {object} [places.member] - the member of an inline table.
     * @param {number[]} [places.line] - the key = value line.
     * @returns {TomlEntry} the value's entry.
     */
    addValue(table, parts, value, { member, line } = {}) {
        let target = table;
        for (let k = 0; k < parts.length - 1; k++) target = this.openDottedTable(target, parts, k, member, line);
        const last = parts[parts.length - 1];
        const existing = findEntry(target, last.key);
        if (existing) this.stopWithError(last.start, isTableNode(existing.node) && !existing.node.inline && existing.node.entries.length !== undefined && existing.mode !== 'line' ? `"${formatKeyParts(parts)}" is already a table - it cannot get a value too` : `The key "${formatKeyParts(parts).slice(0, MAX_QUOTED_LENGTH)}" is defined twice`, last.end);
        const entry = createEntry(target, last, value, member ? 'inline' : 'line');
        entry.refs.push([last.start, last.end]);
        if (line) { entry.spans.push(line); entry.lineSpans = [line]; entry.line = line; }
        if (member) { (entry.members || (entry.members = [])).push(member); entry.member = member; entry.start = member.start; }
        if (isContainerNode(value)) setNodeLocked(value);
        return entry;
    }

    /**
     * Opens the table that one part of a dotted key names: the one that is there, if it may take
     * more keys, or a new one. Returns the table, which the next part goes into.
     * @param {TomlNode} table - the table the part is in.
     * @param {Array<object>} parts - all parts of the key.
     * @param {number} k - the index of the part.
     * @param {object} [member] - the member of an inline table.
     * @param {number[]} [line] - the key = value line.
     * @returns {TomlNode} the table the part names.
     */
    openDottedTable(table, parts, k, member, line) {
        const part = parts[k];
        let entry = findEntry(table, part.key);
        if (entry) this.checkDottedTable(entry.node, parts, k, member);
        else {
            const created = this.createTable(part.start);
            created.dotted = true;
            if (member) created.frozen = true;
            entry = createEntry(table, part, created, member ? 'inline' : 'implicit');
            if (!member) this.pending.push(created);
        }
        entry.refs.push([part.start, part.end]);
        if (line) { entry.spans.push(line); (entry.lineSpans || (entry.lineSpans = [])).push(line); }
        if (member) (entry.members || (entry.members = [])).push(member);
        return entry.node;
    }

    /**
     * Stops when a dotted key names a value that cannot take more keys; a table it extends
     * outside { } cannot get a [header] afterwards (as in tomllib).
     * @param {TomlNode} node - the node the part names.
     * @param {Array<object>} parts - all parts of the key.
     * @param {number} k - the index of the part.
     * @param {object} [member] - the member of an inline table.
     * @returns {void}
     */
    checkDottedTable(node, parts, k, member) {
        const part = parts[k], name = formatKeyParts(parts.slice(0, k + 1));
        if (!isTableNode(node) || node.inline && !member) this.stopWithError(part.start, isTableNode(node) ? `"${name}" ${INLINE_TABLE_CLOSED}` : `"${name}" ${NOT_A_TABLE}`, part.end);
        if (node.frozen && (node.inline || !member)) this.stopWithError(part.start, `"${name}" ${INLINE_TABLE_CLOSED}`, part.end);
        if (node.explicit && !member) this.stopWithError(part.start, `The table "${name}" is already defined with a [header] - write the key in its section`, part.end);
        if (!member && !node.dotted) { node.dotted = true; this.pending.push(node); }
    }

    /**
     * Reads a [header] or [[header]] line and makes its table the current one.
     * @returns {void}
     */
    readHeader() {
        const src = this.src, headerStart = this.position;
        const aot = src[this.position + 1] === '[';
        this.position += aot ? 2 : 1;
        const parts = this.readKey();
        if (aot) {
            if (src[this.position] !== ']' || src[this.position + 1] !== ']') this.stopWithError(this.position, 'A "]]" is missing after the name of the array of tables');
            this.position += 2;
        } else if (src[this.position] !== ']') this.stopWithError(this.position, src[this.position] === '=' ? 'A table header has no value - write [name] alone on its line' : 'A "]" is missing after the table name');
        else this.position++;
        const headerEnd = this.position;
        this.moveOverLineEnd('the table header');
        for (const table of this.pending) table.explicit = true;
        this.pending = [];
        const section = { start: headerStart, headerEnd, lineEnd: this.position, end: this.position, parts, aot, entries: [] };
        this.sections.push(section);
        const parent = this.openHeaderParents(section);
        this.current = aot ? this.addArrayTable(parent, section) : this.openHeaderTable(parent, section);
        this.current.headers = this.current.headers || [];
        this.current.headers.push(section);
        this.section = section;
    }

    /**
     * Opens the tables a header names before its last part; a part that names an array of
     * tables leads into its last table.
     * @param {TomlSection} section - the header's section.
     * @returns {TomlNode} the table the last part goes into.
     */
    openHeaderParents(section) {
        const parts = section.parts;
        let table = this.root;
        for (let k = 0; k < parts.length - 1; k++) {
            const part = parts[k];
            let entry = findEntry(table, part.key);
            if (!entry) entry = createEntry(table, part, Object.assign(this.createTable(part.start), { implicit: true }), 'implicit');
            else if (entry.node.type === 'array' && entry.node.aot) { /* into its last table */ }
            else if (!isTableNode(entry.node)) this.stopWithError(part.start, `"${formatKeyParts(parts.slice(0, k + 1))}" ${NOT_A_TABLE}`, part.end);
            else if (entry.node.frozen) this.stopWithError(part.start, `"${formatKeyParts(parts.slice(0, k + 1))}" ${INLINE_TABLE_CLOSED}`, part.end);
            entry.refs.push([part.start, part.end]);
            section.entries.push(entry);
            if (entry.node.type === 'array') {
                const lastTable = entry.node.entries[entry.node.entries.length - 1];
                section.entries.push(lastTable);
                table = lastTable.node;
            } else table = entry.node;
        }
        return table;
    }

    /**
     * Adds one more table to the array of tables a [[header]] names (making the array when it
     * is new) and returns that table, which the section's lines go into.
     * @param {TomlNode} parent - the table the array is in.
     * @param {TomlSection} section - the header's section.
     * @returns {TomlNode} the new table of the array.
     */
    addArrayTable(parent, section) {
        const parts = section.parts, part = parts[parts.length - 1];
        let entry = findEntry(parent, part.key);
        if (!entry) {
            const array = createNode('array', section.start);
            array.entries = [];
            array.aot = true;
            array.explicit = true;
            this.count++;
            entry = createEntry(parent, part, array, 'section');
        } else if (!(entry.node.type === 'array' && entry.node.aot)) {
            this.stopWithError(part.start, entry.node.type === 'array' ? `"${formatKeyParts(parts)}" is an array [ ] written with = - it cannot get [[ ]] tables too` : `"${formatKeyParts(parts)}" is already defined as ${isTableNode(entry.node) ? 'a table' : 'a value'} - it cannot be an array of tables too`, part.end);
        }
        entry.refs.push([part.start, part.end]);
        section.entries.push(entry);
        const array = entry.node;
        const table = this.createTable(section.start);
        table.explicit = true;
        table.element = true;
        const element = { key: array.entries.length, start: section.start, node: table, parent: array, index: array.entries.length, mode: 'section', refs: [], spans: [] };
        table.entry = element;
        array.entries.push(element);
        section.entries.push(element);
        return table;
    }

    /**
     * Defines the table a [header] names: a table only named so far becomes defined, a new one
     * is made; a table defined twice stops the reading. Returns the table, which the section's
     * lines go into.
     * @param {TomlNode} parent - the table it is in.
     * @param {TomlSection} section - the header's section.
     * @returns {TomlNode} the table.
     */
    openHeaderTable(parent, section) {
        const parts = section.parts, part = parts[parts.length - 1];
        let entry = findEntry(parent, part.key);
        if (entry) {
            const node = entry.node;
            if (!isTableNode(node)) this.stopWithError(part.start, node.type === 'array' && node.aot ? `"${formatKeyParts(parts)}" is an array of tables - write [[${formatKeyParts(parts)}]] for one more table` : `"${formatKeyParts(parts)}" ${NOT_A_TABLE}`, part.end);
            if (node.explicit || node.frozen) this.stopWithError(part.start, node.dotted ? `The table "${formatKeyParts(parts)}" is already defined by dotted keys - it cannot get a [header] too` : `The table [${formatKeyParts(parts)}] is defined twice`, part.end);
            node.explicit = true;
            node.implicit = false;
            entry.mode = 'section';
        } else entry = createEntry(parent, part, Object.assign(this.createTable(section.start), { explicit: true }), 'section');
        entry.refs.push([part.start, part.end]);
        section.entries.push(entry);
        return entry.node;
    }
}

/**
 * Gives every section its span, from the comments right above its header to its last line,
 * and adds it to the spans of the entries the header names.
 * @param {string} text - the code.
 * @param {TomlSection[]} sections - the sections in code order.
 * @param {TomlNode} root - the root table.
 * @returns {void}
 */
function setSectionSpans(text, sections, root) {
    for (const [k, section] of sections.entries()) {
        const end = Math.max(section.end, section.lineEnd);
        let lead = getCommentLead(text, sections, k);
        // no comment block from the start of the file is taken when root lines come before it
        if (k === 0 && lead < section.start && root.lines.some(line => line.end > lead)) lead = section.start;
        section.lead = Math.min(lead, section.start);
        section.span = [section.lead, end];
        for (const entry of section.entries) { entry.spans.push(section.span); (entry.secSpans || (entry.secSpans = [])).push(section.span); }
    }
}

/**
 * Returns where the comment lines right above a header start (they belong to its section);
 * the comments stop at the end of the section before it.
 * @param {string} text - the code.
 * @param {TomlSection[]} sections - the sections.
 * @param {number} k - the index of the section.
 * @returns {number} the start of the first comment line, or the header's start without one.
 */
function getCommentLead(text, sections, k) {
    let lead = sections[k].start;
    for (let lineStart = getLineStart(text, sections[k].start); lineStart > 0;) {
        const previousStart = getLineStart(text, lineStart - 1);
        const line = text.slice(previousStart, lineStart).trim();
        if (!line.startsWith('#') || previousStart < (k ? sections[k - 1].end : 0)) break;
        lead = lineStart = previousStart;
    }
    return lead;
}

/**
 * Joins the spans of every entry and lets every table written in sections (or named by other
 * keys) cover its spans, for the tree and the code.
 * @param {string} text - the code.
 * @param {TomlNode} node - the table or array to go through.
 * @returns {void}
 */
function setTableRanges(text, node) {
    if (!isContainerNode(node)) return;
    for (const entry of node.entries) {
        setTableRanges(text, entry.node);
        if (!entry.spans || !entry.spans.length) continue;
        entry.spans = mergeRanges(entry.spans);
        if ((!entry.node.inline && !isContainerNode(entry.node)) || entry.mode === 'line') continue;
        if (entry.mode === 'section' || entry.mode === 'implicit') setSectionTableRange(text, entry);
    }
}

/**
 * Sets the range of a table written in sections or named by other keys, and where its entry starts.
 * @param {string} text - the code.
 * @param {TomlEntry} entry - the table's entry.
 * @returns {void}
 */
function setSectionTableRange(text, entry) {
    const node = entry.node;
    node.start = Math.min(node.start, ...entry.spans.map(span => span[0]));
    node.end = Math.max(...entry.spans.map(span => getTrimmedEnd(text, span[1])));
    if (entry.mode === 'implicit' && entry.refs.length) entry.start = Math.min(...entry.refs.map(ref => ref[0]));
    else if (node.headers && node.headers.length) entry.start = node.headers[0].start;
    else if (node.type === 'array' && node.entries[0]) entry.start = node.entries[0].node.headers[0].start;
}

/**
 * Creates the function that finds the value at a position: the deepest node one of whose own
 * places holds it.
 * @param {TomlNode} root - the root table.
 * @returns {function(number): TomlNode} the finder (DataModel.at).
 */
function createNodeFinder(root) {
    /**
     * Returns the deepest node one of whose own places holds a position.
     * @param {number} position - the position in the code.
     * @returns {TomlNode} the node, the root table when no entry holds the position.
     */
    const getNodeAt = position => {
        let best = root;
        /**
         * Goes into the entry whose place holds the position, as deep as one does.
         * @param {TomlNode} node - the table or array to look in.
         * @returns {void}
         */
        const findIn = node => {
            if (!isContainerNode(node)) return;
            const entry = node.entries.find(item => isAtEntry(item, position));
            if (entry) { best = entry.node; findIn(entry.node); }
        };
        findIn(root);
        return best;
    };
    return getNodeAt;
}

/**
 * Tells whether a position lies in one of an entry's own places.
 * @param {TomlEntry} entry - the entry.
 * @param {number} position - the position.
 * @returns {boolean} true when the position belongs to the entry.
 */
function isAtEntry(entry, position) {
    if (entry.mode === 'inline') return position >= entry.start && position <= entry.node.end;
    if (entry.mode === 'line') return !!(entry.line && position >= entry.line[0] && position < Math.max(entry.line[1], entry.line[0] + 1)) || (position >= entry.node.start && position <= entry.node.end);
    return (entry.spans || []).some(span => position >= span[0] && position < span[1]) || (entry.refs || []).some(ref => position >= ref[0] && position <= ref[1]);
}
