#!/usr/bin/env node
/**
 * meetrecord CLI.
 *
 *   meetrecord list_meetings '<json>'     (and the other eight
 *   meetrecord get_meeting '<json>'        tool names likewise)
 *   meetrecord mcp
 *   meetrecord --version
 *
 * Each tool subcommand takes one JSON argument string with the
 * tool's arguments and prints the API response body text.
 * Exit codes: 0 success, 1 runtime error (an isError tool
 * result), 2 usage error.
 */
import { createClient, VERSION } from "./meetrecord.js";

const TOOL_NAMES = [
  "list_meetings",
  "get_meeting",
  "get_transcript",
  "search_meetings",
  "get_action_items",
  "regenerate_notes",
  "start_recording",
  "stop_recording",
  "add_marker",
] as const;

function usage(): never {
  console.error(`Usage:
  meetrecord <tool> '<json-args>'     one of: ${TOOL_NAMES.join(", ")}
  meetrecord mcp
  meetrecord --version`);
  process.exit(2);
}

const client = createClient();

async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "list_meetings":
      return client.listMeetings(args as never);
    case "get_meeting":
      return client.getMeeting(args as never);
    case "get_transcript":
      return client.getTranscript(args as never);
    case "search_meetings":
      return client.searchMeetings(args as never);
    case "get_action_items":
      return client.getActionItems(args as never);
    case "regenerate_notes":
      return client.regenerateNotes(args as never);
    case "start_recording":
      return client.startRecording(args as never);
    case "stop_recording":
      return client.stopRecording();
    case "add_marker":
      return client.addMarker(args as never);
    default:
      usage();
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    if (rest.length !== 0) usage();
    await import("./mcp.js");
    return;
  }
  if (!(TOOL_NAMES as readonly string[]).includes(cmd ?? "")) usage();
  if (rest.length > 1) usage();
  let args: Record<string, unknown> = {};
  if (rest.length === 1) {
    try {
      const parsed: unknown = JSON.parse(rest[0]);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) usage();
      args = parsed as Record<string, unknown>;
    } catch {
      console.error("error: argument must be a JSON object string");
      process.exit(2);
    }
  }
  try {
    const out = await runTool(cmd, args);
    console.log(out);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
