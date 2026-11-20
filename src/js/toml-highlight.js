/**
 * Highlighting of TOML code: the code as HTML with a span of a class around every token.
 * Classes: c comment, a [header], k key, s string value, p punctuation, e true / false,
 * d number, date or time, v another value. A token over several lines gets a span on each line
 * (the view lays out the code line by line). The text stays exactly as it is.
 */

import { readDateTime } from './toml-read.js?v=3';

/** The longest word looked at for one value or key. */
const MAX_WORD_LENGTH = 200;
/** Up to two quotes right after the closing three belong to a multi-line string. */
const MAX_EXTRA_QUOTES = 2;

/**
 * Returns text with &, <, > and " as HTML entities.
 * @param {*} text - the text.
 * @returns {string} the escaped text.
 */
function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Returns text in a span of a class, "" for empty text.
 * @param {string} className - the class.
 * @param {string} text - the text.
 * @returns {string} the HTML.
 */
function renderSpan(className, text) {
    return text ? `<span class="${className}">${escapeHtml(text)}</span>` : '';
}

/**
 * Returns TOML code as highlighted HTML.
 * @param {string} text - the code.
 * @returns {string} the HTML.
 */
export function highlightToml(text) {
    return new TomlHighlighter(text).render();
}

/**
 * Goes through the code token by token and collects the HTML. Its read methods move the
 * position as they write (a reader that consumes its input).
 */
class TomlHighlighter {
    /**
     * Creates a highlighter at the start of the code.
     * @param {string} text - the code.
     * @returns {void}
     */
    constructor(text) {
        this.src = text;
        this.position = 0;
        this.html = [];
        /** True at the start of a line, where a [header] can stand. */
        this.atLineStart = true;
        /** True after "=", where a value stands. */
        this.afterEquals = false;
        /** How many [ and { are open. */
        this.brackets = 0;
    }

    /**
     * Returns the whole code as HTML.
     * @returns {string} the HTML.
     */
    render() {
        while (this.position < this.src.length) this.readToken();
        return this.html.join('');
    }

    /**
     * Adds a part of the code to the HTML, in a span of a class on each of its lines.
     * @param {string} className - the class, "" for plain text.
     * @param {number} start - the start of the part.
     * @param {number} end - its end.
     * @returns {void}
     */
    addPart(className, start, end) {
        const part = this.src.slice(start, end);
        this.html.push(className ? part.split('\n').map(line => renderSpan(className, line)).join('\n') : escapeHtml(part));
    }

    /**
     * Reads one token at the position and adds it.
     * @returns {void}
     */
    readToken() {
        const src = this.src, character = src[this.position];
        if (character === '\n') { this.readLineBreak(); return; }
        if (character === ' ' || character === '\t' || character === '\r') { this.readSpaces(); return; }
        if (character === '#') { this.readComment(); return; }
        if (this.atLineStart && character === '[' && !this.brackets) { this.readHeader(); return; }
        if (character === '"' || character === "'") { this.readString(character); return; }
        if (this.readPunctuation(character)) return;
        this.readWord();
    }

    /**
     * Reads a line break; outside brackets the next line starts anew.
     * @returns {void}
     */
    readLineBreak() {
        this.html.push('\n');
        this.position++;
        if (!this.brackets) { this.atLineStart = true; this.afterEquals = false; }
    }

    /**
     * Reads spaces, tabs and carriage returns.
     * @returns {void}
     */
    readSpaces() {
        const start = this.position;
        while (this.src[this.position] === ' ' || this.src[this.position] === '\t' || this.src[this.position] === '\r') this.position++;
        this.addPart('', start, this.position);
    }

    /**
     * Reads a comment up to the end of its line.
     * @returns {void}
     */
    readComment() {
        const start = this.position;
        while (this.position < this.src.length && this.src[this.position] !== '\n') this.position++;
        this.addPart('c', start, this.position);
    }

    /**
     * Reads a [header] or [[header]] up to its last "]" on the line.
     * @returns {void}
     */
    readHeader() {
        const src = this.src, lineBreak = src.indexOf('\n', this.position);
        const lineEnd = lineBreak < 0 ? src.length : lineBreak;
        const close = src.slice(this.position, lineEnd).lastIndexOf(']');
        const end = close >= 0 ? this.position + close + 1 : lineEnd;
        this.addPart('a', this.position, end);
        this.position = end;
        this.atLineStart = false;
    }

    /**
     * Reads a string: a key before "=", else a value.
     * @param {string} quote - '"' or "'".
     * @returns {void}
     */
    readString(quote) {
        const src = this.src, start = this.position;
        if (src[this.position + 1] === quote && src[this.position + 2] === quote) {
            const close = src.indexOf(quote + quote + quote, this.position + 3);
            this.position = close < 0 ? src.length : close + 3;
            while (src[this.position] === quote && this.position - (close + 3) < MAX_EXTRA_QUOTES) this.position++;
        } else {
            this.position++;
            while (this.position < src.length && src[this.position] !== quote && src[this.position] !== '\n') { if (quote === '"' && src[this.position] === '\\') this.position++; this.position++; }
            if (src[this.position] === quote) this.position++;
        }
        this.addPart(!this.afterEquals && !this.brackets ? 'k' : 's', start, this.position);
    }

    /**
     * Reads "=", a bracket, a comma or a dot. Returns whether the character was one of them.
     * @param {string} character - the character at the position.
     * @returns {boolean} true when it was read.
     */
    readPunctuation(character) {
        if (character === '=') { this.afterEquals = true; this.atLineStart = false; }
        else if (character === '[' || character === '{') this.brackets++;
        else if (character === ']' || character === '}') this.brackets = Math.max(0, this.brackets - 1);
        else if (character !== ',' && character !== '.') return false;
        this.addPart('p', this.position, this.position + 1);
        this.position++;
        return true;
    }

    /**
     * Reads a word: a value after "=" or inside brackets (a date with a space before its time
     * is one value), else the bare parts of a key.
     * @returns {void}
     */
    readWord() {
        const src = this.src;
        const match = /^[^\s=,[\]{}#"']+/.exec(src.slice(this.position, this.position + MAX_WORD_LENGTH));
        if (!match) { this.addPart('', this.position, this.position + 1); this.position++; return; }
        let word = match[0];
        if (this.afterEquals || this.brackets) {
            const dateTime = /\d/.test(word[0]) ? readDateTime(src, this.position) : null;
            if (dateTime && !dateTime.bad && dateTime.end > this.position + word.length) word = src.slice(this.position, dateTime.end);
            this.addPart(/^(true|false)$/.test(word) ? 'e' : /^[+-]?(\d|inf|nan)/.test(word) ? 'd' : 'v', this.position, this.position + word.length);
        } else {
            const key = /^[A-Za-z0-9_-]+/.exec(word);
            word = key ? key[0] : word;
            this.addPart('k', this.position, this.position + word.length);
        }
        this.position += word.length;
        this.atLineStart = false;
    }
}
