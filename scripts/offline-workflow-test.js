// 회의 녹취 워크플로의 Code 노드를 n8n 없이 순서대로 실행한다. 파일 읽기와 음성 인식 노드 자리에는 그 노드가 낼 법한 출력을 넣는다.
// 실제 n8n에서 도는지는 Docker E2E로 따로 확인한다. 녹음과 참석자 정보는 모두 지어낸 값이다.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WORKFLOW_FILE, buildWorkflow, credentialTypeOf, serialize } from './build-workflow.js';
import { diffWorkflows, pickWorkflow } from './diff-workflow.js';

const workflow = await buildWorkflow();
const AsyncFunction = (async () => {}).constructor;

/** n8n Code 노드와 같은 이름($input, $, $getWorkflowStaticData)으로 노드 코드를 실행한다. */
function harness(staticData = {}) {
  const outputs = new Map();
  const items = (name) => {
    if (!outputs.has(name)) throw new Error(`${name} 노드 출력이 없습니다`);
    return outputs.get(name);
  };
  const ref = (name) => ({ first: () => items(name)[0], all: () => items(name) });
  return {
    set(name, list) {
      outputs.set(name, list);
    },
    async code(name, input) {
      const node = workflow.nodes.find((n) => n.name === name);
      const fn = new AsyncFunction('$input', '$', '$getWorkflowStaticData', node.parameters.jsCode);
      const result = await fn(ref(input), ref, () => staticData);
      outputs.set(name, result);
      return result;
    },
  };
}

const CHANNEL = '200000000000000002';
const manifest = {
  meetingId: '20261014-1400',
  guildId: '100000000000000001',
  voiceChannel: { id: '300000000000000003', name: '회의실' },
  textChannelId: CHANNEL,
  startedAt: '2026-10-14T05:00:00.000Z',
  endedAt: '2026-10-14T06:05:00.000Z',
  participants: [
    { userId: '400000000000000001', displayName: '도연' },
    { userId: '400000000000000002', displayName: '400000000000000002' }, // 멤버 정보를 못 읽어 ID가 들어간 경우
  ],
  segments: [
    { file: '000003000-400000000000000002.webm', userId: '400000000000000002', startMs: 3_000, endMs: 5_000, displayName: '400000000000000002' },
    { file: '000012000-400000000000000001.webm', userId: '400000000000000001', startMs: 12_000, endMs: 15_000, displayName: '도연' },
    { file: '000040000-400000000000000001.webm', userId: '400000000000000001', startMs: 40_000, endMs: 41_000, displayName: '도연' },
    { file: '003725000-400000000000000001.webm', userId: '400000000000000001', startMs: 3_725_000, endMs: 3_727_000, displayName: '도연' },
  ],
  gaps: [{ startMs: 20_000, endMs: 32_400, reason: '음성 연결 끊김' }],
};

/** 파일 읽기 노드가 내는 항목. 파일 내용은 쓰지 않으므로 이름만 맞춘다. */
const fileItem = (file) => ({ json: {}, binary: { data: { fileName: file, mimeType: 'video/webm', data: '' } } });

async function runUntilFiles(h, body) {
  h.set('회의 종료', [{ json: { headers: {}, params: {}, query: {}, body } }]);
  await h.code('녹음 정보 확인', '회의 종료');
  return h.code('발화 목록', '녹음 정보 확인');
}

// 정상 흐름: manifest 수신 → 발화 목록 → 파일 확인 → 녹취 → 알림 문구
{
  const h = harness();
  const list = await runUntilFiles(h, manifest);
  assert.deepEqual(
    list.map((item) => item.json.path),
    manifest.segments.map((s) => `/recordings/20261014-1400/segments/${s.file}`),
  );

  h.set('발화 파일 읽기', manifest.segments.map((s) => fileItem(s.file)));
  const files = await h.code('발화 파일 확인', '발화 파일 읽기');
  assert.equal(files.length, 4);

  h.set('음성 인식', [
    { json: { text: 'FR-01부터 보죠' } },
    { json: { text: ' 금요일에\n배포합시다 ' } },
    { json: { text: '' } }, // 기침처럼 인식된 말이 없는 발화
    { json: { text: '@everyone 끝' } },
  ]);
  const [result] = await h.code('녹취 만들기', '음성 인식');
  assert.equal(
    result.json.transcript,
    [
      '[00:00:03] 참석자 2: FR-01부터 보죠',
      '[00:00:12] 도연: 금요일에 배포합시다',
      '[00:00:20] (녹음 끊김 약 12초, 음성 연결 끊김)',
      '[01:02:05] 도연: @everyone 끝',
    ].join('\n'),
  );
  assert.equal(result.json.segmentCount, 4);
  assert.equal(result.json.emptyCount, 1);
  assert.equal(result.json.textChannelId, CHANNEL);
  assert.equal(result.json.guildId, manifest.guildId);
  assert.ok(!result.json.transcript.includes('400000000000000002'), '녹취에 Discord ID가 들어가지 않는다');
}

// 표시 이름 자리에 ID가 들어온 참석자는 "참석자 N"이 된다. 음성 인식 프롬프트에도 ID가 들어가지 않는다.
{
  const h = harness();
  h.set('회의 종료', [{ json: { body: manifest } }]);
  const [info] = await h.code('녹음 정보 확인', '회의 종료');
  assert.equal(info.json.prompt, '참석자: 도연, 참석자 2');
  assert.deepEqual(info.json.segments.map((s) => s.speaker), ['참석자 2', '도연', '도연', '도연']);
}

// 형식이 틀린 manifest는 실패한다. 경로와 URL에 들어가는 값은 형식이 맞는 것만 받고, 오류 메시지에 값을 넣지 않는다.
for (const [label, body, expected] of [
  ['회의 ID로 상위 폴더 접근', { ...manifest, meetingId: '../20261014-1400' }, 'meetingId 형식이 다릅니다'],
  ['파일 이름으로 상위 폴더 접근', { ...manifest, segments: [{ ...manifest.segments[0], file: '../../000003000-1.webm' }] }, 'segments[0].file 형식이 다릅니다'],
  ['파일 이름 glob', { ...manifest, segments: [{ ...manifest.segments[0], file: '*.webm' }] }, 'segments[0].file 형식이 다릅니다'],
  ['중복 파일', { ...manifest, segments: [manifest.segments[0], manifest.segments[0]] }, 'segments[1].file이 중복됩니다'],
  ['채널 ID가 경로', { ...manifest, textChannelId: '1/../../users/@me' }, 'textChannelId 형식이 다릅니다'],
  ['서버 ID 없음', { ...manifest, guildId: undefined }, 'guildId 형식이 다릅니다'],
  ['발화 없음', { ...manifest, segments: [] }, '녹음된 발화가 없습니다'],
  ['시각 역전', { ...manifest, segments: [{ ...manifest.segments[0], endMs: 1 }] }, 'segments[0] 시각이 잘못됐습니다'],
  ['끊긴 구간 시각 없음', { ...manifest, gaps: [{ reason: '봇 재시작' }] }, 'gaps[0] 시각이 잘못됐습니다'],
  ['본문 없음', undefined, 'manifest가 JSON 객체가 아닙니다'],
]) {
  const h = harness();
  h.set('회의 종료', [{ json: { body } }]);
  await assert.rejects(h.code('녹음 정보 확인', '회의 종료'), (error) => {
    assert.ok(error.message.includes(expected), `${label}: ${error.message}`);
    assert.ok(!error.message.includes('400000000000000'), `${label}: 오류 메시지에 ID가 없다`);
    return true;
  });
}

// 파일 읽기 노드가 파일을 못 찾으면 alwaysOutputData로 빈 항목 하나를 낸다. 조용히 넘어가지 않고 실패해야 한다.
{
  const h = harness();
  await runUntilFiles(h, manifest);
  h.set('발화 파일 읽기', [{ json: {} }]);
  await assert.rejects(h.code('발화 파일 확인', '발화 파일 읽기'), /발화 파일 4개 중 0개만 읽었습니다/);

  h.set('발화 파일 읽기', manifest.segments.slice(1).map((s) => fileItem(s.file)));
  await assert.rejects(h.code('발화 파일 확인', '발화 파일 읽기'), /발화 파일 4개 중 3개만 읽었습니다/);

  h.set('발화 파일 읽기', [...manifest.segments].reverse().map((s) => fileItem(s.file)));
  await assert.rejects(h.code('발화 파일 확인', '발화 파일 읽기'), /1번째 발화 파일이 발화 목록과 다릅니다/);
}

// 음성 인식 결과 수가 발화 수와 다르면 녹취를 만들지 않는다.
{
  const h = harness();
  await runUntilFiles(h, manifest);
  h.set('음성 인식', [{ json: { text: '하나' } }]);
  await assert.rejects(h.code('녹취 만들기', '음성 인식'), /음성 인식 결과 수\(1\)가 발화 수\(4\)와 다릅니다/);
}

// 저장소 JSON은 코드로 만든 것과 같고, 자격 증명 값이나 ID를 담지 않는다.
{
  const committed = await readFile(WORKFLOW_FILE, 'utf8');
  assert.equal(committed, serialize(workflow), 'node scripts/build-workflow.js로 다시 만드세요');
  assert.ok(workflow.nodes.every((node) => node.credentials === undefined));
  // 음성 인식은 gpt-4o-transcribe를 HTTP 노드로, 알림은 Discord 전용 노드로 부른다.
  const nodeOf = (name) => workflow.nodes.find((n) => n.name === name);
  assert.equal(nodeOf('음성 인식').type, 'n8n-nodes-base.httpRequest');
  assert.ok(nodeOf('음성 인식').parameters.bodyParameters.parameters.some((p) => p.name === 'model' && p.value === 'gpt-4o-transcribe'));
  assert.equal(nodeOf('회의 채널 알림').type, 'n8n-nodes-base.discord');
  assert.deepEqual(workflow.nodes.map(credentialTypeOf).filter(Boolean), ['discordBotApi', 'openAiApi', 'discordBotApi']);
  assert.deepEqual(
    workflow.nodes.map((n) => n.name),
    [
      '회의 종료', '녹음 정보 확인', '발화 목록', '발화 파일 읽기', '발화 파일 확인',
      '결정 메시지 기간', '결정 메시지 조회', '결정 메시지 고르기', '음성 인식', '녹취 만들기',
      '녹취·결정 합치기', '알림 만들기', '회의 채널 알림',
    ],
  );
}

// 차이 검사: n8n이 가져오고 내보낼 때 바꾸는 값(위치, ID, 자격 증명, 배열 형식)은 차이로 보지 않고, 동작이 바뀐 노드는 찾는다.
{
  const exportOf = (edit = () => {}) => {
    const copy = JSON.parse(serialize(workflow));
    copy.id = 'AbCdEf0123456789';
    copy.versionId = '11111111-2222-3333-4444-555555555555';
    copy.nodes.forEach((node, i) => {
      node.id = `node-${i}`;
      node.position = [node.position[0] + 17 * i, node.position[1] + 120]; // 갈래의 위아래 순서는 유지한다
      node.webhookId = node.webhookId ? 'ffffffff-0000-0000-0000-000000000000' : undefined;
      const type = credentialTypeOf(node);
      if (type) node.credentials = { [type]: { id: 'cred1', name: '화면에서 고른 자격 증명' } };
    });
    copy.nodes.find((n) => n.name === '음성 인식').alwaysOutputData = false; // 기본값과 같은 값이 새로 생겨도 같다
    edit(copy);
    return copy;
  };
  const node = (copy, name) => copy.nodes.find((n) => n.name === name);

  assert.deepEqual(diffWorkflows(workflow, exportOf()), []);

  // 화면에서 저장하면 기본값과 같은 파라미터가 빠진다. 동작이 같으므로 차이가 아니다.
  const savedInEditor = exportOf((c) => {
    delete node(c, '회의 종료').parameters.responseMode;
    delete node(c, '발화 파일 읽기').parameters.operation;
    for (const key of ['authentication', 'operation', 'sendTo']) delete node(c, '회의 채널 알림').parameters[key];
    // 결정 메시지 조회(HTTP GET)와 합치기(Merge): 안쪽 설정과 배열 항목 안의 기본값도 빠진다(n8n 2.42.6 화면 저장에서 확인).
    const fetch = node(c, '결정 메시지 조회').parameters;
    delete fetch.method;
    delete fetch.options.pagination.pagination.paginationMode;
    for (const p of fetch.options.pagination.pagination.parameters.parameters) delete p.type;
    delete node(c, '녹취·결정 합치기').parameters.chooseBranchMode;
  });
  assert.deepEqual(diffWorkflows(workflow, savedInEditor), []);
  // 안쪽 설정을 바꾸면 차이다.
  assert.deepEqual(
    diffWorkflows(workflow, exportOf((c) => {
      node(c, '결정 메시지 조회').parameters.options.pagination.pagination.parameters.parameters[0].type = 'body';
    })).slice(0, 1),
    ['~ 결정 메시지 조회'],
  );
  // 기본값이 아닌 값으로 바꾸면 차이다.
  assert.deepEqual(
    diffWorkflows(workflow, exportOf((c) => {
      node(c, '회의 종료').parameters.responseMode = 'lastNode';
    })),
    ['~ 회의 종료', '    parameters.responseMode: "onReceived" → "lastNode"'],
  );
  assert.deepEqual(diffWorkflows(workflow, pickWorkflow([{ name: '다른 워크플로', nodes: [] }, exportOf()], workflow)), []);

  const batch = diffWorkflows(workflow, exportOf((c) => {
    node(c, '음성 인식').parameters.options.batching.batch.batchSize = 10;
  }));
  assert.deepEqual(batch, ['~ 음성 인식', '    parameters.options.batching.batch.batchSize: 5 → 10']);

  const retry = diffWorkflows(workflow, exportOf((c) => {
    node(c, '음성 인식').retryOnFail = false;
  }));
  assert.deepEqual(retry, ['~ 음성 인식', '    settings.retryOnFail: true → (없음)']);

  const codeChange = diffWorkflows(workflow, exportOf((c) => {
    const n = node(c, '녹취 만들기');
    n.parameters.jsCode = n.parameters.jsCode.replace("const pad = (n) => String(n).padStart(2, '0');", "const pad = (n) => String(n).padStart(3, '0');");
  }));
  assert.equal(codeChange[0], '~ 녹취 만들기');
  assert.match(codeChange[1], /^ {4}parameters\.jsCode: \d+번째 줄부터 다름/);
  assert.match(codeChange[1], /padStart\(3/);

  const renamed = diffWorkflows(workflow, exportOf((c) => {
    node(c, '회의 채널 알림').name = '알림';
    c.connections['알림 만들기'].main[0][0].node = '알림';
  }));
  assert.deepEqual(renamed, [
    '- 노드 없음(이름이 바뀌었거나 지워짐): 회의 채널 알림',
    '+ 저장소에 없는 노드: 알림',
    '- 연결 없음: 알림 만들기[main 0] → 회의 채널 알림[main 0]',
    '+ 저장소에 없는 연결: 알림 만들기[main 0] → 알림[main 0]',
  ]);

  const unlinked = diffWorkflows(workflow, exportOf((c) => {
    delete c.connections['발화 파일 읽기'];
    c.connections['발화 목록'].main[0].push({ node: '발화 파일 확인', type: 'main', index: 0 });
  }));
  assert.deepEqual(unlinked, [
    '- 연결 없음: 발화 파일 읽기[main 0] → 발화 파일 확인[main 0]',
    '+ 저장소에 없는 연결: 발화 목록[main 0] → 발화 파일 확인[main 0]',
  ]);
}

// ---------------------------------------------------------------------------
// 결정 메시지 수집(6단계). 메시지와 ID는 모두 지어낸 값이다.
// ---------------------------------------------------------------------------

const DISCORD_EPOCH = 1420070400000n;
const DAY = 24 * 60 * 60 * 1000;
const STARTED = Date.parse(manifest.startedAt);
const ENDED = Date.parse(manifest.endedAt);
let sequence = 0;
/** ms 밀리초에 쓰인 메시지. 같은 밀리초 안에서도 ID가 겹치지 않게 순번을 붙인다. */
const message = (ms, extra = {}) => ({
  id: (((BigInt(ms) - DISCORD_EPOCH) << 22n) + BigInt((sequence += 1) % 4096)).toString(),
  type: 0,
  content: '내용',
  author: { id: '500000000000000001', username: 'doyeon', global_name: '도연', bot: false },
  attachments: [],
  reactions: [{ emoji: { id: null, name: '✅' }, count: 1, me: false }],
  ...extra,
});

/** 녹취까지 돌리고 결정 메시지 기간을 구한다. */
async function untilPeriod(staticData = {}) {
  const h = harness(staticData);
  await runUntilFiles(h, manifest);
  h.set('녹취 만들기', [{ json: { meetingId: manifest.meetingId, segmentCount: 4 } }]);
  const [period] = await h.code('결정 메시지 기간', '녹취 만들기');
  return { h, period: period.json };
}

async function pick(messages, staticData) {
  const { h, period } = await untilPeriod(staticData);
  h.set('결정 메시지 조회', messages.length ? messages.map((json) => ({ json })) : [{ json: {} }]);
  const [result] = await h.code('결정 메시지 고르기', '결정 메시지 조회');
  return { result: result.json, period };
}

// 기간: static data가 없으면 회의 시작 7일 전부터, 있으면 지난 회의 끝 시각부터, 이상하면 처음처럼 7일 전부터. 끝은 회의 종료.
{
  const idAt = (ms) => (BigInt(ms) - DISCORD_EPOCH) << 22n;
  const first = (await untilPeriod()).period;
  assert.equal(first.from, new Date(STARTED - 7 * DAY).toISOString());
  assert.equal(first.to, manifest.endedAt);
  assert.equal(first.afterId, (idAt(STARTED - 7 * DAY + 1) - 1n).toString());
  assert.equal(first.endId, (idAt(ENDED + 1) - 1n).toString());
  assert.equal(first.channelId, CHANNEL);
  assert.equal(first.maxRequests, 50);
  assert.match(first.source, /처음 실행/);

  const last = new Date(STARTED - 3 * DAY).toISOString();
  assert.equal((await untilPeriod({ lastMeetingEndedAt: last })).period.from, last);
  for (const broken of [new Date(ENDED + 1).toISOString(), 'not-a-date', 12345]) {
    assert.equal((await untilPeriod({ lastMeetingEndedAt: broken })).period.from, first.from, `저장값 ${broken}`);
  }
}

// 고르기: 기간 안에 사람이 쓴 ✅ 메시지만, 오래된 순서로. 작성자 ID는 남기지 않는다.
{
  const keep1 = message(STARTED - 2 * DAY, { content: '배포는 금요일로 합니다' });
  const keepReply = message(STARTED + 60_000, { type: 19, content: 'API v2로 갑니다', author: { id: '500000000000000002', username: 'minsu', global_name: null } });
  const keepAtEnd = message(ENDED, { content: '', attachments: [{ filename: 'plan.png' }] });
  const messages = [
    keepReply,
    message(STARTED - 7 * DAY, { content: '기간 시작 시각과 같은 밀리초라 빠짐' }),
    message(ENDED + 1, { content: '회의가 끝난 뒤라 빠짐' }),
    message(STARTED, { reactions: [], content: '반응 없음' }),
    message(STARTED, { reactions: [{ emoji: { name: '👍' }, count: 3 }], content: '다른 반응' }),
    message(STARTED, { reactions: [{ emoji: { name: '✅' }, count: 0 }], content: '0개' }),
    message(STARTED, { author: { id: '600000000000000001', username: 'meeting-bot', bot: true } }),
    message(STARTED, { webhook_id: '700000000000000001' }),
    message(STARTED, { type: 7, content: '' }), // 입장 알림
    keep1,
    keepAtEnd,
  ];
  const { result } = await pick(messages);
  assert.equal(result.scanned, messages.length);
  assert.equal(result.decisionCount, 3);
  assert.deepEqual(result.decisions.map((d) => d.link), [keep1, keepReply, keepAtEnd].map((m) => `https://discord.com/channels/${manifest.guildId}/${CHANNEL}/${m.id}`));
  assert.deepEqual(result.decisions.map((d) => d.author), ['도연', 'minsu', '도연']);
  assert.deepEqual(result.decisions[2].attachments, ['plan.png']);
  assert.equal(result.decisions[0].sentAt, new Date(STARTED - 2 * DAY).toISOString());
  assert.equal(result.textChannelId, CHANNEL);
  assert.ok(!JSON.stringify(result).includes('500000000000000'), '작성자 ID를 남기지 않는다');
}

// ID 경계: 끝 ID와 같은 메시지는 들어가고 1 큰 메시지는 빠진다. 시작(after) ID와 같은 메시지는 빠지고 1 큰 메시지는 들어간다.
{
  const { period } = await untilPeriod();
  const at = (id, content) => ({ ...message(STARTED), id, content });
  const { result } = await pick([
    at(period.endId, '끝 ID'),
    at((BigInt(period.endId) + 1n).toString(), '끝 ID + 1'),
    at(period.afterId, '시작 ID'),
    at((BigInt(period.afterId) + 1n).toString(), '시작 ID + 1'),
  ]);
  assert.deepEqual(result.decisions.map((d) => d.content), ['시작 ID + 1', '끝 ID']);
}

// 받은 메시지가 없으면(alwaysOutputData의 빈 항목) 결정 메시지 0개로 알린다.
{
  const { result } = await pick([]);
  assert.equal(result.scanned, 0);
  assert.equal(result.decisionCount, 0);
}

// 조회 중 오류 응답 본문이 항목으로 들어오면 결정 메시지 0개로 넘어가지 않고 실패한다.
await assert.rejects(pick([message(STARTED), { message: 'e2e injected failure' }]), /메시지가 아닌 항목이 1개/);

// ✅가 달렸는데 내용과 첨부가 모두 없으면 Message Content Intent를 확인하라며 실패한다.
await assert.rejects(pick([message(STARTED, { content: '' })]), /Message Content Intent/);

// 요청 한도(50번, 5,000개)만큼 받았는데 회의 종료 시각에 닿지 못했으면 실패한다. 회의 종료를 넘었으면 다 받은 것이다.
{
  const many = Array.from({ length: 5000 }, (_, i) => message(STARTED - DAY + i, { reactions: [] }));
  await assert.rejects(pick(many), /5000개까지 받고도 회의 종료 시각에 닿지 못했습니다/);
  const reached = [...many.slice(1), message(ENDED + 1, { reactions: [] })];
  assert.equal((await pick(reached)).result.decisionCount, 0);
}

// 결정 메시지 조회 노드의 페이지 넘김 식: 다음 after는 가장 큰 ID, 100개 미만이거나 회의 종료를 넘으면 멈춘다.
{
  const fetchNode = workflow.nodes.find((n) => n.name === '결정 메시지 조회');
  const { pagination } = fetchNode.parameters.options.pagination;
  assert.equal(fetchNode.alwaysOutputData, true);
  assert.equal(pagination.maxRequests, "={{ $('결정 메시지 기간').first().json.maxRequests }}");
  const evaluate = (expression, body, period) => {
    const inner = expression.trim().slice(3, -2);
    return new Function('$response', '$', `return (${inner});`)({ body }, () => ({ first: () => ({ json: period }) }));
  };
  const { period } = await untilPeriod();
  const nextAfter = pagination.parameters.parameters[0].value;
  assert.equal(evaluate(nextAfter, [{ id: '99' }, { id: '1000' }, { id: '998' }], period), '1000');
  const page = (ms) => Array.from({ length: 100 }, (_, i) => message(ms + i, { reactions: [] }));
  assert.equal(evaluate(pagination.completeExpression, page(STARTED), period), false, '100개를 채웠고 회의 중이면 더 받는다');
  assert.equal(evaluate(pagination.completeExpression, page(STARTED).slice(1), period), true, '100개 미만이면 멈춘다');
  assert.equal(evaluate(pagination.completeExpression, [], period), true, '비었으면 멈춘다');
  assert.equal(evaluate(pagination.completeExpression, page(ENDED - 50), period), true, '회의 종료를 넘으면 멈춘다');
  // 오류 응답(배열이 아닌 본문)에서도 식이 깨지지 않는다. 완료로 보면 n8n이 상태 코드로 오류를 올린다.
  assert.equal(evaluate(pagination.completeExpression, { message: '오류' }, period), true);
  assert.equal(evaluate(nextAfter, { message: '오류' }, period), period.afterId);
  assert.equal(evaluate(nextAfter, undefined, period), period.afterId, '첫 요청 전(응답 없음)에는 기간 시작 ID');
}

// 두 갈래: 발화 파일 확인에서 결정 메시지 갈래(위)와 음성 인식 갈래(아래)로 나뉘고, 둘 다 끝나면 알림을 만든다.
{
  const nodeOf = (name) => workflow.nodes.find((n) => n.name === name);
  assert.deepEqual(workflow.connections['발화 파일 확인'].main[0].map((t) => t.node), ['결정 메시지 기간', '음성 인식']);
  // n8n은 갈래를 화면 위쪽부터 실행한다. 결정 메시지 갈래가 위라서 Discord 쪽이 실패하면 음성 인식(유료) 전에 멈춘다.
  assert.ok(nodeOf('결정 메시지 기간').position[1] < nodeOf('음성 인식').position[1]);
  assert.deepEqual(workflow.connections['결정 메시지 고르기'].main[0], [{ node: '녹취·결정 합치기', type: 'main', index: 0 }]);
  assert.deepEqual(workflow.connections['녹취 만들기'].main[0], [{ node: '녹취·결정 합치기', type: 'main', index: 1 }]);
  assert.deepEqual(nodeOf('녹취·결정 합치기').parameters, { mode: 'chooseBranch', chooseBranchMode: 'waitForAll', output: 'empty' });

  // 결정 메시지 고르기는 녹취를 읽지 않는다(녹취 만들기 출력 없이 돈다).
  const { h } = await untilPeriod();
  const bare = harness();
  await runUntilFiles(bare, manifest);
  await bare.code('결정 메시지 기간', '녹음 정보 확인');
  bare.set('결정 메시지 조회', [{ json: {} }]);
  const [alone] = await bare.code('결정 메시지 고르기', '결정 메시지 조회');
  assert.equal(alone.json.decisionCount, 0);

  // 알림 만들기는 두 갈래 결과로 회의 ID와 숫자만 담은 문구를 만든다.
  h.set('녹취 만들기', [{ json: { meetingId: manifest.meetingId, segmentCount: 4, transcript: '[00:00:03] 참석자 2: 원문' } }]);
  h.set('결정 메시지 고르기', [{ json: { decisionCount: 3, decisions: [{ content: '결정 원문' }] } }]);
  h.set('녹취·결정 합치기', [{ json: {} }]);
  const [notice] = await h.code('알림 만들기', '녹취·결정 합치기');
  assert.deepEqual(notice.json, {
    guildId: manifest.guildId,
    textChannelId: CHANNEL,
    notice: '회의 20261014-1400 녹취 완료, 발화 4개, 결정 메시지 3개',
  });
}

// 차이 검사: 화면에서 갈래의 위아래를 바꾸면 실행 순서가 바뀌므로 차이로 찾는다.
{
  const swapped = JSON.parse(serialize(workflow));
  const nodeIn = (name) => swapped.nodes.find((n) => n.name === name);
  [nodeIn('결정 메시지 기간').position, nodeIn('음성 인식').position] = [nodeIn('음성 인식').position, nodeIn('결정 메시지 기간').position];
  assert.deepEqual(diffWorkflows(workflow, swapped), ['~ 갈래 실행 순서 발화 파일 확인[main 0]: 결정 메시지 기간, 음성 인식 → 음성 인식, 결정 메시지 기간']);
}

console.log('회의 녹취 워크플로 오프라인 테스트 통과');
