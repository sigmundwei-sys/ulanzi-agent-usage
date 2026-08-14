# Third-party notices

## Ulanzi common-html and common-node SDK

This plugin vendors portions of the official Ulanzi plugin SDK:

- `libs/` contains the HTML Property Inspector SDK derived from
  [UlanziTechnology/plugin-common-html](https://github.com/UlanziTechnology/plugin-common-html).
- `plugin/plugin-common-node/` contains the Node.js main-service SDK derived from
  [UlanziTechnology/plugin-common-node](https://github.com/UlanziTechnology/plugin-common-node).

The vendored Ulanzi SDK code is licensed under the Apache License, Version 2.0.
The complete license text is included in [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt).
`libs/js/utils.js` contains local modifications for official locale filenames
and Windows-safe plugin path resolution; the surrounding SDK remains vendored
from the official source.
The plugin's own source code remains licensed under the MIT License in the repository root.

## sql.js

The optional local Cursor database reader uses [`sql.js`](https://github.com/sql-js/sql.js),
version 1.14.1, distributed under the MIT License. It is used only for read-only
inspection of the user's local Cursor `state.vscdb` file.
