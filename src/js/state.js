/**
 * The editor's state and the parts every module shares: what makes this the TOML editor, the
 * open document as code and as a model, the undo history, the page elements, the areas set up
 * at start (tree, line wrap, sync …) and a few small helpers.
 *
 * The code is the single source of truth: the tree is made from it (datatree.js with the TOML
 * reader of toml.js), and every change in the tree is a small edit of the code that keeps the
 * rest of its formatting and its comments.
 *
 * The field names of the state are read by the tests through window.tomlEditor.state.
 */

/** What makes this the TOML editor. */
export const EDITOR = {
    prefix: 'tomleditor', editor: 'toml', name: 'TOML', ext: 'toml', mime: 'application/toml',
    other: { name: 'JSON Editor', site: 'https://json.giit.ch/', kind: 'json', ext: 'json' },
};
/** The localStorage key of the settings and the open document's id. */
export const SETTINGS_KEY = EDITOR.prefix + '.v1';
/** The height of one line of code, in pixels. */
export const LINE_HEIGHT = 20;
/** The width below which the editor shows one view at a time. */
export const NARROW_SCREEN = matchMedia('(max-width: 860px)');
/** The name of a document without one. */
export const DEFAULT_NAME = 'Document';
/** The name of a document from the AI without a name of its own. */
export const AI_DOCUMENT = 'AI document';
/** The message shown when the browser storage is full. */
export const STORAGE_FULL = 'The browser storage is full';
/** The message shown when the tree is used while the code has a syntax error. */
export const SYNTAX_ERROR_FIRST = 'The code has a syntax error - fix it first (see above the code), then edit in the tree';
/** The message shown when a conversion meets a syntax error. */
export const FIX_SYNTAX_ERROR = 'The code has a syntax error - fix it first (see above the code)';
/** The message shown when the document has no data. */
export const NO_DATA = 'The document has no data yet';
/** The message shown when a tree action needs a selected value. */
export const CHOOSE_VALUE = 'Choose a value in the tree first';
/** The message shown when an entry is added to a root that is a single value. */
export const ROOT_IS_VALUE = 'The root is a single value - change its type to object or array first';
/** The fields that take typing: shortcuts and pasting a whole document leave them alone. */
export const TYPING_FIELDS = 'textarea, select, [contenteditable], input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=button])';
/** How long a toast stays, in milliseconds. */
const TOAST_TIME = 2600;

/**
 * A step of the undo history.
 * @typedef {object} HistoryStep
 * @property {string} code - the code.
 * @property {number} sel - the cursor in the code.
 * @property {object|null} tree - the place selected in the tree (createTree().getSelectedPlace()).
 */

/**
 * A problem listed above the code (datatree.js and the schema check).
 * @typedef {object} Problem
 * @property {number} pos - the position in the code.
 * @property {number} [end] - the end of the place in the code.
 * @property {string} kind - "error", "warn" or "schema".
 * @property {string} msg - the message.
 */

/**
 * The editor's state.
 * @typedef {object} EditorState
 * @property {string} code - the document's code.
 * @property {object|null} model - the code as read by datatree.js parse().
 * @property {Problem[]} problems - the problems, sorted by position.
 * @property {number} split - the share of the width the code takes.
 * @property {string} name - the document's name.
 * @property {string} fileId - the document's id in "My documents", "" for none.
 * @property {HistoryStep[]} history - the undo steps; the last one is the current code.
 * @property {HistoryStep[]} future - the redo steps.
 * @property {number} histTimer - the timer that makes an undo step of typing.
 * @property {boolean} showProblems - true when the list of problems is open.
 * @property {string|null} savedCode - the code as last stored or read from storage.
 * @property {number} modelTimer - the timer that reads the code after typing.
 * @property {number} saveTimer - the timer that stores the code after typing.
 */

/** @type {EditorState} */
export const state = {
    code: '', model: null, problems: [],
    split: 0.45,
    name: DEFAULT_NAME, fileId: '',
    history: [], future: [], histTimer: 0,
    showProblems: true,
    savedCode: null, modelTimer: 0, saveTimer: 0,
};

/**
 * The areas set up at start by app.js; null until then.
 * @typedef {object} EditorAreas
 * @property {object|null} i18n - the interface language (i18n.js).
 * @property {object|null} lineWrap - the line wrap of the code view (wrap.js).
 * @property {object|null} tree - the data tree (datatree.js createTree()).
 * @property {object|null} files - the "My documents" dialog (files.js).
 * @property {object|null} sync - webhook and embedding (sync.js).
 * @property {{updateRemote: function(): void}|null} ai - the AI Assistant.
 * @property {object|null} aiStatus - the AI status at the button (aistatus.js).
 */

/** @type {EditorAreas} */
export const areas = { i18n: null, lineWrap: null, tree: null, files: null, sync: null, ai: null, aiStatus: null };

/** The undo history of each document opened while the page is open, by id. */
export const historyByDocument = new Map();

/**
 * Returns the first element that matches a selector.
 * @param {string} selector - the CSS selector.
 * @param {ParentNode} [root] - where to look.
 * @returns {HTMLElement|null} the element.
 */
export function getElement(selector, root = document) {
    return root.querySelector(selector);
}

/**
 * Returns every element that matches a selector.
 * @param {string} selector - the CSS selector.
 * @param {ParentNode} [root] - where to look.
 * @returns {HTMLElement[]} the elements.
 */
export function getElements(selector, root = document) {
    return [...root.querySelectorAll(selector)];
}

/** The elements the modules use. */
export const ui = {
    ta: getElement('#code'), hl: getElement('#hl'), marks: getElement('#marks'), gutter: getElement('#gutter'),
    status: getElement('#code-status'), error: getElement('#code-error'),
    tree: getElement('#tree'), node: getElement('#node-wrap'), insert: getElement('#insert-wrap'), convert: getElement('#convert-wrap'), schema: getElement('#schema-wrap'),
    work: getElement('#work'), toast: getElement('#toast'),
};

let toastTimer = 0;

/**
 * Translates an interface text into the page's language.
 * @param {string} text - the English text.
 * @returns {string} the translation, or the text as it is.
 */
export function translate(text) {
    return areas.i18n.translate(text);
}

/**
 * Shows a short message at the bottom of the page.
 * @param {string} message - the message.
 * @returns {void}
 */
export function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('shown'), TOAST_TIME);
}

/**
 * Returns a number kept between two limits.
 * @param {number} value - the number.
 * @param {number} min - the lower limit.
 * @param {number} max - the upper limit.
 * @returns {number} the number inside the limits.
 */
export function getClamped(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Tells whether the open document has data (a root value in at least one of its documents).
 * @returns {boolean} true when the model has a root value.
 */
export function hasData() {
    return !!state.model && state.model.docs.some(doc => doc.root);
}

/**
 * Returns a size for the screen: bytes below 1 KB, else KB with one decimal.
 * @param {number} bytes - the size in bytes.
 * @returns {string} the size with its unit ("512 B", "1.5 KB").
 */
export function formatSize(bytes) {
    return bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB';
}
