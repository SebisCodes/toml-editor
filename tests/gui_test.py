"""Browser test of the TOML editor (Playwright, Google Chrome).

    php -S 127.0.0.1:8108 -t src src/php/router.php          (in the project folder)
    python tests/gui_test.py

Checks the tree (types, counts, dates, folding, tables in several places, path, search),
code <-> tree, problems with line and column, the JSON Schema check, Format,
convert, templates, My documents, opening other formats, AI links (also &mode=add), export,
the typing help and the phone layout."""

import base64
import os
import sys
import tempfile
import zlib

from playwright.sync_api import sync_playwright

URL = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8108/')
HOOK = 'tomlEditor'
failures = []


def check_that(cond, what):
    """Prints one result line and notes a failure.

    Args:
        cond (bool): True when the check holds.
        what (str): what is checked.

    Returns:
        None: the result is printed and a failure is noted.
    """
    print(('ok    ' if cond else 'FAIL  ') + what)
    if not cond:
        failures.append(what)


def set_code(page, text):
    """Sets the editor's code and waits for the tree.

    Args:
        page (Page): the editor page.
        text (str): the TOML code.

    Returns:
        None: the editor holds the code.
    """
    page.evaluate('t => %s.setCode(t)' % HOOK, text)
    page.wait_for_timeout(300)


def get_state(page, expr):
    """Returns a value of the editor state.

    Args:
        page (Page): the editor page.
        expr (str): a JavaScript expression over S, the editor state.

    Returns:
        Any: the value of the expression.
    """
    return page.evaluate(f'() => {{ const S = {HOOK}.state; return {expr}; }}')


def get_code_selection(page):
    """Returns the text selected in the code field.

    Args:
        page (Page): the editor page.

    Returns:
        str: the selected text, empty when nothing is selected.
    """
    return page.evaluate('() => { const t = document.querySelector("#code"); return t.value.slice(t.selectionStart, t.selectionEnd); }')


def get_row(page, key):
    """Returns the first tree row whose key contains a text.

    Args:
        page (Page): the editor page.
        key (str): the text of the key.

    Returns:
        Locator: the row.
    """
    return page.locator('#tree .trow', has=page.locator('.trow-k', has_text=key)).first


def set_cursor_after(page, text, plus=1):
    """Puts the code cursor at a text and waits for the tree to follow it.

    Args:
        page (Page): the editor page.
        text (str): the text in the code to find.
        plus (int): how many characters after the start of the text the cursor goes.

    Returns:
        None: the cursor is placed.
    """
    page.evaluate('([s, d]) => { const t = document.querySelector("#code"); const i = t.value.indexOf(s); t.focus(); t.setSelectionRange(i + d, i + d); }', [text, plus])
    page.wait_for_timeout(400)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    page.wait_for_timeout(800)

    # --- First visit: the welcome example ---
    check_that(get_state(page, 'S.name') == 'Welcome', 'the first visit opens the welcome example')
    check_that(get_state(page, 'S.problems.length') == 0, 'the example has no problems')
    root = page.locator('#tree .trow').first
    check_that('{9}' in root.inner_text() and 'object' in root.inner_text(), 'the root row shows its type and the number of keys')
    check_that('[3]' in get_row(page, 'features').inner_text(), 'an array shows [3]')
    check_that('[2]' in get_row(page, 'servers').inner_text(), 'an array of tables shows [2]')
    check_that(get_row(page, 'free').locator('.t-boolean').count() == 1, 'booleans have their own type')
    check_that(get_row(page, 'released').locator('.trow-tag').inner_text() == 'date' and '2026-11-15' in get_row(page, 'released').inner_text() and '"2026' not in get_row(page, 'released').inner_text(), 'a date is tagged and shown without quotes')
    check_that('"A text over several lines⏎keeps its line breaks."' in get_row(page, 'text').inner_text(), 'a multi-line string shows its line breaks')
    check_that(page.locator('#hl .c').count() >= 3 and page.locator('#hl .k').count() >= 10 and page.locator('#hl .a').count() >= 4, 'comments, keys and table headers are highlighted')
    check_that(page.locator('#hl .s', has_text='keeps its line breaks').count() == 1, 'every line of a multi-line string is highlighted as a string')

    # --- Folding ---
    n = page.locator('#tree .trow').count()
    get_row(page, 'features').locator('.trow-toggle').click()
    page.wait_for_timeout(150)
    check_that(get_row(page, 'features').get_attribute('aria-expanded') == 'false' and page.locator('#tree .trow').count() == n - 3, 'a click on the arrow folds an array')
    page.click('#tree-close')
    page.wait_for_timeout(150)
    check_that(page.locator('#tree .trow').count() == 10, 'Fold everything leaves the root and its keys')
    page.click('#tree-open')
    page.wait_for_timeout(150)
    check_that(page.locator('#tree .trow').count() == n, 'Unfold everything shows every value again')

    # --- Tree -> code, code -> tree, path ---
    get_row(page, 'owner').click()
    page.wait_for_timeout(150)
    check_that(get_code_selection(page) == '[owner]\nname = "Grünwald Innovation"\ncountry = "Switzerland"', 'a click on a table selects its section in the code: ' + repr(get_code_selection(page)))
    set_cursor_after(page, 'Ctrl+E', 2)
    check_that(page.locator('#tree .trow.active').inner_text().startswith('export'), 'the code cursor marks its value in the tree')
    check_that(page.inner_text('#path').replace('\n', '') == '$.settings.shortcuts.export', 'with its path: ' + page.inner_text('#path').replace('\n', ''))
    set_cursor_after(page, '"beta"', 2)
    check_that(page.inner_text('#path').replace('\n', '') == '$.servers[1].name', 'inside an array of tables: ' + page.inner_text('#path').replace('\n', ''))

    # --- A table written in several places ---
    set_code(page, '[a.b]\nx = 1\n\n[other]\ny = 2\n\n[a]\nc.d = 3\n')
    check_that(get_state(page, 'S.problems.length') == 0 and '{2}' in get_row(page, 'a').inner_text(), 'a table written in several places is one entry with all its keys')
    set_cursor_after(page, 'y = 2', 0)
    check_that(page.inner_text('#path').replace('\n', '') == '$.other.y', 'the cursor between the parts of another table marks the right value')
    page.evaluate(f'() => {{ {HOOK}.tree.select({{ doc: 0, path: ["a"] }}); }}')
    r = page.evaluate(f'() => {HOOK}.change({{ kind: "key", entry: {HOOK}.tree.getSelectedInfo().entry, key: "z" }})')
    check_that(r is True and get_state(page, 'S.code') == '[z.b]\nx = 1\n\n[other]\ny = 2\n\n[z]\nc.d = 3\n', 'a rename changes every header that names the table: ' + repr(get_state(page, 'S.code')))
    r = page.evaluate(f'() => {{ {HOOK}.tree.select({{ doc: 0, path: ["z"] }}); return {HOOK}.change({{ kind: "move", entry: {HOOK}.tree.getSelectedInfo().entry, by: 1 }}); }}')
    check_that(r != True and get_state(page, 'S.code').startswith('[z.b]'), 'moving it is refused with a message: ' + str(r))

    # --- Problems with line and column ---
    set_code(page, 'a = 1\nb = 2\na = 3\n')
    check_that(any('defined twice' in p for p in get_state(page, 'S.problems.map(p => p.msg)')) and 'Line 3, column 1' in page.inner_text('#code-error'), 'a key defined twice is reported with line and column')
    set_code(page, '[t]\nx = 1\n[t]\n')
    check_that(any('[t] is defined twice' in p for p in get_state(page, 'S.problems.map(p => p.msg)')), 'a table defined twice is reported')
    set_code(page, 'name = Ada\n')
    check_that(any('needs quotes' in p for p in get_state(page, 'S.problems.map(p => p.msg)')), 'text without quotes is reported')
    set_code(page, 'd = 2026-02-30\nn = 007\n')
    check_that(any('date does not exist' in p for p in get_state(page, 'S.problems.map(p => p.msg)')), 'a date that does not exist is reported')
    page.locator('#code-error [data-prob]').first.click()
    check_that(page.evaluate('document.activeElement.id') == 'code', 'clicking a problem goes to the code')

    # --- Format keeps comments ---
    set_code(page, '# top\n  a=1   # one\nb  =  { x=1,y=2 }\n[t]\nk=  "v"\n\n\n\n[[s]]\n')
    page.click('#btn-format')
    page.wait_for_timeout(400)
    check_that(get_state(page, 'S.code') == '# top\na = 1   # one\nb = { x = 1, y = 2 }\n\n[t]\nk = "v"\n\n[[s]]\n', 'Format: one layout, comments stay: ' + repr(get_state(page, 'S.code')))

    # --- Convert ---
    set_code(page, '[[fruit]]\nid = 1\nname = "Apple"\ncode = "007"\n\n[[fruit]]\nid = 2\nname = "Pear, green"\ncode = "x"\n')
    page.click('[data-itab=convert]')
    page.wait_for_timeout(300)
    check_that(page.input_value('#cv-out').startswith('{\n  "fruit": [\n    {\n      "id": 1,'), 'Convert to JSON')
    check_that(page.locator('#cv-other').is_visible(), 'with "Open in the JSON Editor"')
    page.select_option('#cv-to', 'yaml')
    page.wait_for_timeout(600)
    check_that(page.input_value('#cv-out').startswith('fruit:\n  - id: 1\n    name: Apple\n    code: "007"'), 'Convert to YAML: ' + repr(page.input_value('#cv-out')[:60]))
    page.select_option('#cv-to', 'jsonl')
    page.wait_for_timeout(300)
    check_that(page.input_value('#cv-out') == '{"id":1,"name":"Apple","code":"007"}\n{"id":2,"name":"Pear, green","code":"x"}\n' and 'fruit' in page.inner_text('#cv-note'), 'Convert to JSON Lines: one line per table of the array')
    page.select_option('#cv-to', 'xml')
    page.wait_for_timeout(300)
    check_that('<fruit>' in page.input_value('#cv-out'), 'Convert to XML')
    set_code(page, 'when = 2026-11-15T08:30:00Z\n')
    page.select_option('#cv-to', 'json')
    page.wait_for_timeout(300)
    check_that(page.input_value('#cv-out') == '{\n  "when": "2026-11-15T08:30:00Z"\n}\n', 'a date becomes text in JSON')
    page.click('[data-itab=node]')

    # --- JSON Schema (a schema written in TOML) ---
    page.click('#btn-new')
    page.click('[data-new=blank]')
    page.wait_for_timeout(200)
    set_code(page, 'type = "object"\nrequired = ["name"]\n\n[properties.name]\ntype = "string"\n\n[properties.port]\ntype = "integer"\nmaximum = 65535\n')
    page.evaluate(f'{HOOK}.store.save({HOOK}.state.fileId, {{ name: "Server schema" }})')
    page.click('#btn-new')
    page.click('[data-new=blank]')
    page.wait_for_timeout(200)
    set_code(page, 'port = 70000\n')
    page.click('[data-itab=schema]')
    page.wait_for_timeout(200)
    page.select_option('#sc-doc', label='Server schema')
    page.wait_for_timeout(400)
    sp = get_state(page, 'S.problems.filter(p => p.kind === "schema").map(p => p.msg)')
    check_that(any('required' in p for p in sp) and any('maximum' in p for p in sp), 'a schema in TOML checks the data: ' + str(sp))
    check_that('Line 1, column 8' in page.inner_text('#code-error'), 'schema problems have line and column')
    set_code(page, 'name = "web"\nport = 8080\n')
    check_that(get_state(page, 'S.problems.length') == 0 and 'fits the schema' in page.inner_text('#schema-wrap'), 'valid data fits the schema')
    page.click('[data-itab=node]')

    # --- Templates, My documents ---
    for k, name in [('pyproject', 'pyproject.toml'), ('cargo', 'Cargo.toml'), ('hugo', 'Hugo site'), ('netlify', 'Netlify'), ('table', 'Table')]:
        page.click('#btn-new')
        page.click(f'[data-new={k}]')
        page.wait_for_timeout(200)
        check_that(get_state(page, 'S.name') == name and get_state(page, 'S.problems.length') == 0, f'New > {name} without problems')
    page.click('#btn-files')
    check_that(page.locator('#files-grid .file-card').count() >= 6, 'My documents lists the documents')
    page.locator('#files-grid .file-card', has_text='Welcome').locator('.file-open').click()
    check_that(get_state(page, 'S.name') == 'Welcome', 'a document opens from My documents')

    # --- Opening JSON, YAML, XML and JSON Lines ---
    d = tempfile.mkdtemp()
    with open(os.path.join(d, 'people.json'), 'w') as f:
        f.write('{"team": "core", "people": [{"name": "Ada", "born": 1815, "note": null}, {"name": "Grace", "born": 1906}]}')
    with open(os.path.join(d, 'site.yaml'), 'w') as f:
        f.write('title: Site\nparams:\n  dark: true\n')
    with open(os.path.join(d, 'events.jsonl'), 'w') as f:
        f.write('{"id": 1}\n{"id": 2}\n')
    page.set_input_files('#file', [os.path.join(d, 'people.json'), os.path.join(d, 'site.yaml'), os.path.join(d, 'events.jsonl')])
    page.wait_for_timeout(1500)
    docs = page.evaluate(f'{HOOK}.store.list().map(f => [f.name, {HOOK}.store.code(f.id)])')
    check_that(next((c for n_, c in docs if n_ == 'people'), '') == 'team = "core"\n\n[[people]]\nname = "Ada"\nborn = 1815\n\n[[people]]\nname = "Grace"\nborn = 1906\n', 'a JSON file is converted to TOML, null left out')
    check_that(next((c for n_, c in docs if n_ == 'site'), '') == 'title = "Site"\n\n[params]\ndark = true\n', 'a YAML file too')
    check_that(next((c for n_, c in docs if n_ == 'events'), '') == '[[value]]\nid = 1\n\n[[value]]\nid = 2\n', 'JSON Lines go under the key "value"')

    # --- AI link to a new document, mode=add merges ---
    data = '# from the AI\nitems = [1, 2]\n'
    z = base64.urlsafe_b64encode(zlib.compress(data.encode())).decode().rstrip('=')
    page.goto(URL + '#z=' + z + '&file=new&name=AI%20data', wait_until='networkidle')
    page.wait_for_timeout(800)
    check_that(get_state(page, 'S.name') == 'AI data' and get_state(page, 'S.code') == data, 'an AI link makes a new document')
    link = 'https://toml.giit.ch/#b64=' + base64.urlsafe_b64encode('more = true\nitems = [3]\n'.encode()).decode() + '&mode=add'
    answer = 'Here is the link:\n' + link[:40] + '\n' + link[40:] + '\nClick it.'
    page.click('#btn-ai')
    page.fill('#ai-paste', answer)
    page.wait_for_timeout(400)
    check_that(not page.locator('#ask').is_visible(), 'a link changes the document without a question')
    page.wait_for_timeout(400)
    check_that(get_state(page, 'S.code') == '# from the AI\nitems = [3]\nmore = true\n', 'mode=add merges into the root table, the comment stays: ' + repr(get_state(page, 'S.code')))
    page.keyboard.press('Escape')

    # --- Export ---
    set_code(page, 'a = [1, 2]\nb = "x"\n')
    page.click('#btn-export')
    page.select_option('#ex-format', 'json')
    page.wait_for_timeout(200)
    check_that(page.input_value('#ex-text') == '{\n  "a": [\n    1,\n    2\n  ],\n  "b": "x"\n}\n', 'export: JSON')
    with page.expect_download() as dl:
        page.click('#ex-download')
    check_that(dl.value.suggested_filename == 'AI data.json', 'export: .json download')
    page.select_option('#ex-format', 'toml')
    page.wait_for_timeout(200)
    with page.expect_download() as dl:
        page.click('#ex-download')
    check_that(dl.value.suggested_filename == 'AI data.toml', 'export: .toml as it is')
    page.select_option('#ex-format', 'yaml')
    page.wait_for_timeout(300)
    check_that(page.input_value('#ex-text').startswith('a:\n  - 1\n  - 2\nb: x'), 'export: YAML')
    with page.expect_download() as dl:
        page.click('#ex-zip')
    check_that(dl.value.suggested_filename.endswith('-all.zip'), 'export: all formats as ZIP')
    page.keyboard.press('Escape')

    # --- Typing help: Enter after "[" indents, Ctrl+/ comments ---
    set_code(page, 'a = [')
    page.evaluate('() => { const t = document.querySelector("#code"); t.focus(); t.setSelectionRange(5, 5); }')
    page.keyboard.press('Enter')
    page.keyboard.type('1,')
    page.wait_for_timeout(300)
    check_that(get_state(page, 'S.code').startswith('a = [\n  1,'), 'Enter after "[" indents: ' + repr(get_state(page, 'S.code')))
    set_code(page, 'a = 1\n')
    page.evaluate('() => { const t = document.querySelector("#code"); t.focus(); t.setSelectionRange(0, 0); }')
    page.keyboard.press('Control+/')
    page.wait_for_timeout(200)
    check_that(get_state(page, 'S.code') == '# a = 1\n', 'Ctrl+/ comments a line out')

    # --- Phone ---
    page.set_viewport_size({'width': 390, 'height': 800})
    page.wait_for_timeout(300)
    check_that(page.locator('.views').is_visible(), 'phone: Code / Tree / Value tabs')
    check_that(page.evaluate('document.documentElement.scrollWidth') <= 391, 'phone: no sideways scrolling')
    page.click('[data-pane=code]')
    check_that(page.locator('#code').is_visible(), 'phone: the code view')

    check_that(not errors, 'no script errors' + (': ' + '; '.join(errors) if errors else ''))
    browser.close()

print(f'\n{len(failures)} failed' if failures else '\nall passed')
sys.exit(1 if failures else 0)
