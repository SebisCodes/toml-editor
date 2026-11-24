/**
 * Typing in the code: each input is drawn at once, read into the model and stored after a
 * pause and made an undo step after a longer pause. Typing help: Tab and Shift+Tab indent,
 * Enter keeps the indentation (one level deeper after "{" or "["), brackets and quotes come in
 * pairs or go around a selection, Ctrl+Z / Ctrl+Y undo and redo, Ctrl+/ turns lines into
 * comments.
 */

import { getIndentUnit } from './datatree.js?v=13';
import { state, areas, ui } from './state.js?v=2';
import { renderCode, syncScroll } from './code-view.js?v=4';
import { startModelUpdate } from './model.js?v=4';
import { addHistoryStep, undo, redo } from './history.js?v=4';
import { saveToStorage } from './storage.js?v=4';

/** Code longer than this waits longer before it is read again. */
const LARGE_CODE_LENGTH = 200000;
/** The pause before large code is read again, in milliseconds. */
const LARGE_CODE_DELAY = 600;
/** The pause before code is read again, in milliseconds. */
const CODE_DELAY = 220;
/** The pause before typing becomes an undo step, in milliseconds. */
const HISTORY_DELAY = 600;
/** The pause before typing is stored, in milliseconds. */
const SAVE_DELAY = 400;
/** The keys of undo (both cases, Shift turns it into redo) and redo with Ctrl or Cmd. */
const UNDO_KEYS = ['z', 'Z'], REDO_KEY = 'y';
/** The characters that come in pairs, with their partner. */
const PAIRS = { '{': '}', '[': ']', '"': '"', "'": "'" };

/**
 * Connects typing, scrolling and the typing help of the code.
 * @returns {void}
 */
export function startCodeInput() {
    ui.ta.addEventListener('input', readTypedCode);
    ui.ta.addEventListener('scroll', syncScroll);
    ui.ta.addEventListener('keydown', handleCodeKey);
}

/**
 * Takes the typed code: draws it, and reads, stores and makes an undo step of it after a pause.
 * @returns {void}
 */
function readTypedCode() {
    state.code = ui.ta.value;
    renderCode();
    startModelUpdate(state.code.length > LARGE_CODE_LENGTH ? LARGE_CODE_DELAY : CODE_DELAY);
    clearTimeout(state.histTimer);
    state.histTimer = setTimeout(addHistoryStep, HISTORY_DELAY);
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveToStorage, SAVE_DELAY);
    areas.sync?.handleChange();
}

/**
 * Writes text over a range of the code, with the browser's own undo where it can, and sets the
 * selection after it.
 * @param {number} start - the start of the range.
 * @param {number} end - the end of the range.
 * @param {string} text - the new text.
 * @param {number} [selectionStart] - the start of the selection afterwards (else the end of the text).
 * @param {number} [selectionEnd] - the end of the selection afterwards.
 * @returns {void}
 */
export function writeCodeRange(start, end, text, selectionStart, selectionEnd) {
    const ta = ui.ta;
    if (document.activeElement !== ta) ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, end);
    // execCommand keeps the edit in the browser's own undo and assistive tech; the fallback sets the text directly.
    if (!document.execCommand || !document.execCommand('insertText', false, text)) {
        ta.setRangeText(text, start, end, 'end');
        ta.dispatchEvent(new Event('input'));
    }
    if (selectionStart != null) ta.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
}

/**
 * Answers a key in the code: undo and redo, Escape, Tab, Enter, pairs (a keydown handler).
 * @param {KeyboardEvent} event - the key.
 * @returns {void}
 */
function handleCodeKey(event) {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && !event.altKey && UNDO_KEYS.includes(event.key)) { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (modifier && event.key === REDO_KEY) { event.preventDefault(); redo(); return; }
    if (event.key === 'Escape') { ui.ta.blur(); return; }
    if (modifier && event.key === '/') { event.preventDefault(); applyLineCommentSwitch(); return; }
    if (event.key === 'Tab') { event.preventDefault(); writeIndent(event.shiftKey); return; }
    if (event.key === 'Enter' && !modifier && !event.isComposing) { event.preventDefault(); writeLineBreak(); return; }
    if (!modifier) writePairs(event);
}

/**
 * Tab: one indentation unit at the cursor, or the selected lines one level deeper; Shift+Tab:
 * the selected lines one level back.
 * @param {boolean} outdent - true for Shift+Tab.
 * @returns {void}
 */
function writeIndent(outdent) {
    const code = ui.ta.value, start = ui.ta.selectionStart, end = ui.ta.selectionEnd;
    const unit = getIndentUnit(code);
    const lineStart = code.lastIndexOf('\n', start - 1) + 1;
    if (start === end && !outdent) { writeCodeRange(start, end, unit); return; }
    const lineEnd = code.indexOf('\n', end - (end > start && code[end - 1] === '\n' ? 1 : 0));
    const rangeEnd = lineEnd < 0 ? code.length : lineEnd;
    const lines = code.slice(lineStart, rangeEnd).split('\n');
    const strip = new RegExp('^(?:' + (unit === '\t' ? '\\t' : ' {1,' + unit.length + '}') + ')');
    const indented = lines.map(line => (outdent ? line.replace(strip, '') : unit + line)).join('\n');
    writeCodeRange(lineStart, rangeEnd, indented, lineStart, lineStart + indented.length);
}

/**
 * Enter: a new line with the indentation of this one, one level deeper after "{" or "[" (and the
 * closing bracket on a line of its own when it follows).
 * @returns {void}
 */
function writeLineBreak() {
    const code = ui.ta.value, start = ui.ta.selectionStart, end = ui.ta.selectionEnd;
    const unit = getIndentUnit(code);
    const lineStart = code.lastIndexOf('\n', start - 1) + 1;
    const indent = /^[ \t]*/.exec(code.slice(lineStart))[0];
    const before = code.slice(lineStart, start).trimEnd(), after = code.slice(end).trimStart();
    if (/[{[]$/.test(before)) {
        if ((before.endsWith('{') && after.startsWith('}')) || (before.endsWith('[') && after.startsWith(']'))) {
            writeCodeRange(start, end, '\n' + indent + unit + '\n' + indent, start + 1 + indent.length + unit.length);
            return;
        }
        writeCodeRange(start, end, '\n' + indent + unit);
        return;
    }
    writeCodeRange(start, end, '\n' + indent);
}

/**
 * Quotes and brackets around a selection; "{" and "[" get their partner; a typed "}" or "]"
 * steps over the one that is there.
 * @param {KeyboardEvent} event - the key (without Ctrl or Cmd).
 * @returns {void}
 */
function writePairs(event) {
    const code = ui.ta.value, start = ui.ta.selectionStart, end = ui.ta.selectionEnd;
    if (PAIRS[event.key] && !event.isComposing) {
        if (start !== end) { event.preventDefault(); writeCodeRange(start, end, event.key + code.slice(start, end) + PAIRS[event.key], start + 1, end + 1); return; }
        if ((event.key === '{' || event.key === '[') && /^(\s|$|[,\]}])/.test(code.slice(start, start + 1))) { event.preventDefault(); writeCodeRange(start, end, event.key + PAIRS[event.key], start + 1); return; }
    }
    if ((event.key === '}' || event.key === ']') && start === end && code[start] === event.key) { event.preventDefault(); ui.ta.setSelectionRange(start + 1, start + 1); }
}

/**
 * Ctrl+/: the selected lines become comments (#), or stop being comments when they all are.
 * @returns {void}
 */
function applyLineCommentSwitch() {
    const code = ui.ta.value, start = ui.ta.selectionStart, end = ui.ta.selectionEnd;
    const lineStart = code.lastIndexOf('\n', start - 1) + 1;
    const lineEndFound = code.indexOf('\n', end - (end > start && code[end - 1] === '\n' ? 1 : 0));
    const lineEnd = lineEndFound < 0 ? code.length : lineEndFound;
    const lines = code.slice(lineStart, lineEnd).split('\n');
    const allComments = lines.every(line => !line.trim() || /^\s*#/.test(line));
    const switched = lines.map(line => (!line.trim() ? line : allComments ? line.replace(/^(\s*)# ?/, '$1') : line.replace(/^(\s*)/, '$1# '))).join('\n');
    writeCodeRange(lineStart, lineEnd, switched, lineStart, lineStart + switched.length);
}
