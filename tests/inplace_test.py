"""Editing in place in the tree: a click on a key or a value opens a field;
Enter writes the change into the code (written as TOML needs it, the rest of the code keeps its
formatting and comments, one undo step), Escape cancels. The buttons above the tree add,
duplicate, move and remove entries and change the type - in sections, dotted keys, inline
tables, arrays and arrays of tables.

    php -S 127.0.0.1:8108 -t src src/php/router.php          (in the project folder)
    python tests/inplace_test.py
"""
import os
import sys

from playwright.sync_api import sync_playwright

EDITOR = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8108/')
HOOK = 'tomlEditor'
CODE = '''# the team
name = "Ada"   # first name
title = 'Countess'
age = 36
active = true
born = 1815-12-10
tags = ["a", "b"]

[team]
lead = "Grace"
members = [
  "Linus",
  "Margaret",
]

[[servers]]
host = "alpha"

[[servers]]
host = "beta"
'''
failed = []


def check_that(ok, text):
    """Prints one result line and notes a failure.

    Args:
        ok (bool): True when the check holds.
        text (str): what is checked.

    Returns:
        None: the result is printed and a failure is noted.
    """
    print(('ok    ' if ok else 'FAIL  ') + text)
    if not ok:
        failed.append(text)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(EDITOR, wait_until='networkidle')
    page.wait_for_timeout(800)
    page.evaluate('c => %s.setCode(c)' % HOOK, CODE)
    page.wait_for_timeout(300)
    code = lambda: page.evaluate('%s.state.code' % HOOK)
    history = lambda: page.evaluate('%s.state.history.length' % HOOK)
    field = page.locator('#tree .trow-edit')
    row = lambda text: page.locator('#tree .trow', has=page.locator('.trow-k', has_text=text)).first
    item = lambda text: page.locator('#tree .trow', has=page.locator('.trow-v', has_text=text)).first

    # A plain value
    row('name').locator('.trow-v').click()
    page.wait_for_timeout(150)
    check_that(field.count() == 1 and field.input_value() == 'Ada', 'a click on a value opens a field with the value')
    sel = page.evaluate('() => { const t = document.querySelector("#code"); return t.value.slice(t.selectionStart, t.selectionEnd); }')
    check_that(sel == 'name = "Ada"', 'the click also selects the entry in the code: ' + repr(sel))
    n = history()
    field.fill('Ada "the first" \\ #1')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that(field.count() == 0, 'Enter closes the field')
    check_that('name = "Ada \\"the first\\" \\\\ #1"   # first name\n' in code(), 'the value is escaped as TOML needs it, the comment stays: ' + code().split('\n')[1])
    check_that(history() == n + 1, 'one undo step')
    page.evaluate('%s.undo()' % HOOK)
    page.wait_for_timeout(200)
    check_that(code() == CODE, 'one Undo brings the old value back')

    # A literal string stays literal, and Escape cancels
    row('title').locator('.trow-v').click()
    field.fill('C:\\Users\\ada')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that("title = 'C:\\Users\\ada'\n" in code(), 'a literal string stays literal: ' + code().split('\n')[2])
    row('title').locator('.trow-v').click()
    field.fill('Not this')
    field.press('Escape')
    page.wait_for_timeout(200)
    check_that(field.count() == 0 and "'C:\\Users\\ada'" in code(), 'Escape cancels')

    # A number keeps its type and its way of writing
    row('age').locator('.trow-v').click()
    field.fill('thirty')
    field.press('Enter')
    page.wait_for_timeout(200)
    check_that(field.count() == 1 and 'not a number' in page.inner_text('#toast'), 'a number field does not take text')
    field.fill('1_000')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that('\nage = 1_000\n' in code(), 'the number is written as typed')

    # A date stays a date
    row('born').locator('.trow-v').click()
    field.fill('1815-02-30')
    field.press('Enter')
    page.wait_for_timeout(200)
    check_that(field.count() == 1 and 'not a date' in page.inner_text('#toast'), 'a date field does not take a date that does not exist')
    field.fill('1815-12-11')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that('\nborn = 1815-12-11\n' in code(), 'the date is written without quotes')
    check_that(row('born').locator('.trow-type').inner_text() == 'date / time', 'the type column calls a date date / time: ' + row('born').locator('.trow-type').inner_text())

    # Leaving the field with a button that changes the code: the change never lands elsewhere
    before = code()
    row('title').locator('.trow-v').click()
    field.fill('Lovelace')
    page.click('#node-del')
    page.wait_for_timeout(300)
    check_that('title' not in code() and 'Lovelace' not in code(), 'Remove while a value is open removes the entry, the typed value is not written elsewhere')
    page.evaluate('%s.undo()' % HOOK)
    page.wait_for_timeout(300)
    check_that(code() == before, 'one Undo brings the entry back')

    # A key
    row('active').locator('.trow-k').click()
    field.fill('is on')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that('\n"is on" = true\n' in code() and 'active' not in code(), 'a key is renamed in the code, quoted where needed')

    # Arrays are edited with commas; a multi-line array keeps one entry per line
    row('tags').click()
    page.click('#node-add')
    page.wait_for_timeout(300)
    check_that('tags = ["a", "b", ""]\n' in code(), 'Add on a one-line array adds an entry on the same line')
    item('"b"').click()
    page.click('#node-del')
    page.wait_for_timeout(300)
    check_that('tags = ["a", ""]\n' in code(), 'Remove in an array takes the comma along')
    row('members').click()
    page.click('#node-add')
    page.wait_for_timeout(300)
    check_that('  "Linus",\n  "Margaret",\n  "",\n]' in code(), 'Add on a multi-line array adds a line: ' + repr(code().split('members = ')[1][:60]))

    # Tables: new keys go into their section
    page.evaluate('c => %s.setCode(c)' % HOOK, CODE)
    page.wait_for_timeout(300)
    row('team').click()
    n = history()
    page.click('#node-add')
    page.wait_for_timeout(300)
    check_that(field.count() == 1 and field.input_value() == 'key', 'Add on a table adds a key and opens it for typing')
    field.fill('size')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that('  "Margaret",\n]\nsize = ""\n\n[[servers]]' in code(), 'the new key is the last line of its section: ' + repr(code().split('[team]')[1][:90]))
    check_that(history() == n + 2, 'adding and naming are two undo steps')
    row('lead').click()
    page.click('#node-dup')
    page.wait_for_timeout(300)
    check_that('lead = "Grace"\n"lead copy" = "Grace"\n' in code(), 'Duplicate copies a key')
    page.locator('#tree').press('Delete')
    page.wait_for_timeout(300)
    check_that('lead copy' not in code(), 'the Delete key removes the selected entry with its line')

    # Arrays of tables: one [[…]] section per entry
    page.locator('#tree .trow', has=page.locator('.trow-i', has_text='1')).filter(has_text='{1}').last.click()
    page.click('#node-up')
    page.wait_for_timeout(300)
    check_that(code().index('host = "beta"') < code().index('host = "alpha"'), 'Move up swaps two tables of an array of tables')
    row('servers').click()
    page.click('#node-add')
    page.wait_for_timeout(300)
    check_that(code().endswith('host = "alpha"\n\n[[servers]]\n'), 'Add on an array of tables adds a [[…]] section: ' + repr(code()[-50:]))
    check_that(code().startswith('# the team\n') and '# first name' in code(), 'the comments are still there after all changes')
    for k in range(6):
        page.evaluate('%s.undo()' % HOOK)
    page.wait_for_timeout(300)
    check_that(code() == CODE, 'Undo takes every change back, step by step')

    # Type changes
    row('active').click()
    page.select_option('#node-type', 'object')
    page.wait_for_timeout(300)
    check_that('\nactive = {}\n' in code(), 'the type menu turns a value into an empty inline table')
    page.click('#node-add')
    page.wait_for_timeout(300)
    field.fill('on')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that('\nactive = { on = "" }\n' in code(), 'adding to an inline table stays on its line: ' + repr(code().split('active')[1][:30]))
    check_that(page.locator('#node-type option[value=null]').count() == 0, 'the type menu has no null')
    row('age').click()
    page.select_option('#node-type', 'datetime')
    page.wait_for_timeout(300)
    check_that(row('age').locator('.trow-tag').count() == 1, 'a value can become a date and time')
    row('team').click()
    page.select_option('#node-type', 'string')
    page.wait_for_timeout(300)
    check_that('[team]' not in code() and '\nteam = ""\n' in code() and '"Margaret"' not in code(), 'a table becomes an empty string, its section is gone: ' + repr(code()))

    # With a syntax error, the tree is not edited
    page.evaluate('c => %s.setCode(c)' % HOOK, 'a = 1\nb = \n')
    page.wait_for_timeout(300)
    row('a').locator('.trow-v').click()
    page.wait_for_timeout(150)
    check_that(field.count() == 0 and 'syntax error' in page.inner_text('#toast'), 'with a syntax error the tree asks to fix it first')

    # German interface: the data itself is not translated
    page.goto(EDITOR + 'de/', wait_until='networkidle')
    page.wait_for_timeout(1200)
    page.evaluate('c => %s.setCode(c)' % HOOK, CODE)
    page.wait_for_timeout(300)
    row('name').locator('.trow-v').click()
    page.wait_for_timeout(150)
    check_that(field.count() == 1 and field.input_value() == 'Ada', 'also in the German interface, and the data is not translated')
    check_that(page.locator('#tree .trow-type').first.inner_text() == 'Objekt', 'the type names in the tree are German')
    field.press('Escape')
    page.evaluate('c => %s.setCode(c)' % HOOK, 'a = 1\na = 2\n')
    page.wait_for_timeout(400)
    check_that('doppelt definiert' in page.inner_text('#code-error'), 'the problems are German: ' + page.inner_text('#code-error')[:80])
    page.goto(EDITOR, wait_until='networkidle')
    check_that(not errors, 'no script errors: ' + '; '.join(errors))
    browser.close()

print()
print('all passed' if not failed else f'{len(failed)} failed')
sys.exit(1 if failed else 0)
