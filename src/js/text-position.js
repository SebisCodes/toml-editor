/**
 * Lines and columns of positions in the open document's code, and the other way round.
 * Lines and columns are 0-based here; the screen and the tools add 1.
 */

import { state } from './state.js?v=2';

/**
 * Returns the line of a position in the open document's code.
 * @param {number} position - the character offset.
 * @returns {number} the line, 0-based.
 */
export function getLineIndex(position) {
    let line = 0;
    for (let i = state.code.indexOf('\n'); i >= 0 && i < position; i = state.code.indexOf('\n', i + 1)) line++;
    return line;
}

/**
 * Returns the column of a position in the open document's code.
 * @param {number} position - the character offset.
 * @returns {number} the column, 0-based.
 */
export function getColumnIndex(position) {
    return position - (state.code.lastIndexOf('\n', position - 1) + 1);
}

/**
 * Returns where a line of the open document's code starts; past the last line, the end of the
 * code (also for a huge or endless number).
 * @param {number} line - the line, 1-based.
 * @returns {number} the character offset of its start.
 */
export function getLinePosition(line) {
    let position = 0;
    for (let current = 1; current < line; current++) {
        const lineEnd = state.code.indexOf('\n', position);
        if (lineEnd < 0) return state.code.length;
        position = lineEnd + 1;
    }
    return position;
}

/**
 * Returns the line of a position in any text.
 * @param {string} text - the text.
 * @param {number} position - the character offset.
 * @returns {number} the line, 0-based.
 */
export function getLineIndexIn(text, position) {
    return text.slice(0, position).split('\n').length - 1;
}
