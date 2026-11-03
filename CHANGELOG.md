# Changelog

## 0.1.0 (2026-10-27)

- Initial release: nine MCP tools and matching CLI subcommands
  over the local Recordist API — `list_meetings`, `get_meeting`,
  `get_transcript`, `search_meetings`, `get_action_items`,
  `regenerate_notes`, `start_recording`, `stop_recording`, and
  `add_marker`.
- Every call first probes the app's health endpoint (cached for
  five seconds); when the app is not running the tools report
  that plainly instead of guessing. Transcripts can be read as
  json, md, srt, vtt, or txt, defaulting to md.
