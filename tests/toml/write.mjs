/**
 * Writes the data of every valid document of a JSON list (argv[3]), and some hard values, as
 * TOML with toml.js (argv[2]) and reads it back; prints each value that comes back different
 * and the count of bad ones.
 */
const T = await import(process.argv[2]);
const D = await import(process.argv[2].replace('toml.js', 'datatree.js') + '?v=9');
import { readFileSync } from 'fs';

/**
 * Tells whether two values hold the same data (keys in any order, NaN equal to NaN).
 * @param {*} a - one value.
 * @param {*} b - the other.
 * @returns {boolean} true when they are equal.
 */
function isEqual(a, b) {
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => isEqual(item, b[i]));
  if (a && typeof a === 'object') return b && typeof b === 'object' && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => isEqual(a[key], b[key]));
  return Object.is(a, b);
}

let bad = 0, count = 0;
const values = JSON.parse(readFileSync(process.argv[3], 'utf8')).map(src => { const model = T.parseToml(src); return model.broken ? null : D.getPlainValue(model.docs[0].root); }).filter(Boolean);
values.push({ a: { b: [{ c: 1, d: { e: [{ f: 2 }] } }, { c: 3 }] }, 'x y': 'q"\\\n\t\u0001', n: -0, big: 1e300, small: 5e-324, arr: [[{ a: 1 }], []], mixed: [1, { a: 1 }], emptyObj: {}, deep: { e: {} } });
for (const value of values) {
  count++;
  const written = T.convertToToml(value);
  const model = T.parseToml(written.text);
  if (model.broken) { bad++; console.log('INVALID', model.problems[0].msg, JSON.stringify(written.text).slice(0, 300)); continue; }
  const readBack = D.getPlainValue(model.docs[0].root);
  if (!isEqual(value, readBack)) { bad++; console.log('DIFF', JSON.stringify(value).slice(0, 200), '\n ', JSON.stringify(written.text).slice(0, 300)); }
}
console.log(count, 'values written, bad', bad);
