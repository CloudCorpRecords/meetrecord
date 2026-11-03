# meetrecord

Your meetings already live on your own machine in the
Recordist app. meetrecord is a small bridge to them: it talks
to the app's local API (on the same machine, over loopback)
and exposes nine tools for listing and searching meetings,
reading transcripts, checking action items, regenerating
notes, and starting or stopping a recording.

Nothing leaves the machine from meetrecord itself — every
request goes to the Recordist app, which decides what to do
with it. If the app is not running, each tool says so
plainly (`Recordist app is not running`) instead of guessing;
a health probe checks first, and a successful probe is
reused for five seconds so a burst of calls does not hammer
the app.

The nine tools:

- `list_meetings` — recent meetings, with an optional
  full-text query, `from`/`to` date range, and
  `limit`/`offset` paging.
- `get_meeting` — one meeting with its notes, action items,
  and markers.
- `get_transcript` — a meeting's transcript as `json`,
  `md`, `srt`, `vtt`, or `txt` (default `md`); other values
  are rejected with the list of expected formats.
- `search_meetings` — full-text search across transcripts
  and notes; the query must be non-empty.
- `get_action_items` — action items, optionally narrowed
  to one meeting or to open items only.
- `regenerate_notes` — re-run AI notes for a meeting with
  the provider configured in Recordist, optionally with a
  specific notes template.
- `start_recording` — start a recording, optionally naming
  the source app, a title, and attendees. Recordist only
  honours this when "Allow agents to start recordings" is
  enabled in its Settings → Integrations.
- `stop_recording` — stop the current recording.
- `add_marker` — bookmark the current moment, optionally
  with a label.

Errors from the app come back with the app's own message
when it provides one; otherwise meetrecord reports the HTTP
status it saw.

## Configuration

```bash
export RECORDIST_API_URL="http://127.0.0.1:47321"   # default; the app on this machine
export RECORDIST_API_TOKEN="..."                    # optional; see below
export RECORDIST_DATA_DIR="..."                     # optional; where api_token lives
```

Authentication uses a bearer token. If
`RECORDIST_API_TOKEN` is set it wins; otherwise meetrecord
reads the `api_token` file inside `RECORDIST_DATA_DIR`, or
its default location
`~/.local/share/app.recordist.desktop/api_token`. The
health probe is the only request sent without the token.

## CLI

Each tool is a subcommand taking one JSON argument string:

```bash
npx @reneturcios/meetrecord list_meetings '{"q":"budget","limit":5}'
npx @reneturcios/meetrecord get_transcript '{"meeting_id":"m123","format":"srt"}'
npx @reneturcios/meetrecord start_recording '{"title":"Weekly sync"}'
npx @reneturcios/meetrecord --version
```

Output is the response body the app returned. Exit codes:
`0` on success, `1` on a runtime error (including a tool
error such as the app not running), `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/meetrecord mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "meetrecord": {
      "command": "npx",
      "args": ["-y", "@reneturcios/meetrecord", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/meetrecord
docker run --rm ghcr.io/cloudcorprecords/meetrecord list_meetings '{}'
```

Note the container is its own machine: point
`RECORDIST_API_URL` at wherever the Recordist app is
reachable from the container if you run it this way.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (fake fetch + fake file reader + fake clock, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
