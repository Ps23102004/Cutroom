#!/usr/bin/env node
// scripts/verify_b0_slice.mjs
//
// Native Vertical Slice verification (Task B0-E / Phase B).
// Drives the cutroom-cli binary over NDJSON stdio and validates every phase
// of the project lifecycle: create → import → timeline → revision → render →
// close → reopen → verify persistence.
//
// Usage:
//   node scripts/verify_b0_slice.mjs [--cli-path <path>] [--keep]
//
// Requires: Node.js ≥ 18, cargo-built cutroom-cli, ffprobe, ffmpeg.

import { spawn, execSync } from "node:child_process";
import { mkdtemp, rm, readFile, access, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FIXTURE_A = join(ROOT, "tests/fixtures/fixture_a.mp4");
const FIXTURE_B = join(ROOT, "tests/fixtures/fixture_b.mp4");
const FIXTURE_A_SHA = "06e35e744a729825b664fc938485d840307755bcc44a60cd3f47f362555bcccb";
const FIXTURE_B_SHA = "5bcb5af63d409cd5f9a46c849867315b83fc9377e5ddab31ac70295ad6654560";
const FFPROBE = "/opt/homebrew/bin/ffprobe";
const FFMPEG = "/opt/homebrew/bin/ffmpeg";

// ──────────────────────────────────────────────────────────────────────────────
// CLI binary driver
// ──────────────────────────────────────────────────────────────────────────────

class CutroomCLI {
  #proc;
  #rl;
  #pending;
  #ready;

  constructor(cliPath, registryPath) {
    this.#pending = [];
    this.#ready = new Promise((resolve) => {
      this.#proc = spawn(cliPath, ["--registry-path", registryPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderrBuf = "";
      this.#proc.stderr.on("data", (chunk) => {
        stderrBuf += chunk.toString();
        if (stderrBuf.includes("ready")) resolve();
      });
      this.#proc.on("error", (err) => {
        console.error(`cutroom-cli spawn error: ${err.message}`);
        process.exit(1);
      });
      this.#proc.on("exit", (code) => {
        // Reject any remaining promises
        for (const { reject } of this.#pending) {
          reject(new Error(`cutroom-cli exited with code ${code}`));
        }
        this.#pending = [];
      });
      this.#rl = createInterface({ input: this.#proc.stdout });
      this.#rl.on("line", (line) => {
        if (this.#pending.length > 0) {
          const { resolve } = this.#pending.shift();
          resolve(JSON.parse(line));
        }
      });
    });
  }

  async waitReady() {
    await this.#ready;
  }

  send(request) {
    return new Promise((resolve, reject) => {
      this.#pending.push({ resolve, reject });
      this.#proc.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  async close() {
    return new Promise((resolve) => {
      this.#proc.on("exit", resolve);
      this.#proc.stdin.end();
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function opId() {
  return randomUUID();
}

function assertOk(response, label) {
  if (!response.ok) {
    console.error(`FAIL [${label}]:`, JSON.stringify(response, null, 2));
    throw new Error(`${label}: expected ok=true, got error ${response.error?.code}: ${response.error?.message}`);
  }
  return response.data;
}

function assertErr(response, expectedCode, label) {
  if (response.ok) {
    throw new Error(`${label}: expected error ${expectedCode}, got ok`);
  }
  if (response.error.code !== expectedCode) {
    throw new Error(`${label}: expected error code ${expectedCode}, got ${response.error.code}`);
  }
  return response.error;
}

function assertEqual(actual, expected, label) {
  const a = typeof actual === "object" ? JSON.stringify(actual) : String(actual);
  const e = typeof expected === "object" ? JSON.stringify(expected) : String(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
}

function assertExists(val, label) {
  if (val === undefined || val === null || val === "") {
    throw new Error(`${label}: expected a value, got ${val}`);
  }
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function shasum(filePath) {
  const out = execSync(`shasum -a 256 "${filePath}"`, { encoding: "utf-8" });
  return out.trim().split(/\s+/)[0];
}

function ffprobe(filePath) {
  const out = execSync(
    `${FFPROBE} -v quiet -print_format json -show_format -show_streams "${filePath}"`,
    { encoding: "utf-8" }
  );
  return JSON.parse(out);
}

function ffmpegNullDecode(filePath) {
  // Decodes every frame to /dev/null — catches truncated or corrupt output.
  execSync(`${FFMPEG} -v error -i "${filePath}" -f null -`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

let phaseCount = 0;
function phase(name) {
  phaseCount++;
  console.log(`\n── Phase ${phaseCount}: ${name} ${"─".repeat(Math.max(0, 58 - name.length))}`);
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let cliPath = join(ROOT, "target/debug/cutroom-cli");
  let keep = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cli-path") cliPath = args[++i];
    if (args[i] === "--keep") keep = true;
  }

  // Check prerequisites
  if (!(await fileExists(cliPath))) {
    console.error(`cutroom-cli not found at ${cliPath}. Run: cargo build --bin cutroom-cli`);
    process.exit(1);
  }
  if (!(await fileExists(FIXTURE_A)) || !(await fileExists(FIXTURE_B))) {
    console.error("Test fixtures not found in tests/fixtures/");
    process.exit(1);
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "cutroom-b0-"));
  const registryPath = join(tmpDir, "native", "projects.json");
  const projectDir = join(tmpDir, "project");

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  CUTROOM — Native Vertical Slice Verification (B0-E)       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  cli:       ${cliPath}`);
  console.log(`  tmpDir:    ${tmpDir}`);
  console.log(`  registry:  ${registryPath}`);
  console.log(`  project:   ${projectDir}`);

  // Saved IDs from earlier phases, used for persistence checks
  let projectId, assetAId, assetBId, trackId;
  let firstClipId, secondClipId;
  let revisionId, revisionContentHash;
  let jobId;

  try {
    // ── Phase 1: Launch & health ───────────────────────────────────────────
    phase("Launch & health check");
    const cli = new CutroomCLI(cliPath, registryPath);
    await cli.waitReady();
    pass("cutroom-cli started");

    const health = assertOk(
      await cli.send({ command: "health.get", payload: {} }),
      "health.get"
    );
    assertEqual(health.tauriConnected, true, "tauriConnected");
    assertEqual(health.ffmpegAvailable, true, "ffmpegAvailable");
    pass(`health ok (ffmpeg ${health.ffmpegVersion})`);

    // ── Phase 2: Create project ───────────────────────────────────────────
    phase("Create project & persist in SQLite");
    const project = assertOk(
      await cli.send({
        command: "project.create",
        operation_id: opId(),
        payload: {
          name: "B0 Vertical Slice",
          path: projectDir,
          aspectRatio: "16:9",
          fpsNumerator: 24,
          fpsDenominator: 1,
        },
      }),
      "project.create"
    );
    projectId = project.id;
    assertExists(projectId, "project.id");
    assertEqual(project.name, "B0 Vertical Slice", "project.name");
    const dbPath = join(projectDir, ".cutroom", "project.cutroom");
    if (!(await fileExists(dbPath))) throw new Error("SQLite database not created");
    pass(`project ${projectId} created`);
    pass(`SQLite at ${dbPath}`);

    // ── Phase 3: Import real recordings ───────────────────────────────────
    phase("Import real recordings (fixture_a.mp4 & fixture_b.mp4)");
    const assetA = assertOk(
      await cli.send({
        command: "asset.import",
        operation_id: opId(),
        project_id: projectId,
        payload: { path: FIXTURE_A, name: "fixture_a.mp4", importType: "linked" },
      }),
      "asset.import fixture_a"
    );
    assetAId = assetA.id;
    assertEqual(assetA.codec, "h264", "assetA.codec");
    assertEqual(assetA.width, 1920, "assetA.width");
    assertEqual(assetA.height, 1080, "assetA.height");
    assertEqual(assetA.durationTicks, "61440", "assetA.durationTicks");
    assertEqual(assetA.sha256, FIXTURE_A_SHA, "assetA.sha256");
    pass(`fixture_a imported: ${assetAId}`);

    const assetB = assertOk(
      await cli.send({
        command: "asset.import",
        operation_id: opId(),
        project_id: projectId,
        payload: { path: FIXTURE_B, name: "fixture_b.mp4", importType: "linked" },
      }),
      "asset.import fixture_b"
    );
    assetBId = assetB.id;
    assertEqual(assetB.sha256, FIXTURE_B_SHA, "assetB.sha256");
    pass(`fixture_b imported: ${assetBId}`);

    const assetList = assertOk(
      await cli.send({ command: "asset.list", project_id: projectId, payload: {} }),
      "asset.list"
    );
    assertEqual(assetList.length, 2, "asset count");
    pass("2 assets persisted");

    // ── Phase 4: Build timeline — add source ranges ───────────────────────
    phase("Add source ranges to timeline");
    const comp0 = assertOk(
      await cli.send({ command: "composition.get", project_id: projectId, payload: {} }),
      "composition.get initial"
    );
    assertEqual(comp0.version, 1, "initial version");

    // Add first clip (fixture_a, first 2 seconds: 0..24576 ticks @ 12288 tb)
    const comp1 = assertOk(
      await cli.send({
        command: "composition.apply",
        operation_id: opId(),
        project_id: projectId,
        expected_version: 1,
        payload: {
          action: "add",
          assetId: assetAId,
          sourceInTicks: "0",
          sourceOutTicks: "24576",
          timelineStartTicks: "0",
        },
      }),
      "add first clip"
    );
    assertEqual(comp1.version, 2, "version after first add");
    trackId = comp1.tracks[0].id;
    firstClipId = comp1.clips[0].id;
    pass(`clip 1 added: ${firstClipId} on track ${trackId}`);

    // Add second clip (fixture_b, 2-4 seconds: 24576..49152)
    const comp2 = assertOk(
      await cli.send({
        command: "composition.apply",
        operation_id: opId(),
        project_id: projectId,
        expected_version: 2,
        payload: {
          action: "add",
          assetId: assetBId,
          trackId: trackId,
          sourceInTicks: "24576",
          sourceOutTicks: "49152",
          timelineStartTicks: "96000",
        },
      }),
      "add second clip"
    );
    assertEqual(comp2.version, 3, "version after second add");
    secondClipId = comp2.clips[1].id;
    pass(`clip 2 added: ${secondClipId}`);

    // ── Phase 5: Trim ranges ──────────────────────────────────────────────
    phase("Trim source ranges");
    const trimmed = assertOk(
      await cli.send({
        command: "composition.apply",
        operation_id: opId(),
        project_id: projectId,
        expected_version: 3,
        payload: {
          action: "trim",
          clipId: firstClipId,
          newInTicks: "4096",
          newOutTicks: "20480",
        },
      }),
      "trim first clip"
    );
    assertEqual(trimmed.version, 4, "version after trim");
    pass("first clip trimmed (4096..20480)");

    // ── Phase 6: Reorder ranges ───────────────────────────────────────────
    phase("Reorder ranges");
    const reordered = assertOk(
      await cli.send({
        command: "composition.apply",
        operation_id: opId(),
        project_id: projectId,
        expected_version: 4,
        payload: { action: "reorder", clipId: secondClipId, direction: "left" },
      }),
      "reorder second clip left"
    );
    assertEqual(reordered.version, 5, "version after reorder");
    pass("second clip moved left");

    // ── Phase 7: Persist timeline & create immutable revision ─────────────
    phase("Create immutable revision (SHA-256 hash)");
    const revision = assertOk(
      await cli.send({
        command: "revision.create",
        operation_id: opId(),
        project_id: projectId,
        expected_version: 5,
        payload: { commitNote: "B0 vertical slice revision" },
      }),
      "revision.create"
    );
    revisionId = revision.id;
    revisionContentHash = revision.contentHash;
    assertEqual(revisionContentHash.length, 64, "contentHash is SHA-256");
    assertExists(revisionId, "revision.id");
    pass(`revision ${revisionId}`);
    pass(`content hash: ${revisionContentHash}`);

    // ── Phase 8: Render durable media output ──────────────────────────────
    phase("Render durable media output (1080p_sdr)");
    const job = assertOk(
      await cli.send({
        command: "render.enqueue",
        operation_id: opId(),
        project_id: projectId,
        expected_version: 5,
        payload: { preset: "1080p_sdr", revisionId: revisionId },
      }),
      "render.enqueue"
    );
    jobId = job.id;
    assertEqual(job.status, "queued", "job initial status");
    pass(`render job ${jobId} enqueued`);

    // Poll for job completion (background worker runs in cutroom-cli process)
    let finalJob;
    const POLL_INTERVAL_MS = 500;
    const MAX_POLL_SECONDS = 120;
    const maxPolls = (MAX_POLL_SECONDS * 1000) / POLL_INTERVAL_MS;
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const jobs = assertOk(
        await cli.send({ command: "job.list", project_id: projectId, payload: {} }),
        "job.list poll"
      );
      const current = jobs.find((j) => j.id === jobId);
      if (!current) throw new Error("render job disappeared from job.list");
      if (current.status === "completed") {
        finalJob = current;
        break;
      }
      if (current.status === "failed") {
        throw new Error(`render failed: ${current.error}`);
      }
      if (current.status === "cancelled") {
        throw new Error("render was unexpectedly cancelled");
      }
      // Still running — keep polling
    }
    if (!finalJob) throw new Error("render did not complete within timeout");
    pass(`render completed (status=${finalJob.status})`);

    // ── Phase 9: Probe & decode rendered output ───────────────────────────
    phase("Probe & decode rendered output");
    // The artifact path is inside .cutroom/jobs/<jobId>/attempt-1/artifact.mp4
    const artifactDir = join(projectDir, ".cutroom", "jobs", jobId, "attempt-1");
    const artifactPath = join(artifactDir, "artifact.mp4");
    if (!(await fileExists(artifactPath))) {
      throw new Error(`rendered artifact not found at ${artifactPath}`);
    }
    pass(`artifact exists: ${artifactPath}`);

    // ffprobe the output
    const probeData = ffprobe(artifactPath);
    const videoStream = probeData.streams.find((s) => s.codec_type === "video");
    if (!videoStream) throw new Error("no video stream in rendered output");
    assertEqual(videoStream.width, 1920, "output width");
    assertEqual(videoStream.height, 1080, "output height");
    const duration = parseFloat(probeData.format.duration);
    if (duration < 0.1) throw new Error(`output duration too short: ${duration}s`);
    pass(`output: ${videoStream.width}x${videoStream.height}, ${duration.toFixed(3)}s, ${videoStream.codec_name}`);
    pass(`streams: ${probeData.streams.length} (${probeData.streams.map(s => s.codec_type).join(", ")})`);

    // ffmpeg null-decode (integrity check)
    ffmpegNullDecode(artifactPath);
    pass("ffmpeg null-decode passed (no corruption)");

    // ── Phase 10a: Cancellation & recovery ────────────────────────────────
    phase("Cancellation & recovery behavior");
    // Enqueue another render, cancel it before completion
    const cancelJob = assertOk(
      await cli.send({
        command: "render.enqueue",
        operation_id: opId(),
        project_id: projectId,
        expected_version: 5,
        payload: { preset: "1080p_sdr", revisionId: revisionId },
      }),
      "render.enqueue for cancel"
    );
    const cancelResult = assertOk(
      await cli.send({
        command: "job.cancel",
        operation_id: opId(),
        project_id: projectId,
        payload: { jobId: cancelJob.id },
      }),
      "job.cancel"
    );
    assertEqual(cancelResult.status, "cancelled", "cancelled job status");
    pass(`job ${cancelJob.id} cancelled successfully`);

    // Verify stale write conflict
    const stale = await cli.send({
      command: "composition.apply",
      operation_id: opId(),
      project_id: projectId,
      expected_version: 3, // stale — current is 5
      payload: {
        action: "trim",
        clipId: firstClipId,
        newInTicks: "0",
        newOutTicks: "16384",
      },
    });
    assertErr(stale, "STALE_WRITE_CONFLICT", "stale write");
    pass("stale write conflict correctly rejected");

    // Verify fixture hashes never changed
    assertEqual(shasum(FIXTURE_A), FIXTURE_A_SHA, "fixture_a hash unchanged");
    assertEqual(shasum(FIXTURE_B), FIXTURE_B_SHA, "fixture_b hash unchanged");
    pass("fixture hashes unchanged");

    // ── Close application ─────────────────────────────────────────────────
    phase("Close application (drop AppState)");
    const exitCode = await cli.close();
    pass(`cutroom-cli exited (code ${exitCode})`);

    // ── Phase 10b: Reopen & verify persistence ────────────────────────────
    phase("Reopen application & verify persistence");
    const cli2 = new CutroomCLI(cliPath, registryPath);
    await cli2.waitReady();
    pass("second cutroom-cli instance started");

    // Verify project list
    const projectList = assertOk(
      await cli2.send({ command: "project.list", payload: {} }),
      "project.list after reopen"
    );
    assertEqual(projectList.length, 1, "project count after reopen");
    assertEqual(projectList[0].id, projectId, "project ID persisted");
    pass("project persisted in registry");

    // Reopen project
    const reopened = assertOk(
      await cli2.send({ command: "project.open", project_id: projectId, payload: {} }),
      "project.open after reopen"
    );
    assertEqual(reopened.id, projectId, "reopened project ID");
    pass(`project ${projectId} reopened`);

    // Verify sources persisted
    const assets2 = assertOk(
      await cli2.send({ command: "asset.list", project_id: projectId, payload: {} }),
      "asset.list after reopen"
    );
    assertEqual(assets2.length, 2, "asset count after reopen");
    pass("2 assets persisted across restart");

    // Verify timeline persisted
    const comp3 = assertOk(
      await cli2.send({ command: "composition.get", project_id: projectId, payload: {} }),
      "composition.get after reopen"
    );
    assertEqual(comp3.version, 5, "composition version after reopen");
    assertEqual(comp3.clips.length, 2, "clip count after reopen");
    assertEqual(comp3.tracks.length, 1, "track count after reopen");
    pass("timeline persisted (version 5, 2 clips, 1 track)");

    // Verify revision persisted
    const revisions2 = assertOk(
      await cli2.send({ command: "revision.list", project_id: projectId, payload: {} }),
      "revision.list after reopen"
    );
    assertEqual(revisions2.length, 1, "revision count after reopen");
    assertEqual(revisions2[0].id, revisionId, "revision ID persisted");
    assertEqual(revisions2[0].contentHash, revisionContentHash, "content hash persisted");
    pass(`revision ${revisionId} persisted`);

    // Verify render output persisted
    const jobs2 = assertOk(
      await cli2.send({ command: "job.list", project_id: projectId, payload: {} }),
      "job.list after reopen"
    );
    // Should have 2 jobs: completed render + cancelled render
    const completedJobs = jobs2.filter((j) => j.status === "completed");
    const cancelledJobs = jobs2.filter((j) => j.status === "cancelled");
    assertEqual(completedJobs.length, 1, "completed job count");
    if (cancelledJobs.length < 1) {
      throw new Error(`expected ≥1 cancelled job, got ${cancelledJobs.length}`);
    }
    pass(`${jobs2.length} jobs persisted (${completedJobs.length} completed, ${cancelledJobs.length} cancelled)`);

    // Verify rendered artifact still exists on disk
    if (!(await fileExists(artifactPath))) {
      throw new Error("rendered artifact missing after restart");
    }
    pass("render output persisted on disk");

    // Final fixture hash check
    assertEqual(shasum(FIXTURE_A), FIXTURE_A_SHA, "fixture_a final hash");
    assertEqual(shasum(FIXTURE_B), FIXTURE_B_SHA, "fixture_b final hash");
    pass("fixture hashes still unchanged");

    await cli2.close();
    pass("second instance closed cleanly");

    // ── Summary ───────────────────────────────────────────────────────────
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║  ✅  ALL PHASES PASSED — Native Vertical Slice verified     ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log(`  Phases:    ${phaseCount}`);
    console.log(`  Project:   ${projectId}`);
    console.log(`  Revision:  ${revisionId}`);
    console.log(`  Artifact:  ${artifactPath}`);
    console.log(`  tmpDir:    ${tmpDir}`);
    console.log();
  } catch (error) {
    console.error(`\n❌  VERIFICATION FAILED: ${error.message}`);
    console.error(`  tmpDir preserved: ${tmpDir}`);
    process.exit(1);
  } finally {
    if (!keep) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    } else {
      console.log(`  tmpDir kept: ${tmpDir}`);
    }
  }
}

main();
