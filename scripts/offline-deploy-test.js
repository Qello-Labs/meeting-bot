// 워크플로 반영 스크립트(scripts/deploy/apply-workflows.js)를 가짜 n8n 공개 API로 확인한다.
// 가짜 API는 n8n 2.42.6 실험에서 본 동작을 따른다: PUT하면 versionId와 activeVersionId가 새 값이 되고 켜진 상태가 유지된다.
// 다만 Webhook은 activate할 때의 버전으로 등록된다(registeredVersionId). PUT만 하면 옛 정의가 계속 돈다.
// 실제 n8n에서의 동작은 E2E(scripts/e2e-n8n.js)가 확인한다.
import assert from 'node:assert/strict';
import { applyWorkflows, attachCredentials, n8nApi, readWorkflows } from './deploy/apply-workflows.js';

const repo = await readWorkflows();
const [failure, transcribe] = repo;
const CREDENTIALS = [
  { id: 'cDiscord', name: 'Discord Bot', type: 'discordBotApi' },
  { id: 'cOpenAi', name: 'OpenAI', type: 'openAiApi' },
  { id: 'cAtlassian', name: 'Atlassian', type: 'httpBasicAuth' },
  { id: 'cHeader', name: 'n8n API', type: 'httpHeaderAuth' },
];
const STATIC = { global: { lastMeetingEndedAt: '2026-10-14T05:10:00.000Z' } };

/** 메모리 위 가짜 n8n. calls에 부른 순서를 남긴다. */
function fakeN8n({ workflows, credentials = CREDENTIALS, waiting = {}, onPut, failRestore = false } = {}) {
  const state = new Map(workflows.map((w) => [w.id, structuredClone({ active: true, versionId: 'v0', activeVersionId: 'v0', registeredVersionId: 'v0', ...w })]));
  const calls = [];
  let version = 0;
  const call = async (method, path, body) => {
    calls.push(`${method} ${path}`);
    const [, id, action] = path.match(/^\/workflows\/([^/]+)(?:\/(activate))?$/) ?? [];
    if (!id || !state.has(id)) throw new Error(`가짜 API에 없는 경로: ${method} ${path}`);
    const w = state.get(id);
    if (method === 'GET') return structuredClone(w);
    if (method === 'POST' && action === 'activate') {
      w.active = true;
      w.registeredVersionId = w.versionId;
      return structuredClone(w);
    }
    if (method === 'PUT') {
      const isRestore = calls.filter((c) => c === `PUT ${path}`).length > 1;
      if (isRestore && failRestore) throw new Error('n8n API PUT /workflows/x: HTTP 500');
      version += 1;
      const next = { ...w, ...structuredClone(body), versionId: `v${version}`, activeVersionId: `v${version}` };
      if (body.staticData === undefined) delete next.staticData; // static data를 안 보내면 지워진다고 가정해 빠뜨림을 잡는다
      state.set(id, onPut && !isRestore ? onPut(next) : next);
      return structuredClone(state.get(id));
    }
    throw new Error(`가짜 API에 없는 경로: ${method} ${path}`);
  };
  const list = async (path) => {
    calls.push(`LIST ${path}`);
    if (path === '/credentials') return structuredClone(credentials);
    const id = path.match(/workflowId=([^&]+)/)?.[1];
    return Array.from({ length: waiting[id] ?? 0 }, (_, i) => ({ id: String(i + 1), status: 'waiting' }));
  };
  return { api: { call, list }, state, calls };
}

// 저장소 JSON은 active: false로 만들어진다. 서버에 반영된 상태는 켜져 있다.
const deployed = (w, overrides = {}) => ({ ...attachCredentials(w, CREDENTIALS), active: true, staticData: STATIC, ...overrides });

// 서버가 저장소와 같으면 아무것도 바꾸지 않는다.
{
  const n8n = fakeN8n({ workflows: [deployed(failure), deployed(transcribe)] });
  assert.deepEqual(await applyWorkflows({ api: n8n.api, workflows: repo }), ['회의 녹취 실패 알림: 변경 없음', '회의 녹취: 변경 없음']);
  assert.ok(!n8n.calls.some((c) => c.startsWith('PUT') || c.endsWith('/activate')));
}

// 바뀐 워크플로만 반영한다. 자격 증명을 종류별로 붙이고, static data는 지금 값을 그대로 보내고, PUT 뒤에 activate한다.
{
  const old = deployed(transcribe, { nodes: deployed(transcribe).nodes.map((n) => (n.name === '녹음 정보 확인' ? { ...n, parameters: { jsCode: 'return [];' } } : n)) });
  const n8n = fakeN8n({ workflows: [deployed(failure), old], waiting: { MeetingTranscribe: 2 } });
  assert.deepEqual(await applyWorkflows({ api: n8n.api, workflows: repo }), [
    '회의 녹취 실패 알림: 변경 없음',
    '회의 녹취: 반영 (승인 대기 실행 2개는 옛 정의로 끝남)',
  ]);
  const after = n8n.state.get('MeetingTranscribe');
  assert.deepEqual(after.staticData, STATIC, '지난 회의 끝 시각을 지우지 않는다');
  assert.equal(after.nodes.find((n) => n.name === '녹음 정보 확인').parameters.jsCode, transcribe.nodes.find((n) => n.name === '녹음 정보 확인').parameters.jsCode);
  assert.deepEqual(after.nodes.find((n) => n.name === '음성 인식').credentials, { openAiApi: { id: 'cOpenAi', name: 'OpenAI' } });
  assert.deepEqual(after.nodes.find((n) => n.name === '결정 메시지 조회').credentials, { discordBotApi: { id: 'cDiscord', name: 'Discord Bot' } });
  assert.deepEqual(after.settings, transcribe.settings, 'errorWorkflow 설정까지 반영한다');
  const puts = n8n.calls.indexOf('PUT /workflows/MeetingTranscribe');
  assert.ok(puts >= 0 && n8n.calls[puts + 1] === 'POST /workflows/MeetingTranscribe/activate', 'PUT 바로 뒤에 activate한다');
  assert.equal(after.registeredVersionId, after.versionId, '새 정의가 등록된다');
}

// 자격 증명 연결만 달라도(예: 화면에서 다른 자격 증명을 골랐음) 반영한다.
{
  const other = deployed(failure, { nodes: deployed(failure).nodes.map((n) => (n.credentials?.discordBotApi ? { ...n, credentials: { discordBotApi: { id: 'cOld', name: '옛 봇' } } } : n)) });
  const n8n = fakeN8n({ workflows: [other, deployed(transcribe)] });
  assert.equal((await applyWorkflows({ api: n8n.api, workflows: repo }))[0], '회의 녹취 실패 알림: 반영');
  assert.ok(n8n.state.get('MeetingFailAlert').nodes.filter((n) => n.credentials?.discordBotApi).every((n) => n.credentials.discordBotApi.id === 'cDiscord'));
}

// 실패 알림을 먼저 반영한다(회의 녹취 설정이 실패 알림을 가리킨다).
{
  const n8n = fakeN8n({ workflows: [deployed(failure, { settings: {} }), deployed(transcribe, { settings: {} })] });
  await applyWorkflows({ api: n8n.api, workflows: repo });
  assert.ok(n8n.calls.indexOf('PUT /workflows/MeetingFailAlert') < n8n.calls.indexOf('PUT /workflows/MeetingTranscribe'));
}

// 꺼져 있던 워크플로는 내용이 같아도 반영해서 켠다.
{
  const n8n = fakeN8n({ workflows: [deployed(failure, { active: false }), deployed(transcribe)] });
  assert.equal((await applyWorkflows({ api: n8n.api, workflows: repo }))[0], '회의 녹취 실패 알림: 반영');
  assert.equal(n8n.state.get('MeetingFailAlert').active, true);
}

// 자격 증명이 없거나 같은 종류가 둘이면 아무것도 바꾸지 않고 실패한다.
for (const [label, credentials, pattern] of [
  ['없음', CREDENTIALS.filter((c) => c.type !== 'httpHeaderAuth'), /실행 읽기: httpHeaderAuth 자격 증명이 0개입니다/],
  ['둘', [...CREDENTIALS, { id: 'cDiscord2', name: 'Discord 2', type: 'discordBotApi' }], /discordBotApi 자격 증명이 2개입니다/],
]) {
  const n8n = fakeN8n({ workflows: [deployed(failure, { settings: {} }), deployed(transcribe, { settings: {} })], credentials });
  await assert.rejects(applyWorkflows({ api: n8n.api, workflows: repo }), pattern, label);
  assert.ok(!n8n.calls.some((c) => c.startsWith('PUT')), `${label}: PUT하지 않는다`);
}

// 반영 뒤 확인에 실패하면(예: 자격 증명 연결이 빠짐) 반영 전 정의로 되돌리고 실패한다.
{
  const old = deployed(transcribe, { settings: {} });
  const n8n = fakeN8n({
    workflows: [deployed(failure), old],
    onPut: (w) => ({ ...w, nodes: w.nodes.map(({ credentials, ...n }) => n) }),
  });
  await assert.rejects(applyWorkflows({ api: n8n.api, workflows: repo }), /회의 녹취: 반영 뒤 확인 실패: 자격 증명 연결이 다름. 반영 전 정의로 되돌렸습니다/);
  const restored = n8n.state.get('MeetingTranscribe');
  assert.deepEqual(restored.settings, {}, '반영 전 설정으로 돌아간다');
  assert.deepEqual(restored.staticData, STATIC);
  assert.equal(restored.active, true);
  assert.equal(restored.registeredVersionId, restored.versionId, '되돌린 정의를 다시 켜서 등록한다');
  assert.equal(n8n.calls.filter((c) => c === 'PUT /workflows/MeetingTranscribe').length, 2);
}

// 되돌리기마저 실패하면 화면에서 확인하라고 알린다.
{
  const n8n = fakeN8n({
    workflows: [deployed(failure), deployed(transcribe, { settings: {} })],
    onPut: (w) => ({ ...w, nodes: w.nodes.map(({ credentials, ...n }) => n) }),
    failRestore: true,
  });
  await assert.rejects(applyWorkflows({ api: n8n.api, workflows: repo }), /되돌리기도 실패했습니다\(n8n API PUT \/workflows\/x: HTTP 500\). n8n 화면에서 확인해야 합니다/);
}

// API 도우미: 키를 헤더로 보내고, nextCursor로 목록을 끝까지 읽고, 오류에 응답 본문을 넣지 않는다.
{
  const seen = [];
  const pages = { '': { data: [{ id: 'a' }], nextCursor: 'c 1' }, 'c 1': { data: [{ id: 'b' }], nextCursor: null } };
  const fetchImpl = async (url, init) => {
    seen.push([url, init.headers['X-N8N-API-KEY']]);
    if (url.includes('/fail')) return { ok: false, status: 500, json: async () => ({ message: '녹취 원문 문장' }) };
    const cursor = decodeURIComponent(new URL(url).searchParams.get('cursor') ?? '');
    return { ok: true, status: 200, json: async () => pages[cursor] };
  };
  const api = n8nApi({ apiUrl: 'http://n8n:5678/api/v1', apiKey: 'k', fetchImpl });
  assert.deepEqual((await api.list('/credentials')).map((c) => c.id), ['a', 'b']);
  assert.deepEqual(seen.map(([u]) => u), ['http://n8n:5678/api/v1/credentials?limit=250', 'http://n8n:5678/api/v1/credentials?limit=250&cursor=c%201']);
  assert.ok(seen.every(([, key]) => key === 'k'));
  await assert.rejects(api.call('GET', '/fail?includeData=true'), (error) => {
    assert.equal(error.message, 'n8n API GET /fail: HTTP 500');
    return true;
  });
}

console.log('배포 오프라인 테스트 통과');
