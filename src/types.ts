/**
 * meetrecord types.
 *
 * Nine tools over the Recordist app's local API. Every tool
 * returns a single text payload: JSON responses pass through
 * as their JSON text, and non-JSON transcript formats pass
 * through as the raw body text.
 */

export interface ListMeetingsArgs {
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface GetMeetingArgs {
  meeting_id: string;
}

export interface GetTranscriptArgs {
  meeting_id: string;
  format?: string;
}

export interface SearchMeetingsArgs {
  query: string;
}

export interface GetActionItemsArgs {
  meeting_id?: string;
  open_only?: boolean;
}

export interface RegenerateNotesArgs {
  meeting_id: string;
  template_id?: string;
}

export interface StartRecordingArgs {
  source_app?: string;
  title?: string;
  attendees?: string[];
}

export interface StopRecordingArgs {
  // No arguments.
}

export interface AddMarkerArgs {
  label?: string;
}

/** The minimal slice of a fetch Response this client relies on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Injectable fetch, so tests never touch the live network. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/** Injectable token-file reader, so tests use fixtures. */
export type FileReaderFn = (path: string) => Promise<string>;

/** Runtime dependencies for the core, all injectable in tests. */
export interface MeetDeps {
  /** Fetch implementation. Defaults to the global fetch. */
  fetchFn?: FetchFn;
  /** Reads the token file. Defaults to fs/promises readFile (utf8). */
  readFileFn?: FileReaderFn;
  /** Clock in epoch milliseconds, driving the probe cache. Defaults to Date.now. */
  now?: () => number;
  /** Environment (RECORDIST_* variables and HOME). Defaults to process.env. */
  env?: Record<string, string | undefined>;
}
