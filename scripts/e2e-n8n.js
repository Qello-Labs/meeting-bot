// 실제 n8n(2.42.6)에 회의 녹취 워크플로를 가져와 가짜 OpenAI·Discord 서버를 상대로 끝까지 돌린다.
// 외부 API는 부르지 않아 비용이 들지 않는다. Docker가 필요하다. 녹음 파일은 내용 없는 가짜 webm이다.
//   node scripts/e2e-n8n.js          실행 후 컨테이너를 내리고 임시 폴더를 지운다
//   node scripts/e2e-n8n.js --keep   실패 원인을 보려고 컨테이너와 임시 폴더를 남긴다
// 이 단계에는 실패 알림 워크플로(10단계)가 없으므로, 실패는 n8n 실행 기록의 상태와 오류 메시지로 확인한다.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { TEST_CREDENTIALS } from '../test/e2e/credentials.js';
import { buildWorkflow, credentialTypeOf } from './build-workflow.js';
import { diffWorkflows, pickWorkflow } from './diff-workflow.js';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_FILE = path.join(ROOT, 'test/e2e/docker-compose.yml');
const PROJECT = 'meeting-bot-gh13-e2e';
const N8N = 'http://127.0.0.1:25678';
const MOCK = 'http://127.0.0.1:28080';
const keep = process.argv.includes('--keep');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = await mkdtemp(path.join(os.tmpdir(), 'meeting-bot-e2e-'));
const env = { ...process.env, E2E_DIR: dir };
const compose = (...args) =>
  run('docker', ['compose', '-p', PROJECT, '-f', COMPOSE_FILE, ...args], { env, cwd: ROOT, maxBuffer: 20_000_000 });

const CHANNEL = '200000000000000002';
const USER_A = '400000000000000001';
const USER_B = '400000000000000002';
const segment = (startMs, userId, displayName) => ({
  file: `${String(startMs).padStart(9, '0')}-${userId}.webm`,
  userId,
  startMs,
  endMs: startMs + 1500,
  displayName,
});
const manifest = {
  meetingId: '20261014-1400',
  guildId: '100000000000000001',
  voiceChannel: { id: '300000000000000003', name: '회의실' },
  textChannelId: CHANNEL,
  startedAt: '2026-10-14T05:00:00.000Z',
  endedAt: '2026-10-14T05:10:00.000Z',
  participants: [
    { userId: USER_A, displayName: '도연' },
    { userId: USER_B, displayName: USER_B }, // 멤버 정보를 못 읽어 ID가 들어간 경우
  ],
  // 6개 중 2개는 같은 화자가 이어 말한 발화, 1개는 1시간을 넘긴 시각이다.
  segments: [
    segment(3_000, USER_B, USER_B),
    segment(12_000, USER_A, '도연'),
    segment(40_000, USER_A, '도연'),
    segment(41_500, USER_B, USER_B),
    segment(95_000, USER_A, '도연'),
    segment(3_725_000, USER_A, '도연'),
  ],
  gaps: [{ startMs: 20_000, endMs: 32_400, reason: '음성 연결 끊김' }],
};

function step(message) {
  console.log(`- ${message}`);
}

async function waitFor(label, check, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() > until) throw new Error(`${label}을(를) ${timeoutMs / 1000}초 안에 확인하지 못했습니다`);
    await sleep(1_000);
  }
}

const mockRequests = async () => (await fetch(`${MOCK}/__requests`)).json();
const byPath = (requests, test) => requests.filter((r) => test.test(r.path));
const TRANSCRIBE = /^\/openai\/audio\/transcriptions$/;
const DISCORD = /^\/discord\//;
const DISCORD_POST = /^\/discord\/channels\/\d+\/messages$/;

async function writeSegments(meetingId, segments) {
  const folder = path.join(dir, 'recordings', meetingId, 'segments');
  await mkdir(folder, { recursive: true });
  for (const s of segments) await writeFile(path.join(folder, s.file), 'e2e-fake-webm');
}

/** discord.com 인증서를 테스트 CA로 만든다. 이 CA는 테스트 n8n 컨테이너만 믿는다. */
async function makeCertificates() {
  const certs = path.join(dir, 'certs');
  await mkdir(certs, { recursive: true });
  const openssl = (...args) => run('openssl', args, { cwd: certs });
  await openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=meeting-bot-e2e-ca',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign',
    '-keyout', 'ca.key', '-out', 'ca.pem');
  await openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=discord.com',
    '-addext', 'subjectAltName=DNS:discord.com', '-CA', 'ca.pem', '-CAkey', 'ca.key',
    '-keyout', 'server.key', '-out', 'server.pem');
}

async function prepare() {
  await makeCertificates();
  await mkdir(path.join(dir, 'n8n'), { recursive: true });
  await mkdir(path.join(dir, 'import'), { recursive: true });
  await writeSegments(manifest.meetingId, manifest.segments);
  // 일부 파일만 있는 회의
  await writeSegments('20261016-1400', manifest.segments.slice(1));

  const workflow = await buildWorkflow({ openaiBase: 'http://mock:8080/openai' });
  for (const node of workflow.nodes) {
    const type = credentialTypeOf(node);
    if (type) node.credentials = { [type]: { id: TEST_CREDENTIALS[type].id, name: TEST_CREDENTIALS[type].name } };
  }
  const credentials = Object.entries(TEST_CREDENTIALS).map(([type, c]) => ({ id: c.id, name: c.name, type, data: c.data }));
  await writeFile(path.join(dir, 'import', 'workflow.json'), JSON.stringify(workflow));
  await writeFile(path.join(dir, 'import', 'credentials.json'), JSON.stringify(credentials));
  return workflow;
}

async function startN8n(workflow) {
  for (const args of [
    ['import:credentials', '--input=/import/credentials.json'],
    ['import:workflow', '--input=/import/workflow.json'],
    ['publish:workflow', `--id=${workflow.id}`],
  ]) {
    await compose('run', '--rm', '--no-deps', 'n8n', ...args);
  }
  await compose('up', '-d');
  await waitFor('n8n 기동', async () => (await fetch(`${N8N}/healthz`)).ok);
  await waitFor('mock 기동', async () => (await fetch(`${MOCK}/__requests`)).ok);
}

async function meetingEnded(body) {
  // n8n이 막 떴을 때는 Webhook이 아직 등록되지 않아 404가 날 수 있다.
  const res = await waitFor('Webhook 응답', async () => {
    const r = await fetch(`${N8N}/webhook/meeting-ended`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.status === 404 ? null : r;
  }, 30_000);
  assert.equal(res.status, 200, `Webhook 응답 ${res.status}`);
}

/** n8n을 멈춘 뒤 SQLite 사본에서 실행 기록을 읽는다. 실행 중인 DB를 컨테이너 밖에서 읽지 않기 위해서다. */
async function readExecutions(workflowId) {
  await compose('stop', 'n8n');
  const copy = path.join(dir, 'db-copy');
  await mkdir(copy, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    await cp(path.join(dir, 'n8n', `database.sqlite${suffix}`), path.join(copy, `database.sqlite${suffix}`)).catch(() => {});
  }
  const db = new DatabaseSync(path.join(copy, 'database.sqlite'));
  try {
    return db
      .prepare(
        `SELECT e.id, e.status, d.data FROM execution_entity e JOIN execution_data d ON d.executionId = e.id
         WHERE e.workflowId = ? ORDER BY e.id`,
      )
      .all(workflowId);
  } finally {
    db.close();
  }
}

let failed = false;
try {
  step(`임시 폴더 ${dir}`);
  const workflow = await prepare();
  step('n8n에 테스트 자격 증명과 워크플로를 가져오고 publish');
  await startN8n(workflow);

  step('1회차: 회의 종료 → 발화 파일 6개 읽기 → 음성 인식 → 녹취 → 회의 채널 알림');
  await meetingEnded(manifest);
  const first = await waitFor('채널 알림', async () => {
    const requests = await mockRequests();
    return byPath(requests, DISCORD_POST).length === 1 ? requests : null;
  });
  const transcriptions = byPath(first, TRANSCRIBE);
  assert.equal(transcriptions.length, 6);
  assert.deepEqual(transcriptions.map((r) => r.multipart.file.filename).sort(), manifest.segments.map((s) => s.file).sort());
  for (const r of transcriptions) {
    assert.equal(r.authorization, 'Bearer dummy-e2e-openai');
    assert.equal(r.multipart.model, 'gpt-4o-transcribe');
    assert.equal(r.multipart.language, 'ko');
    assert.equal(r.multipart.response_format, 'json');
    assert.equal(r.multipart.prompt, '참석자: 도연, 참석자 2');
  }
  const discord = byPath(first, DISCORD);
  assert.ok(discord.every((r) => r.authorization === 'Bot dummy-e2e-discord'));
  // 봇 토큰 방식에서는 서버 확인 요청 없이 메시지만 보낸다(서버 확인은 OAuth2일 때만).
  assert.deepEqual(discord.map((r) => `${r.method} ${r.path}`), [`POST /discord/channels/${CHANNEL}/messages`]);
  const [notice] = discord;
  // Discord 노드에는 멘션을 끄는 옵션이 없다. 알림 문구가 코드가 만든 회의 ID와 숫자뿐인지 확인한다.
  assert.deepEqual(notice.json, { content: '회의 20261014-1400 녹취 완료, 발화 6개' });
  console.log(`  알림: ${notice.json.content}`);

  step('2회차: 녹음 폴더가 없으면 음성 인식과 알림 없이 실패');
  await meetingEnded({ ...manifest, meetingId: '20261015-1400' });
  step('3회차: 발화 파일 6개 중 1개가 없으면 실패');
  await meetingEnded({ ...manifest, meetingId: '20261016-1400' });
  step('4회차: 회의 ID로 상위 폴더에 접근하려는 manifest는 실패');
  await meetingEnded({ ...manifest, meetingId: '../20261014-1400' });
  await sleep(5_000);
  assert.equal((await mockRequests()).length, first.length, '실패한 회차는 외부 API를 부르지 않는다');

  step('5회차: 음성 인식 한 번 실패(500) → 노드 재시도 후 성공');
  await fetch(`${MOCK}/__fail-next-transcription`, { method: 'POST' });
  await meetingEnded(manifest);
  const fifth = await waitFor('재시도 뒤 채널 알림', async () => {
    const requests = await mockRequests();
    return byPath(requests, DISCORD_POST).length === 2 ? requests.slice(first.length) : null;
  });
  const retried = byPath(fifth, TRANSCRIBE);
  assert.equal(retried.filter((r) => r.status === 500).length, 1);
  assert.equal(retried.filter((r) => r.status === 200).length >= 6, true);
  console.log(`  음성 인식 요청 ${retried.length}건(실패 1건 포함). 노드 전체를 다시 시도해 성공한 발화도 다시 보냈습니다`);

  step('n8n에서 내보낸 워크플로가 가져온 것과 동작이 같은지 차이 검사');
  await compose('exec', '-T', 'n8n', 'n8n', 'export:workflow', `--id=${workflow.id}`, '--output=/home/node/.n8n/exported.json');
  const exported = pickWorkflow(JSON.parse(await readFile(path.join(dir, 'n8n', 'exported.json'), 'utf8')), workflow);
  assert.deepEqual(diffWorkflows(workflow, exported), []);

  step('n8n 실행 기록 확인');
  const executions = await readExecutions(workflow.id);
  assert.deepEqual(executions.map((e) => e.status), ['success', 'error', 'error', 'error', 'success']);
  const [ok, noFolder, oneMissing, badId] = executions.map((e) => e.data);
  for (const line of [
    '[00:00:03] 참석자 2: 3초 발화',
    '[00:00:12] 도연: 12초 발화',
    '[00:00:20] (녹음 끊김 약 12초, 음성 연결 끊김)',
    '[00:00:41] 참석자 2: 41.5초 발화',
    '[01:02:05] 도연: 3725초 발화',
  ]) {
    assert.ok(ok.includes(line), `녹취에 "${line}"이 없습니다`);
  }
  assert.ok(!ok.includes(`${USER_B}: `), '녹취 화자 자리에 Discord ID가 없다');
  assert.ok(noFolder.includes('발화 파일 6개 중 0개만 읽었습니다'), '폴더 없음 오류 메시지');
  assert.ok(oneMissing.includes('발화 파일 6개 중 5개만 읽었습니다'), '파일 1개 없음 오류 메시지');
  assert.ok(badId.includes('meetingId 형식이 다릅니다'), '회의 ID 형식 오류 메시지');
  console.log(`  실행 ${executions.length}건: ${executions.map((e) => e.status).join(', ')}`);

  console.log('E2E PASS');
} catch (error) {
  failed = true;
  console.error('E2E FAIL:', error.message);
  const logs = await compose('logs', '--tail', '80', 'n8n').catch((e) => ({ stdout: e.message }));
  console.error(logs.stdout);
} finally {
  if (keep) {
    console.log(`컨테이너와 ${dir}를 남겼습니다. 정리: E2E_DIR=${dir} docker compose -p ${PROJECT} -f ${COMPOSE_FILE} down`);
  } else {
    await compose('down').catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
process.exit(failed ? 1 : 0);
