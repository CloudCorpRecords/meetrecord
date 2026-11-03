# meetrecord — Build Report (Batch 21)

Rebuild of the Recordist gateway MCP server (npm
`@recordist/gateway`) from the firsthand spec in
`specs-batch21/meetrecord.md`. Built 2026-10-27.

## Identity

- npm: `@reneturcios/meetrecord` @ 0.1.0, bin `meetrecord` → `dist/cli.js`
- MCP Registry name: `io.github.CloudCorpRecords/meetrecord`
  (matches `package.json` `mcpName`, `server.json` `name`, and
  the Dockerfile `io.modelcontextprotocol.server.name` label)
- server.json description (95 chars, verified):
  "Recordist meetings on your machine: list, search, transcripts,
  action items, recording control."
- server.json: npm package entry carries `"version": "0.1.0"`;
  the OCI entry (`ghcr.io/cloudcorprecords/meetrecord:0.1.0`)
  carries **no** `version` field.

## Files (19-file factory set, per TEMPLATE.md §2)

package.json, server.json, Dockerfile, tsconfig.json
(byte-identical to builds/swissreg/tsconfig.json, verified
with `cmp`, 318 bytes),
.gitignore, package-lock.json, README.md (fresh prose),
LICENSE (MIT, © 2026 Rene Turcios), CHANGELOG.md
(single 0.1.0 entry dated 2026-10-27), src/index.ts,
src/cli.ts, src/mcp.ts, src/types.ts, src/meetrecord.ts
(core), test/meetrecord.test.ts, and the four workflows
under .github/workflows/ (publish-container adapted:
IMAGE ghcr.io/cloudcorprecords/meetrecord, smoke assertion
on server name `meetrecord`). Plus this BUILD-REPORT.md.

## Implementation

- `src/mcp.ts`: low-level `Server` API
  (`sdk/server/index.js` + `StdioServerTransport`), explicit
  JSON-schema literals for all 9 tools (list_meetings,
  get_meeting, get_transcript, search_meetings,
  get_action_items, regenerate_notes, start_recording,
  stop_recording, add_marker); no McpServer/zod. Tool
  descriptions and per-property descriptions, enums and
  `required` lists are exactly the fixture's.
- `src/meetrecord.ts`: a client factory (`createClient`)
  holding the shared health-probe cache, plus standalone
  wrappers per tool. Backend rules as spec'd: base URL from
  RECORDIST_API_URL, default http://127.0.0.1:47321, all
  paths under /v1; before each tool call a GET /v1/health
  probe with an 800 ms timeout (AbortController), a
  successful probe cached for 5 s on the injectable clock,
  any probe failure → `Recordist app is not running`;
  `Authorization: Bearer <token>` on every non-health
  request, the token from RECORDIST_API_TOKEN else the
  `api_token` file in RECORDIST_DATA_DIR (or the Linux
  default `~/.local/share/app.recordist.desktop`) read
  through an injectable file reader and trimmed; a non-2xx
  response returns the body's `error.message` verbatim when
  present, else `upstream error: HTTP <status> from
  recordist-api`; a fetch throw after a successful probe →
  `upstream unreachable: recordist-api`; results are the
  response body text as-is (JSON passes through as its JSON
  text, non-JSON transcript formats pass through untouched).
  Validation uses the pinned sentences
  `<tool>: missing required argument: <name>` and
  `<tool>: argument <name> must be a <type>`;
  `search_meetings` rejects an empty query with
  `query must be a non-empty string`; `get_transcript`
  defaults `format` to `md` and rejects other values with
  `invalid format: <value> (expected json, md, srt, vtt or
  txt)` before any request. Wires exactly as spec'd,
  including `open_only=true` only when true,
  `regenerate_notes` / `add_marker` posting `{}` when the
  optional field is absent, and `stop_recording` posting
  with no body. All upstream access goes through an
  injectable fetch — no live call is made or claimed.
- CLI: one subcommand per tool taking a JSON argument
  string, `mcp`, `--version`; unknown subcommand → usage on
  stderr, exit 2; tool errors exit 1 (verified:
  `node dist/cli.js list_meetings '{}'` with no app running
  prints `error: Recordist app is not running`, exit 1).

## Verification (all real, run 2026-10-27)

- `npm run build` (tsc): exit 0. `npx tsc --noEmit`: exit 0.
- `npm test`: **28 tests, 28 pass, 0 fail** — fake fetch +
  fake file reader + fake clock only, no network. Covers
  probe failure (non-2xx and throw) with the pinned
  message, probe caching across the 5 s boundary and
  no caching of failures, the health probe carrying no
  Authorization header, a custom RECORDIST_API_URL, token
  resolution order (env over file, RECORDIST_DATA_DIR path,
  Linux default path, trimmed file contents, no header when
  no token resolves), query construction for list / search
  / action-items (including open_only only when true), the
  POST bodies for regenerate_notes / start_recording /
  stop_recording / add_marker, transcript format default
  (md), explicit format on the wire, and the pinned
  invalid-format sentence with no API call, missing /
  wrong-typed argument sentences, the empty-query sentence,
  and error mapping (error.message verbatim, the upstream
  HTTP fallback, upstream unreachable, JSON passthrough).
- `node dist/cli.js --version`: `0.1.0`; unknown command:
  usage on stderr, exit 2.
- Parity: `python3 harness/parity.py --original
  harness/fixtures/recordist-gateway-tools-original.json
  --rebuild "stdio:node builds/meetrecord/dist/cli.js mcp"
  --out builds/meetrecord/parity-out` → **verdict=PASS
  parity_pct=100.0**, 9/9 tools, no missing, no extra, no
  schema diffs.
- Lockfile: Route 3 only — clean temp dir with
  package.json alone, `npm install --package-lock-only
  --ignore-scripts --offline`; parses, name
  `@reneturcios/meetrecord`, **128 package entries**.
  Dependencies installed in the build dir with
  `npm install --offline --ignore-scripts`.

## Gap notes / deviations (from the spec, verbatim)

- The SQLite read fallback is not reproduced (see Backend);
  when the app is down, reads return `Recordist app is not
  running` instead of opening `recordist.db`.
- The original's HTTP and A2A transports, its resources
  (`recordist://meeting/{id}`) and prompts are not reproduced;
  the rebuild is the factory shape (stdio MCP + CLI).
- `get_transcript`'s default format (`md`) is a documented
  local choice; wire paths are pinned by the published API
  reference, but no live call against a real Recordist app
  was made — behaviour is proven against fake fetch only.
- The original's `--http`, `--a2a` and `--doctor` CLI modes
  are NOT reproduced.
- No push, no publish.
