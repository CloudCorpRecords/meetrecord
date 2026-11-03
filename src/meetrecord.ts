/**
 * meetrecord core: nine tools over the Recordist app's local
 * API (base URL from RECORDIST_API_URL, default
 * http://127.0.0.1:47321; every path under /v1).
 *
 * Shared behaviour, as documented:
 * - Before each tool call the client probes GET /v1/health
 *   with an 800 ms timeout; a successful probe is cached for
 *   5 s on the injectable clock. A failed probe (non-2xx or a
 *   throwing fetch) fails the call with
 *   "Recordist app is not running".
 * - Requests other than the health probe carry
 *   "Authorization: Bearer <token>". The token comes from
 *   RECORDIST_API_TOKEN, else the api_token file in
 *   RECORDIST_DATA_DIR (or its Linux default
 *   ~/.local/share/app.recordist.desktop), read through the
 *   injectable file reader.
 * - A non-2xx API response fails with the body's
 *   error.message verbatim when present, else
 *   "upstream error: HTTP <status> from recordist-api"; a
 *   fetch that throws after a successful probe fails with
 *   "upstream unreachable: recordist-api".
 * - Results are the response body text as-is: JSON passes
 *   through as its JSON text and transcript formats other
 *   than JSON pass through untouched.
 * - Argument validation uses the pinned sentences
 *   "<tool>: missing required argument: <name>" and
 *   "<tool>: argument <name> must be a <type>".
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AddMarkerArgs,
  FetchFn,
  FetchResponseLike,
  FileReaderFn,
  GetActionItemsArgs,
  GetMeetingArgs,
  GetTranscriptArgs,
  ListMeetingsArgs,
  MeetDeps,
  RegenerateNotesArgs,
  SearchMeetingsArgs,
  StartRecordingArgs,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_BASE_URL = "http://127.0.0.1:47321";
export const TRANSCRIPT_FORMATS = ["json", "md", "srt", "vtt", "txt"] as const;

const PROBE_TIMEOUT_MS = 800;
const PROBE_CACHE_MS = 5000;

type Args = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function requireArg(tool: string, args: Args, name: string): unknown {
  if (args[name] === undefined || args[name] === null) {
    throw new Error(`${tool}: missing required argument: ${name}`);
  }
  return args[name];
}

function checkString(tool: string, args: Args, name: string, required: boolean): string | undefined {
  const v = required ? requireArg(tool, args, name) : args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new Error(`${tool}: argument ${name} must be a string`);
  }
  return v;
}

function checkInteger(tool: string, args: Args, name: string): number | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new Error(`${tool}: argument ${name} must be a integer`);
  }
  return v;
}

function checkBoolean(tool: string, args: Args, name: string): boolean | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") {
    throw new Error(`${tool}: argument ${name} must be a boolean`);
  }
  return v;
}

function checkStringArray(tool: string, args: Args, name: string): string[] | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((item) => typeof item !== "string")) {
    throw new Error(`${tool}: argument ${name} must be a array`);
  }
  return v as string[];
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init);
}

async function defaultReadFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export interface MeetrecordClient {
  listMeetings(args: ListMeetingsArgs): Promise<string>;
  getMeeting(args: GetMeetingArgs): Promise<string>;
  getTranscript(args: GetTranscriptArgs): Promise<string>;
  searchMeetings(args: SearchMeetingsArgs): Promise<string>;
  getActionItems(args: GetActionItemsArgs): Promise<string>;
  regenerateNotes(args: RegenerateNotesArgs): Promise<string>;
  startRecording(args: StartRecordingArgs): Promise<string>;
  stopRecording(args?: Record<string, never>): Promise<string>;
  addMarker(args: AddMarkerArgs): Promise<string>;
  /** Resolve the bearer token (env first, then the token file). */
  resolveToken(): Promise<string | undefined>;
  /** The token-file path this client would read. */
  tokenFilePath(): string;
  /** The configured base URL (no trailing slash). */
  baseUrl(): string;
}

export function createClient(deps: MeetDeps = {}): MeetrecordClient {
  const fetchFn: FetchFn = deps.fetchFn ?? defaultFetch;
  const readFileFn: FileReaderFn = deps.readFileFn ?? defaultReadFile;
  const now: () => number = deps.now ?? (() => Date.now());
  const env: Record<string, string | undefined> = deps.env ?? process.env;

  let lastProbeOkAt: number | null = null;

  function baseUrl(): string {
    const raw = env.RECORDIST_API_URL;
    const url = raw && raw.trim() !== "" ? raw.trim() : DEFAULT_BASE_URL;
    return url.replace(/\/+$/, "");
  }

  function tokenFilePath(): string {
    const dataDir =
      env.RECORDIST_DATA_DIR && env.RECORDIST_DATA_DIR.trim() !== ""
        ? env.RECORDIST_DATA_DIR
        : join(env.HOME ?? homedir(), ".local", "share", "app.recordist.desktop");
    return join(dataDir, "api_token");
  }

  async function resolveToken(): Promise<string | undefined> {
    const fromEnv = env.RECORDIST_API_TOKEN;
    if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim();
    try {
      const contents = await readFileFn(tokenFilePath());
      const token = contents.trim();
      return token !== "" ? token : undefined;
    } catch {
      return undefined;
    }
  }

  async function probe(): Promise<void> {
    if (lastProbeOkAt !== null && now() - lastProbeOkAt < PROBE_CACHE_MS) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    let res: FetchResponseLike;
    try {
      res = await fetchFn(`${baseUrl()}/v1/health`, {
        method: "GET",
        signal: controller.signal,
      });
    } catch {
      throw new Error("Recordist app is not running");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error("Recordist app is not running");
    lastProbeOkAt = now();
  }

  async function request(
    path: string,
    init?: { method?: string; body?: string },
  ): Promise<string> {
    await probe();
    const token = await resolveToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (init?.body !== undefined) headers["Content-Type"] = "application/json";
    let res: FetchResponseLike;
    try {
      res = await fetchFn(`${baseUrl()}${path}`, {
        method: init?.method ?? "GET",
        headers,
        body: init?.body,
      });
    } catch {
      throw new Error("upstream unreachable: recordist-api");
    }
    const text = await res.text();
    if (!res.ok) {
      let message: string | undefined;
      try {
        const parsed = JSON.parse(text) as {
          error?: { message?: unknown };
        };
        if (typeof parsed?.error?.message === "string" && parsed.error.message !== "") {
          message = parsed.error.message;
        }
      } catch {
        // Not a JSON error body; fall through to the generic form.
      }
      throw new Error(
        message ?? `upstream error: HTTP ${res.status} from recordist-api`,
      );
    }
    return text;
  }

  function withQuery(path: string, params: Array<[string, string]>): string {
    if (params.length === 0) return path;
    const qs = params
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    return `${path}?${qs}`;
  }

  return {
    baseUrl,
    tokenFilePath,
    resolveToken,

    async listMeetings(raw: ListMeetingsArgs): Promise<string> {
      const tool = "list_meetings";
      const args = raw as Args;
      const q = checkString(tool, args, "q", false);
      const from = checkString(tool, args, "from", false);
      const to = checkString(tool, args, "to", false);
      const limit = checkInteger(tool, args, "limit");
      const offset = checkInteger(tool, args, "offset");
      const params: Array<[string, string]> = [];
      if (q !== undefined) params.push(["q", q]);
      if (from !== undefined) params.push(["from", from]);
      if (to !== undefined) params.push(["to", to]);
      if (limit !== undefined) params.push(["limit", String(limit)]);
      if (offset !== undefined) params.push(["offset", String(offset)]);
      return request(withQuery("/v1/meetings", params));
    },

    async getMeeting(raw: GetMeetingArgs): Promise<string> {
      const tool = "get_meeting";
      const args = raw as unknown as Args;
      const meetingId = checkString(tool, args, "meeting_id", true) as string;
      return request(`/v1/meetings/${encodeURIComponent(meetingId)}`);
    },

    async getTranscript(raw: GetTranscriptArgs): Promise<string> {
      const tool = "get_transcript";
      const args = raw as unknown as Args;
      const meetingId = checkString(tool, args, "meeting_id", true) as string;
      const format = checkString(tool, args, "format", false) ?? "md";
      if (!(TRANSCRIPT_FORMATS as readonly string[]).includes(format)) {
        throw new Error(
          `invalid format: ${format} (expected json, md, srt, vtt or txt)`,
        );
      }
      return request(
        `/v1/meetings/${encodeURIComponent(meetingId)}/transcript?format=${encodeURIComponent(format)}`,
      );
    },

    async searchMeetings(raw: SearchMeetingsArgs): Promise<string> {
      const tool = "search_meetings";
      const args = raw as unknown as Args;
      const query = checkString(tool, args, "query", true) as string;
      if (query.trim() === "") {
        throw new Error("query must be a non-empty string");
      }
      return request(withQuery("/v1/search", [["q", query]]));
    },

    async getActionItems(raw: GetActionItemsArgs): Promise<string> {
      const tool = "get_action_items";
      const args = raw as Args;
      const meetingId = checkString(tool, args, "meeting_id", false);
      const openOnly = checkBoolean(tool, args, "open_only");
      const params: Array<[string, string]> = [];
      if (meetingId !== undefined) params.push(["meeting_id", meetingId]);
      if (openOnly === true) params.push(["open_only", "true"]);
      return request(withQuery("/v1/action_items", params));
    },

    async regenerateNotes(raw: RegenerateNotesArgs): Promise<string> {
      const tool = "regenerate_notes";
      const args = raw as unknown as Args;
      const meetingId = checkString(tool, args, "meeting_id", true) as string;
      const templateId = checkString(tool, args, "template_id", false);
      const body: Record<string, unknown> = {};
      if (templateId !== undefined) body.template_id = templateId;
      return request(`/v1/meetings/${encodeURIComponent(meetingId)}/notes`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    async startRecording(raw: StartRecordingArgs): Promise<string> {
      const tool = "start_recording";
      const args = raw as Args;
      const sourceApp = checkString(tool, args, "source_app", false);
      const title = checkString(tool, args, "title", false);
      const attendees = checkStringArray(tool, args, "attendees");
      const body: Record<string, unknown> = {};
      if (sourceApp !== undefined) body.source_app = sourceApp;
      if (title !== undefined) body.title = title;
      if (attendees !== undefined) body.attendees = attendees;
      return request("/v1/recording/start", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    async stopRecording(): Promise<string> {
      return request("/v1/recording/stop", { method: "POST" });
    },

    async addMarker(raw: AddMarkerArgs): Promise<string> {
      const tool = "add_marker";
      const args = raw as Args;
      const label = checkString(tool, args, "label", false);
      const body: Record<string, unknown> = {};
      if (label !== undefined) body.label = label;
      return request("/v1/recording/marker", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  };
}

/* ------------------------------------------------------------------ */
/* Standalone tool functions (a fresh default client per call)        */
/* ------------------------------------------------------------------ */

export async function listMeetings(
  args: ListMeetingsArgs,
  deps: MeetDeps = {},
): Promise<string> {
  return createClient(deps).listMeetings(args);
}

export async function getMeeting(
  args: GetMeetingArgs,
  deps: MeetDeps = {},
): Promise<string> {
  return createClient(deps).getMeeting(args);
}

export async function getTranscript(
  args: GetTranscriptArgs,
  deps: MeetDeps = {},
): Promise<string> {
  return createClient(deps).getTranscript(args);
}

export async function searchMeetings(
  args: SearchMeetingsArgs,
  deps: MeetDeps = {},
): Promise<string> {
  return createClient(deps).searchMeetings(args);
}

export async function getActionItems(
  args: GetActionItemsArgs,
  deps: MeetDeps = {},
): Promise<string> {
  return createClient(deps).getActionItems(args);
}

export async function regenerateNotes(
  args: RegenerateNotesArgs,
  deps: MeetDeps = {},
): Promise<string> {
  return createClient(deps).regenerateNotes(args);
}

export async function startRecording(
  args: StartRecordingArgs,
  deps: MeetDeps = {},
): Promise<string> {
  return createClient(deps).startRecording(args);
}

export async function stopRecording(deps: MeetDeps = {}): Promise<string> {
  return createClient(deps).stopRecording();
}

export async function addMarker(
  args: AddMarkerArgs,
  deps: MeetDeps = {},
): Promise<string> {
  return createClient(deps).addMarker(args);
}
