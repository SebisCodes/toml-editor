/**
 * The problems above the code: a count of errors, schema problems and notes, and the list with
 * line and column. A click on a problem selects its place in the code and its value in the tree.
 */

import { escapeHtml } from './datatree.js?v=13';
import { getTreeNodeAtCode } from './tree-views.js?v=1';
import { state, areas, ui, NARROW_SCREEN } from './state.js?v=2';
import { getLineIndex, getColumnIndex } from './text-position.js?v=2';
import { showCodePosition, getProblemClass } from './code-view.js?v=5';
import { showPane } from './layout.js?v=5';

/** The most problems the list shows. */
const MAX_LISTED_PROBLEMS = 80;
/** The sign of a problem by its kind. */
const PROBLEM_SIGN = { err: '✕', schema: '§', warn: '!' };

/**
 * Draws the problems above the code, or hides the box when there are none.
 * @returns {void}
 */
export function renderProblems() {
    const problems = state.problems;
    const box = ui.error;
    if (!problems.length) { box.hidden = true; return; }
    const errors = problems.filter(problem => problem.kind === 'error').length;
    const items = problems.slice(0, MAX_LISTED_PROBLEMS).map(renderProblemItem).join('');
    box.innerHTML = `<div class="pr-header"><span>${getProblemCounts(problems).join(' · ')}</span><button type="button" class="button small" data-toggle-probs>${state.showProblems ? 'Hide' : 'Show'}</button></div>${state.showProblems ? `<ul>${items}</ul>` : ''}`;
    box.classList.toggle('only-warnings', !errors);
    box.hidden = false;
}

/**
 * Returns the counts of errors, schema problems and notes as text, leaving out the kinds with none.
 * @param {import('./state.js').Problem[]} problems - the problems.
 * @returns {string[]} the counts as HTML ("<b>2 errors</b>", "1 schema problem", "3 notes").
 */
function getProblemCounts(problems) {
    const errors = problems.filter(problem => problem.kind === 'error').length;
    const schemaProblems = problems.filter(problem => problem.kind === 'schema').length;
    const notes = problems.length - errors - schemaProblems;
    const parts = [];
    if (errors) parts.push(`<b>${errors} ${errors === 1 ? 'error' : 'errors'}</b>`);
    if (schemaProblems) parts.push(`${schemaProblems} ${schemaProblems === 1 ? 'schema problem' : 'schema problems'}`);
    if (notes) parts.push(`${notes} ${notes === 1 ? 'note' : 'notes'}`);
    return parts;
}

/**
 * Returns the list entry of one problem.
 * @param {import('./state.js').Problem} problem - the problem.
 * @param {number} index - its index in the problems.
 * @returns {string} the HTML of the entry.
 */
function renderProblemItem(problem, index) {
    const className = getProblemClass(problem.kind);
    return `<li class="${className}"><div class="pr-row" role="button" tabindex="0" data-prob="${index}"><span class="kind">${PROBLEM_SIGN[className]}</span><span class="line-number">Line ${getLineIndex(problem.pos) + 1}, column ${getColumnIndex(problem.pos) + 1}</span><span>${escapeHtml(problem.msg)}</span></div></li>`;
}

/**
 * Connects the problem list: Enter and Space press a problem, a click shows it or opens and
 * closes the list.
 * @returns {void}
 */
export function startProblems() {
    ui.error.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-prob]')) { event.preventDefault(); event.target.click(); }
    });
    ui.error.addEventListener('click', showClickedProblem);
}

/**
 * Shows the problem that was clicked in the code and in the tree, or opens and closes the list
 * (a click handler).
 * @param {MouseEvent} event - the click.
 * @returns {void}
 */
function showClickedProblem(event) {
    if (event.target.closest('[data-prob]') && String(getSelection())) return;   // the user selects the text to copy it
    if (event.target.closest('[data-toggle-probs]')) { state.showProblems = !state.showProblems; renderProblems(); return; }
    const row = event.target.closest('[data-prob]');
    if (!row) return;
    const problem = state.problems[+row.dataset.prob];
    if (NARROW_SCREEN.matches) showPane('code');
    showCodePosition(problem.pos, true, Math.max(problem.pos, Math.min(problem.end ?? problem.pos, state.code.length)));
    const node = getTreeNodeAtCode(problem.pos);
    if (node) areas.tree.selectNode(node);
}
