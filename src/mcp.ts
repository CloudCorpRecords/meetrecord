/**
 * meetrecord MCP server. Tools: list_meetings, get_meeting,
 * get_transcript, search_meetings, get_action_items,
 * regenerate_notes, start_recording, stop_recording,
 * add_marker.
 *
 * Why the low-level Server instead of McpServer: the
 * high-level helper converts zod schemas to JSON Schema and
 * injects keys that are not in this tool set's documented
 * spec ("$schema" and "additionalProperties"), which breaks
 * exact tool-list/schema parity with the spec. This file
 * serves tools/list with the spec's exact input schemas as
 * explicit literals, and the core validates every tools/call
 * argument set itself.
 *
 * Every tool returns a single text item carrying the API
 * response body as-is; validation, probe and upstream
 * failures come back as isError results carrying the
 * documented error strings.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient, VERSION } from "./meetrecord.js";

const TOOLS = [
  {
    name: "list_meetings",
    description: "Recent meetings; optional `q`, `from`/`to`, `limit`/`offset`.",
    inputSchema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Start of the date range.",
        },
        limit: {
          type: "integer",
          description: "Maximum meetings to return.",
        },
        offset: {
          type: "integer",
          description: "Meetings to skip.",
        },
        q: {
          type: "string",
          description: "Full-text search query.",
        },
        to: {
          type: "string",
          description: "End of the date range.",
        },
      },
    },
  },
  {
    name: "get_meeting",
    description: "One meeting with notes, action items and markers.",
    inputSchema: {
      type: "object" as const,
      properties: {
        meeting_id: {
          type: "string",
          description: "The meeting id.",
        },
      },
      required: ["meeting_id"],
    },
  },
  {
    name: "get_transcript",
    description: "Transcript as `json` | `md` | `srt` | `vtt` | `txt`.",
    inputSchema: {
      type: "object" as const,
      properties: {
        format: {
          type: "string",
          enum: ["json", "md", "srt", "vtt", "txt"],
          description: "Transcript format. Defaults to md.",
        },
        meeting_id: {
          type: "string",
          description: "The meeting id.",
        },
      },
      required: ["meeting_id"],
    },
  },
  {
    name: "search_meetings",
    description: "Full-text search across transcripts and notes (FTS5).",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The search query; must be non-empty.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_action_items",
    description: "Action items, filter by `meeting_id` / `open_only`.",
    inputSchema: {
      type: "object" as const,
      properties: {
        meeting_id: {
          type: "string",
          description: "Only action items from this meeting.",
        },
        open_only: {
          type: "boolean",
          description: "Only open action items.",
        },
      },
    },
  },
  {
    name: "regenerate_notes",
    description: "Re-run AI notes with the provider set in Recordist; needs the app.",
    inputSchema: {
      type: "object" as const,
      properties: {
        meeting_id: {
          type: "string",
          description: "The meeting id.",
        },
        template_id: {
          type: "string",
          description: "Notes template id. The app's default template is general.",
        },
      },
      required: ["meeting_id"],
    },
  },
  {
    name: "start_recording",
    description:
      "Start recording; needs the app and Allow agents to start recordings (Settings → Integrations, off by default).",
    inputSchema: {
      type: "object" as const,
      properties: {
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Attendee names.",
        },
        source_app: {
          type: "string",
          description: "The app being recorded.",
        },
        title: {
          type: "string",
          description: "Recording title.",
        },
      },
    },
  },
  {
    name: "stop_recording",
    description: "Stop the current recording; needs the app.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "add_marker",
    description: "Bookmark the current moment; needs the app.",
    inputSchema: {
      type: "object" as const,
      properties: {
        label: {
          type: "string",
          description: "Marker label.",
        },
      },
    },
  },
];

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const client = createClient();

const server = new Server(
  { name: "meetrecord", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    let out: string;
    switch (name) {
      case "list_meetings":
        out = await client.listMeetings(a as never);
        break;
      case "get_meeting":
        out = await client.getMeeting(a as never);
        break;
      case "get_transcript":
        out = await client.getTranscript(a as never);
        break;
      case "search_meetings":
        out = await client.searchMeetings(a as never);
        break;
      case "get_action_items":
        out = await client.getActionItems(a as never);
        break;
      case "regenerate_notes":
        out = await client.regenerateNotes(a as never);
        break;
      case "start_recording":
        out = await client.startRecording(a as never);
        break;
      case "stop_recording":
        out = await client.stopRecording();
        break;
      case "add_marker":
        out = await client.addMarker(a as never);
        break;
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(out);
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
