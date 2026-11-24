"""Template placeholders (?template=mustache, angle): how the TOML Editor reads them.

    python3 tests/template_test.py            the checks in Node
    python3 tests/template_test.py --browser  also the checks in the editor (php -S on port 8108 first)

  order     an order confirmation template (tests/order-template.toml) with placeholder values
            (also in an array and an inline table), placeholders in basic, literal and multi-line
            strings and in a comment, a list section around [[items]], a flag section around a
            table and an inverted section has 0 errors with "mustache"; with the option off the
            code is a TOML error and the code view is the plain TOML highlighting
  model     a placeholder value is a string node holding its tag (placeholder "value"); a string
            with a tag has placeholder "text"; the data holds every tag
  keys      a bare placeholder key (a key = line, a dotted key, a [header], an inline table) is
            one error at the tag; a quoted one is a key; placeholder keys make no duplicate key
  places    a real TOML error is reported at the same place as in the filled document
  schema    a placeholder value matches every schema, a string with a tag is checked for its type,
            the other values are checked as before
  edits     a tree edit keeps every tag outside the changed part; a placeholder value and a
            table holding tags are changed in the code
  view      the code view shows every tag as written, without a color of its own
  examples  the example view: values typed as TOML reads them, strings escaped, sections and list
            rows applied, the label in brackets without an example, every kind of string; a node
            leads to its place in the code, text with an example is read-only, a change of copied
            text changes the template, the code cursor finds its node; filled text that is no TOML
            is reported, filling past a limit stops
  angle     the order template in the syntax "angle" (tests/order-template-angle.toml) has 0 errors
  edge      adding data (&mode=add) keeps every tag or is refused
  browser   with --browser: through a page around the editor, the example view is the default and
            shows the examples, the switch shows the template view with the tags, the code view has
            no placeholder color, the "Placeholders" box is closed and puts a tag at the cursor as
            one undo step, the side panel is closed, "get" carries the template; Format and Tidy
            keep the template as written, an edit of a placeholder value in the tree is refused
            with a message; with the option off nothing of this is there
Needs Node; --browser needs Playwright with Chrome."""
import json
import html
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(os.path.dirname(HERE), 'src', 'js')
URL = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8108/')
HOOK = 'tomlEditor'
EDIT_MESSAGE = 'This part holds a placeholder - change it in the code'
FORMAT_MESSAGE = 'A template stays as written - Format and conversions work on filled data'
failed = []


def check_that(ok, text):
    """Prints one result line and notes a failure.

    Args:
        ok (bool): True when the check holds.
        text (str): what is checked.

    Returns:
        None: the result is printed and a failure is noted.
    """
    print(('ok    ' if ok else 'FAIL  ') + text, flush=True)
    if not ok:
        failed.append(text)


def run_report(cases):
    """Runs tests/template/report.mjs in Node on the cases.

    Args:
        cases (list[dict]): each with `code` (str), `format` (str), `template` (str or None) and
            optionally `schema` and `edits`.

    Returns:
        list[dict]: one result per case, in order.
    """
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as file:
        json.dump(cases, file)
    try:
        run = subprocess.run(['node', os.path.join(HERE, 'template', 'report.mjs'), SCRIPTS, file.name],
                             capture_output=True, text=True, timeout=120)
    finally:
        os.unlink(file.name)
    if run.returncode:
        print(run.stderr)
        sys.exit('report.mjs failed')
    return json.loads(run.stdout)


def get_messages(result, kind):
    """Returns the messages of the problems of one kind.

    Args:
        result (dict): one case result of report.mjs.
        kind (str): "error" or "warn".

    Returns:
        list[str]: the messages.
    """
    return [problem['msg'] for problem in result['problems'] if problem['kind'] == kind]


def get_plain_text(highlighted):
    """Returns the plain text of highlighted HTML.

    Args:
        highlighted (str): the HTML of the code view.

    Returns:
        str: the text with the tags removed and the entities decoded.
    """
    return html.unescape(re.sub(r'<[^>]+>', '', highlighted))


def get_node(result, path):
    """Returns a marked node of a result by its path.

    Args:
        result (dict): one case result of report.mjs.
        path (str): the keys joined by dots.

    Returns:
        dict | None: the node, or None when it is not marked.
    """
    return next((node for node in result['nodes'] if node['path'] == path), None)


def read_fixture(name):
    """Reads a fixture of the tests folder.

    Args:
        name (str): the file name.

    Returns:
        str: the file's text.
    """
    with open(os.path.join(HERE, name), encoding='utf-8') as fixture:
        return fixture.read()


ORDER = read_fixture('order-template.toml')
ANGLE = read_fixture('order-template-angle.toml')
KEYS = '{{first}} = 1\nsite.{{second}} = 2\n"{{quoted}}" = 3\ninline = { {{third}} = 4 }\n\n[servers.{{server}}]\nip = "10.0.0.1"\n'
PLACES = 'name = {{name}}\nport = {{port}}\nopen = tru\n'
FILLED = 'name = 12345678\nport = 12345678\nopen = tru\n'
SCHEMA_CODE = 'orderNumber = {{orderNumber}}\nemail = "{{email}}"\nage = "ten"\nstatus = {{status}}\n'
SCHEMA = {'type': 'object', 'properties': {'orderNumber': {'type': 'integer', 'minimum': 1}, 'email': {'type': 'string', 'format': 'email'},
          'age': {'type': 'integer'}, 'status': {'enum': ['open', 'paid']}}, 'required': ['orderNumber']}
EDIT_CODE = 'name = "{{name}}" # {{comment}}\nport = {{port}}\ncity = "Springfield"\n\n[customer]\nstreet = "{{street}}"\n'
EDITS = [
    {'kind': 'value', 'path': ['city'], 'value': 'Shelbyville'},
    {'kind': 'value', 'path': ['port'], 'value': 8080},
    {'kind': 'type', 'path': ['port'], 'type': 'number'},
    {'kind': 'value', 'path': ['customer'], 'value': {}},
    {'kind': 'key', 'path': ['city'], 'key': 'town'},
    {'kind': 'add', 'path': [], 'key': 'country', 'value': 'US'},
    {'kind': 'remove', 'path': ['port']},
    {'kind': 'value', 'path': ['name'], 'value': 'Dear {{name}}'},
]
PLAIN = 'name   =   "John Doe"\ncity="Springfield"\n'

order, order_off, keys, places, filled, schema, edits, angle = run_report([
    {'code': ORDER, 'format': 'toml', 'template': 'mustache'},
    {'code': ORDER, 'format': 'toml', 'template': None},
    {'code': KEYS, 'format': 'toml', 'template': 'mustache'},
    {'code': PLACES, 'format': 'toml', 'template': 'mustache'},
    {'code': FILLED, 'format': 'toml', 'template': None},
    {'code': SCHEMA_CODE, 'format': 'toml', 'template': 'mustache', 'schema': SCHEMA},
    {'code': EDIT_CODE, 'format': 'toml', 'template': 'mustache', 'edits': EDITS},
    {'code': ANGLE, 'format': 'toml', 'template': 'angle'},
])

print('-- the order template')
check_that(get_messages(order, 'error') == [] and not order['broken'], f'mustache: 0 errors (got {get_messages(order, "error")})')
check_that(get_messages(order, 'warn') == [], f'mustache: no notes (got {get_messages(order, "warn")})')
check_that(len(order['tags']) == 22, f'every tag of the template is found ({len(order["tags"])})')
check_that(order_off['broken'] and len(get_messages(order_off, 'error')) == 1, f'option off: the plain TOML check reports its error ({get_messages(order_off, "error")})')
check_that(order_off['highlighted'] == order_off['plainHighlighted'] and order_off['nodes'] == [], 'option off: plain highlighting, nothing marked')

print('-- model')
order_number = get_node(order, 'orderNumber')
check_that(order_number and order_number['placeholder'] == 'value' and order_number['type'] == 'string' and order_number['value'] == '{{orderNumber}}'
           and ORDER[order_number['start']:order_number['end']] == '{{orderNumber}}', f'a placeholder value is its tag, with the tag\'s place: {order_number}')
check_that(get_node(order, 'tags.1')['placeholder'] == 'value' and get_node(order, 'customer.location.latitude')['placeholder'] == 'value',
           'a placeholder in an array and in an inline table is a placeholder value')
check_that(all(get_node(order, path)['placeholder'] == 'text' for path in ('greeting', 'letter', 'customer.street', 'customer.name')),
           'basic, literal and multi-line strings with a tag have placeholder "text"')
check_that(get_node(order, 'items.0.price')['placeholder'] == 'value', 'a placeholder in an array of tables is a placeholder value')
check_that(order['value']['paid'] == '{{paid}}' and order['value']['note']['text'] == '{{note}}', 'the data holds every placeholder as its tag')

print('-- keys')
key_errors = [(problem['pos'], problem['msg']) for problem in keys['problems'] if problem['kind'] == 'error']
expected = [(KEYS.index('{{' + name + '}}'), f'A placeholder key goes in quotes: "{{{{{name}}}}}"') for name in ('first', 'second', 'third', 'server')]
check_that(key_errors == expected, f'a bare placeholder key is one error at its tag: {key_errors}')
check_that(get_messages(keys, 'warn') == [], 'placeholder keys make no duplicate key')
check_that(sorted(key['key'] for key in keys['keys']) == sorted(['{{first}}', '{{second}}', '{{quoted}}', '{{third}}', '{{server}}']), 'every placeholder key reads as its tag')

print('-- places')
place_errors = [(problem['pos'], problem['msg']) for problem in places['problems'] if problem['kind'] == 'error']
filled_errors = [(problem['pos'], problem['msg']) for problem in filled['problems'] if problem['kind'] == 'error']
check_that(place_errors and place_errors == filled_errors, f'a real TOML error is reported where the filled document has it: {place_errors}')

print('-- schema')
check_that(schema['schema'] == ['Schema: the type must be integer (it is string)'], f'only the filled value is checked against the schema: {schema["schema"]}')

print('-- edits')
city, port, port_type, table_value, key_edit, added, removed, quoted = edits['edits']
check_that(city.get('tagsKept') and 'city = "Shelbyville"' in city['code'], 'a value edit keeps every tag elsewhere')
check_that(port.get('error') == EDIT_MESSAGE and port_type.get('error') == EDIT_MESSAGE, 'a placeholder value is changed in the code')
check_that(table_value.get('error') == EDIT_MESSAGE, 'a table holding tags is changed in the code')
check_that(key_edit.get('tagsKept') and added.get('tagsKept'), 'renaming a key and adding an entry keep every tag')
check_that(removed.get('code') is not None and '{{port}}' not in removed['code'] and '{{comment}}' in removed['code'], 'removing an entry takes its own tags along')
check_that(quoted.get('code') is not None and 'Dear {{name}}' in quoted['code'] and '{{comment}}' in quoted['code'], 'a string with a tag is edited in the tree')

print('-- view')
check_that(get_plain_text(order['highlighted']) == ORDER, 'the highlighted text is the code')
check_that('class="tp"' not in order['highlighted'], 'a tag has no color of its own')

print('-- angle')
check_that(get_messages(angle, 'error') == [] and get_node(angle, 'paid')['value'] == '<<paid>>', f'angle: 0 errors (got {get_messages(angle, "error")})')
check_that(get_plain_text(angle['highlighted']) == ANGLE and 'class="tp"' not in angle['highlighted'], 'angle: the code view shows every tag as written')


print('-- examples')
EXAMPLES = {'placeholders': [
    {'name': 'orderNumber', 'example': '1001'}, {'name': 'name', 'label': 'Name', 'example': 'John Doe'},
    {'name': 'street', 'example': '1 Main Street'}, {'name': 'postalCode', 'example': '8000'},
    {'name': 'hasNote', 'kind': 'section', 'shown': True}, {'name': 'note', 'example': 'Ring "twice"\nthen wait'},
    {'name': 'items', 'kind': 'list', 'fields': [{'name': 'title', 'label': 'Title'}, {'name': 'quantity'}, {'name': 'price'}],
     'rows': [{'title': 'Chair', 'quantity': '2', 'price': '49.5'}, {'title': 'Table', 'quantity': 'two', 'price': '120'}]},
    {'name': 'paid', 'example': 'true'}, {'name': 'tag', 'example': 'urgent'}, {'name': 'latitude', 'example': '47.4'}]}
MORE = 'first = {{a}}\nsecond = \'{{b}}\'\nthird = "{{c}}"\nfourth = """\n{{d}}"""\nfifth = [1, {{e}}]\n# {{c}}\n\n["{{k}}"]\nx = 1\n'
BROKEN = "street = '{{street}}'\n"
TWICE = '{{#items}}\nx = "{{title}}"\n{{/items}}\n'
TRICKY = "v = '''{{x}}'''\n[a.b]\nx = 1\n"

DEEP = '{{#a}}' * 40 + 'x = 1\n' + '{{/a}}' * 40
twice, tricky, injected = run_report([
    {'code': TWICE, 'format': 'toml', 'template': 'mustache', 'example': {'message': {'placeholders': [
        {'name': 'items', 'kind': 'list', 'fields': [{'name': 'title'}], 'rows': [{'title': 'A'}, {'title': 'B'}]}]}}},
    {'code': TRICKY, 'format': 'toml', 'template': 'mustache', 'example': {'message': {'placeholders': [{'name': 'x', 'example': 'plain'}]},
        'edits': [{'kind': 'add', 'path': ['a'], 'key': 'c', 'value': 2}, {'kind': 'add', 'path': ['a', 'b'], 'key': 'y', 'value': 2}]}},
    {'code': TRICKY, 'format': 'toml', 'template': 'mustache', 'example': {'message': {'placeholders': [{'name': 'x', 'example': "a'''\npwn = 3\n#"}]}}},
])
filled, unlisted, more, broken, deep = run_report([
    {'code': ORDER, 'format': 'toml', 'template': 'mustache', 'example': {
        'message': EXAMPLES, 'paths': [['items', 1, 'title'], ['items', 2, 'title'], ['customer', 'city']],
        'edits': [{'kind': 'value', 'path': ['items', 2, 'title'], 'value': 'Postage'},
                  {'kind': 'value', 'path': ['customer', 'name'], 'value': 'Jane Roe'},
                  {'kind': 'key', 'path': ['customer', 'city'], 'key': 'town'},
                  {'kind': 'add', 'path': ['customer'], 'key': 'country', 'value': 'US'}],
        'cursors': [ORDER.index('Shipping'), ORDER.index('{{title}}')]}},
    {'code': ORDER, 'format': 'toml', 'template': 'mustache', 'example': {'message': None}},
    {'code': MORE, 'format': 'toml', 'template': 'mustache', 'example': {'message': {'placeholders': [
        {'name': 'a', 'example': '0x1F'}, {'name': 'b', 'example': 'C:\\data'}, {'name': 'c', 'example': 'say "hi"\nnow'},
        {'name': 'd', 'example': 'a "quoted" \\ line'}, {'name': 'e', 'example': '2.5'}, {'name': 'k', 'example': 'web 1'}]}}},
    {'code': BROKEN, 'format': 'toml', 'template': 'mustache', 'example': {'message': {'placeholders': [{'name': 'street', 'example': "O'Brien Lane"}]}}},
    {'code': DEEP, 'format': 'toml', 'template': 'mustache', 'example': {'message': None}},
])
value = filled['example']['value']
check_that(filled['example']['errors'] == [] and value['orderNumber'] == 1001 and value['paid'] is True and value['tags'] == ['order', 'urgent'] and value['customer']['location']['latitude'] == 47.4,
           f'a bare value takes a TOML literal, also in an array and an inline table: {value.get("orderNumber")!r}, {value.get("paid")!r}, {value.get("tags")!r}')
check_that(value['customer']['name'] == 'John Doe' and value['greeting'] == 'Dear John Doe,' and value['customer']['street'] == '1 Main Street', 'text in basic and literal strings takes the example')
check_that(value['note']['text'] == 'Ring "twice"\nthen wait' and value['letter'] == 'Dear John Doe,\n', 'a shown section is there, its inverted section left out, quotes and line breaks escaped')
check_that([item['title'] for item in value['items']] == ['Chair', 'Table', 'Shipping'] and value['items'][1]['quantity'] == 'two' and value['items'][0]['quantity'] == 2,
           'a list repeats its table per row; an example that is no TOML literal is a string')
check_that('{{' not in filled['example']['text'], 'no tag is left in the example view')
check_that(value['customer']['city'] == '[city]' and value['customer']['location']['longitude'] == '[longitude]', 'a placeholder the page did not list shows its name in brackets')
labels = unlisted['example']['value']
check_that(labels['orderNumber'] == '[orderNumber]' and labels['items'][0]['title'] == '[title]' and len(labels['items']) == 2 and labels['note']['text'] == '[note]',
           'without examples: labels in brackets, a list shows one entry, a section is shown once')
row, shipping, city_place = filled['example']['places']
check_that(row['code'] == '"{{title}}"' and not row['valueEditable'], f'a filled value leads to its tag and is read-only: {row}')
check_that(shipping['code'] == '"Shipping"' and shipping['valueEditable'] and shipping['keyEditable'], f'copied text leads to its own place and may be edited: {shipping}')
check_that(city_place['code'] == '"{{city}}"' and city_place['keyEditable'] and not city_place['valueEditable'], 'the key of a filled value may be edited, its value not')
postage, refused, town, country = filled['example']['edits']
check_that(postage.get('code') == ORDER.replace('title = "Shipping"', 'title = "Postage"'), f'a change of copied text changes the template there: {postage.get("error")}')
check_that(refused.get('error') == 'This part shows an example - change it in the template view or in the code', f'a change of an example is refused: {refused}')
check_that(town.get('code') == ORDER.replace('city = "{{city}}"', 'town = "{{city}}"'), f'a key renamed in the example view is renamed in the template: {town.get("error")}')
check_that(country.get('code') is not None and 'country = "US"' in country['code'] and '{{city}}' in country['code'], f'an entry added in the example view goes into the template: {country.get("error")}')
check_that(filled['example']['cursors'] == ['$.items[2].title', '$.items[0].title'], f'the code cursor finds its node in the example view: {filled["example"]["cursors"]}')
extra = more['example']
check_that(extra['errors'] == [] and extra['value'] == {'first': 31, 'second': 'C:\\data', 'third': 'say "hi"\nnow', 'fourth': 'a "quoted" \\ line', 'fifth': [1, 2.5], 'web 1': {'x': 1}},
           f'literal, basic and multi-line strings, an array, a header key and a comment take the example in their escaping: {extra.get("value")} {extra.get("errors")}')
ADDRESS = '\nJohn Doe\n1 Main Street\n\n8000 Springfield'
BREAKS = 'a = "{{n}}"\nb = \"\"\"{{n}}\"\"\"\nc = \'\'\'{{n}}\'\'\'\nd = \'\'\'to {{n}}\'\'\'\ne = \"\"\"\n{{n}}\"\"\"\n'
breaks = run_report([{'code': BREAKS, 'format': 'toml', 'template': 'mustache', 'example': {'message': {'placeholders': [{'name': 'n', 'example': ADDRESS}]}}}])[0]['example']
check_that(breaks.get('errors') == [] and breaks.get('value') == {'a': ADDRESS, 'b': ADDRESS, 'c': ADDRESS, 'd': 'to ' + ADDRESS, 'e': ADDRESS},
           f'line breaks of an example: basic and multi-line strings read back the example, also one that starts with a line break: {breaks.get("value")} {breaks.get("errors")}')
check_that(broken['example'].get('error') == 'TemplateExpansionError' and injected['example'].get('error') == 'TemplateExpansionError',
           'an example that would end a literal string stops the filling (the tree then shows the template)')
check_that(twice['example']['errors'] != [], 'filled text that is no TOML is reported (the tree then shows the template)')
to_a, to_b = tricky['example']['edits']
check_that('y = 2' in (to_b.get('code') or '').split('[a.b]')[1] and (to_a.get('error') or 'c = 2' not in (to_a.get('code') or '').split('[a.b]')[1]),
           f'an entry added to [a.b] goes there, one added to its parent a never into [a.b]: {to_a} {to_b}')
check_that(deep['example'].get('error') == 'TemplateExpansionError', f'filling past a limit stops: {deep["example"]}')


print('-- edge cases')
MERGE = 'x = 1 # {{keep}}\ny = {{y}}\n'
merge, = run_report([{'code': MERGE, 'format': 'toml', 'template': 'mustache', 'edits': [
    {'kind': 'merge', 'path': [], 'value': {'x': {'street': '1 Main Street', 'city': 'Springfield', 'postalCode': '8000', 'name': 'John Doe'}}},
    {'kind': 'merge', 'path': [], 'value': {'z': 3}}]}])
lost, kept = merge['edits']
check_that(lost.get('error') == EDIT_MESSAGE, 'adding data (&mode=add) that would drop a tag is refused')
check_that(kept.get('code') == MERGE + 'z = 3\n', 'adding data keeps every tag')


HOST = """<!doctype html><meta charset="utf-8"><body style="margin:0">
<iframe id="ed" src="%s" style="width:1200px;height:800px;border:0"></iframe>
<script>
window.msgs = [];
addEventListener('message', e => { if (e.data && typeof e.data.type === 'string') msgs.push(e.data); });
window.send = m => document.getElementById('ed').contentWindow.postMessage(m, '*');
</script>"""
PREFIX = HOOK.lower()
# The code of the entry "orderNumber", which a click on its key in the tree selects.
PICKED_ENTRY = 'orderNumber = {{orderNumber}}'


def open_hosted_editor(browser, query):
    """Opens the editor inside a page around it (on another origin) and waits for its ready message.

    Args:
        browser (Browser): the browser.
        query (str): the editor's address parameters after ?embed=1, e.g. "&template=mustache".

    Returns:
        tuple: the browser context and the page around the editor.
    """
    context = browser.new_context(viewport={'width': 1400, 'height': 900})
    page = context.new_page()
    page.route('http://localhost:8199/**', lambda route: route.fulfill(status=200, content_type='text/html', body=HOST % (URL + '?embed=1&lang=en' + query)))
    page.goto('http://localhost:8199/', wait_until='load')
    page.wait_for_function(f"msgs.some(m => m.type === '{PREFIX}:ready')", timeout=15000)
    return context, page


def send_and_wait(page, message, answer):
    """Sends a message to the editor and waits for its answer of a type.

    Args:
        page (Page): the page around the editor.
        message (dict): the message.
        answer (str): the type of the answer without the prefix, e.g. "loaded".

    Returns:
        dict: the answer.
    """
    page.evaluate('m => { msgs.length = 0; send(m); }', message)
    page.wait_for_function(f"msgs.some(m => m.type === '{PREFIX}:{answer}')", timeout=15000)
    return page.evaluate(f"msgs.find(m => m.type === '{PREFIX}:{answer}')")


def get_tidied_load(browser, query, content, extra=None):
    """Loads a document into the editor inside a page (the load message) and returns the code it holds then.

    Args:
        browser (Browser): the browser.
        query (str): the editor's address parameters after ?embed=1, e.g. "&tidy=1&template=mustache".
        content (str): the document.
        extra (dict | None): further fields of the load message, e.g. {"tidy": True}.

    Returns:
        str: the code the editor answers to get.
    """
    context, page = open_hosted_editor(browser, query)
    send_and_wait(page, {'type': f'{PREFIX}:load', 'name': 'Order', 'content': content, **(extra or {})}, 'loaded')
    code = send_and_wait(page, {'type': f'{PREFIX}:get'}, 'save')['content']
    context.close()
    return code


def get_box(frame, selector):
    """Returns the place and size of an element.

    Args:
        frame (Frame): the editor's frame.
        selector (str): the element's selector.

    Returns:
        dict: x, y, width and height, rounded.
    """
    return frame.evaluate("s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; }", selector)


def get_tree_text(frame):
    """Returns the text of the tree.

    Args:
        frame (Frame): the editor's frame.

    Returns:
        str: the tree's text.
    """
    return frame.inner_text('#tree')


def run_view_checks(browser):
    """Checks the example view, the template view, the "Placeholders" box and the side panel through
    a page around the editor that sends examples.

    Args:
        browser (Browser): the browser.

    Returns:
        None: the results are printed and failures are noted.
    """
    context, page = open_hosted_editor(browser, '&template=mustache')
    frame = page.frames[1]
    send_and_wait(page, {'type': f'{PREFIX}:load', 'name': 'Order', 'content': ORDER, 'template': EXAMPLES}, 'loaded')
    frame.wait_for_function("document.querySelector('#tree').innerText.includes('John Doe')", timeout=10000)
    tree = get_tree_text(frame)
    check_that('{{' not in tree and 'Chair' in tree and '1001' in tree, 'the example view is the default: the examples, the list rows, no tag')
    check_that(frame.locator('#hl .tp').count() == 0 and frame.inner_text('#hl').startswith(ORDER[:ORDER.index('{{orderNumber}}') + 15]), 'the code view shows the tags as written, without a color of their own')
    switch_before = [get_box(frame, '#view-switch [data-view-set=example]'), get_box(frame, '#view-switch [data-view-set=template]')]
    check_that(switch_before[0]['width'] == switch_before[1]['width'], f'the two buttons of the switch have one width: {switch_before}')
    frame.locator('#tree .trow-v', has_text='"Chair"').first.dblclick()
    page.wait_for_timeout(200)
    check_that(frame.inner_text('#toast') == 'This part shows an example - change it in the template view or in the code' and frame.locator('#tree input, #tree textarea').count() == 0,
               'a value with an example is read-only in the tree, with a message')
    frame.locator('#tree .trow-k', has_text='orderNumber').first.click()
    page.wait_for_timeout(300)
    selection = frame.evaluate('() => { const ta = document.querySelector("#code"); return ta.value.slice(ta.selectionStart, ta.selectionEnd); }')
    check_that(selection.startswith(PICKED_ENTRY), f'a click in the example view selects its place in the code: {selection!r}')
    frame.click('#view-switch [data-view-set=template]')
    page.wait_for_timeout(300)
    check_that(frame.locator('#tree .t-placeholder', has_text='{{orderNumber}}').count() == 1 and 'John Doe' not in get_tree_text(frame), 'the switch shows the template view with the tags')
    switch_after = [get_box(frame, '#view-switch [data-view-set=example]'), get_box(frame, '#view-switch [data-view-set=template]')]
    check_that(switch_after == switch_before, 'the switch keeps its place and size')
    frame.click('#view-switch [data-view-set=example]')
    editor_before = get_box(frame, '.code-pane .editor')
    check_that(frame.locator('#placeholder-list').is_hidden() and frame.inner_text('[data-placeholder-count]') == str(len(EXAMPLES['placeholders'])), 'the "Placeholders" box is closed and counts the page\'s placeholders')
    frame.click('[data-placeholder-toggle]')
    check_that(frame.locator('#placeholder-list').is_visible() and get_box(frame, '.code-pane .editor') == editor_before, 'the box opens over the code without moving it')
    cursor = ORDER.index('Dear {{name}}')
    frame.evaluate('c => { const ta = document.querySelector("#code"); ta.focus(); ta.setSelectionRange(c, c + 4); }', cursor)
    frame.locator('.placeholder-entry', has_text='hasNote').click()
    code = frame.evaluate(f'{HOOK}.state.code')
    check_that(code == ORDER[:cursor] + '{{#hasNote}}Dear{{/hasNote}}' + ORDER[cursor + 4:], 'a section goes around the selection')
    frame.evaluate(f'{HOOK}.undo()')
    check_that(frame.evaluate(f'{HOOK}.state.code') == ORDER, 'one undo step takes it back')
    check_that(send_and_wait(page, {'type': f'{PREFIX}:get'}, 'save')['content'] == ORDER, '"get" carries the template as written')
    panel_button = get_box(frame, '#btn-panel')
    check_that(frame.evaluate("getComputedStyle(document.querySelector('#side-panel')).display") == 'none', 'the side panel is closed at the start')
    frame.click('#btn-panel')
    check_that(frame.evaluate("getComputedStyle(document.querySelector('#side-panel')).display") != 'none' and get_box(frame, '#btn-panel') == panel_button, 'its button opens it and stays in its place')
    page.evaluate(f"() => {{ document.querySelector('#ed').contentWindow.postMessage({{ type: '{PREFIX}:template', clear: true }}, '*'); }}")
    frame.wait_for_function("document.querySelector('#tree').innerText.includes('[name]')", timeout=10000)
    check_that('[orderNumber]' in get_tree_text(frame), 'clear ends the examples: labels in brackets')
    context.close()


def run_browser_checks():
    """Checks the option in the editor: code view, views of the tree, box, side panel, Format, Tidy
    and tree edits of placeholders.

    Returns:
        None: the results are printed and failures are noted.
    """
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        # The page around the editor is served by the browser itself; these flags let it frame the local editor.
        browser = pw.chromium.launch(channel='chrome', headless=True, args=['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'])
        print('-- browser')
        run_view_checks(browser)
        page = browser.new_page(viewport={'width': 1400, 'height': 900})
        page.goto(URL + '?lang=en&template=mustache', wait_until='networkidle')
        page.evaluate('t => %s.setCode(t)' % HOOK, ORDER)
        page.wait_for_timeout(500)
        check_that(page.locator('#tree .t-placeholder').count() == 0 and '[orderNumber]' in page.inner_text('#tree'), 'without a page: the example view shows the labels in brackets')
        page.click('#view-switch [data-view-set=template]')
        page.wait_for_timeout(200)
        row = page.locator('#tree .t-placeholder', has_text='{{orderNumber}}')
        check_that(row.count() == 1, 'the template view shows a placeholder value as its tag')
        page.click('#btn-format')
        page.wait_for_timeout(200)
        check_that(page.inner_text('#toast') == FORMAT_MESSAGE and page.evaluate('%s.state.code' % HOOK) == ORDER, 'Format keeps the template as written, with the message')
        row.dblclick()
        page.wait_for_timeout(200)
        check_that(page.inner_text('#toast') == EDIT_MESSAGE and page.locator('#tree input, #tree textarea').count() == 0, 'a placeholder value is refused for editing in the tree, with the message')
        page.goto(URL + '?lang=en', wait_until='networkidle')
        page.evaluate('t => %s.setCode(t)' % HOOK, ORDER)
        page.wait_for_timeout(500)
        check_that(page.locator('#hl .tp').count() == 0 and page.locator('#tree .t-placeholder').count() == 0, 'option off: no placeholder colors, no placeholder rows')
        check_that(page.locator('#view-switch').is_hidden() and page.locator('#placeholder-box').is_hidden() and page.locator('#view-note').is_hidden(), 'option off: no switch, no box, no note')
        page.close()
        check_that(get_tidied_load(browser, '&tidy=1&template=mustache', ORDER) == ORDER, '?tidy=1 loads the template as written')
        check_that(get_tidied_load(browser, '&template=mustache', ORDER, {'tidy': True}) == ORDER, 'a load with tidy: true keeps the template as written')
        check_that(get_tidied_load(browser, '&tidy=1', PLAIN) != PLAIN, 'option off: ?tidy=1 tidies plain data as before')
        browser.close()


if '--browser' in sys.argv:
    run_browser_checks()

print(f'\n{len(failed)} failed' if failed else '\nall passed')
sys.exit(1 if failed else 0)
