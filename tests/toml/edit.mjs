/**
 * Every edit from the tree on a set of documents (argv[3], a JSON list) with toml.js (argv[2]):
 * the new code must be valid TOML holding exactly the expected data (checked here and again
 * with tomllib by toml_test.py). Prints the count of edits, refusals and wrong results, and each
 * result.
 *
 * Steps for each valid document:
 *   1. list the changes for every entry (values, key, remove, duplicate, move, add) and for the root;
 *   2. work out the expected data of each change on a copy of the data (some are skipped);
 *   3. run the change and compare the data of the new code with the expected data.
 */
const T = await import(process.argv[2]);
const D = await import(process.argv[2].replace('toml.js', 'datatree.js') + '?v=9');
import { readFileSync } from 'fs';
const docs = JSON.parse(readFileSync(process.argv[3], 'utf8'));
/** Thrown by an expectation when its change is not checked. */
const SKIP = 'skip';

/**
 * Returns a deep copy of a value.
 * @param {*} value - the value.
 * @returns {*} the copy.
 */
function getCopy(value) {
  return structuredClone(value);
}

/**
 * Tells whether two values hold the same data; with ordered, the keys of the top level also in the same order.
 * @param {*} a - one value.
 * @param {*} b - the other.
 * @param {boolean} ordered - true to compare the order of the keys (nested levels never are).
 * @returns {boolean} true when they are equal.
 */
function isEqual(a, b, ordered) {
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => isEqual(item, b[i], ordered));
  if (a && typeof a === 'object') {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
    const keysA = Object.keys(a), keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    if (ordered && keysA.join('\u0000') !== keysB.join('\u0000')) return false;
    return keysA.every(key => key in b && isEqual(a[key], b[key], false));
  }
  return Object.is(a, b) || a === b;
}

/**
 * Returns the value at a path of plain data.
 * @param {*} value - the data.
 * @param {Array<string|number>} path - the path.
 * @returns {*} the value there.
 */
function getAt(value, path) {
  return path.reduce((item, key) => item[key], value);
}

/**
 * Returns every entry of a tree, depth first.
 * @param {object} root - the root node.
 * @returns {object[]} the entries.
 */
function getEntries(root) {
  const entries = [];
  /**
   * Adds the entries of a node and of the nodes below it.
   * @param {object} node - the node.
   * @returns {void}
   */
  const addEntries = node => { if (node.entries) for (const entry of node.entries) { entries.push(entry); addEntries(entry.node); } };
  addEntries(root);
  return entries;
}

/**
 * Sets a key's value in the data (the expectation of a value change).
 * @param {Array<string|number>} parentPath - the path of the key's table or array.
 * @param {string|number} key - the key.
 * @param {*} newValue - the new value.
 * @returns {function(*): void} the expectation, applied to a copy of the data.
 */
function createSetExpectation(parentPath, key, newValue) {
  return data => { getAt(data, parentPath)[key] = getCopy(newValue); };
}

/**
 * Returns the expectation of renaming a key to "renamed": the key keeps its place.
 * @param {object} entry - the entry.
 * @param {Array<string|number>} parentPath - the path of its table.
 * @returns {function(*): void} the expectation; it throws SKIP when "renamed" is taken.
 */
function createRenameExpectation(entry, parentPath) {
  return data => {
    const parent = getAt(data, parentPath);
    if ('renamed' in parent) throw SKIP;
    const renamed = {};
    for (const key of Object.keys(parent)) renamed[key === entry.key ? 'renamed' : key] = parent[key];
    for (const key of Object.keys(parent)) delete parent[key];
    Object.assign(parent, renamed);
  };
}

/**
 * Returns the expectation of moving an entry up or down.
 * @param {object} entry - the entry.
 * @param {Array<string|number>} parentPath - the path of its table or array.
 * @param {number} by - -1 up, 1 down.
 * @returns {function(*): void} the expectation; it throws SKIP at the ends and for integer-like keys.
 */
function createMoveExpectation(entry, parentPath, by) {
  return data => {
    const parent = getAt(data, parentPath);
    const target = entry.index + by;
    if (!Array.isArray(parent) && Object.keys(parent).some(key => /^\d+$/.test(key))) throw SKIP;
    if (target < 0 || target >= entry.parent.entries.length) throw SKIP;
    if (Array.isArray(parent)) { const [item] = parent.splice(entry.index, 1); parent.splice(target, 0, item); return; }
    const keys = Object.keys(parent);
    const [moved] = keys.splice(entry.index, 1);
    keys.splice(target, 0, moved);
    const reordered = {};
    for (const key of keys) reordered[key] = parent[key];
    for (const key of Object.keys(parent)) delete parent[key];
    Object.assign(parent, reordered);
  };
}

/**
 * Returns the expectation of adding a value to a table (as "added") or an array (at the end;
 * an array of tables gets a table).
 * @param {object} entry - the entry of the table or array.
 * @param {Array<string|number>} path - its path.
 * @param {*} newValue - the added value.
 * @returns {function(*): void} the expectation; it throws SKIP when "added" is taken.
 */
function createAddExpectation(entry, path, newValue) {
  return data => {
    const box = getAt(data, path);
    if (Array.isArray(box)) { box.push(entry.node.aot && (typeof newValue !== 'object' || Array.isArray(newValue)) ? {} : getCopy(newValue)); return; }
    if ('added' in box) throw SKIP;
    box.added = getCopy(newValue);
  };
}

/**
 * Returns the changes for one entry with their expectations.
 * @param {object} entry - the entry.
 * @returns {Array<Array>} each change, its expectation and, for a rename or a move, its kind.
 */
function getEntryChanges(entry) {
  const path = D.getPath(entry.node), parentPath = path.slice(0, -1), isTableKey = entry.parent.type === 'object';
  const changes = [];
  for (const newValue of ['new', 42, { q: 1, r: { s: 'x' } }, [1, 2]]) changes.push([{ kind: 'value', node: entry.node, value: newValue }, createSetExpectation(parentPath, entry.key, newValue)]);
  if (isTableKey) changes.push([{ kind: 'key', entry, key: 'renamed' }, createRenameExpectation(entry, parentPath), 'rename']);
  changes.push([{ kind: 'remove', entry }, data => { const parent = getAt(data, parentPath); if (Array.isArray(parent)) parent.splice(entry.key, 1); else delete parent[entry.key]; }]);
  changes.push([{ kind: 'duplicate', entry }, data => { const parent = getAt(data, parentPath); if (Array.isArray(parent)) parent.splice(entry.key + 1, 0, getCopy(parent[entry.key])); else parent[D.getFreeKey(entry.parent, entry.key + ' copy')] = getCopy(parent[entry.key]); }]);
  for (const by of [-1, 1]) changes.push([{ kind: 'move', entry, by }, createMoveExpectation(entry, parentPath, by), 'move']);
  if (D.getAliasTarget(entry.node).entries) {
    for (const newValue of ['', 7, { a: 1 }, [1], {}, [{ z: 1 }]]) changes.push([{ kind: 'add', box: entry.node, value: newValue, key: entry.node.type === 'object' ? 'added' : undefined }, createAddExpectation(entry, path, newValue)]);
  }
  return changes;
}

/**
 * Returns the changes that add to the root table, with their expectations.
 * @param {object} root - the root node.
 * @returns {Array<Array>} each change and its expectation.
 */
function getRootChanges(root) {
  return ['', { a: 1 }, [{ z: 1 }], {}].map(newValue => [{ kind: 'add', box: root, value: newValue, key: 'added' }, data => { if ('added' in data) throw SKIP; data.added = getCopy(newValue); }]);
}

const results = [];
let count = 0, refused = 0, wrong = 0;
for (const src of docs) {
  const model = T.parseToml(src);
  if (model.broken) continue;
  const value = D.getPlainValue(model.docs[0].root);
  const changes = [...getEntries(model.docs[0].root).flatMap(getEntryChanges), ...getRootChanges(model.docs[0].root)];
  for (const [change, expect, kind] of changes) {
    const wanted = getCopy(value);
    try { expect(wanted); } catch (x) { if (x === SKIP) continue; throw x; }
    count++;
    let result;
    try { result = T.editTomlCode(src, change); } catch (x) { refused++; results.push({ refused: String(x.message || x), op: change.kind, src }); continue; }
    const changed = T.parseToml(result.code);
    const got = changed.broken ? null : D.getPlainValue(changed.docs[0].root);
    // integer-like keys are ordered first by JavaScript objects, so the order is checked for moves only
    if (!got || !isEqual(wanted, got, kind === 'move')) { wrong++; results.push({ wrong: true, op: change.kind, path: D.getPath(change.node || change.entry?.node || change.box), src, code: result.code, err: changed.problems.find(problem => problem.kind === 'error')?.msg, want: wanted, got }); continue; }
    results.push({ ok: true, code: result.code, want: wanted });
  }
}
console.log(JSON.stringify({ n: count, refused, wrong, results }));
