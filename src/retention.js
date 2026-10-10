import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { statePath } from './state.js';

// 녹음 파일은 회의가 끝난 뒤 일주일 보관한다(설계 문서 6절).
export const RETENTION_MS = 7 * 24 * 60 * 60_000;
const MEETING_ID = /^\d{8}-\d{4}$/;

const exists = (file) => stat(file).then(() => true, () => false);

/** 회의가 끝난 시각. manifest가 있으면 그 종료 시각, 없으면 폴더 수정 시각을 쓴다. */
async function endedAtMs(dir) {
  try {
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    const ms = Date.parse(manifest.endedAt);
    if (Number.isFinite(ms)) return ms;
  } catch {
    // manifest가 없거나 읽을 수 없으면 폴더 수정 시각으로 본다.
  }
  return (await stat(dir)).mtimeMs;
}

/**
 * 끝난 지 보관 기간이 지난 회의 폴더를 지우고 지운 회의 ID를 돌려준다.
 * 회의 ID 형식의 폴더만 보고, 끝나지 않은 회의(상태 파일이 있는 폴더)는 지우지 않는다.
 */
export async function pruneRecordings(recordingsDir, { now = Date.now(), maxAgeMs = RETENTION_MS } = {}) {
  const entries = await readdir(recordingsDir, { withFileTypes: true }).catch(() => []);
  const removed = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !MEETING_ID.test(entry.name)) continue;
    const dir = path.join(recordingsDir, entry.name);
    if (await exists(statePath(dir))) continue;
    if (now - (await endedAtMs(dir)) <= maxAgeMs) continue;
    await rm(dir, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}
