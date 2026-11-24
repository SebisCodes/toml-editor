# Using the TOML Editor

The TOML Editor shows your TOML (pyproject.toml, Cargo.toml, app settings) next to a
foldable tree of the data. You can change keys and values right in the tree with comments
and formatting kept, see problems with line and column, check the data against a JSON Schema
and convert it to JSON, YAML, CSV or XML.

Open it at https://toml.giit.ch/. It is free, needs no sign-up, and runs in your browser:
your documents stay there unless you send them somewhere yourself.

## What it can do

- TOML 1.0, read by the editor's own parser, as strict as Python's `tomllib`: tables, arrays
  of tables, dotted keys, inline tables, all string forms, integers in four bases, floats
  with `inf` / `nan`, dates and times; comments are kept.
- A tree of the data: tables and arrays fold, every value shows its type (dates and times
  are tagged date-time, date or time), and a table written in several places is one entry.
- Editing in the tree: keys and values, the type of a value, entries added, duplicated,
  moved and removed. A renamed key changes in every header and dotted key that names it; new
  tables become `[sections]`; a change TOML cannot express in place is refused with a
  message. TOML has no null.
- Problems with line and column, with a message that names the cause and the remedy: keys or
  tables defined twice, a table after dotted keys, text without quotes, leading zeros, dates
  that do not exist, a time without seconds, unknown escapes; and what does not fit a chosen
  JSON Schema. Integers past 2^53 get a warning, since a browser holds them only
  approximately.
- **Format**: `key = value` with one space around `=`, no indentation, an empty line before
  each header; comments, multi-line strings and multi-line arrays stay as written, and every key
  and value reads the same afterwards (a quoted key keeps its text).
- Convert to JSON, YAML, JSON Lines, CSV (an array of tables is a table) and XML, dates
  becoming text; JSON, JSON Lines, YAML, CSV and XML files open as TOML.
- Templates: pyproject.toml, Cargo.toml, Hugo site, Netlify, table (array of tables).

## Getting started

1. **Start**: choose a template under **New**, open a file or paste TOML.
2. **Edit**: type in the code, or change keys and values in the tree.
3. **Export**: save TOML, JSON, YAML, CSV or text.

## Editing in the tree

Click a key or a value in the tree to change it right there. **Enter** or a click elsewhere
writes the change into the code at exactly that place, **Escape** cancels. The buttons above
the tree add, duplicate, move and remove entries and change the type of a value. Each change
is a small edit of the code that keeps comments and formatting, and one step for Undo.

A click in the tree puts the code's cursor on that value; the cursor in the code marks its
value in the tree. The path of the selected value (`$.items[3].name`) is shown below the
tree, and you can search keys and values.

The right side panel has **Value** (the selected key and value), **Insert** (entries and
pieces of code), **Convert** and **Schema**: choose a JSON Schema from your documents and
every place that does not fit is listed as a problem (type, required, properties, enum,
pattern, format, minimum and maximum, items, allOf / anyOf / oneOf, if / then / else, `$ref`
inside the schema and more). A `$schema` address is never fetched.

## Your documents

Your documents are kept only in your browser (in `localStorage`), not on a server, and stay
there after you close the page. **My documents** (the folder button at the top left) lists
every document of this browser: open, rename, duplicate, download (`.toml`) and delete them.

Clearing the browser's site data removes them, so download the ones you want to keep, or let
the editor send them to your own server: **Save to server** (the cloud button) sets up a
webhook, an address that gets every saved version (see [EMBEDDING.md](EMBEDDING.md#webhook)
for what it receives). Nothing is sent until you enter an address there.

**Opening files:** Open `.toml` files with the button, by drop or by paste; JSON, JSON
Lines, YAML, CSV and XML files open as TOML (null is left out, a value that is no table goes
under the key `value`).

## Export

**Export** saves the `.toml` as it is, JSON, YAML, CSV, the tree as plain text, or all of
them as one ZIP.

**Export > Open in another editor** converts the document in the browser to JSON, YAML,
SHLS, XML or CSV and opens the result as a new document in that editor. Anything the other
format cannot hold is listed first.

## AI Assistant

Any AI can work with you: ChatGPT, Claude, Gemini, Copilot or the AI in your coding tool.
Nothing to install and no key needed. Click **AI Assistant**, then **Copy prompt**, paste it
into your AI and say what it should do. The prompt holds the instructions and the current
document.

The AI answers with a link that carries the document after the `#`; click it and the
document appears in your editor. **Undo** takes every change back. The links look like this:

- `https://toml.giit.ch/#b64=<base64url of the UTF-8 text>`
- `https://toml.giit.ch/#toml=<URL-encoded text>`
- `https://toml.giit.ch/#z=<base64url of the zlib-compressed text>` (shortest)
- `&mode=add` merges the keys of a table into the root table of the open document (existing
  keys get the new values); comments stay.
- `&file=new&name=<name>` makes a new document next to your others, `&file=<name>` changes
  that one; without `&file=` the open document changes.
- `&part=N&of=M&id=<name>` sends a long document in several links; the editor collects the
  parts.

A tab opened with such a link hands the document to the editor tab you used last. You can
also paste the AI's whole answer into the editor (Ctrl+V outside the code); links that a
terminal broke over several lines are joined. When the editor is embedded in another
website, links cannot reach it, so paste the answer there. A website that embeds the
editor may give its own instructions for how the AI answers, or show its own AI dialog
when you press the button; the dialog names the website and shows its instructions.

**Browser agents (WebMCP):** in browsers that offer WebMCP, the page registers tools for AI
agents that run in the page itself: `get_document`, `get_problems`, `get_value` and
`set_value` (by a path such as `$.a.b[0]` or a JSON Pointer), `set_document`,
`replace_text`, `show_line`, `undo`, and `list_files`, `open_file`, `new_file` for your
other documents. Every change is one step for Undo.

## Side panel

The side panel holds **Value**, **Insert**, **Convert** and **Schema**. The button at the top right
of the work area opens it over the tree, below the tree's bar, and closes it again (Escape too);
it is closed when the editor opens. The bar's controls stay in view and usable while it is open.
On a phone it is the view **Edit**.

## Templates with placeholders

A website that edits templates opens the editor with `?template=mustache` or `?template=angle`.
The tree then shows the data filled with the website's examples (when they cannot be filled in, the template's tree with a note); **Template** in the tree's bar
shows the template's tree with the placeholders as written, **Examples** brings the examples back.
A placeholder without an example shows its label in brackets. The **Placeholders** box below the
code lists them: a click puts one at the cursor, a section around the selected text. A value that
comes from an example cannot be changed in the tree. Saving, downloading and exporting keep the
placeholders.

## Languages

The editor speaks English at `/`, German `/de/`, French `/fr/`, Italian `/it/`, Spanish
`/es/`, Portuguese `/pt/`, Dutch `/nl/`, Polish `/pl/`, Turkish `/tr/`, Russian `/ru/`,
Ukrainian `/uk/`, Chinese `/zh/`, Japanese `/ja/` and Korean `/ko/`. Opening
`https://toml.giit.ch/` leads to the language you picked before in a language menu, or else
to your browser's language. A language picked in the menu holds for every giit.ch site. The
prompt for the AI is always in English.

## Color theme

Light, dark or automatic (following your system): the theme switch in the bar sets it, and
the editor remembers your choice.

## Keyboard shortcuts

On macOS use Cmd instead of Ctrl. The **Help** dialog in the editor lists them as well.

| Keys | Action |
|---|---|
| ↑ ↓ ← → | In the tree: go up and down, fold and unfold |
| Enter | In the tree: change the value (F2: the key) |
| Delete | In the tree: remove the entry |
| Alt + ↑ / ↓ | In the tree: move the entry up / down |
| Ctrl + F | Search keys and values in the tree |
| Ctrl + Shift + F | Format the document |
| Tab / Shift + Tab | Indent / outdent in the code |
| Ctrl + / | Comment lines in or out (`#`) |
| Ctrl + Z / Y | Undo / redo |
| Ctrl + S | Save (download, or to your server) |
| Ctrl + E | Export |
| Ctrl + O | My documents |

Enter keeps the indentation of the line, and after `[` or `{` it indents one step. Quotes
and brackets close by themselves around a selection.

## On your own website

The editor can be embedded in other websites with an iframe, opened in a window of its own
or used as a read-only viewer. See [EMBEDDING.md](EMBEDDING.md).
