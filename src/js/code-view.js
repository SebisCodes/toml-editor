/**
 * The code view: a textarea with the highlighted code, the problem marks and the line numbers
 * behind it, a band on the line with the cursor, and the status below it (lines and size).
 */

import { highlight, escapeHtml } from './datatree.js?v=13';
import { state, areas, ui, EDITOR, LINE_HEIGHT, NARROW_SCREEN, formatSize } from './state.js?v=2';
import { getLineIndex, getColumnIndex } from './text-position.js?v=2';
import { updateHistoryButtons } from './history.js?v=4';

/** Longer code is shown without highlighting, so typing stays fast. */
const MAX_HIGHLIGHT_LENGTH = 600000;
/** The padding above the first line, in pixels. */
const CODE_PADDING_TOP = 10;
/** The cursor is scrolled into view when it is closer to the bottom than this many lines (to the top: one line). */
const SCROLL_MARGIN_LINES = 2;
/** A line scrolled into view stands this far down the code view (a third of its height). */
const SCROLL_TARGET_SHARE = 1 / 3;
/** Room kept right of the cursor before the code scrolls sideways, in pixels. */
const SCROLL_MARGIN_RIGHT = 60;
/** Room kept left of the cursor after the code scrolls sideways, in pixels. */
const SCROLL_MARGIN_LEFT = 40;
/** The number of characters measured for the character width. */
const MEASURE_LENGTH = 100;

/** The band on the line with the cursor, so the cursor is easy to find. */
const lineBand = document.createElement('div');
let characterWidth = 0;

/**
 * Adds the band of the cursor's line behind the code.
 * @returns {void}
 */
export function startCodeView() {
    lineBand.className = 'line-band';
    lineBand.setAttribute('aria-hidden', 'true');
    ui.marks.before(lineBand);
}

/**
 * Draws the highlighted code, the problem marks, the line wrap and the status below the code.
 * @returns {void}
 */
export function renderCode() {
    const code = state.code;
    ui.hl.innerHTML = code.length < MAX_HIGHLIGHT_LENGTH ? highlight(EDITOR.editor, code) + '\n' : escapeHtml(code) + '\n';
    renderMarks();
    const lines = code.split('\n').length;
    areas.lineWrap.update(code);
    const bytes = new Blob([code]).size;
    ui.status.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'} · ${formatSize(bytes)}`;
    updateHistoryButtons();
}

/**
 * Gives lines with problems a colored background (one mark per line, the first problem's kind).
 * @returns {void}
 */
export function renderMarks() {
    const code = state.code;
    const ranges = getMarkRanges(code);
    let html = '', last = 0;
    for (const [start, end, className] of ranges) {
        if (start < last) continue;
        html += escapeHtml(code.slice(last, start)) + `<mark class="${className}">` + escapeHtml(code.slice(start, end) || ' ') + '</mark>';
        last = end;
    }
    ui.marks.innerHTML = html + escapeHtml(code.slice(last)) + '\n';
}

/**
 * Returns the lines to mark, sorted by position.
 * @param {string} code - the code.
 * @returns {Array<[number, number, string]>} start, end and class of each marked line.
 */
function getMarkRanges(code) {
    const ranges = [];
    const seen = new Set();
    for (const problem of state.problems) {
        const lineStart = code.lastIndexOf('\n', problem.pos - 1) + 1;
        if (seen.has(lineStart)) continue;
        seen.add(lineStart);
        let lineEnd = code.indexOf('\n', lineStart);
        if (lineEnd < 0) lineEnd = code.length;
        ranges.push([lineStart, Math.max(lineEnd, lineStart + 1), getProblemClass(problem.kind)]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    return ranges;
}

/**
 * Returns the CSS class of a problem's mark and list entry.
 * @param {string} kind - the kind of problem: "error", "schema" or a note.
 * @returns {string} "err", "schema" or "warn".
 */
export function getProblemClass(kind) {
    return kind === 'error' ? 'err' : kind === 'schema' ? 'schema' : 'warn';
}

/**
 * Moves the highlighting, the marks and the line numbers with the textarea's scroll.
 * @returns {void}
 */
export function syncScroll() {
    const offset = `translate(${-ui.ta.scrollLeft}px, ${-ui.ta.scrollTop}px)`;
    ui.hl.style.transform = offset;
    ui.marks.style.transform = offset;
    ui.gutter.style.transform = `translateY(${-ui.ta.scrollTop}px)`;
    showLineBand();
}

/**
 * Puts the band on the line with the cursor; hides it while text is selected in the code.
 * @returns {void}
 */
export function showLineBand() {
    const ta = ui.ta;
    lineBand.hidden = ta.selectionStart !== ta.selectionEnd && document.activeElement === ta;
    const line = getLineIndex(ta.selectionStart);
    lineBand.style.transform = `translateY(${CODE_PADDING_TOP + areas.lineWrap.getLineTop(line) - ta.scrollTop}px)`;
    lineBand.style.height = areas.lineWrap.getLineHeight(line) + 'px';
}

/**
 * Returns the width of one character of the code's font, measured once (a query that fills a
 * cache).
 * @returns {number} the width in pixels.
 */
function getCharacterWidth() {
    if (!characterWidth) {
        const probe = document.createElement('span');
        probe.textContent = 'x'.repeat(MEASURE_LENGTH);
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
        probe.style.font = getComputedStyle(ui.ta).font;
        document.body.appendChild(probe);
        characterWidth = probe.getBoundingClientRect().width / MEASURE_LENGTH;
        probe.remove();
    }
    return characterWidth;
}

/**
 * Puts the cursor (or a selection) at a position and scrolls the code there.
 * @param {number} position - the start of the selection.
 * @param {boolean} [focus] - true to focus the code (not on narrow screens).
 * @param {number} [selectionEnd] - the end of the selection.
 * @returns {void}
 */
export function showCodePosition(position, focus = true, selectionEnd = position) {
    const ta = ui.ta;
    if (focus && !NARROW_SCREEN.matches) ta.focus({ preventScroll: true });
    ta.setSelectionRange(position, selectionEnd);
    const top = areas.lineWrap.getLineTop(getLineIndex(position)), height = ta.clientHeight;
    if (top < ta.scrollTop + LINE_HEIGHT || top > ta.scrollTop + height - LINE_HEIGHT * SCROLL_MARGIN_LINES) ta.scrollTop = Math.max(0, top - height * SCROLL_TARGET_SHARE);
    const left = getColumnIndex(position) * getCharacterWidth();
    if (left < ta.scrollLeft || left > ta.scrollLeft + ta.clientWidth - SCROLL_MARGIN_RIGHT) ta.scrollLeft = Math.max(0, left - SCROLL_MARGIN_LEFT);
    syncScroll();
}
