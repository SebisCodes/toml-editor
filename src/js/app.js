/**
 * TOML editor: the code on the left, the data as a tree in the middle, the selected value,
 * insert, convert and schema in the side panel. This file starts the editor and wires its
 * areas together; each area has its own module (state.js describes the shared state). TOML
 * itself is read and changed by toml.js, which joins the data tree of
 * datatree.js as a format of its own.
 *
 * The code is the single source of truth: the tree is made from it (datatree.js), and every
 * change in the tree is a small edit of the code that keeps the rest of its formatting and its
 * comments (tree-edit.js). A click in the tree puts the code's cursor on that value; the cursor
 * in the code marks its value in the tree.
 *
 * Start-up steps:
 *   1. TOML and the template syntax of ?template= join the data tree; the interface language
 *      (the AI prompt stays English) and the line wrap of the code;
 *   2. connect the areas: errors of data that expands too far, storage, code view, problems,
 *      tree, side panel, documents, opening files, keyboard, layout, Export, the dialogs and the
 *      controls of template placeholders;
 *   3. take the stored settings and open the last document (or the welcome example);
 *   4. read and draw the document, and again once the language pack is there;
 *   5. start the AI Assistant, the WebMCP tools, the AI status, "Open in another editor" and
 *      sync.js (webhook, embedding, ?src=);
 *   6. offer the test hook window.tomlEditor.
 */

import { importYamlLibrary, TooManyValues, addFormat, setTemplateSyntax } from './datatree.js?v=13';
import { getTemplateSyntax, getTemplateNameByAddress } from './template-tags.js?v=2';
import { TOML } from './toml.js?v=7';
import { START } from './samples.js?v=4';
import { createAi } from './ai.js?v=10';
import { createMcp } from './mcp.js?v=5';
import { createAiStatus } from './aistatus.js?v=9';
import { createI18n } from './i18n.js?v=22';
import { createWrap } from './wrap.js?v=5';
import { store } from './files.js?v=8';
import { createSync } from './sync.js?v=24';
import './export-menu.js?v=6';
import { startConvert } from './convert-to.js?v=15';
import { state, areas, ui, EDITOR, STORAGE_FULL, showToast, translate } from './state.js?v=2';
import { getSettings, startStorageSync } from './storage.js?v=4';
import { setCode, addHistoryStep, undo, redo } from './history.js?v=4';
import { updateModel, renderTreeView } from './model.js?v=4';
import { renderCode, syncScroll, showCodePosition, startCodeView } from './code-view.js?v=4';
import { startCodeInput } from './code-input.js?v=4';
import { startProblems } from './problems.js?v=4';
import { createTreeArea, startTreeBar } from './tree-view.js?v=4';
import { editData } from './tree-edit.js?v=4';
import { renderNode, startNodePanel } from './node-panel.js?v=4';
import { renderInsert, startInsertPanel } from './insert-panel.js?v=4';
import { startConvertPanel } from './convert-panel.js?v=4';
import { startSchemaPanel } from './schema-panel.js?v=4';
import { formatCodeAsStep, getConvertibleCode } from './conversion.js?v=4';
import { showFileName, openDocument, createDocumentsDialog, startDocumentButtons } from './documents.js?v=4';
import { startFileImport } from './file-import.js?v=4';
import { startKeyboard } from './keyboard.js?v=4';
import { showSplit, startLayout, startPanelTabs, startDialogs } from './layout.js?v=4';
import { startExportDialog } from './export-dialog.js?v=4';
import { receiveDocument, importExternalDocument } from './incoming.js?v=4';
import { startTemplateControls } from './template-panel.js?v=1';
import { createTemplateExamples } from './template-examples.js?v=2';
import { getViewMode, getTreeModel } from './tree-views.js?v=1';
import {
    getPromptState, getProblemList, getAgentValue, setAgentValue, getFileList, openFileByName, createFile, updateText, showAgentLine,
} from './agent-api.js?v=4';

/** The YAML package loads this long after the start, for converting to YAML. */
const YAML_LIBRARY_DELAY = 1500;

startEditor();

/**
 * Starts the editor (the flow of the steps in the header).
 * @returns {void}
 */
function startEditor() {
    addFormat(EDITOR.editor, TOML);
    setTemplateSyntax(getTemplateSyntax(getTemplateNameByAddress(location.search)));
    startLanguageAndWrap();
    connectAreas();
    openStartDocument();
    renderStart();
    window[EDITOR.editor + 'Editor'] = createTestHook();
}

/**
 * Starts the interface language (translated at run time, see i18n.js) and the line wrap of
 * the code view (wrap.js).
 * @returns {void}
 */
function startLanguageAndWrap() {
    areas.i18n = createI18n({
        prefix: 'tomleditor',
        roots: '.header, .views, #work, #ai-receive, #toast, .storage-hint, dialog',
        skip: '',
    });
    areas.lineWrap = createWrap({ prefix: EDITOR.prefix, ta: ui.ta, layers: [ui.hl, ui.marks], gutter: ui.gutter, button: document.getElementById('btn-wrap'), onChange: () => { renderCode(); syncScroll(); } });
}

/**
 * Connects the areas of the page, in the order their listeners take events.
 * @returns {void}
 */
function connectAreas() {
    startErrorMessages();
    startStorageSync();
    startCodeView();
    startProblems();
    areas.tree = createTreeArea();
    startTreeBar();
    startNodePanel();
    startInsertPanel();
    startCodeInput();
    startConvertPanel();
    startSchemaPanel();
    startPanelTabs();
    areas.files = createDocumentsDialog();
    startDocumentButtons();
    startFileImport();
    startKeyboard();
    startLayout();
    startExportDialog();
    startDialogs();
    startTemplateControls();
}

/**
 * Shows the message of data that expands past the limit of datatree.js (TooManyValues), which
 * stops an action such as convert, export or format.
 * @returns {void}
 */
function startErrorMessages() {
    addEventListener('error', event => { if (event.error instanceof TooManyValues) { event.preventDefault(); showToast(event.error.message); } });
    addEventListener('unhandledrejection', event => { if (event.reason instanceof TooManyValues) { event.preventDefault(); showToast(event.reason.message); } });
}

/**
 * Takes the stored settings and opens the last document, or the welcome example when
 * "My documents" is empty; with the storage blocked, the example without saving.
 * @returns {void}
 */
function openStartDocument() {
    const settings = getSettings();
    if (settings && settings.split) state.split = settings.split;
    showSplit();
    let code = null;
    try {
        if (!store.list().length) store.create(START.name, START.code);
        const entry = store.getEntry(settings?.file) || store.getSortedEntries()[0];
        code = store.code(entry.id);
        if (code != null) { state.fileId = entry.id; state.name = entry.name; state.savedCode = code; }
    } catch (e) { /* Storage blocked: one document without saving */ }
    if (code == null) { code = START.code; state.name = START.name; }
    state.code = code;
    ui.ta.value = code;
    showFileName();
    renderInsert();
}

/**
 * Reads and draws the start document in the next microtask, loads the YAML package a little
 * later (for conversions to and from YAML), then starts the AI and sync.js.
 * @returns {void}
 */
function renderStart() {
    Promise.resolve().then(renderStartDocument);
}

/**
 * Reads and draws the start document, selects its root, loads the YAML package after a delay
 * and starts the AI and sync.js.
 * @returns {void}
 */
function renderStartDocument() {
    updateModel();
    renderCode();
    areas.tree.select({ doc: 0, path: [] }, { scroll: false });
    renderNode();
    addHistoryStep();
    syncScroll();
    setTimeout(() => importYamlLibrary().catch(() => { /* converting to YAML is not possible then */ }), YAML_LIBRARY_DELAY);
    areas.i18n.ready.then(() => { areas.tree.render(); renderNode(); });
    startAiAndSync();
}

/**
 * Starts the AI Assistant, the WebMCP tools, the AI status, "Open in another editor" and
 * sync.js. The callbacks reach the areas through `areas`, so each may start after the ones
 * it calls.
 * @returns {void}
 */
function startAiAndSync() {
    areas.ai = createAi({
        getState: getPromptState,
        receiveDocument: async (...args) => { setTimeout(() => areas.aiStatus.addDelivery('link')); await receiveDocument(...args); return state.fileId; },
        tryOpenDocument: id => { if (!store.getEntry(id)) return false; openDocument(id); return true; },
        showToast,
        getRemote: () => areas.sync?.getAiSettings() || null,
        fetchKey: () => (areas.sync ? areas.sync.fetchKey() : Promise.resolve(null)),
        hasValidKey: () => !!areas.sync?.hasValidKey(),
        handleAiClick: openEditorDialog => (areas.sync ? areas.sync.handleAiClick(openEditorDialog) : openEditorDialog()),
        getKeyDecline: () => areas.sync?.getKeyDecline() || '',
    });
    const agent = createMcp({
        onUse: () => areas.aiStatus.addDelivery('agent'),
        getState: getPromptState,
        getProblems: getProblemList,
        getValue: getAgentValue,
        setValue: setAgentValue,
        getFiles: getFileList,
        openFileByName,
        createFile,
        receiveDocument,
        updateText,
        showLine: showAgentLine,
        undo,
    });
    areas.aiStatus = createAiStatus({
        prefix: EDITOR.prefix, btn: document.getElementById('btn-ai'), box: document.getElementById('ai-status'),
        remote: () => areas.sync?.getAiSettings() || null, agent: () => agent,
    });
    startConvert({ editor: 'toml', code: getConvertibleCode, name: () => state.name, toast: showToast, t: translate });
    areas.sync = createSync(createSyncEditor());
}

/**
 * Creates what sync.js gets from the editor; the property names are sync.js's contract.
 * @returns {object} the adapter.
 */
function createSyncEditor() {
    return {
        viewerAllow: '.trow-toggle',
        onAiResult: () => areas.aiStatus.addDelivery('page'),
        onAiEnd: () => areas.aiStatus.resetDelivery(),
        prefix: EDITOR.prefix, editor: EDITOR.editor, word: 'document',
        tidy: formatCodeAsStep,
        current: () => ({ id: state.fileId, name: state.name, content: state.code, assets: {} }),
        load: importExternalDocument,
        toast: showToast,
        hookFor: id => store.getEntry(id)?.hook || null,
        setHookFor: (id, hook) => { try { store.setEntryFields(id, { hook }); } catch (e) { showToast(STORAGE_FULL); } },
        onAi: () => areas.ai?.updateRemote(),
        parseTemplate: message => createTemplateExamples(message),
        onTemplate: () => renderTreeView(),
    };
}

/**
 * Creates the hook for automated UI tests (window.tomlEditor); its member names are the ones
 * the tests call.
 * @returns {object} the state and the functions the tests call.
 */
function createTestHook() {
    return {
        state, store, setCode, undo, redo, receive: receiveDocument, revealInCode: showCodePosition, tree: areas.tree,
        sync: () => areas.sync, analyse: updateModel, change: editData, loadYaml: importYamlLibrary,
        viewMode: getViewMode, treeModel: getTreeModel,
    };
}
