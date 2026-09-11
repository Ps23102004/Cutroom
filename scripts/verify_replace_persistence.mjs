// scripts/verify_replace_persistence.mjs
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FIXTURE_A = join(ROOT, "tests/fixtures/fixture_a.mp4");
const FIXTURE_B = join(ROOT, "tests/fixtures/fixture_b.mp4");
const CLI = join(ROOT, "target/debug/cutroom-cli");

class CutroomCLI {
  #proc;
  #rl;
  #pending = [];
  #ready;

  constructor(cliPath, registryPath) {
    this.#ready = new Promise((resolve) => {
      this.#proc = spawn(cliPath, ["--registry-path", registryPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderrBuf = "";
      this.#proc.stderr.on("data", (chunk) => {
        stderrBuf += chunk.toString();
        if (stderrBuf.includes("ready")) resolve();
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

async function sha256(filePath) {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

async function run() {
  const tmp = await mkdtemp(join(tmpdir(), "cutroom-replace-proof-"));
  const registry = join(tmp, "projects.json");
  const projectDir = join(tmp, "project");

  const hashA_before = await sha256(FIXTURE_A);
  const hashB_before = await sha256(FIXTURE_B);

  console.log("1. Starting cutroom-cli instance...");
  let cli = new CutroomCLI(CLI, registry);
  await cli.waitReady();

  console.log("2. Creating project...");
  const createRes = await cli.send({
    command: "project.create",
    operation_id: randomUUID(),
    payload: { name: "Replace Proof", path: projectDir, fpsNumerator: 24, fpsDenominator: 1, aspectRatio: "16:9" },
  });
  if (!createRes.ok) throw new Error("Create failed: " + JSON.stringify(createRes));
  const projectId = createRes.data.id;

  console.log("3. Importing assets fixture_a and fixture_b...");
  const importA = await cli.send({
    command: "asset.import",
    project_id: projectId,
    operation_id: randomUUID(),
    payload: { path: FIXTURE_A, importType: "linked" },
  });
  const importB = await cli.send({
    command: "asset.import",
    project_id: projectId,
    operation_id: randomUUID(),
    payload: { path: FIXTURE_B, importType: "linked" },
  });
  const assetA_id = importA.data.id;
  const assetB_id = importB.data.id;

  console.log("4. Adding clip from asset A...");
  const addRes = await cli.send({
    command: "composition.apply",
    project_id: projectId,
    expected_version: 1,
    operation_id: randomUUID(),
    payload: {
      action: "add",
      assetId: assetA_id,
      sourceInTicks: "0",
      sourceOutTicks: "1536", // 1536 in 1/12288 -> 3000 in 1/24000
      timelineStartTicks: "90000",
    },
  });
  const initialComp = addRes.data;
  const clipId = initialComp.clips[0].id;
  if (initialComp.version !== 2) throw new Error("Expected version 2, got " + initialComp.version);
  if (initialComp.clips[0].assetId !== assetA_id) throw new Error("Expected clip to reference asset A");

  console.log("5. Applying atomic Replace with asset B...");
  const replaceRes = await cli.send({
    command: "composition.apply",
    project_id: projectId,
    expected_version: 2,
    operation_id: randomUUID(),
    payload: {
      action: "replace",
      clipId: clipId,
      assetId: assetB_id,
      sourceInTicks: "0",
      sourceOutTicks: "19200", // 19200 in 1/12288 -> 37500 in 1/24000
    },
  });
  if (!replaceRes.ok) throw new Error("Replace failed: " + JSON.stringify(replaceRes));
  const replacedComp = replaceRes.data;

  // Verify: version increments, clip ID kept, timelineStart kept, asset swapped, outTicks updated
  if (replacedComp.version !== 3) throw new Error("Expected version 3, got " + replacedComp.version);
  const replacedClip = replacedComp.clips.find(c => c.id === clipId);
  if (!replacedClip) throw new Error("Clip ID not found after replace");
  if (replacedClip.assetId !== assetB_id) throw new Error("Expected clip assetId to be asset B");
  if (replacedClip.timelineStartTicks !== "90000") throw new Error("Expected start ticks 90000");
  if (replacedClip.inTicks !== "0") throw new Error("Expected inTicks 0");
  if (replacedClip.outTicks !== "19200") throw new Error("Expected outTicks 19200");
  console.log("   ✓ In-memory replacement verified (version 3, asset swapped, clip ID preserved)");

  console.log("6. Creating revision...");
  const revRes = await cli.send({
    command: "revision.create",
    project_id: projectId,
    expected_version: 3,
    operation_id: randomUUID(),
    payload: { commitNote: "Proof revision after replace" },
  });
  if (!revRes.ok) throw new Error("Revision failed: " + JSON.stringify(revRes));
  console.log("   ✓ Revision created:", revRes.data.contentHash);

  console.log("7. Closing cutroom-cli (dropping in-memory state)...");
  await cli.close();

  console.log("8. Reopening cutroom-cli and reopening project from SQLite...");
  cli = new CutroomCLI(CLI, registry);
  await cli.waitReady();

  const openRes = await cli.send({
    command: "project.open",
    project_id: projectId,
    operation_id: randomUUID(),
    payload: {},
  });
  if (!openRes.ok) throw new Error("Reopen failed: " + JSON.stringify(openRes));

  const compRes = await cli.send({
    command: "composition.get",
    project_id: projectId,
    operation_id: randomUUID(),
    payload: {},
  });
  const persistedComp = compRes.data;
  if (persistedComp.version !== 3) throw new Error("Expected persisted version 3, got " + persistedComp.version);
  const persistedClip = persistedComp.clips.find(c => c.id === clipId);
  if (!persistedClip) throw new Error("Persisted clip not found");
  if (persistedClip.assetId !== assetB_id) throw new Error("Expected persisted clip asset to be asset B");
  if (persistedClip.outTicks !== "19200") throw new Error("Expected persisted outTicks 19200");
  console.log("   ✓ Reopened composition verified: replacement persisted in SQLite!");

  await cli.close();

  console.log("9. Verifying source assets untouched...");
  const hashA_after = await sha256(FIXTURE_A);
  const hashB_after = await sha256(FIXTURE_B);
  if (hashA_before !== hashA_after) throw new Error("FIXTURE_A was modified!");
  if (hashB_before !== hashB_after) throw new Error("FIXTURE_B was modified!");
  console.log("   ✓ Source asset hashes perfectly unchanged!");

  await rm(tmp, { recursive: true, force: true });
  console.log("✅ ALL DISPOSABLE REPLACE PERSISTENCE CHECKS PASSED!");
}

run().catch(err => {
  console.error("FAILED:", err);
  process.exit(1);
});
