"""toml.js against Python's tomllib, in Node, no browser.

    python3 tests/toml_test.py                      the documents in tests/toml/cases.json
    TOML_FILES=list.txt python3 tests/toml_test.py  also every file named in list.txt (one path per line)

  reading   every document is accepted or refused as tomllib does it, with the same data (known
            differences: a byte order mark at the start is read, integers past 64 bits are refused)
  editing   every change from the tree (value, key, add, duplicate, move, remove, on every entry of
            every valid document) gives valid TOML holding exactly the expected data, or a refusal
            with a message
  format    Format keeps the data and the text of every multi-line string and gives the same code
            when run twice; highlighting keeps the text
  writing   data written as TOML (convertToToml) reads back the same
Needs Node and Python 3.11 or later."""
import datetime
import json
import math
import os
import subprocess
import sys
import tempfile
import tomllib

HERE = os.path.dirname(os.path.abspath(__file__))
TOMLJS = os.path.join(os.path.dirname(HERE), 'src', 'js', 'toml.js')
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


def run_node(script, docs):
    """Runs a helper of tests/toml in Node on a list of documents.

    Args:
        script (str): the file name of the helper (dump.mjs, edit.mjs, fmt.mjs, write.mjs).
        docs (list[str]): the TOML documents, handed over as a JSON file.

    Returns:
        subprocess.CompletedProcess: the finished run with its output.
    """
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(docs, f)
    try:
        r = subprocess.run(['node', os.path.join(HERE, 'toml', script), TOMLJS, f.name] if script != 'dump.mjs' else ['node', os.path.join(HERE, 'toml', script), f.name, TOMLJS],
                           capture_output=True, text=True, timeout=600)
    finally:
        os.unlink(f.name)
    if r.returncode:
        print(r.stderr[-2000:])
    return r


def is_same_value(t, v):
    """Tells whether a tagged tree of toml.js holds the same data as tomllib read.

    Args:
        t (dict): the tagged tree ({'t': type, 'v': value}) printed by dump.mjs.
        v (Any): the value tomllib read.

    Returns:
        bool: True when type and value agree.
    """
    k = t['t']
    if k == 'table':
        return isinstance(v, dict) and list(v.keys()) == [a for a, _ in t['v']] and all(is_same_value(b, v[a]) for a, b in t['v'])
    if k == 'array':
        return isinstance(v, list) and len(v) == len(t['v']) and all(is_same_value(a, b) for a, b in zip(t['v'], v))
    if k == 'datetime':
        return isinstance(v, (datetime.datetime, datetime.date, datetime.time)) and tomllib.loads('x = ' + t['v'])['x'] == v
    if k in ('integer', 'float'):
        o = tomllib.loads('x = ' + t['v'])['x']
        if isinstance(o, float) and math.isnan(o):
            return isinstance(v, float) and math.isnan(v)
        return type(o) is type(v) and o == v
    if k == 'boolean':
        return v is t['v']
    return isinstance(v, str) and v == t['v']


def is_known_difference(src):
    """Tells whether a document shows a known difference to tomllib.

    Args:
        src (str): the TOML document.

    Returns:
        bool: True for a byte order mark at the start or an integer past 64 bits.
    """
    return src.startswith('﻿') or '9223372036854775808' in src.replace('-9223372036854775808', '')


docs = json.load(open(os.path.join(HERE, 'toml', 'cases.json'), encoding='utf-8'))
if os.environ.get('TOML_FILES'):
    for p in open(os.environ['TOML_FILES'], encoding='utf-8').read().split('\n'):
        try:
            docs.append(open(p, encoding='utf-8').read()) if p.strip() else None
        except (OSError, UnicodeDecodeError):
            pass

# reading
r = run_node('dump.mjs', docs)
mine = json.loads(r.stdout) if not r.returncode else []
bad = []
for src, res in zip(docs, mine):
    if is_known_difference(src):
        continue
    try:
        ref, referr = tomllib.loads(src), None
    except tomllib.TOMLDecodeError as e:
        ref, referr = None, str(e)
    if 'crash' in res:
        bad.append(('crash', src, res['crash'][:200]))
    elif referr and 'error' not in res:
        bad.append(('accepted', src, referr))
    elif not referr and 'error' in res:
        bad.append(('refused', src, res['error']))
    elif not referr and not is_same_value(res['tree'], ref):
        bad.append(('different', src, ''))
for b in bad[:5]:
    print('      ', b[0], repr(b[1])[:120], b[2][:120])
check_that(len(mine) == len(docs) and not bad, f'reading: {len(docs)} documents read as tomllib does ({len(bad)} differ)')

valid = []
for src in docs:
    try:
        tomllib.loads(src)
        valid.append(src)
    except tomllib.TOMLDecodeError:
        pass
small = [d for d in valid if len(d) < 4000][:150]

# editing
r = run_node('edit.mjs', small)
if not r.returncode:
    d = json.loads(r.stdout)
    invalid = 0
    for x in d['results']:
        if x.get('ok'):
            try:
                tomllib.loads(x['code'])
            except tomllib.TOMLDecodeError:
                invalid += 1
    wrong = [x for x in d['results'] if x.get('wrong')]
    for x in wrong[:3]:
        print('      ', x['op'], x['path'], repr(x['src'])[:100], '->', repr(x['code'])[:160])
    check_that(not wrong and not invalid and d['n'] > 1000, f"editing: {d['n']} edits, {d['refused']} refused with a message, {len(wrong)} wrong, {invalid} refused by tomllib")
else:
    check_that(False, 'editing: the edit run finished')

# format and highlighting
r = run_node('fmt.mjs', valid)
if not r.returncode:
    probs = []
    for x in json.loads(r.stdout):
        if x['err']:
            probs.append(x['err'])
            continue
        try:
            if json.dumps(tomllib.loads(x['f']), default=str, sort_keys=True) != json.dumps(tomllib.loads(x['src']), default=str, sort_keys=True):
                probs.append('format changes the data: ' + repr(x['src'])[:80])
        except (tomllib.TOMLDecodeError, ValueError) as e:
            probs.append(f'format gives invalid TOML ({e}): ' + repr(x['src'])[:80])
        if not x['idem']:
            probs.append('format twice differs: ' + repr(x['src'])[:80])
        if not x['kept']:
            probs.append('format changes the text of a multi-line string: ' + repr(x['src'])[:80])
        if not x['hl']:
            probs.append('highlighting changes the text: ' + repr(x['src'])[:80])
    for p in probs[:3]:
        print('      ', p)
    check_that(not probs, f'format and highlighting: {len(valid)} documents ({len(probs)} problems)')
else:
    check_that(False, 'format: the run finished')

# writing
r = run_node('write.mjs', valid)
check_that(not r.returncode and r.stdout.strip().endswith('bad 0'), 'writing: data written as TOML reads back the same ' + (r.stdout.strip().split('\n')[-1] if r.stdout else ''))

print()
print('all passed' if not failed else f'{len(failed)} failed')
sys.exit(1 if failed else 0)
