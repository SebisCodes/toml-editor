/**
 * Formats every valid document of a JSON list (argv[3]) twice with toml.js (argv[2]), writes its
 * data as TOML and highlights it; prints the results for toml_test.py to check with tomllib.
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

const results = [];
for (const src of docs) {
  const model = T.parseToml(src);
  if (model.broken) continue;
  const value = D.getPlainValue(model.docs[0].root);
  let formatted, formattedTwice, written, error = null;
  try { formatted = T.formatToml(src); formattedTwice = T.formatToml(formatted); } catch (e) { error = 'format: ' + e.message; }
  try { written = T.convertToToml(value).text; } catch (e) { error = (error || '') + ' write: ' + e.message; }
  results.push({ src, f: formatted, idem: formatted === formattedTwice, w: written, err: error, hl: getPlainText(T.highlightToml(src)) === src });
}
console.log(JSON.stringify(results));
