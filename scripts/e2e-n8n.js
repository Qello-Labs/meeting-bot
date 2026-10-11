// 실제 n8n(2.42.6)에 회의 녹취 워크플로를 가져와 가짜 OpenAI·Discord·ClickUp 서버를 상대로 끝까지 돌린다.
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
import { TEMPLATE } from '../test/e2e/template.js';
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
const isGet = (r) => r.method === 'GET' && DISCORD_POST.test(r.path);
const isPost = (r) => r.method === 'POST' && DISCORD_POST.test(r.path);
const TEMPLATE_PAGE = /^\/clickup\/api\/v3\/workspaces\/[^/]+\/docs\/[^/]+\/pages\/[^/]+$/;
const DRAFT = /^\/openai\/responses$/;

// 회의 채널 메시지(가짜). 기간 안 230개(✅ 사람 3개, ✅ 봇·Webhook 각 1개), 기간 전 1개, 회의 뒤 30개라 100·100·60개로 세 번 받는다.
const DISCORD_EPOCH = 1420070400000n;
const DAY = 24 * 60 * 60 * 1000;
let sequence = 0;
const idAt = (ms) => (((BigInt(ms) - DISCORD_EPOCH) << 22n) + BigInt((sequence += 1) % 4096)).toString();
const human = { id: '500000000000000001', username: 'doyeon', global_name: '도연' };
const checkmark = [{ emoji: { id: null, name: '✅' }, count: 1, me: false }];
function channelMessages({ blankDecision = false } = {}) {
  const start = Date.parse(manifest.startedAt);
  const end = Date.parse(manifest.endedAt);
  const from = start - 7 * DAY;
  const at = (ms, extra = {}) => ({ id: idAt(ms), type: 0, content: '잡담', author: human, attachments: [], reactions: [], ...extra });
  const inWindow = Array.from({ length: 230 }, (_, i) => at(from + 1 + Math.floor(((end - from) * i) / 230)));
  inWindow[10] = { ...inWindow[10], content: blankDecision ? '' : '결정 A: 배포는 금요일', reactions: checkmark };
  inWindow[120] = { ...inWindow[120], content: '결정 B: API v2', reactions: checkmark, type: 19 };
  inWindow[229] = { ...inWindow[229], content: '결정 C: 회의 중 결정', reactions: checkmark };
  inWindow[50] = { ...inWindow[50], content: '봇 메시지', reactions: checkmark, author: { id: '600000000000000001', username: 'meeting-bot', bot: true } };
  inWindow[60] = { ...inWindow[60], content: 'Webhook 메시지', reactions: checkmark, webhook_id: '700000000000000001' };
  const before = at(from - 1000, { content: '기간 전 결정', reactions: checkmark });
  const after = Array.from({ length: 30 }, (_, i) => at(end + 1000 * (i + 1), { content: i === 0 ? '회의 뒤 결정' : '잡담', reactions: i === 0 ? checkmark : [] }));
  return [before, ...inWindow, ...after];
}
const post = (control, json) =>
  fetch(`${MOCK}/${control}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json ?? {}) });
const setTemplate = (content) => post('__template', { content });
const setDraft = (body, status = 200) => post('__llm', { status, body });
const linkOf = (m) => `https://discord.com/channels/${manifest.guildId}/${CHANNEL}/${m.id}`;

/** GPT가 채운 것처럼 쓴 초안. 근거는 녹취 발화 시각과 수집한 ✅ 메시지 링크다. time을 바꾸면 근거가 틀린 초안이 된다. */
function draftFor(messages, { time = '00:00:12' } = {}) {
  const link = (content) => linkOf(messages.find((m) => m.content === content));
  return `| 필드 | 값 |
| ---| --- |
| 일시 | 2026-10-14 |
| 회의 종류 | 정기 회의 |
| 참석자 | 도연, 참석자 2 |
| 관련 명세 ID | 없음 |

## 안건

1. 배포 일정

## 논의 내용

### 배포 일정

배포 일정과 API 버전을 논의했다.

## 결정 사항

*   배포는 금요일에 한다. 이유: 준비가 끝났다. (근거: 녹취 ${time}, [Discord 메시지](${link('결정 A: 배포는 금요일')}))
*   API는 v2로 간다. 이유: 호환성. (근거: [Discord 메시지](${link('결정 B: API v2')}))
*   회의 중 결정을 따른다. 이유: 합의했다. (근거: 녹취 01:02:05, [Discord 메시지](${link('결정 C: 회의 중 결정')}))

## 액션 아이템

| 담당 파트 | 담당자 | 할 일 | 기한 | ClickUp 작업 |
| ---| ---| ---| ---| --- |
| Backend | 도연 | 배포 | 2026-10-16 | 없음 |

## 다음 회의

*   일시: 2026-10-17

### 안건

1. 배포 회고

## 기타

*   없음`;
}
/** OpenAI Responses API 응답. 출력에는 reasoning 항목과 message 항목이 섞여 온다. */
const gptResponse = (text, extra = {}) => ({
  id: 'resp_e2e',
  object: 'response',
  status: 'completed',
  incomplete_details: null,
  model: 'gpt-6-luna',
  output: [
    { type: 'reasoning', id: 'rs_e2e', summary: [] },
    { type: 'message', id: 'msg_e2e', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] },
  ],
  usage: { input_tokens: 1000, output_tokens: 800, output_tokens_details: { reasoning_tokens: 300 }, total_tokens: 1800 },
  ...extra,
});

const setMessages = (list) => fetch(`${MOCK}/__messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(list) });

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

  const workflow = await buildWorkflow({ openaiBase: 'http://mock:8080/openai', clickupBase: 'http://mock:8080/clickup/api/v3' });
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

/**
 * n8n 실행 기록(flatted 형식)을 객체로 되돌린다. 문자열 값은 배열 안 위치를 가리키는 참조다.
 * flatted 패키지의 parse와 같은 규칙을 의존성 없이 옮겼다.
 */
function unflatten(text) {
  const input = JSON.parse(text);
  const seen = new Map();
  const revive = (index) => {
    if (seen.has(index)) return seen.get(index);
    const value = input[index];
    if (value === null || typeof value !== 'object') {
      seen.set(index, value);
      return value;
    }
    const out = Array.isArray(value) ? [] : {};
    seen.set(index, out);
    for (const [key, v] of Object.entries(value)) out[key] = typeof v === 'string' ? revive(Number(v)) : v;
    return out;
  };
  return revive(0);
}

/** 실행 기록에서 노드의 첫 출력 항목들을 꺼낸다. */
const nodeOutput = (data, name) =>
  (unflatten(data).resultData.runData[name]?.[0]?.data?.main?.[0] ?? []).map((item) => item.json);

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

  step('1회차: 회의 종료 → 발화 파일 6개 읽기 → (결정 메시지 갈래, 음성 인식 갈래) → 템플릿 읽기 → 초안 작성 → 초안 검증 → 회의 채널 알림');
  const messages = channelMessages();
  await setMessages(messages);
  await setTemplate(TEMPLATE);
  await setDraft(gptResponse(`\`\`\`markdown\n${draftFor(messages)}\n\`\`\``));
  await meetingEnded(manifest);
  const first = await waitFor('채널 알림', async () => {
    const requests = await mockRequests();
    return requests.filter(isPost).length === 1 ? requests : null;
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
  // 결정 메시지는 기간 시작 ID부터 100개씩 받고, 다음 after는 받은 것 중 가장 큰 ID다. 60개가 온 세 번째에서 멈춘다.
  const pages = discord.filter(isGet);
  const afterIdOf = (ms) => (((BigInt(ms) - DISCORD_EPOCH) << 22n) - 1n).toString();
  const sorted = messages.map((m) => m.id).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const firstAfter = afterIdOf(Date.parse(manifest.startedAt) - 7 * DAY + 1);
  const startIndex = sorted.findIndex((id) => BigInt(id) > BigInt(firstAfter));
  assert.deepEqual(pages.map((r) => r.query.after), [firstAfter, sorted[startIndex + 99], sorted[startIndex + 199]]);
  assert.ok(pages.every((r) => r.query.limit === '100' && r.path === `/discord/channels/${CHANNEL}/messages`));
  // 봇 토큰 방식의 Discord 노드는 서버 확인 요청 없이 메시지만 보낸다(서버 확인은 OAuth2일 때만).
  const [notice] = discord.filter(isPost);
  // Discord 노드에는 멘션을 끄는 옵션이 없다. 알림 문구가 코드가 만든 회의 ID와 숫자뿐인지 확인한다.
  assert.deepEqual(notice.json, { content: '회의 20261014-1400 녹취 완료, 발화 6개, 결정 메시지 3개, 초안 검증 통과' });
  // 결정 메시지 갈래가 화면 위쪽이라 음성 인식보다 먼저 실행된다.
  assert.ok(first.findIndex(isGet) < first.findIndex((r) => TRANSCRIBE.test(r.path)), '결정 메시지 조회가 음성 인식보다 먼저다');

  // 템플릿은 두 갈래가 끝난 뒤 한 번 읽고, GPT는 그 뒤에 한 번 부른다.
  const pageReads = byPath(first, TEMPLATE_PAGE);
  assert.equal(pageReads.length, 1);
  assert.equal(pageReads[0].authorization, 'dummy-e2e-clickup', 'ClickUp 자격 증명은 Authorization 헤더에 토큰을 넣는다');
  assert.deepEqual(pageReads[0].query, { content_format: 'text/md' });
  const draftCalls = byPath(first, DRAFT);
  assert.equal(draftCalls.length, 1);
  const [call] = draftCalls;
  assert.equal(call.authorization, 'Bearer dummy-e2e-openai', '음성 인식과 같은 OpenAI 자격 증명');
  assert.equal(call.json.model, 'gpt-6-luna');
  assert.deepEqual(call.json.reasoning, { effort: 'high' });
  assert.equal(call.json.max_output_tokens, 32000);
  assert.equal(call.json.store, false);
  for (const key of ['temperature', 'top_p']) assert.equal(call.json[key], undefined, `${key}를 보내지 않는다`);
  const userText = call.json.input[0].content;
  assert.ok(userText.includes(TEMPLATE), '템플릿 원문이 요청에 들어간다');
  assert.ok(userText.includes('[00:00:12] 도연: 12초 발화'), '녹취가 요청에 들어간다');
  assert.ok(['결정 A: 배포는 금요일', '결정 B: API v2', '결정 C: 회의 중 결정'].every((c) => userText.includes(c)));
  assert.ok(!userText.includes(USER_B) && !userText.includes(USER_A), '요청에 참석자 Discord ID가 없다');
  const order = (test) => first.findIndex((r) => test.test(r.path));
  const lastTranscription = first.findLastIndex((r) => TRANSCRIBE.test(r.path));
  assert.ok(lastTranscription < order(TEMPLATE_PAGE) && order(TEMPLATE_PAGE) < order(DRAFT) && order(DRAFT) < first.findIndex(isPost));
  console.log(`  메시지 조회 ${pages.length}번(음성 인식보다 먼저), 템플릿 1번, GPT 1번, 알림: ${notice.json.content}`);

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
    return requests.filter(isPost).length === 2 ? requests.slice(first.length) : null;
  });
  const retried = byPath(fifth, TRANSCRIBE);
  assert.equal(retried.filter((r) => r.status === 500).length, 1);
  assert.equal(retried.filter((r) => r.status === 200).length >= 6, true);
  console.log(`  음성 인식 요청 ${retried.length}건(실패 1건 포함). 노드 전체를 다시 시도해 성공한 발화도 다시 보냈습니다`);

  step('6회차: 결정 메시지 조회가 계속 실패(500)하면 다시 시도한 뒤 실행이 실패하고, 음성 인식과 알림은 하지 않는다');
  await fetch(`${MOCK}/__messages-fail`, { method: 'POST' });
  const beforeSixth = (await mockRequests()).length;
  await meetingEnded(manifest);
  await waitFor('조회 실패', async () => (await mockRequests()).slice(beforeSixth).some((r) => isGet(r) && r.status === 500) || null);
  // 노드 재시도(5초 간격 2번)가 끝날 때까지 기다린다.
  await sleep(15_000);
  const sixth = (await mockRequests()).slice(beforeSixth);
  const failedFetches = sixth.filter((r) => isGet(r) && r.status === 500).length;
  // 오류 응답에서도 페이지 넘김 식이 깨지지 않아 노드가 실패하고, 노드 재시도로 3번 요청한다.
  assert.equal(failedFetches, 3);
  console.log(`  조회 500 응답 ${failedFetches}번`);
  assert.equal(sixth.filter(isPost).length, 0, '조회가 실패하면 알림을 보내지 않는다');
  assert.equal(byPath(sixth, TRANSCRIBE).length, 0, 'Discord 쪽이 실패하면 음성 인식(유료)을 부르지 않는다');
  assert.equal(byPath(sixth, DRAFT).length, 0, 'Discord 쪽이 실패하면 GPT(유료)를 부르지 않는다');

  step('7회차: ✅ 메시지 내용이 비어 있으면(Message Content Intent 꺼짐) 실패하고, 음성 인식과 알림은 하지 않는다');
  await setMessages(channelMessages({ blankDecision: true }));
  const beforeSeventh = (await mockRequests()).length;
  await meetingEnded(manifest);
  await waitFor('메시지 조회', async () => (await mockRequests()).slice(beforeSeventh).filter((r) => isGet(r) && r.status === 200).length >= 3 || null);
  await sleep(3_000);
  const seventh = (await mockRequests()).slice(beforeSeventh);
  assert.equal(seventh.filter(isPost).length, 0);
  assert.equal(byPath(seventh, TRANSCRIBE).length, 0, 'Discord 쪽이 실패하면 음성 인식(유료)을 부르지 않는다');
  assert.equal(byPath(seventh, DRAFT).length, 0);

  step('8회차: 근거가 틀린 초안(녹음 끊김 줄의 시각)은 실행이 성공으로 끝나고, 알림에 오류 종류별 개수만 나온다');
  await setMessages(messages);
  await setDraft(gptResponse(draftFor(messages, { time: '00:00:20' })));
  const beforeEighth = (await mockRequests()).length;
  await meetingEnded(manifest);
  const eighth = await waitFor('검증 실패 알림', async () => {
    const requests = (await mockRequests()).slice(beforeEighth);
    return requests.some(isPost) ? requests : null;
  });
  assert.deepEqual(eighth.find(isPost).json, {
    content: '회의 20261014-1400 녹취 완료, 발화 6개, 결정 메시지 3개, 초안 검증 실패(녹취에 없는 시각 1개). 오류 목록은 n8n 실행 기록에 있습니다',
  });

  /** GPT 응답을 바꿔 회의를 한 번 돌리고, GPT를 부른 뒤 알림 없이 끝나는지 본다. */
  async function draftFails(response) {
    await setDraft(response);
    const before = (await mockRequests()).length;
    await meetingEnded(manifest);
    await waitFor('GPT 호출', async () => (await mockRequests()).slice(before).some((r) => DRAFT.test(r.path)) || null);
    await sleep(3_000);
    const requests = (await mockRequests()).slice(before);
    assert.equal(byPath(requests, DRAFT).length, 1, '잘림·거절은 HTTP 200이라 다시 부르지 않는다');
    assert.equal(requests.filter(isPost).length, 0, '초안이 없으면 알림을 보내지 않고 실행이 실패한다');
  }
  step('9회차: 응답이 max_output_tokens에서 잘리면(incomplete) 실행이 실패한다');
  await draftFails(gptResponse('| 필드 | 값 |', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
  step('10회차: 거절(refusal)이면 실행이 실패한다');
  await draftFails(gptResponse('', {
    output: [{ type: 'message', id: 'msg_e2e', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'e2e' }] }],
  }));

  step('11회차: 템플릿 조회가 계속 실패(500)하면 다시 시도한 뒤 실행이 실패하고, GPT와 알림은 하지 않는다');
  await setDraft(gptResponse(draftFor(messages)));
  await post('__template-fail');
  const beforeEleventh = (await mockRequests()).length;
  await meetingEnded(manifest);
  await waitFor('템플릿 조회 3번', async () => byPath((await mockRequests()).slice(beforeEleventh), TEMPLATE_PAGE).length >= 3 || null);
  await sleep(5_000);
  const eleventh = (await mockRequests()).slice(beforeEleventh);
  assert.equal(byPath(eleventh, TEMPLATE_PAGE).filter((r) => r.status === 500).length, 3, '노드 재시도로 3번 요청한다');
  assert.equal(byPath(eleventh, DRAFT).length, 0);
  assert.equal(eleventh.filter(isPost).length, 0);

  step('n8n에서 내보낸 워크플로가 가져온 것과 동작이 같은지 차이 검사');
  await compose('exec', '-T', 'n8n', 'n8n', 'export:workflow', `--id=${workflow.id}`, '--output=/home/node/.n8n/exported.json');
  const exported = pickWorkflow(JSON.parse(await readFile(path.join(dir, 'n8n', 'exported.json'), 'utf8')), workflow);
  assert.deepEqual(diffWorkflows(workflow, exported), []);

  step('n8n 실행 기록 확인');
  const executions = await readExecutions(workflow.id);
  assert.deepEqual(executions.map((e) => e.status), [
    'success', 'error', 'error', 'error', 'success', 'error', 'error', 'success', 'error', 'error', 'error',
  ]);
  const [ok, noFolder, oneMissing, badId, , fetchFailed, blank, badEvidence, truncated, refused, noTemplate] = executions.map((e) => e.data);
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
  // 실제 n8n에서 조회 노드는 메시지 하나를 항목 하나로 냈고, 고르기 노드는 사람이 쓴 기간 안 ✅ 메시지 3개만 골랐다.
  assert.equal(nodeOutput(ok, '결정 메시지 조회').length, 260);
  const [picked] = nodeOutput(ok, '결정 메시지 고르기');
  assert.equal(picked.scanned, 260);
  assert.deepEqual(picked.decisions.map((d) => d.content), ['결정 A: 배포는 금요일', '결정 B: API v2', '결정 C: 회의 중 결정']);
  assert.ok(picked.decisions.every((d) => d.author === '도연' && d.link.startsWith(`https://discord.com/channels/${manifest.guildId}/${CHANNEL}/`)));
  assert.equal(unflatten(fetchFailed).resultData.lastNodeExecuted, '결정 메시지 조회', '조회 실패는 조회 노드에서 멈춘다');
  assert.ok(blank.includes('Message Content Intent'), '빈 내용 오류 메시지');
  // 초안 검증: 코드 블록을 벗기고 고정 필드를 덮어쓴 초안과 응답 모델이 실행 기록에 남는다.
  const [checked] = nodeOutput(ok, '초안 검증');
  assert.equal(checked.draftOk, true);
  assert.equal(checked.model, 'gpt-6-luna');
  assert.equal(checked.usage.output_tokens_details.reasoning_tokens, 300);
  assert.ok(checked.draft.startsWith('| 필드 | 값 |') && checked.draft.includes('| 참석자 | 도연, 참석자 2 |'));
  const [wrong] = nodeOutput(badEvidence, '초안 검증');
  assert.equal(wrong.draftOk, false);
  assert.deepEqual(wrong.errors, [{ kind: '녹취에 없는 시각', detail: '00:00:20' }]);
  assert.ok(truncated.includes('초안이 max_output_tokens에서 잘렸습니다'), '잘림 오류 메시지');
  assert.ok(refused.includes('GPT가 초안 작성을 거절했습니다'), '거절 오류 메시지');
  for (const data of [truncated, refused]) assert.equal(unflatten(data).resultData.lastNodeExecuted, '초안 검증');
  assert.equal(unflatten(noTemplate).resultData.lastNodeExecuted, '템플릿 읽기', '템플릿 조회 실패는 템플릿 읽기에서 멈춘다');
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
