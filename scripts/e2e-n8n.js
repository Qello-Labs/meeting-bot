// 실제 n8n(2.42.6)에 회의 녹취 워크플로를 가져와 가짜 OpenAI·Discord·Confluence·Jira 서버를 상대로 끝까지 돌린다.
// 외부 API는 부르지 않아 비용이 들지 않는다. Docker가 필요하다. 녹음 파일은 내용 없는 가짜 webm이다.
//   node scripts/e2e-n8n.js          실행 후 컨테이너를 내리고 임시 폴더를 지운다
//   node scripts/e2e-n8n.js --keep   실패 원인을 보려고 컨테이너와 임시 폴더를 남긴다
// 실패한 회차는 실패 알림 워크플로가 가짜 Discord로 보낸 알림과 n8n 실행 기록의 상태·오류 메시지로 확인한다.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { TEST_CREDENTIALS } from '../test/e2e/credentials.js';
import { TEMPLATE, TEMPLATE_STORAGE } from '../test/e2e/template.js';
import { handleApprovalButton } from '../src/approval.js';
import { buildFailureWorkflow, buildWorkflow, credentialTypeOf } from './build-workflow.js';
import { diffWorkflows, pickWorkflow } from './diff-workflow.js';
import { applyWorkflows, n8nApi, readWorkflows } from './deploy/apply-workflows.js';

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
// 실패 알림이 회의 채널을 모를 때 보내는 고정 채널(운영에서는 실제 회의 채널). 회의 채널과 구분되게 다른 값을 쓴다.
const FALLBACK_CHANNEL = '200000000000000009';
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
// 초안 메시지: 짧은 초안은 JSON, 긴 초안은 multipart(payload_json + 파일)로 온다. 둘 다 버튼(components)이 있다.
const payloadOf = (r) => (r.multipart ? JSON.parse(r.multipart.payload_json) : r.json);
const isDraftPost = (r) => isPost(r) && Array.isArray(payloadOf(r)?.components);
const isPatch = (r) => r.method === 'PATCH' && /^\/discord\/channels\/\d+\/messages\/\d+$/.test(r.path);
// 실패 알림 워크플로가 보낸 알림. 그 밖의 메시지(녹취 알림, 초안, 기한 초과 알림)와 나눠 센다.
const isFailureNotice = (r) => isPost(r) && /회의록 처리가 .*실패했습니다/.test(r.json?.content ?? '');
const isOtherPost = (r) => isPost(r) && !isFailureNotice(r);

/** 녹음 봇의 버튼 처리 코드로 실제 n8n 재개 주소를 부른다. Discord 상호작용만 흉내 내고, 누른 사람에게 보인 답을 돌려준다. */
async function click(customId, user = {}, { embed, submit } = {}) {
  const replies = [];
  const interaction = {
    customId,
    user: { bot: false, username: 'doyeon', globalName: '도연', ...user },
    deferred: false,
    message: { embeds: embed === undefined ? [] : [{ description: embed }] },
    fields: { getTextInputValue: () => submit },
    isButton: () => submit === undefined,
    isModalSubmit: () => submit !== undefined,
    async deferReply() { this.deferred = true; },
    async reply(options) { replies.push(options.content); },
    async showModal(modal) { replies.push(modal); },
    async editReply(text) { replies.push(text); },
  };
  await handleApprovalButton(interaction, { webhookUrl: `${N8N}/webhook/meeting-ended` });
  return replies;
}
const accepted = (label) => [`${label}했습니다. 회의 채널의 초안 메시지에 결과가 표시됩니다.`];
const INVALID_BUTTON = ['이미 처리됐거나 유효하지 않은 버튼입니다.'];
const settled = (text) => ({ content: `회의 20261014-1400 회의록 초안: ${text}`, components: [], allowed_mentions: { parse: [] } });
const buttonIds = (components) => components[0].components.map((b) => b.custom_id);

// 승인된 회의록을 쓰는 가짜 Confluence 상위 페이지(`회의록` 아래 테스트 페이지 역할)
const MINUTES_PARENT = '90001';
const WIKI = '/confluence/wiki/api/v2';
const isSearch = (r) => r.method === 'GET' && r.path === `${WIKI}/pages`;
const isCreate = (r) => r.method === 'POST' && r.path === `${WIKI}/pages`;
const isReadBack = (r) => r.method === 'GET' && /^\/confluence\/wiki\/api\/v2\/pages\/7\d{3}$/.test(r.path);
const TEMPLATE_PAGE = /^\/confluence\/wiki\/api\/v2\/pages\/294915$/;
const isJira = (method, tail) => (r) => r.method === method && r.path === `/jira${tail}`;
const isIssueSearch = isJira('GET', '/rest/api/3/search/jql');
const isSprints = isJira('GET', '/rest/agile/1.0/board/1/sprint');
const isIssueCreate = isJira('POST', '/rest/api/3/issue');
const ATLASSIAN_AUTH = `Basic ${Buffer.from('e2e@example.com:dummy-e2e-atlassian').toString('base64')}`;
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
const setMinutes = () => post('__minutes', { parentPageId: MINUTES_PARENT });
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

| 담당 파트 | 담당자 | 할 일 | 기한 | Jira 이슈 |
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

  // 승인 기다리기는 3일 대신 30초로 줄여 기한 초과를 확인한다.
  const workflow = await buildWorkflow({
    openaiBase: 'http://mock:8080/openai',
    confluenceBase: 'http://mock:8080/confluence/wiki/api/v2',
    jiraBase: 'http://mock:8080/jira',
    approvalWait: { amount: 30, unit: 'seconds' },
    minutesParentPage: MINUTES_PARENT,
  });
  const failureWorkflow = await buildFailureWorkflow({ fallbackChannelId: FALLBACK_CHANNEL });
  for (const node of [...workflow.nodes, ...failureWorkflow.nodes]) {
    const type = credentialTypeOf(node);
    if (type) node.credentials = { [type]: { id: TEST_CREDENTIALS[type].id, name: TEST_CREDENTIALS[type].name } };
  }
  // n8n API 키는 n8n이 뜬 뒤에 만들 수 있어 그 자격 증명은 나중에 가져온다(startN8n).
  const credentials = Object.entries(TEST_CREDENTIALS)
    .filter(([type]) => type !== 'httpHeaderAuth')
    .map(([type, c]) => ({ id: c.id, name: c.name, type, data: c.data }));
  await writeFile(path.join(dir, 'import', 'workflow.json'), JSON.stringify(workflow));
  await writeFile(path.join(dir, 'import', 'failure-workflow.json'), JSON.stringify(failureWorkflow));
  await writeFile(path.join(dir, 'import', 'credentials.json'), JSON.stringify(credentials));
  return { workflow, failureWorkflow };
}

/**
 * 소유자 계정을 만들고 n8n API 키 두 개를 만든다(운영에서는 사람이 화면에서 만든다).
 * 실패 알림용은 실행 읽기만, 배포용은 워크플로 반영에 필요한 범위만 가진다(결정 기록 2026-10-13-gh26-workflow-api-apply).
 */
async function createApiKeys() {
  // 테스트 n8n에서만 쓰고 버리는 계정이다. 비밀번호는 실행할 때마다 만든다(n8n 규칙: 8자 이상, 숫자와 대문자 포함).
  const owner = { email: 'e2e@example.com', firstName: 'E2E', lastName: 'Owner', password: `E2e${randomUUID()}` };
  // healthz가 응답해도 잠깐 동안은 REST 경로가 등록되지 않아 404가 난다.
  const setup = await waitFor('소유자 계정 만들기', async () => {
    const r = await fetch(`${N8N}/rest/owner/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(owner),
    });
    return r.status === 404 ? null : r;
  }, 60_000);
  assert.equal(setup.status, 200, `소유자 계정 ${setup.status}`);
  const cookie = setup.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const createKey = async (label, scopes) => {
    const created = await fetch(`${N8N}/rest/api-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ label, expiresAt: null, scopes }),
    });
    assert.equal(created.status, 200, `API 키 ${created.status}`);
    const { data } = await created.json();
    return data.rawApiKey ?? data.apiKey;
  };
  return {
    failureKey: await createKey('e2e failure alert', ['execution:read']),
    deployKey: await createKey('e2e deploy', ['workflow:read', 'workflow:update', 'workflow:activate', 'credential:list', 'execution:list']),
  };
}

async function startN8n({ workflow, failureWorkflow }) {
  const importAll = async (commands) => {
    for (const args of commands) await compose('run', '--rm', '--no-deps', 'n8n', ...args);
  };
  const up = async () => {
    await compose('up', '-d');
    await waitFor('n8n 기동', async () => (await fetch(`${N8N}/healthz`)).ok);
  };
  await importAll([
    ['import:credentials', '--input=/import/credentials.json'],
    ['import:workflow', '--input=/import/workflow.json'],
    ['publish:workflow', `--id=${workflow.id}`],
  ]);
  await up();
  await waitFor('mock 기동', async () => (await fetch(`${MOCK}/__requests`)).ok);

  // 실행 중에 가져오면 새 DB에서 깨질 수 있어 n8n을 멈추고 가져온다.
  const { failureKey, deployKey } = await createApiKeys();
  const { id, name, data } = TEST_CREDENTIALS.httpHeaderAuth;
  await writeFile(path.join(dir, 'import', 'api-credential.json'), JSON.stringify([{ id, name, type: 'httpHeaderAuth', data: { ...data, value: failureKey } }]));
  await compose('stop', 'n8n');
  await importAll([
    ['import:credentials', '--input=/import/api-credential.json'],
    ['import:workflow', '--input=/import/failure-workflow.json'],
    ['publish:workflow', `--id=${failureWorkflow.id}`],
  ]);
  await up();
  return deployKey;
}

/** before 뒤에 온 실패 알림을 기다려 채널과 문구를 확인하고 실행 ID를 돌려준다. */
async function failureNotice(before, { node, kind, channel = CHANNEL, meetingId = manifest.meetingId, written = false }) {
  const notice = await waitFor(`${node} 실패 알림`, async () => (await mockRequests()).slice(before).find(isFailureNotice), 60_000);
  assert.equal(notice.path, `/discord/channels/${channel}/messages`, `${node} 실패 알림 채널`);
  assert.equal(notice.authorization, 'Bot dummy-e2e-discord');
  assert.deepEqual(Object.keys(notice.json).sort(), ['allowed_mentions', 'content']);
  assert.deepEqual(notice.json.allowed_mentions, { parse: [] });
  const meeting = meetingId ? `회의 ${meetingId} ` : '';
  const check = written ? ` Jira(\`meeting-${meetingId}\` 레이블 이슈)와 Confluence \`회의록\`에 만들어진 것이 있는지 확인해 주세요.` : '';
  const text = `${meeting}회의록 처리가 '${node}' 단계에서 실패했습니다. 오류: ${kind}. n8n 실행 `;
  assert.ok(notice.json.content.startsWith(text), `${notice.json.content}`);
  const executionId = notice.json.content.slice(text.length).match(/^(\d+)에서 확인해 주세요\./)?.[1];
  assert.equal(notice.json.content, `${text}${executionId}에서 확인해 주세요.${check}`);
  return executionId;
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
    return {
      staticData: JSON.parse(db.prepare('SELECT staticData FROM workflow_entity WHERE id = ?').get(workflowId).staticData ?? '{}'),
      executions: db
      .prepare(
        `SELECT e.id, e.status, d.data FROM execution_entity e JOIN execution_data d ON d.executionId = e.id
         WHERE e.workflowId = ? ORDER BY e.id`,
      )
      .all(workflowId),
    };
  } finally {
    db.close();
  }
}

let failed = false;
try {
  step(`임시 폴더 ${dir}`);
  const { workflow, failureWorkflow } = await prepare();
  step('n8n에 테스트 자격 증명과 두 워크플로를 가져오고 publish. 실패 알림용 n8n API 키는 n8n을 띄운 뒤 만든다');
  const deployKey = await startN8n({ workflow, failureWorkflow });

  step('1회차: 회의 종료 → 발화 파일 6개 읽기 → (결정 메시지 갈래, 음성 인식 갈래) → 템플릿 읽기 → 초안 작성 → 초안 검증 → 회의 채널 알림 → 초안 메시지');
  const messages = channelMessages();
  await setMessages(messages);
  await setTemplate(TEMPLATE_STORAGE);
  await setDraft(gptResponse(`\`\`\`markdown\n${draftFor(messages)}\n\`\`\``));
  await meetingEnded(manifest);
  const first = await waitFor('초안 메시지', async () => {
    const requests = await mockRequests();
    return requests.some(isDraftPost) ? requests : null;
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
  const [notice] = discord.filter((r) => isPost(r) && !isDraftPost(r));
  // Discord 노드에는 멘션을 끄는 옵션이 없다. 알림 문구가 코드가 만든 회의 ID와 숫자뿐인지 확인한다.
  assert.deepEqual(notice.json, { content: '회의 20261014-1400 녹취 완료, 발화 6개, 결정 메시지 3개, 초안 검증 통과' });
  // 결정 메시지 갈래가 화면 위쪽이라 음성 인식보다 먼저 실행된다.
  assert.ok(first.findIndex(isGet) < first.findIndex((r) => TRANSCRIBE.test(r.path)), '결정 메시지 조회가 음성 인식보다 먼저다');

  // 템플릿은 두 갈래가 끝난 뒤 한 번 읽고, GPT는 그 뒤에 한 번 부른다.
  const pageReads = byPath(first, TEMPLATE_PAGE);
  assert.equal(pageReads.length, 1);
  assert.equal(pageReads[0].authorization, ATLASSIAN_AUTH, 'Atlassian 자격 증명은 이메일과 토큰을 Basic Auth로 보낸다');
  assert.deepEqual(pageReads[0].query, { 'body-format': 'storage' });
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
  assert.ok(userText.includes(TEMPLATE), 'Markdown으로 바꾼 템플릿이 요청에 들어간다');
  assert.ok(userText.includes('[00:00:12] 도연: 12초 발화'), '녹취가 요청에 들어간다');
  assert.ok(['결정 A: 배포는 금요일', '결정 B: API v2', '결정 C: 회의 중 결정'].every((c) => userText.includes(c)));
  assert.ok(!userText.includes(USER_B) && !userText.includes(USER_A), '요청에 참석자 Discord ID가 없다');
  const order = (test) => first.findIndex((r) => test.test(r.path));
  const lastTranscription = first.findLastIndex((r) => TRANSCRIBE.test(r.path));
  assert.ok(lastTranscription < order(TEMPLATE_PAGE) && order(TEMPLATE_PAGE) < order(DRAFT) && order(DRAFT) < first.findIndex(isPost));
  console.log(`  메시지 조회 ${pages.length}번(음성 인식보다 먼저), 템플릿 1번, GPT 1번, 알림: ${notice.json.content}`);

  // 초안 메시지: embed 하나, 승인·거절 버튼, 멘션 끔, 파일 없음. 버튼 ID에 실행 ID와 서명이 있다.
  const [draftPost] = first.filter(isDraftPost);
  assert.equal(draftPost.path, `/discord/channels/${CHANNEL}/messages`);
  assert.equal(draftPost.authorization, 'Bot dummy-e2e-discord');
  assert.equal(draftPost.multipart, undefined, '4,096자 이하는 파일 없이 JSON으로 보낸다');
  const payload = payloadOf(draftPost);
  assert.equal(payload.content, '회의 20261014-1400 회의록 초안입니다. 3일 안에 승인 또는 거절을 눌러 주세요. 승인하면 Confluence에 쓰고 액션 아이템을 Jira 이슈로 만듭니다.');
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.ok(payload.embeds[0].description.includes('| 참석자 | 도연, 참석자 2 |'));
  const [approveId, editId, rejectId] = buttonIds(payload.components);
  assert.match(approveId, /^mb:approve:\d+:1:[0-9a-f]{64}$/);
  assert.match(editId, /^mb:edit:\d+:1:[0-9a-f]{64}$/);
  assert.match(rejectId, /^mb:reject:\d+:1:[0-9a-f]{64}$/);

  step('1회차 버튼: 틀린 서명과 봇 계정 클릭은 실행을 바꾸지 않는다');
  await setMinutes();
  assert.deepEqual(await click(approveId.replace(/[0-9a-f]{64}$/, '0'.repeat(64))), INVALID_BUTTON);
  assert.deepEqual(await click(approveId, { bot: true }), []);
  await sleep(1_500);
  assert.equal((await mockRequests()).filter(isPatch).length, 0, '틀린 서명과 봇 클릭으로는 재개되지 않는다');

  step('1회차 수정: 모달을 열고, 근거가 틀린 수정은 반영하지 않으며, 통과한 수정은 같은 메시지를 2판으로 바꾼다');
  const original = payload.embeds[0].description;
  const [modal] = await click(editId, {}, { embed: original });
  assert.equal(modal.custom_id, editId, '모달 ID는 버튼 ID와 같다');
  assert.equal(modal.components[0].components[0].value, original, '모달을 지금 초안으로 채운다');
  assert.deepEqual(await click(editId, {}, { submit: original.replace('녹취 00:00:12', '녹취 00:00:20') }), [
    '고친 초안이 근거 검증을 통과하지 못해 반영하지 않았습니다(녹취에 없는 시각 1개). 고치기 전 초안이 그대로 있습니다.',
  ]);
  await sleep(1_500);
  assert.equal((await mockRequests()).filter(isPatch).length, 0, '검증에 실패한 수정은 메시지를 바꾸지 않는다');
  // 링크가 아닌 대괄호를 넣어, 저장 형식으로 바꿨다가 다시 읽어도 대조가 같다고 보는지 확인한다.
  const edited = original.replace('배포는 금요일에 한다.', '배포는 [금요일] 오후에 한다.');
  assert.deepEqual(await click(editId, { globalName: '민수' }, { submit: edited }), accepted('수정'));
  const editPatch = await waitFor('수정 반영', async () => (await mockRequests()).find(isPatch));
  assert.equal(editPatch.json.content, '회의 20261014-1400 회의록 초안입니다(수정: 민수). 3일 안에 승인 또는 거절을 눌러 주세요. 승인하면 Confluence에 쓰고 액션 아이템을 Jira 이슈로 만듭니다.');
  assert.equal(editPatch.json.embeds[0].description, edited);
  assert.deepEqual(editPatch.json.allowed_mentions, { parse: [] });
  const [approve2, edit2, reject2] = buttonIds(editPatch.json.components);
  assert.match(approve2, /^mb:approve:\d+:2:[0-9a-f]{64}$/);
  assert.match(edit2, /^mb:edit:\d+:2:[0-9a-f]{64}$/);

  step('1회차 늦은 클릭: 1판 버튼은 반영되지 않고, 2판 승인으로 액션 아이템을 Jira 이슈로 만든 뒤 Confluence 테스트 페이지 아래에 쓰고 대조한다');
  assert.deepEqual(await click(approveId), ['그 사이 초안이 바뀌었습니다. 회의 채널의 최신 초안 메시지에서 다시 눌러 주세요.']);
  await sleep(1_500);
  assert.equal((await mockRequests()).filter(isPatch).length, 1, '1판 승인은 메시지를 바꾸지 않는다');
  assert.deepEqual(await click(approve2), accepted('승인'));
  const written = await waitFor('Confluence 쓰기 결과', async () => {
    const requests = await mockRequests();
    return requests.filter(isPatch).length >= 3 ? requests : null;
  });
  const [, approvedPatch, writtenPatch] = written.filter(isPatch);
  assert.deepEqual(approvedPatch.json, settled('승인(도연). Confluence에 쓰는 중입니다'));
  const [searchCall] = written.filter(isSearch);
  assert.equal(written.filter(isSearch).length, 1);
  assert.deepEqual(searchCall.query, { 'space-id': '98307', title: '2026-10-14 정기 회의' });
  const [createCall] = written.filter(isCreate);
  assert.equal(createCall.authorization, ATLASSIAN_AUTH);
  assert.deepEqual(Object.keys(createCall.json).sort(), ['body', 'parentId', 'spaceId', 'status', 'title']);
  assert.deepEqual([createCall.json.spaceId, createCall.json.parentId, createCall.json.title, createCall.json.status, createCall.json.body.representation],
    ['98307', MINUTES_PARENT, '2026-10-14 정기 회의', 'current', 'storage']);
  assert.ok(createCall.json.body.value.includes('<li><p>배포는 [금요일] 오후에 한다.'), '고친 초안을 저장 형식으로 쓴다');
  assert.ok(createCall.json.body.value.startsWith('<table><tbody><tr><th><p>필드</p></th>'), '표 첫 행은 머리글이다');
  assert.equal(written.filter(isReadBack).length, 1);
  // 액션 아이템 1개(Backend, 기한 2026-10-16)를 Backend 진행 중 스프린트에 이슈로 만들고, 회의록 표에 링크를 채운 뒤 쓴다.
  assert.deepEqual([written.filter(isIssueSearch).length, written.filter(isSprints).length], [1, 1]);
  assert.equal(written.find(isIssueSearch).query.jql, 'project = SCRUM AND labels = "meeting-20261014-1400" ORDER BY created ASC');
  const issueCalls = written.filter(isIssueCreate);
  assert.equal(issueCalls.length, 1);
  assert.equal(issueCalls[0].authorization, ATLASSIAN_AUTH);
  const fields = issueCalls[0].json.fields;
  assert.deepEqual([fields.summary, fields.duedate, fields.customfield_10020, fields.labels], ['배포', '2026-10-16', 8, ['meeting-minutes', 'meeting-20261014-1400']]);
  assert.ok(written.indexOf(issueCalls[0]) < written.indexOf(createCall), '이슈를 만든 뒤 회의록을 쓴다');
  assert.ok(createCall.json.body.value.includes('<a href="https://tkv123.atlassian.net/browse/SCRUM-1">SCRUM-1</a>'), '회의록 표에 이슈 링크를 채운다');
  const pageLink = 'https://tkv123.atlassian.net/wiki/spaces/SCRUM/pages/7000';
  assert.deepEqual(writtenPatch.json, settled(`승인(도연). Confluence에 썼습니다: ${pageLink}\nJira: 이슈 1개를 만들었습니다(SCRUM-1)`),
    'Confluence가 붙인 속성 차이는 같은 것으로 본다');
  assert.ok(written.indexOf(approvedPatch) < written.indexOf(createCall), '승인을 표시한 뒤 쓴다');
  assert.deepEqual(await click(reject2), INVALID_BUTTON, '끝난 실행(409)');
  await sleep(1_500);
  const afterFirst = await mockRequests();
  assert.equal(afterFirst.filter(isPatch).length, 3);
  assert.equal(afterFirst.filter(isCreate).length, 1);
  assert.equal(afterFirst.filter(isPost).length, 2, '승인하면 기한 초과 알림을 보내지 않는다');

  step('2회차: 녹음 폴더가 없으면 음성 인식 없이 실패하고 실패 알림만 간다');
  await meetingEnded({ ...manifest, meetingId: '20261015-1400' });
  step('3회차: 발화 파일 6개 중 1개가 없으면 실패');
  await meetingEnded({ ...manifest, meetingId: '20261016-1400' });
  step('4회차: 회의 ID로 상위 폴더에 접근하려는 manifest는 실패');
  await meetingEnded({ ...manifest, meetingId: '../20261014-1400' });
  const failedEarly = await waitFor('실패 알림 3건', async () => {
    const requests = (await mockRequests()).slice(afterFirst.length);
    return requests.filter(isFailureNotice).length >= 3 ? requests : null;
  }, 60_000);
  await sleep(3_000);
  assert.equal((await mockRequests()).length, afterFirst.length + 3, '실패한 회차는 실패 알림 말고는 외부 API를 부르지 않는다');
  // 세 실행은 거의 동시에 끝나 알림 순서가 바뀔 수 있다. 회의 ID가 다른 것으로 가린다.
  const earlyNotice = (text) => failedEarly.find((r) => r.json.content.startsWith(text));
  for (const meetingId of ['20261015-1400', '20261016-1400']) {
    const r = earlyNotice(`회의 ${meetingId} `);
    assert.equal(r.path, `/discord/channels/${CHANNEL}/messages`);
    assert.match(r.json.content, new RegExp(`^회의 ${meetingId} 회의록 처리가 '발화 파일 확인' 단계에서 실패했습니다\\. 오류: 검사 중단\\. n8n 실행 \\d+에서 확인해 주세요\\.$`));
  }
  // manifest 형식이 틀리면 customData를 적지 않아 고정 채널로 보낸다.
  const badManifest = earlyNotice('회의록 처리가');
  assert.equal(badManifest.path, `/discord/channels/${FALLBACK_CHANNEL}/messages`);
  assert.match(badManifest.json.content, /^회의록 처리가 '녹음 정보 확인' 단계에서 실패했습니다\. 오류: 검사 중단\. n8n 실행 \d+에서 확인해 주세요\.$/);
  assert.ok(failedEarly.every((r) => !r.json.content.includes('../')), '형식이 틀린 회의 ID는 알림에 넣지 않는다');
  console.log(`  실패 알림: ${failedEarly.map((r) => r.json.content).join(' / ')}`);

  step('5회차: 음성 인식 한 번 실패(500) → 노드 재시도 후 성공. 4,096자가 넘는 초안은 .md 파일로 붙이고, 거절한다');
  await fetch(`${MOCK}/__fail-next-transcription`, { method: 'POST' });
  const longDraft = draftFor(messages).replace(/\*   없음$/, `*   ${'긴 기록입니다. '.repeat(500)}`);
  await setDraft(gptResponse(longDraft));
  await meetingEnded(manifest);
  const fifth = await waitFor('재시도 뒤 초안 메시지', async () => {
    const requests = (await mockRequests()).slice(afterFirst.length);
    return requests.some(isDraftPost) ? requests : null;
  });
  const longPost = fifth.find(isDraftPost);
  const longPayload = payloadOf(longPost);
  assert.deepEqual(longPost.multipart['files[0]'].filename, 'meeting-notes-draft-20261014-1400.md');
  assert.ok(longPost.multipart['files[0]'].size > Buffer.byteLength(longPayload.embeds[0].description), '파일에 초안 전체가 있다');
  assert.deepEqual(longPayload.attachments, [{ id: 0, filename: 'meeting-notes-draft-20261014-1400.md' }]);
  assert.equal([...longPayload.embeds[0].description].length, 4096);
  assert.ok(longPayload.embeds[0].description.endsWith('…(전체는 첨부한 .md 파일에 있습니다)'));
  const longReject = longPayload.components[0].components[1].custom_id;
  assert.deepEqual(await click(longReject, { globalName: null, username: 'minsu' }), ['거절했습니다. 회의 채널의 초안 메시지에 결과가 표시됩니다.']);
  const rejected = await waitFor('거절 표시', async () => (await mockRequests()).slice(afterFirst.length).find(isPatch));
  assert.deepEqual(rejected.json, { content: '회의 20261014-1400 회의록 초안: 거절(minsu)', components: [], allowed_mentions: { parse: [] } });
  const retried = byPath(fifth, TRANSCRIBE);
  assert.equal(retried.filter((r) => r.status === 500).length, 1);
  assert.equal(retried.filter((r) => r.status === 200).length >= 6, true);
  console.log(`  음성 인식 요청 ${retried.length}건(실패 1건 포함). 노드 전체를 다시 시도해 성공한 발화도 다시 보냈습니다`);

  step('6회차: 결정 메시지 조회가 계속 실패(500)하면 다시 시도한 뒤 실행이 실패하고, 음성 인식과 녹취 알림 없이 실패 알림만 간다');
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
  assert.equal(sixth.filter(isOtherPost).length, 0, '조회가 실패하면 녹취 알림을 보내지 않는다');
  await failureNotice(beforeSixth, { node: '결정 메시지 조회', kind: '외부 서비스 응답 오류(HTTP 500)' });
  assert.equal(byPath(sixth, TRANSCRIBE).length, 0, 'Discord 쪽이 실패하면 음성 인식(유료)을 부르지 않는다');
  assert.equal(byPath(sixth, DRAFT).length, 0, 'Discord 쪽이 실패하면 GPT(유료)를 부르지 않는다');

  step('7회차: ✅ 메시지 내용이 비어 있으면(Message Content Intent 꺼짐) 실패하고, 음성 인식과 녹취 알림 없이 실패 알림만 간다');
  await setMessages(channelMessages({ blankDecision: true }));
  const beforeSeventh = (await mockRequests()).length;
  await meetingEnded(manifest);
  await waitFor('메시지 조회', async () => (await mockRequests()).slice(beforeSeventh).filter((r) => isGet(r) && r.status === 200).length >= 3 || null);
  await sleep(3_000);
  const seventh = (await mockRequests()).slice(beforeSeventh);
  assert.equal(seventh.filter(isOtherPost).length, 0);
  await failureNotice(beforeSeventh, { node: '결정 메시지 고르기', kind: '검사 중단' });
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
    assert.equal(requests.filter(isOtherPost).length, 0, '초안이 없으면 녹취 알림을 보내지 않고 실행이 실패한다');
    await failureNotice(before, { node: '초안 검증', kind: '검사 중단' });
  }
  step('9회차: 응답이 max_output_tokens에서 잘리면(incomplete) 실행이 실패한다');
  await draftFails(gptResponse('| 필드 | 값 |', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
  step('10회차: 거절(refusal)이면 실행이 실패한다');
  await draftFails(gptResponse('', {
    output: [{ type: 'message', id: 'msg_e2e', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'e2e' }] }],
  }));

  step('11회차: 템플릿 조회가 계속 실패(500)하면 다시 시도한 뒤 실행이 실패하고, GPT와 녹취 알림 없이 실패 알림만 간다');
  await setDraft(gptResponse(draftFor(messages)));
  await post('__template-fail');
  const beforeEleventh = (await mockRequests()).length;
  await meetingEnded(manifest);
  await waitFor('템플릿 조회 3번', async () => byPath((await mockRequests()).slice(beforeEleventh), TEMPLATE_PAGE).length >= 3 || null);
  await sleep(5_000);
  const eleventh = (await mockRequests()).slice(beforeEleventh);
  assert.equal(byPath(eleventh, TEMPLATE_PAGE).filter((r) => r.status === 500).length, 3, '노드 재시도로 3번 요청한다');
  assert.equal(byPath(eleventh, DRAFT).length, 0);
  assert.equal(eleventh.filter(isOtherPost).length, 0);
  await failureNotice(beforeEleventh, { node: '템플릿 읽기', kind: '외부 서비스 응답 오류(HTTP 500)' });

  step('12회차: 기한(테스트 30초) 안에 아무도 누르지 않으면 기한 초과로 재개되어 버튼을 지우고 답장으로 알린다');
  await setTemplate(TEMPLATE_STORAGE);
  await setDraft(gptResponse(draftFor(messages)));
  const beforeTwelfth = (await mockRequests()).length;
  await meetingEnded(manifest);
  const twelfth = await waitFor('기한 초과 알림', async () => {
    const requests = (await mockRequests()).slice(beforeTwelfth);
    return requests.some((r) => isPost(r) && r.json?.message_reference) ? requests : null;
  }, 180_000);
  const timedOutPost = twelfth.find(isDraftPost);
  const timedOutPatch = twelfth.find(isPatch);
  assert.deepEqual(timedOutPatch.json, {
    content: '회의 20261014-1400 회의록 초안: 기한 초과(3일 동안 승인·거절 없음)', components: [], allowed_mentions: { parse: [] },
  });
  const timeoutNotice = twelfth.find((r) => isPost(r) && r.json?.message_reference);
  assert.deepEqual(timeoutNotice.json, {
    content: '회의 20261014-1400 회의록 초안을 3일 동안 아무도 승인하거나 거절하지 않아 Confluence에 쓰지 않았습니다.',
    message_reference: { message_id: timedOutPatch.path.split('/').pop(), fail_if_not_exists: false },
    allowed_mentions: { parse: [], replied_user: false },
  });
  assert.ok(twelfth.indexOf(timedOutPost) < twelfth.indexOf(timedOutPatch));
  const lateClick = payloadOf(timedOutPost).components[0].components[0].custom_id;
  assert.deepEqual(await click(lateClick), INVALID_BUTTON, '기한이 지난 버튼');

  step('13회차: 같은 회의를 다시 승인하면 같은 제목의 페이지가 있어 쓰지 않고 메시지에 알린다');
  const beforeThirteenth = (await mockRequests()).length;
  await meetingEnded(manifest);
  const thirteenthDraft = await waitFor('초안 메시지', async () => (await mockRequests()).slice(beforeThirteenth).find(isDraftPost));
  assert.deepEqual(await click(buttonIds(payloadOf(thirteenthDraft).components)[0]), accepted('승인'));
  const thirteenth = await waitFor('같은 제목 알림', async () => {
    const requests = (await mockRequests()).slice(beforeThirteenth);
    return requests.filter(isPatch).length >= 2 ? requests : null;
  });
  assert.deepEqual(thirteenth.filter(isPatch)[1].json, settled('승인(도연). Confluence에 같은 제목(2026-10-14 정기 회의)의 페이지가 있어 쓰지 않았습니다'));
  assert.equal(thirteenth.filter(isSearch).length, 1);
  assert.equal(thirteenth.filter(isCreate).length, 0, '같은 제목이 있으면 쓰지 않는다');
  assert.equal(thirteenth.filter(isIssueCreate).length, 0, '같은 제목이 있으면 Jira 이슈도 만들지 않는다');

  step('14회차: 승인 뒤 페이지를 다시 읽지 못하면(500) 실행이 실패하고, 실패 알림이 Jira·Confluence 확인을 알린 뒤 초안 메시지를 실패로 고친다. 이미 만든 Jira 이슈는 다시 만들지 않는다');
  // 재개된 실행이 실패해도 실패 알림이 돌고, 기다리기 전에 적은 customData가 남는지 확인한다(설계 5절 "실패 알림").
  await post('__minutes-clear');
  await post('__readback-fail');
  const beforeFourteenth = (await mockRequests()).length;
  await meetingEnded(manifest);
  const fourteenthDraft = await waitFor('초안 메시지', async () => (await mockRequests()).slice(beforeFourteenth).find(isDraftPost));
  assert.deepEqual(await click(buttonIds(payloadOf(fourteenthDraft).components)[0]), accepted('승인'));
  const readBackFailedId = await failureNotice(beforeFourteenth, {
    node: '페이지 다시 읽기', kind: '외부 서비스 응답 오류(HTTP 500)', written: true,
  });
  const fourteenth = await waitFor('초안 메시지 실패 표시', async () => {
    const requests = (await mockRequests()).slice(beforeFourteenth);
    return requests.filter(isPatch).length >= 2 ? requests : null;
  });
  const [approvedFourteenth, failedPatch] = fourteenth.filter(isPatch);
  assert.deepEqual(approvedFourteenth.json, settled('승인(도연). Confluence에 쓰는 중입니다'));
  assert.equal(failedPatch.path, approvedFourteenth.path, '같은 초안 메시지를 고친다');
  assert.deepEqual(failedPatch.json, settled(`처리 중 실패했습니다(n8n 실행 ${readBackFailedId}). Jira(\`meeting-20261014-1400\` 레이블 이슈)와 Confluence \`회의록\`에 만들어진 것이 있는지 확인해 주세요.`));
  // 같은 회의를 다시 처리했으므로 1회차에 만든 이슈(같은 레이블, 같은 요약)를 다시 쓰고 새로 만들지 않는다.
  assert.equal(fourteenth.filter(isIssueSearch).length, 1);
  assert.equal(fourteenth.filter(isIssueCreate).length, 0, '이미 있는 이슈는 다시 만들지 않는다');
  assert.ok(fourteenth.find(isCreate).json.body.value.includes('/browse/SCRUM-1"'), '이미 있던 이슈 링크를 채운다');
  assert.ok(fourteenth.indexOf(fourteenth.find(isFailureNotice)) < fourteenth.indexOf(failedPatch), '알림을 먼저 보낸다');
  assert.equal(fourteenth.filter(isCreate).length, 1);
  assert.equal(fourteenth.filter((r) => isReadBack(r) && r.status === 500).length, 3, '다시 읽기는 노드 재시도로 3번 요청한다');

  step('n8n에서 내보낸 두 워크플로가 가져온 것과 동작이 같은지 차이 검사');
  for (const wf of [workflow, failureWorkflow]) {
    await compose('exec', '-T', 'n8n', 'n8n', 'export:workflow', `--id=${wf.id}`, '--output=/home/node/.n8n/exported.json');
    const exported = pickWorkflow(JSON.parse(await readFile(path.join(dir, 'n8n', 'exported.json'), 'utf8')), wf);
    assert.deepEqual(diffWorkflows(wf, exported), [], wf.name);
  }

  step('15회차: 승인을 기다리는 회의가 있을 때 배포 스크립트로 저장소 워크플로를 반영한다. 기다리던 회의는 옛 정의로 끝나고, 다시 반영하면 변경 없음');
  // 반영할 저장소 JSON은 실제 서비스 주소를 쓴다. 기다리던 회의가 옛 정의(가짜 서버 주소)로 끝나야 가짜 서버에 요청이 남는다.
  const beforeFifteenth = (await mockRequests()).length;
  await meetingEnded(manifest);
  const fifteenthDraft = await waitFor('초안 메시지', async () => (await mockRequests()).slice(beforeFifteenth).find(isDraftPost));
  const deployApi = n8nApi({ apiUrl: `${N8N}/api/v1`, apiKey: deployKey });
  const repoWorkflows = await readWorkflows();
  assert.deepEqual(await applyWorkflows({ api: deployApi, workflows: repoWorkflows }), [
    '회의 녹취 실패 알림: 반영',
    '회의 녹취: 반영 (승인 대기 실행 1개는 옛 정의로 끝남)',
  ]);
  // 실제 n8n이 돌려준 형식으로도 같다고 판정해야 배포마다 새 버전을 만들지 않는다.
  assert.deepEqual(await applyWorkflows({ api: deployApi, workflows: repoWorkflows }), [
    '회의 녹취 실패 알림: 변경 없음',
    '회의 녹취: 변경 없음 (승인 대기 실행 1개는 옛 정의로 끝남)',
  ]);
  for (const wf of repoWorkflows) {
    const live = await deployApi.call('GET', `/workflows/${wf.id}`);
    assert.equal(live.active, true, `${wf.name} 켜짐`);
    assert.equal(live.activeVersionId, live.versionId, `${wf.name} 게시 버전`);
    for (const node of live.nodes.filter((n) => credentialTypeOf(n))) {
      const type = credentialTypeOf(node);
      assert.deepEqual(node.credentials?.[type]?.id, TEST_CREDENTIALS[type].id, `${wf.name} ${node.name} 자격 증명`);
    }
  }
  assert.deepEqual(await click(buttonIds(payloadOf(fifteenthDraft).components)[0]), accepted('승인'));
  const fifteenth = await waitFor('같은 제목 알림', async () => {
    const requests = (await mockRequests()).slice(beforeFifteenth);
    return requests.filter(isPatch).length >= 2 ? requests : null;
  });
  assert.deepEqual(fifteenth.filter(isPatch)[1].json, settled('승인(도연). Confluence에 같은 제목(2026-10-14 정기 회의)의 페이지가 있어 쓰지 않았습니다'));
  assert.equal(fifteenth.filter(isSearch).length, 1, '기다리던 회의는 옛 정의의 가짜 Confluence 주소로 제목을 찾는다');
  console.log('  반영: 실패 알림, 회의 녹취(대기 실행 1개). 다시 반영: 변경 없음. 기다리던 회의는 옛 정의로 끝남');

  step('n8n 실행 기록 확인');
  const { executions, staticData } = await readExecutions(workflow.id);
  // 회의록을 쓴 뒤 다음 회의의 결정 메시지는 이번 회의 종료 뒤부터 모은다.
  assert.equal(staticData.global?.lastMeetingEndedAt, manifest.endedAt);
  assert.deepEqual(executions.map((e) => e.status), [
    'success', 'error', 'error', 'error', 'success', 'error', 'error', 'success', 'error', 'error', 'error', 'success', 'success', 'error', 'success',
  ]);
  const [ok, noFolder, oneMissing, badId, rejectedRun, fetchFailed, blank, badEvidence, truncated, refused, noTemplate, timedOut, duplicated, readBackFailed, appliedWhileWaiting] =
    executions.map((e) => e.data);
  assert.equal(unflatten(readBackFailed).resultData.lastNodeExecuted, '페이지 다시 읽기');
  assert.equal(executions[13].id, Number(readBackFailedId), '알림의 실행 ID가 14회차에서 실패한 실행이다');
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
  // 승인 기다리기가 재개된 이유가 실행 기록에 남는다. 검증에 실패한 초안은 승인 메시지를 만들지 않았다.
  // 결정 읽기는 반복될 때마다 실행 기록에 한 번씩 남는다(검증 실패 → 수정 → 옛 판 클릭 → 승인).
  const outcomesOf = (data) => (unflatten(data).resultData.runData['결정 읽기'] ?? []).map((run) => {
    const { outcome, by, rev } = run.data.main[0][0].json;
    return [outcome, by, rev];
  });
  assert.deepEqual(outcomesOf(ok), [['editInvalid', '도연', 1], ['edited', '민수', 1], ['stale', '도연', 2], ['approve', '도연', 2]]);
  assert.deepEqual(outcomesOf(rejectedRun), [['reject', 'minsu', 1]]);
  assert.deepEqual(outcomesOf(timedOut), [['timeout', null, 1]]);
  assert.deepEqual(outcomesOf(duplicated), [['approve', '도연', 1]]);
  assert.deepEqual(outcomesOf(appliedWhileWaiting), [['approve', '도연', 1]]);
  const [verified] = nodeOutput(ok, '내용 대조');
  assert.deepEqual([verified.matched, verified.differentLines], [true, 0]);
  assert.deepEqual(nodeOutput(duplicated, '내용 대조'), []);
  assert.equal(unflatten(badEvidence).resultData.lastNodeExecuted, '초안 메시지 만들기');
  assert.deepEqual(nodeOutput(badEvidence, '초안 메시지 만들기'), []);
  console.log(`  실행 ${executions.length}건: ${executions.map((e) => e.status).join(', ')}`);

  // 실패 알림은 실패한 회의 녹취 실행(9건)마다 한 번씩 돌았고 모두 성공했다. 실행 읽기가 n8n API로 customData를 받았다.
  const failures = (await readExecutions(failureWorkflow.id)).executions;
  assert.deepEqual(failures.map((e) => e.status), Array(9).fill('success'));
  const customDataOf = (data) => nodeOutput(data, '실행 읽기')[0]?.customData;
  assert.deepEqual(failures.map((e) => customDataOf(e.data)?.draftMessageId ?? null).filter(Boolean), [approvedFourteenth.path.split('/').pop()]);
  assert.equal(failures.filter((e) => customDataOf(e.data)?.textChannelId === CHANNEL).length, 8, 'manifest 형식이 틀린 1건만 채널을 모른다');
  console.log(`  실패 알림 실행 ${failures.length}건: ${failures.map((e) => e.status).join(', ')}`);

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
