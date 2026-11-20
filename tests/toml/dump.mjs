/**
 * Reads a JSON list of TOML texts (argv[2]) with toml.js (argv[3]) and prints for each the
 * tagged tree or the first error, for toml_test.py to compare with tomllib.
 */
import { readFileSync } from 'fs';
const { parseToml } = await import(process.argv[3]);
const docs = JSON.parse(readFileSync(process.argv[2], 'utf8'));

/**
 * Returns a node as a tagged tree: its TOML type and its value (numbers and dates as written).
 * @param {object} node - a node of the model.
 * @returns {{t: string, v: *}} the type and the value; tables and arrays hold tagged trees.
 */
function getTaggedTree(node) {
  if (node.type === 'object') return { t: 'table', v: node.entries.map(entry => [entry.key, getTaggedTree(entry.node)]) };
  if (node.type === 'array') return { t: 'array', v: node.entries.map(entry => getTaggedTree(entry.node)) };
  if (node.style === 'datetime') return { t: 'datetime', v: node.value };
  if (node.type === 'number') return { t: node.float ? 'float' : 'integer', v: node.raw };
  return { t: node.type, v: node.value };
}

const results = docs.map(src => {
  try {
    const model = parseToml(src);
    const error = model.problems.find(problem => problem.kind === 'error');
    if (error) return { error: error.msg, pos: error.pos };
    return { tree: getTaggedTree(model.docs[0].root) };
  } catch (e) { return { crash: String(e.stack) }; }
});
console.log(JSON.stringify(results));
