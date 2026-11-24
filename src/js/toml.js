/**
 * TOML for the data tree. The TOML Editor
 * registers TOML with datatree.js (addFormat), so the tree, the paths, the JSON Schema check
 * and the conversions work on TOML as on JSON and YAML. This file gathers the parts:
 *
 * - toml-read.js: parseToml() reads TOML 1.0 and keeps the place of every key, value and table;
 * - toml-edit.js: editTomlCode() writes one change from the tree as a small edit of the code
 *   (comments and the rest of the formatting stay), mergeTomlData() adds the keys of a table;
 * - toml-highlight.js: the colored code;
 * - toml-write.js: data as TOML (convertToToml) and TOML as data (convertFromToml);
 * - toml-format.js: Format, one layout with the comments kept;
 * - toml-template.js: the roles and places of template placeholders (?template=) for the data
 *   tree, and the examples written for their places in the example view.
 *
 * The shared convert-data.js imports this file and calls convertFromToml(), the convert test
 * also convertToToml(); TOML holds the names of datatree.js's format contract (parse,
 * applyEdit, highlight, mergeInto, findTemplateRoles, findTemplatePlaces, writeTemplateFill).
 */

import { parseToml } from './toml-read.js?v=3';
import { editTomlCode, mergeTomlData } from './toml-edit.js?v=4';
import { highlightToml } from './toml-highlight.js?v=3';
import { findTomlTagRoles, findTomlTagPlaces, writeTomlFill } from './toml-template.js?v=1';

export { parseToml } from './toml-read.js?v=3';
export { editTomlCode, mergeTomlData } from './toml-edit.js?v=4';
export { highlightToml } from './toml-highlight.js?v=3';
export { convertToToml, convertFromToml, isDateTime } from './toml-write.js?v=4';
export { formatToml } from './toml-format.js?v=4';

/** TOML for datatree.js addFormat(): the property names are its format contract. */
export const TOML = {
    parse: parseToml, applyEdit: editTomlCode, highlight: highlightToml, mergeInto: mergeTomlData,
    findTemplateRoles: findTomlTagRoles, findTemplatePlaces: findTomlTagPlaces, writeTemplateFill: writeTomlFill,
};
