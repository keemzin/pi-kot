import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, utimes, readdir, rm, stat } from "node:fs/promises";
import { config } from "./config.js";
import {
  purgeExpiredArchivedSessions,
  deleteArchivedSession,
  unarchiveSession,
  ARCHIVE_RETENTION_MS,
} from "./session-store.js";

describe("archive-retention (30-day auto-purge & delete)", () => {
  const testProjectId = `test-retention-${Date.now()}`;
  const projectDir = join(config.sessionDir, testProjectId);
  const archiveDir = join(projectDir, "_archived");

  afterEach(async () => {
    try {
      await rm(projectDir, { recursive: true, force: true });
    } catch {}
  });

  it("deletes archived sessions older than 30 days and preserves newer ones", async () => {
    await mkdir(archiveDir, { recursive: true });

    // File 1: 35 days old (expired)
    const oldFile = "2026-08-01T00-00-00-000Z_sess-old-123.jsonl";
    const oldPath = join(archiveDir, oldFile);
    await writeFile(oldPath, `{"type":"session","id":"sess-old-123"}\n`);
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    await utimes(oldPath, thirtyFiveDaysAgo, thirtyFiveDaysAgo);

    // File 2: 5 days old (active)
    const recentFile = "2026-09-20T00-00-00-000Z_sess-recent-456.jsonl";
    const recentPath = join(archiveDir, recentFile);
    await writeFile(recentPath, `{"type":"session","id":"sess-recent-456"}\n`);
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await utimes(recentPath, fiveDaysAgo, fiveDaysAgo);

    // Run purge for this project
    const deletedCount = await purgeExpiredArchivedSessions(testProjectId);
    expect(deletedCount).toBe(1);

    const remaining = await readdir(archiveDir);
    expect(remaining).toContain(recentFile);
    expect(remaining).not.toContain(oldFile);
  });

  it("deleteArchivedSession immediately removes an archived session file", async () => {
    await mkdir(archiveDir, { recursive: true });

    const sessionId = "sess-manual-delete-789";
    const file = `2026-09-24T00-00-00-000Z_${sessionId}.jsonl`;
    const filePath = join(archiveDir, file);
    await writeFile(filePath, `{"type":"session","id":"${sessionId}"}\n`);

    const deleted = await deleteArchivedSession(sessionId, testProjectId);
    expect(deleted).toBe(true);

    const remaining = await readdir(archiveDir);
    expect(remaining).not.toContain(file);
  });

  it("restoring via unarchiveSession moves the file out of _archived so it is safe from purge", async () => {
    await mkdir(archiveDir, { recursive: true });

    const sessionId = "sess-restore-999";
    const file = `2026-09-24T00-00-00-000Z_${sessionId}.jsonl`;
    const archivePath = join(archiveDir, file);
    await writeFile(archivePath, `{"type":"session","id":"${sessionId}"}\n`);

    const restored = await unarchiveSession(sessionId, testProjectId);
    expect(restored).toBe(true);

    // File should now be in projectDir, not in archiveDir
    const mainFiles = await readdir(projectDir);
    expect(mainFiles).toContain(file);

    const archiveFiles = await readdir(archiveDir);
    expect(archiveFiles).not.toContain(file);
  });
});
