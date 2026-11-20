/**
 * Small helpers on the TOML code that the reader, Format and the edits share: where a line
 * starts and ends, where text ends before spaces, and joining ranges of the code.
 */

/**
 * A range of the code: its start and its end (exclusive).
 * @typedef {number[]} CodeRange
 */

/**
 * Returns where the line of a position starts.
 * @param {string} text - the code.
 * @param {number} position - a character offset.
 * @returns {number} the offset of the line's first character.
 */
export function getLineStart(text, position) {
    return text.lastIndexOf('\n', position - 1) + 1;
}

/**
 * Returns where the line of a position ends.
 * @param {string} text - the code.
 * @param {number} position - a character offset.
 * @returns {number} the offset of the line break, or the end of the code.
 */
export function getLineEnd(text, position) {
    const lineBreak = text.indexOf('\n', position);
    return lineBreak < 0 ? text.length : lineBreak;
}

/**
 * Returns where the text before a position ends when spaces and line breaks are left out.
 * @param {string} text - the code.
 * @param {number} position - a character offset.
 * @returns {number} the offset after the last character before it that is no white space.
 */
export function getTrimmedEnd(text, position) {
    let end = position;
    while (end > 0 && /\s/.test(text[end - 1])) end--;
    return end;
}

/**
 * Returns ranges sorted and joined where they overlap or touch.
 * @param {CodeRange[]} ranges - the ranges (left as they are).
 * @returns {CodeRange[]} new ranges, sorted by start.
 */
export function mergeRanges(ranges) {
    const sorted = ranges.map(range => [range[0], range[1]]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of sorted) {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else merged.push(range);
    }
    return merged;
}

/**
 * Returns ranges joined as mergeRanges() does, and also where only white space lies between them.
 * @param {string} text - the code.
 * @param {CodeRange[]} ranges - the ranges.
 * @returns {CodeRange[]} new ranges, sorted by start.
 */
export function mergeLooseRanges(text, ranges) {
    const merged = [];
    for (const range of mergeRanges(ranges)) {
        const last = merged[merged.length - 1];
        if (last && !text.slice(last[1], range[0]).trim()) last[1] = range[1];
        else merged.push(range);
    }
    return merged;
}

/**
 * Returns text with a range replaced.
 * @param {string} text - the text.
 * @param {number} start - the start of the range.
 * @param {number} end - its end.
 * @param {string} insert - the text that takes its place.
 * @returns {string} the new text.
 */
export function getSpliced(text, start, end, insert) {
    return text.slice(0, start) + insert + text.slice(end);
}
