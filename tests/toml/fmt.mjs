/**
 * Formats every valid document of a JSON list (argv[3]) twice with toml.js (argv[2]), writes its
 * data as TOML and highlights it; prints the results for toml_test.py to check with tomllib, and
 * whether the text of every multi-line string is in the formatted code as written.
 */
const T = await import(process.argv[2]);
const D = await import(process.argv[2].replace('toml.js', 'datatree.js') + '?v=9');
import { readFileSync } from 'fs';
const docs = JSON.parse(readFileSync(process.argv[3], 'utf8'));

/**
 * Returns highlighted HTML as plain text again (tags removed, entities decoded).
 * @param {string} html - the highlighted code.
 * @returns {string} the text.
 */
function getPlainText(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/**
 * Collects the written text of every multi-line string in a node and below it, with LF line ends.
 * @param {string} src - the code.
 * @param {object} node - the node to go through.
 * @param {string[]} texts - the collector.
 * @returns {void} nothing; the collector gets the texts.
 */
function collectMultiLineStrings(src, node, texts) {
  if (!node) return;
  if (node.type === 'string' && /^multi/.test(node.style || '')) texts.push(src.slice(node.start, node.end).replace(/\r\n/g, '\n'));
  for (const entry of node.entries || []) collectMultiLineStrings(src, entry.node, texts);
}

const results = [];
for (const src of docs) {
  const model = T.parseToml(src);
  if (model.broken) continue;
  const value = D.getPlainValue(model.docs[0].root);
  let formatted, formattedTwice, written, error = null;
  try { formatted = T.formatToml(src); formattedTwice = T.formatToml(formatted); } catch (e) { error = 'format: ' + e.message; }
  try { written = T.convertToToml(value).text; } catch (e) { error = (error || '') + ' write: ' + e.message; }
  const strings = [];
  collectMultiLineStrings(src, model.docs[0].root, strings);
  const kept = formatted === undefined || strings.every(text => formatted.includes(text));
  results.push({ src, f: formatted, idem: formatted === formattedTwice, kept, w: written, err: error, hl: getPlainText(T.highlightToml(src)) === src });
}
console.log(JSON.stringify(results));
