/**
 * The welcome example and the templates of the New menu. Each one is a document with its name
 * and its TOML code; the shared convert test reads START.code.
 */

/**
 * A document the editor offers to start from.
 * @typedef {object} SampleDocument
 * @property {string} name - the name the new document gets.
 * @property {string} code - its TOML code.
 */

/** @type {SampleDocument} The document of a first visit, and of New > Example. */
export const START = {
    name: 'Welcome',
    code: `# Edit the code on the left - the tree in the middle follows.
# Click a key or a value in the tree to change it there; comments stay.
title = "TOML Editor"
version = "1.0"
free = true
released = 2026-11-15

features = [
  "tree with types and counts",
  "problems with line and column",
  "convert to JSON, YAML, CSV and XML",
]

[owner]
name = "Grünwald Innovation"
country = "Switzerland"

[settings]
theme = "auto"
shortcuts = { save = "Ctrl+S", export = "Ctrl+E" }

# Tables of the same array: one [[…]] per entry
[[servers]]
name = "alpha"
ip = "10.0.0.1"

[[servers]]
name = "beta"
ip = "10.0.0.2"

[note]
text = """
A text over several lines
keeps its line breaks."""
`,
};

/** @type {Object<string, SampleDocument>} The templates of the New menu, by the data-new value of their item. */
export const TEMPLATES = {
    pyproject: {
        name: 'pyproject.toml',
        code: `[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "my-package"
version = "0.1.0"
description = "A short description"
readme = "README.md"
requires-python = ">=3.10"
dependencies = [
  "requests>=2.31",
]

[project.optional-dependencies]
dev = ["pytest", "ruff"]

[tool.ruff]
line-length = 100
`,
    },
    cargo: {
        name: 'Cargo.toml',
        code: `[package]
name = "my-app"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1", features = ["full"] }

[dev-dependencies]
assert_cmd = "2"

[profile.release]
lto = true
`,
    },
    hugo: {
        name: 'Hugo site',
        code: `baseURL = "https://example.com/"
languageCode = "en-us"
title = "My site"

[params]
description = "A site built with Hugo"

[[menus.main]]
name = "Blog"
pageRef = "/posts"
weight = 10

[[menus.main]]
name = "About"
pageRef = "/about"
weight = 20
`,
    },
    netlify: {
        name: 'Netlify',
        code: `[build]
command = "npm run build"
publish = "dist"

[build.environment]
NODE_VERSION = "20"

[[redirects]]
from = "/old/*"
to = "/new/:splat"
status = 301

[[headers]]
for = "/*"

[headers.values]
X-Frame-Options = "DENY"
`,
    },
    table: {
        name: 'Table',
        code: `[[products]]
id = 1
name = "Apple"
price = 1.2
organic = true

[[products]]
id = 2
name = "Bread"
price = 3.5
organic = false
`,
    },
};

/** The code of a blank document. */
export const BLANK = '';
