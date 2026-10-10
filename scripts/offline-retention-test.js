// 녹음 보관 기간(일주일)이 지난 회의 폴더만 지워지는지 확인한다. 실제 녹음은 쓰지 않고 빈 폴더와 파일 시각으로 흉내 낸다.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RETENTION_MS, pruneRecordings } from '../src/retention.js';

const DAY = 24 * 60 * 60_000;
const now = Date.parse('2026-10-20T00:00:00.000Z');
const root = await mkdtemp(path.join(os.tmpdir(), 'meeting-retention-'));

async function meeting(name, { endedDaysAgo, state = false, manifest = true, touchedDaysAgo = 0 }) {
  const dir = path.join(root, name);
  await mkdir(path.join(dir, 'segments'), { recursive: true });
  if (manifest) {
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ endedAt: new Date(now - endedDaysAgo * DAY).toISOString() }));
  }
  if (state) await writeFile(path.join(dir, 'state.json'), '{}');
  const touched = (now - touchedDaysAgo * DAY) / 1000;
  await utimes(dir, touched, touched);
}

await meeting('20261010-1400', { endedDaysAgo: 10 }); // 지움: 끝난 지 10일
await meeting('20261012-1400', { endedDaysAgo: 7.5 }); // 지움: 7일 반
await meeting('20261014-1400', { endedDaysAgo: 6 }); // 남김: 6일
await meeting('20261001-1400', { manifest: false, state: true, touchedDaysAgo: 19 }); // 남김: 끝나지 않은 회의
await meeting('20261002-1400', { manifest: false, touchedDaysAgo: 18 }); // 지움: 시작에 실패해 둘 다 없는 폴더
await meeting('backup', { endedDaysAgo: 30 }); // 남김: 회의 ID 형식이 아닌 폴더

const removed = await pruneRecordings(root, { now });
assert.equal(RETENTION_MS, 7 * DAY);
assert.deepEqual(removed.sort(), ['20261002-1400', '20261010-1400', '20261012-1400']);
assert.deepEqual((await readdir(root)).sort(), ['20261001-1400', '20261014-1400', 'backup']);
assert.deepEqual(await pruneRecordings(path.join(root, 'missing'), { now }), [], '녹음 폴더가 없어도 실패하지 않는다');
console.log('녹음 보관 오프라인 테스트 통과');
