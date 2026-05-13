#!/usr/bin/env node
// Lightweight end-to-end smoke test for environments where Playwright
// browser binaries can't be installed (e.g. firewalled CI sandboxes).
//
// Boots `next dev` with PRISMA_MOCK=true USE_MOCK_EXTRACTION=true, then hits
// every public endpoint and asserts the response shape. Exits non-zero on
// the first failure.

import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PORT = Number(process.env.E2E_PORT ?? 3110);
const BASE = `http://127.0.0.1:${PORT}`;
const STARTUP_TIMEOUT_MS = 90_000;

const results = [];

function record(name, ok = true, detail = "") {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  const out = ok ? process.stdout : process.stderr;
  out.write(`[${tag}] ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function waitForServer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return true;
    } catch {
      // server not up yet
    }
    await wait(500);
  }
  return false;
}

async function loadSampleByKey(id) {
  const raw = await readFile(
    resolve(ROOT, `data/samples/${id}.json`),
    "utf8",
  );
  return JSON.parse(raw);
}

async function postJSON(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response
  }
  return { status: res.status, data };
}

async function patchJSON(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response
  }
  return { status: res.status, data };
}

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response
  }
  return { status: res.status, data };
}

async function getHTML(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  return { status: res.status, text };
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

async function runSuite() {
  // 1. Dashboard renders
  {
    const { status, text } = await getHTML("/");
    assert(status === 200, `GET / status ${status}`);
    assert(
      text.includes("Verification history"),
      "GET / missing 'Verification history' heading",
    );
    record("GET /  dashboard renders");
  }

  // 2. New page renders
  {
    const { status, text } = await getHTML("/new");
    assert(status === 200, `GET /new status ${status}`);
    assert(
      text.includes("New verification"),
      "GET /new missing 'New verification' heading",
    );
    record("GET /new  new-verification page renders");
  }

  // 3. Batch page renders
  {
    const { status, text } = await getHTML("/batch");
    assert(status === 200, `GET /batch status ${status}`);
    assert(
      text.includes("Batch verification"),
      "GET /batch missing 'Batch verification' heading",
    );
    record("GET /batch  batch page renders");
  }

  // 4. POST /api/verify with the wine-valid sample
  let recordId;
  {
    const sample = await loadSampleByKey("wine-valid");
    const { status, data } = await postJSON("/api/verify", {
      clientName: sample.clientName,
      applicantName: sample.applicantName,
      productName: sample.productName,
      application: sample.application,
      images: sample.images,
      mockScenario: sample.mockScenario,
    });
    assert(status === 200, `POST /api/verify status ${status}`);
    assert(data && data.report, "POST /api/verify missing report");
    assert(
      Array.isArray(data.report.checks) && data.report.checks.length > 0,
      "POST /api/verify report has no checks",
    );
    assert(typeof data.recordId === "string", "POST /api/verify missing recordId");
    recordId = data.recordId;
    record(
      `POST /api/verify  wine-valid → ${data.report.overallStatus} (recordId ${recordId})`,
    );
  }

  // 5. GET /api/verifications lists the record
  {
    const { status, data } = await getJSON("/api/verifications");
    assert(status === 200, `GET /api/verifications status ${status}`);
    assert(
      Array.isArray(data.records),
      "GET /api/verifications missing records array",
    );
    assert(
      data.records.some((r) => r.id === recordId),
      `GET /api/verifications did not contain recordId ${recordId}`,
    );
    record(
      `GET /api/verifications  lists ${data.records.length} record(s)`,
    );
  }

  // 6. GET /api/verifications/[id] returns full detail
  {
    const { status, data } = await getJSON(`/api/verifications/${recordId}`);
    assert(status === 200, `GET /api/verifications/${recordId} status ${status}`);
    assert(
      data.record && data.record.applicationJson && data.record.reportJson,
      "GET /api/verifications/[id] missing detail json",
    );
    record(`GET /api/verifications/${recordId}  detail loads`);
  }

  // 7. PATCH /api/verifications/[id] updates reviewer notes
  {
    const { status } = await patchJSON(`/api/verifications/${recordId}`, {
      reviewerNotes: "Smoke-test reviewer note.",
    });
    assert(status === 200, `PATCH /api/verifications/${recordId} status ${status}`);
    record(`PATCH /api/verifications/${recordId}  reviewer notes updated`);
  }

  // 8. POST /api/verify/batch with all sample scenarios
  {
    const ids = [
      "wine-valid",
      "wine-abv-warning",
      "spirits-valid",
      "spirits-missing-warning",
      "malt-valid",
      "imported-missing-origin",
    ];
    const items = await Promise.all(
      ids.map(async (id) => {
        const sample = await loadSampleByKey(id);
        return {
          itemKey: id,
          clientName: sample.clientName,
          applicantName: sample.applicantName,
          productName: sample.productName,
          application: sample.application,
          images: sample.images,
          mockScenario: sample.mockScenario,
        };
      }),
    );
    const { status, data } = await postJSON("/api/verify/batch", { items });
    assert(status === 200, `POST /api/verify/batch status ${status}`);
    assert(
      data.counts.total === items.length,
      `POST /api/verify/batch wrong total: ${data.counts.total}`,
    );
    assert(
      data.counts.success === items.length,
      `POST /api/verify/batch wrong success: ${data.counts.success}`,
    );
    record(
      `POST /api/verify/batch  ${data.counts.success}/${data.counts.total} success in ${(data.durationMs / 1000).toFixed(2)}s`,
    );
  }

  // 9. POST /api/verify rejects invalid JSON
  {
    const res = await fetch(`${BASE}/api/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    assert(res.status === 400, `POST /api/verify invalid-json expected 400, got ${res.status}`);
    record("POST /api/verify  invalid JSON → 400");
  }

  // 10. POST /api/verify rejects schema-invalid application
  {
    const sample = await loadSampleByKey("wine-valid");
    const { status } = await postJSON("/api/verify", {
      application: { applicationTypeStep: { productType: "wine" } },
      images: sample.images,
    });
    assert(status === 422, `POST /api/verify invalid-app expected 422, got ${status}`);
    record("POST /api/verify  invalid application → 422");
  }
}

async function main() {
  process.env.PRISMA_MOCK = process.env.PRISMA_MOCK ?? "true";
  process.env.USE_MOCK_EXTRACTION = process.env.USE_MOCK_EXTRACTION ?? "true";

  process.stdout.write(`[smoke] starting dev server on :${PORT}…\n`);
  const dev = spawn(
    "npx",
    ["next", "dev", "--port", String(PORT), "--hostname", "127.0.0.1"],
    {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let serverStderr = "";
  dev.stderr.on("data", (chunk) => {
    serverStderr += chunk.toString();
  });

  const stop = () => {
    if (!dev.killed) dev.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("exit", stop);

  try {
    const up = await waitForServer();
    if (!up) {
      process.stderr.write(serverStderr);
      throw new Error(`Dev server did not respond within ${STARTUP_TIMEOUT_MS}ms`);
    }
    await runSuite();
    const failed = results.filter((r) => !r.ok);
    process.stdout.write(
      `\n[smoke] ${results.length - failed.length}/${results.length} checks passed\n`,
    );
    if (failed.length > 0) {
      process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`\n[smoke] FAILED: ${err.message}\n`);
    process.exit(1);
  } finally {
    stop();
    await wait(200);
  }
}

main().catch((err) => {
  process.stderr.write(`[smoke] unexpected error: ${err.stack ?? err}\n`);
  process.exit(1);
});
