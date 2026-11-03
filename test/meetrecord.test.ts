import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../src/meetrecord.js";
import type { FetchFn, MeetDeps } from "../src/types.js";

/**
 * Every test runs against an injected fake fetch, a fake
 * token-file reader and a fake clock: no live network, no
 * live call, no real file reads.
 */

interface Captured {
  url: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  };
}

type Reply = { status?: number; body: unknown };
type Handler = (url: string, init?: Captured["init"]) => Reply | null | "throw";

function makeFetch(handlers: Handler[], captured: Captured[] = []): FetchFn {
  return async (url, init) => {
    captured.push({ url, init });
    for (const h of handlers) {
      const r = h(url, init);
      if (r === "throw") throw new Error("socket hang up");
      if (r) {
        const status = r.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
        };
      }
    }
    return { ok: false, status: 404, text: async () => "no fake route" };
  };
}

const healthOk: Handler = (url) =>
  url === "http://127.0.0.1:47321/v1/health" ? { body: { status: "ok" } } : null;

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function deps(
  fetchFn: FetchFn,
  extra: Partial<MeetDeps> = {},
): MeetDeps {
  return {
    fetchFn,
    now: () => 1_000_000,
    env: { HOME: "/home/tester", RECORDIST_API_TOKEN: "env-token" },
    readFileFn: async () => {
      throw new Error("no token file");
    },
    ...extra,
  };
}

/* ------------------------------------------------------------------ */

describe("backend probe", () => {
  it("fails with the pinned message when the health probe returns non-2xx", async () => {
    const fetchFn = makeFetch([
      (url) => (url.endsWith("/v1/health") ? { status: 503, body: "down" } : null),
    ]);
    await assert.rejects(() => createClient(deps(fetchFn)).listMeetings({}), {
      message: "Recordist app is not running",
    });
  });

  it("fails with the pinned message when the health probe throws", async () => {
    const fetchFn = makeFetch([() => "throw"]);
    await assert.rejects(() => createClient(deps(fetchFn)).getMeeting({ meeting_id: "m1" }), {
      message: "Recordist app is not running",
    });
  });

  it("caches a successful probe for 5 seconds on the injectable clock", async () => {
    const clock = makeClock();
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.includes("/v1/meetings") ? { body: [] } : null)],
      captured,
    );
    const client = createClient(deps(fetchFn, { now: clock.now }));
    await client.listMeetings({});
    await client.listMeetings({});
    clock.advance(4999);
    await client.listMeetings({});
    const probesBefore = captured.filter((c) => c.url.endsWith("/v1/health")).length;
    assert.equal(probesBefore, 1);
    clock.advance(2);
    await client.listMeetings({});
    const probesAfter = captured.filter((c) => c.url.endsWith("/v1/health")).length;
    assert.equal(probesAfter, 2);
  });

  it("does not cache a failed probe", async () => {
    let healthCalls = 0;
    const fetchFn: FetchFn = async (url) => {
      if (url.endsWith("/v1/health")) {
        healthCalls += 1;
        if (healthCalls === 1) return { ok: false, status: 500, text: async () => "x" };
        return { ok: true, status: 200, text: async () => "{}" };
      }
      return { ok: true, status: 200, text: async () => "[]" };
    };
    const client = createClient(deps(fetchFn));
    await assert.rejects(() => client.listMeetings({}), {
      message: "Recordist app is not running",
    });
    assert.equal(await client.listMeetings({}), "[]");
    assert.equal(healthCalls, 2);
  });

  it("probes the health endpoint without an Authorization header", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.includes("/v1/meetings") ? { body: [] } : null)],
      captured,
    );
    await createClient(deps(fetchFn)).listMeetings({});
    const probe = captured.find((c) => c.url.endsWith("/v1/health"));
    assert.equal(probe?.init?.headers?.Authorization, undefined);
    assert.equal(probe?.init?.method, "GET");
  });

  it("honours a custom RECORDIST_API_URL", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [
        (url) => (url === "http://localhost:9999/v1/health" ? { body: {} } : null),
        (url) => (url === "http://localhost:9999/v1/meetings/m9" ? { body: { id: "m9" } } : null),
      ],
      captured,
    );
    const client = createClient(
      deps(fetchFn, {
        env: { HOME: "/home/tester", RECORDIST_API_URL: "http://localhost:9999/", RECORDIST_API_TOKEN: "t" },
      }),
    );
    assert.equal(client.baseUrl(), "http://localhost:9999");
    assert.equal(await client.getMeeting({ meeting_id: "m9" }), '{"id":"m9"}');
  });
});

describe("token resolution", () => {
  it("prefers RECORDIST_API_TOKEN over the token file", async () => {
    let fileReads = 0;
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.includes("/v1/meetings") ? { body: [] } : null)],
      captured,
    );
    const client = createClient(
      deps(fetchFn, {
        readFileFn: async () => {
          fileReads += 1;
          return "file-token";
        },
      }),
    );
    assert.equal(await client.resolveToken(), "env-token");
    assert.equal(fileReads, 0);
    await client.listMeetings({});
    const api = captured.find((c) => c.url.includes("/v1/meetings"));
    assert.equal(api?.init?.headers?.Authorization, "Bearer env-token");
  });

  it("reads <RECORDIST_DATA_DIR>/api_token when the env token is absent", async () => {
    const seenPaths: string[] = [];
    const client = createClient(
      deps(makeFetch([healthOk]), {
        env: { HOME: "/home/tester", RECORDIST_DATA_DIR: "/data/rec" },
        readFileFn: async (path) => {
          seenPaths.push(path);
          return "  file-token\n";
        },
      }),
    );
    assert.equal(client.tokenFilePath(), "/data/rec/api_token");
    assert.equal(await client.resolveToken(), "file-token");
    assert.deepEqual(seenPaths, ["/data/rec/api_token"]);
  });

  it("falls back to the Linux default data dir under HOME", async () => {
    const client = createClient(
      deps(makeFetch([healthOk]), {
        env: { HOME: "/home/tester" },
        readFileFn: async () => "tok",
      }),
    );
    assert.equal(
      client.tokenFilePath(),
      "/home/tester/.local/share/app.recordist.desktop/api_token",
    );
  });

  it("sends no Authorization header when no token resolves", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.includes("/v1/meetings") ? { body: [] } : null)],
      captured,
    );
    const client = createClient(
      deps(fetchFn, { env: { HOME: "/home/tester" } }),
    );
    await client.listMeetings({});
    const api = captured.find((c) => c.url.includes("/v1/meetings"));
    assert.equal(api?.init?.headers?.Authorization, undefined);
  });
});

describe("query construction and wires", () => {
  it("list_meetings passes only the provided args as query params", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.startsWith("http://127.0.0.1:47321/v1/meetings") ? { body: [{ id: "m1" }] } : null)],
      captured,
    );
    const out = await createClient(deps(fetchFn)).listMeetings({
      q: "budget review",
      from: "2026-10-01",
      limit: 10,
    });
    assert.equal(out, '[{"id":"m1"}]');
    const api = captured.find((c) => !c.url.endsWith("/v1/health"));
    assert.equal(
      api?.url,
      "http://127.0.0.1:47321/v1/meetings?q=budget%20review&from=2026-10-01&limit=10",
    );
    assert.equal(api?.init?.method, "GET");
  });

  it("list_meetings with no args calls the bare path", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.includes("/v1/meetings") ? { body: [] } : null)],
      captured,
    );
    await createClient(deps(fetchFn)).listMeetings({});
    const api = captured.find((c) => !c.url.endsWith("/v1/health"));
    assert.equal(api?.url, "http://127.0.0.1:47321/v1/meetings");
  });

  it("search_meetings encodes the query into /v1/search?q=", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.includes("/v1/search") ? { body: [] } : null)],
      captured,
    );
    await createClient(deps(fetchFn)).searchMeetings({ query: "pricing & plans" });
    const api = captured.find((c) => !c.url.endsWith("/v1/health"));
    assert.equal(api?.url, "http://127.0.0.1:47321/v1/search?q=pricing%20%26%20plans");
  });

  it("get_action_items sends open_only=true only when true", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.includes("/v1/action_items") ? { body: [] } : null)],
      captured,
    );
    const client = createClient(deps(fetchFn));
    await client.getActionItems({ meeting_id: "m7", open_only: true });
    await client.getActionItems({ open_only: false });
    const urls = captured.filter((c) => !c.url.endsWith("/v1/health")).map((c) => c.url);
    assert.deepEqual(urls, [
      "http://127.0.0.1:47321/v1/action_items?meeting_id=m7&open_only=true",
      "http://127.0.0.1:47321/v1/action_items",
    ]);
  });

  it("regenerate_notes posts template_id when provided and {} otherwise", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.endsWith("/notes") ? { body: { ok: true } } : null)],
      captured,
    );
    const client = createClient(deps(fetchFn));
    await client.regenerateNotes({ meeting_id: "m3", template_id: "standup" });
    await client.regenerateNotes({ meeting_id: "m3" });
    const posts = captured.filter((c) => c.url.endsWith("/notes"));
    assert.equal(posts[0].url, "http://127.0.0.1:47321/v1/meetings/m3/notes");
    assert.equal(posts[0].init?.method, "POST");
    assert.equal(posts[0].init?.body, '{"template_id":"standup"}');
    assert.equal(posts[0].init?.headers?.["Content-Type"], "application/json");
    assert.equal(posts[1].init?.body, "{}");
  });

  it("start_recording posts only the provided fields", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.endsWith("/recording/start") ? { body: {} } : null)],
      captured,
    );
    await createClient(deps(fetchFn)).startRecording({
      title: "Weekly sync",
      attendees: ["Ana", "Bo"],
    });
    const post = captured.find((c) => c.url.endsWith("/recording/start"));
    assert.equal(post?.init?.body, '{"title":"Weekly sync","attendees":["Ana","Bo"]}');
  });

  it("stop_recording posts with no body", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.endsWith("/recording/stop") ? { body: {} } : null)],
      captured,
    );
    await createClient(deps(fetchFn)).stopRecording();
    const post = captured.find((c) => c.url.endsWith("/recording/stop"));
    assert.equal(post?.init?.method, "POST");
    assert.equal(post?.init?.body, undefined);
  });

  it("add_marker posts the label when provided and {} otherwise", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.endsWith("/recording/marker") ? { body: {} } : null)],
      captured,
    );
    const client = createClient(deps(fetchFn));
    await client.addMarker({ label: "decision" });
    await client.addMarker({});
    const posts = captured.filter((c) => c.url.endsWith("/recording/marker"));
    assert.equal(posts[0].init?.body, '{"label":"decision"}');
    assert.equal(posts[1].init?.body, "{}");
  });
});

describe("get_transcript formats", () => {
  it("defaults to md and passes the body text through as-is", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.includes("/transcript") ? { body: "# Notes\nhello" } : null)],
      captured,
    );
    const out = await createClient(deps(fetchFn)).getTranscript({ meeting_id: "m5" });
    assert.equal(out, "# Notes\nhello");
    const api = captured.find((c) => c.url.includes("/transcript"));
    assert.equal(api?.url, "http://127.0.0.1:47321/v1/meetings/m5/transcript?format=md");
  });

  it("passes an explicit srt format through on the wire", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch(
      [healthOk, (url) => (url.includes("/transcript") ? { body: "1\n00:00:00,000 --> 00:00:01,000\nhi" } : null)],
      captured,
    );
    await createClient(deps(fetchFn)).getTranscript({ meeting_id: "m5", format: "srt" });
    const api = captured.find((c) => c.url.includes("/transcript"));
    assert.ok(api?.url.endsWith("?format=srt"));
  });

  it("rejects an unknown format with the pinned sentence and no API call", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch([healthOk], captured);
    await assert.rejects(
      () => createClient(deps(fetchFn)).getTranscript({ meeting_id: "m5", format: "pdf" }),
      { message: "invalid format: pdf (expected json, md, srt, vtt or txt)" },
    );
    assert.equal(captured.length, 0);
  });
});

describe("validation", () => {
  it("reports a missing required argument with the pinned sentence", async () => {
    const client = createClient(deps(makeFetch([healthOk])));
    await assert.rejects(() => client.getMeeting({} as never), {
      message: "get_meeting: missing required argument: meeting_id",
    });
    await assert.rejects(() => client.regenerateNotes({} as never), {
      message: "regenerate_notes: missing required argument: meeting_id",
    });
  });

  it("reports a wrong-typed argument with the pinned sentence", async () => {
    const client = createClient(deps(makeFetch([healthOk])));
    await assert.rejects(() => client.getMeeting({ meeting_id: 42 } as never), {
      message: "get_meeting: argument meeting_id must be a string",
    });
    await assert.rejects(() => client.listMeetings({ limit: 1.5 } as never), {
      message: "list_meetings: argument limit must be a integer",
    });
    await assert.rejects(() => client.getActionItems({ open_only: "yes" } as never), {
      message: "get_action_items: argument open_only must be a boolean",
    });
    await assert.rejects(() => client.startRecording({ attendees: "Ana" } as never), {
      message: "start_recording: argument attendees must be a array",
    });
  });

  it("rejects an empty search query with the pinned sentence", async () => {
    const client = createClient(deps(makeFetch([healthOk])));
    await assert.rejects(() => client.searchMeetings({ query: "" }), {
      message: "query must be a non-empty string",
    });
    await assert.rejects(() => client.searchMeetings({ query: "   " }), {
      message: "query must be a non-empty string",
    });
  });
});

describe("error mapping", () => {
  it("carries the API error.message verbatim on a non-2xx response", async () => {
    const fetchFn = makeFetch([
      healthOk,
      (url) =>
        url.includes("/v1/meetings")
          ? { status: 404, body: { error: { code: 404, message: "no such meeting" } } }
          : null,
    ]);
    await assert.rejects(
      () => createClient(deps(fetchFn)).getMeeting({ meeting_id: "nope" }),
      { message: "no such meeting" },
    );
  });

  it("falls back to the upstream error form when no error.message is present", async () => {
    const fetchFn = makeFetch([
      healthOk,
      (url) => (url.includes("/v1/meetings") ? { status: 500, body: "boom" } : null),
    ]);
    await assert.rejects(() => createClient(deps(fetchFn)).listMeetings({}), {
      message: "upstream error: HTTP 500 from recordist-api",
    });
  });

  it("maps a throwing fetch after a successful probe to upstream unreachable", async () => {
    const fetchFn = makeFetch([
      healthOk,
      (url) => (url.includes("/v1/meetings") ? "throw" : null),
    ]);
    await assert.rejects(() => createClient(deps(fetchFn)).listMeetings({}), {
      message: "upstream unreachable: recordist-api",
    });
  });

  it("passes a JSON response body through as its JSON text", async () => {
    const fetchFn = makeFetch([
      healthOk,
      (url) =>
        url.includes("/v1/meetings/m2")
          ? { body: '{"id":"m2","title":"Sync","action_items":[1,2]}' }
          : null,
    ]);
    const out = await createClient(deps(fetchFn)).getMeeting({ meeting_id: "m2" });
    assert.equal(out, '{"id":"m2","title":"Sync","action_items":[1,2]}');
  });
});
