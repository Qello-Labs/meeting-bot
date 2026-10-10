import { execFile } from 'node:child_process';
import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const STATE_FILE = 'state.json';

/**
 * 진행 중인 회의 상태를 녹음 폴더에 쓴다. 임시 파일에 쓴 뒤 이름을 바꿔서, 쓰는 도중 죽어도 이전 상태가 남는다.
 */
export async function writeState(dir, state) {
  const target = path.join(dir, STATE_FILE);
  await writeFile(`${target}.tmp`, JSON.stringify(state, null, 2));
  await rename(`${target}.tmp`, target);
}

export async function readState(dir) {
  return JSON.parse(await readFile(path.join(dir, STATE_FILE), 'utf8'));
}

export function statePath(dir) {
  return path.join(dir, STATE_FILE);
}

/** 상태 파일은 있고 manifest.json은 없는 폴더가 끝나지 않은 회의다. */
export async function findUnfinished(recordingsDir) {
  const entries = await readdir(recordingsDir, { withFileTypes: true }).catch(() => []);
  const exists = (file) => stat(file).then(() => true, () => false);
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(recordingsDir, entry.name);
    if ((await exists(statePath(dir))) && !(await exists(path.join(dir, 'manifest.json')))) found.push(dir);
  }
  return found;
}

async function probeSeconds(file) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) ? seconds : 0;
  } catch {
    return 0;
  }
}

/**
 * 재시작 순간 쓰고 있던 발화 파일은 상태 파일의 발화 목록에 없다. 파일 이름에서 화자와 시작 시각을,
 * 파일에서 길이를 읽어 살린다. 길이를 읽지 못하면 길이 0으로 두어 마무리 단계에서 버려진다.
 * 발화는 패킷 10개(0.2초)씩 페이지로 묶여 쓰이므로 죽는 순간의 마지막 0.2초 정도는 빠질 수 있다.
 */
export async function recoverSegments(segmentsDir, knownSegments) {
  const known = new Set(knownSegments.map((s) => s.file));
  const files = (await readdir(segmentsDir).catch(() => [])).filter((f) => f.endsWith('.ogg') && !known.has(f));
  const recovered = [];
  for (const file of files.sort()) {
    const match = /^(\d{9})-([^.]+)\.ogg$/.exec(file);
    if (!match) continue;
    const startMs = Number(match[1]);
    const seconds = await probeSeconds(path.join(segmentsDir, file));
    recovered.push({ file, userId: match[2], startMs, endMs: startMs + Math.round(seconds * 1000) });
  }
  return recovered;
}
