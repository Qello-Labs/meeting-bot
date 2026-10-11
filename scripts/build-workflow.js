// workflows/src의 Code 노드 코드로 n8n에 가져올 워크플로 JSON을 만든다. 워크플로의 원본은 이 스크립트와 workflows/src다.
//   node scripts/build-workflow.js           workflows/meeting-transcribe.json을 다시 쓴다
//   node scripts/build-workflow.js --check   커밋된 JSON이 코드와 같은지만 확인한다
// 자격 증명은 넣지 않는다. n8n 화면에서 등록하고 노드마다 고른다(workflows/README.md).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORKFLOW_FILE = path.join(ROOT, 'workflows/meeting-transcribe.json');

const OPENAI_BASE = 'https://api.openai.com/v1';
const DISCORD_BASE = 'https://discord.com/api/v10';

// Discord 메시지 ID는 길이가 다를 수 있어 길이부터 비교한다. 받은 메시지 중 가장 큰 ID를 다음 after로 쓴다.
// n8n 2.42.6은 첫 요청 전에도 이 식을 계산하고(그때는 응답이 없다), 오류 응답은 본문이 배열이 아니다.
// 식이 깨지면 n8n이 페이지 넘김을 멈추고 오류 본문을 출력으로 내므로(E2E에서 확인) 배열이 아닐 때도 계산되게 하고,
// 그때는 기간 시작 ID를 쓴다. 오류 응답은 완료로 보고 n8n이 붙이는 상태 코드 검사가 오류를 올린다.
const PERIOD = "$('결정 메시지 기간').first().json";
const NEWEST_ID = `(Array.isArray($response.body) ? $response.body.map((m) => m.id).reduce((a, b) => (b.length > a.length || (b.length === a.length && b > a) ? b : a), '0') : ${PERIOD}.afterId)`;

// Discord는 전용 노드로 불러 화면에서 아이콘으로 구분한다. 음성 인식은 OpenAI 전용 노드가 whisper-1 고정이고 프롬프트를 받지 않아
// HTTP Request 노드로 gpt-4o-transcribe를 부른다(2026-10-11 사용자 결정).
const CREDENTIAL_TYPES = { 'n8n-nodes-base.discord': 'discordBotApi' };

/** 노드에서 고를 자격 증명 종류. 테스트(scripts/e2e-n8n.js)도 이 함수로 테스트 자격 증명을 붙인다. */
export const credentialTypeOf = (node) => node.parameters.nodeCredentialType ?? CREDENTIAL_TYPES[node.type];

const readCode = (name) => readFile(path.join(ROOT, 'workflows/src', `${name}.js`), 'utf8');

// 화면 위치. n8n(executionOrder v1)은 한 노드에서 갈라진 갈래를 화면 위쪽부터 하나씩 끝까지 실행하므로 위치가 실행 순서를 정한다.
// 결정 메시지 갈래를 위에 두어 Discord 쪽이 실패하면 음성 인식(유료) 전에 멈춘다(2026-10-11 사용자 결정: 병렬 갈래 + Merge).
const POSITIONS = {
  '회의 종료': [0, 0],
  '녹음 정보 확인': [240, 0],
  '발화 목록': [480, 0],
  '발화 파일 읽기': [720, 0],
  '발화 파일 확인': [960, 0],
  '결정 메시지 기간': [1200, -200],
  '결정 메시지 조회': [1440, -200],
  '결정 메시지 고르기': [1680, -200],
  '음성 인식': [1200, 200],
  '녹취 만들기': [1440, 200],
  '녹취·결정 합치기': [1920, 0],
  '알림 만들기': [2160, 0],
  '회의 채널 알림': [2400, 0],
};

// [보내는 노드, 받는 노드, 받는 입력 번호]
const EDGES = [
  ['회의 종료', '녹음 정보 확인'],
  ['녹음 정보 확인', '발화 목록'],
  ['발화 목록', '발화 파일 읽기'],
  ['발화 파일 읽기', '발화 파일 확인'],
  ['발화 파일 확인', '결정 메시지 기간'],
  ['발화 파일 확인', '음성 인식'],
  ['결정 메시지 기간', '결정 메시지 조회'],
  ['결정 메시지 조회', '결정 메시지 고르기'],
  ['결정 메시지 고르기', '녹취·결정 합치기', 0],
  ['음성 인식', '녹취 만들기'],
  ['녹취 만들기', '녹취·결정 합치기', 1],
  ['녹취·결정 합치기', '알림 만들기'],
  ['알림 만들기', '회의 채널 알림'],
];

function place(nodes) {
  return nodes.map((node) => {
    if (!POSITIONS[node.name]) throw new Error(`${node.name}의 화면 위치가 없습니다`);
    return { ...node, position: POSITIONS[node.name] };
  });
}

function connect(edges) {
  const connections = {};
  for (const [from, to, index = 0] of edges) {
    (connections[from] ??= { main: [[]] }).main[0].push({ node: to, type: 'main', index });
  }
  return connections;
}

const code = (name, jsCode) => ({ parameters: { jsCode }, name, type: 'n8n-nodes-base.code', typeVersion: 2 });

const http = (name, parameters, settings = {}) => ({
  parameters: { ...parameters, options: parameters.options ?? {} },
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  ...settings,
});

const credential = (type) => ({ authentication: 'predefinedCredentialType', nodeCredentialType: type });

export async function buildWorkflow({ openaiBase = OPENAI_BASE } = {}) {
  const meeting = "$('녹음 정보 확인').first().json";
  const nodes = place([
    {
      // n8n은 서버 127.0.0.1에만 열려 있고 녹음 봇이 compose 내부 주소로 부르므로 고정 경로를 쓴다.
      // 음성 인식이 몇 분 걸려도 녹음 봇 요청이 끊기지 않게 받자마자 응답한다.
      parameters: { httpMethod: 'POST', path: 'meeting-ended', responseMode: 'onReceived', options: {} },
      name: '회의 종료',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      webhookId: 'a6780d36-8ae8-42d3-83b7-9d7a0d6f8dbc',
    },
    code('녹음 정보 확인', await readCode('manifest-check')),
    code('발화 목록', await readCode('segment-list')),
    {
      parameters: { operation: 'read', fileSelector: '={{ $json.path }}', options: { dataPropertyName: 'data' } },
      name: '발화 파일 읽기',
      type: 'n8n-nodes-base.readWriteFile',
      typeVersion: 1,
      // 파일이 없을 때도 다음 노드가 돌아야 개수를 확인하고 실패시킬 수 있다.
      alwaysOutputData: true,
    },
    code('발화 파일 확인', await readCode('files-check')),
    code('결정 메시지 기간', await readCode('decision-window')),
    http(
      '결정 메시지 조회',
      {
        method: 'GET',
        url: `=${DISCORD_BASE}/channels/{{ $json.channelId }}/messages`,
        ...credential('discordBotApi'),
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'limit', value: '100' },
            { name: 'after', value: '={{ $json.afterId }}' },
          ],
        },
        // Discord 노드는 채널 기록 전체를 받거나 최신 100개만 받아서 HTTP 노드로 기간 시작부터 받는다(2026-10-11 사용자 결정).
        // 100개 미만이 오거나 가장 최근 메시지가 회의 종료를 넘으면 멈춘다. 한도에서 멈춘 경우는 다음 노드가 확인한다.
        options: {
          pagination: {
            pagination: {
              paginationMode: 'updateAParameterInEachRequest',
              parameters: { parameters: [{ type: 'qs', name: 'after', value: `={{ ${NEWEST_ID} }}` }] },
              paginationCompleteWhen: 'other',
              completeExpression:
                `={{ !Array.isArray($response.body) || $response.body.length < 100 || ((id, end) => id.length > end.length || (id.length === end.length && id > end))(${NEWEST_ID}, ${PERIOD}.endId) }}`,
              limitPagesFetched: true,
              maxRequests: `={{ ${PERIOD}.maxRequests }}`,
            },
          },
        },
      },
      // 받은 메시지가 없어도 다음 노드가 돌아 알림을 보내게 한다. 조회 실패는 3번까지 다시 시도한 뒤 실행을 실패시킨다.
      { alwaysOutputData: true, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    ),
    code('결정 메시지 고르기', await readCode('decision-pick')),
    http(
      '음성 인식',
      {
        method: 'POST',
        url: `${openaiBase}/audio/transcriptions`,
        ...credential('openAiApi'),
        sendBody: true,
        contentType: 'multipart-form-data',
        bodyParameters: {
          parameters: [
            { parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' },
            { name: 'model', value: 'gpt-4o-transcribe' },
            { name: 'language', value: 'ko' },
            { name: 'response_format', value: 'json' },
            { name: 'prompt', value: `={{ ${meeting}.prompt }}` },
          ],
        },
        options: { batching: { batch: { batchSize: 5, batchInterval: 500 } }, timeout: 120000 },
      },
      // 노드 전체를 다시 시도하므로 발화 하나만 실패해도 회의 전체 발화를 다시 보낸다(2026-10-11 사용자 결정).
      { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    ),
    code('녹취 만들기', await readCode('transcript')),
    {
      // 두 갈래가 모두 끝날 때까지 기다렸다가 빈 항목 하나로 넘긴다. 알림 만들기가 두 갈래 결과를 노드 이름으로 읽는다.
      parameters: { mode: 'chooseBranch', chooseBranchMode: 'waitForAll', output: 'empty' },
      name: '녹취·결정 합치기',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
    },
    code('알림 만들기', await readCode('notice')),
    {
      // 녹취와 결정 메시지 원문은 보내지 않는다. Discord 노드에는 멘션을 끄는 옵션이 없어서, 알림 문구를 코드가 만든 회의 ID와 숫자로만 채운다.
      parameters: {
        authentication: 'botToken',
        resource: 'message',
        operation: 'send',
        guildId: { __rl: true, mode: 'id', value: '={{ $json.guildId }}' },
        sendTo: 'channel',
        channelId: { __rl: true, mode: 'id', value: '={{ $json.textChannelId }}' },
        content: '={{ $json.notice }}',
        options: {},
      },
      name: '회의 채널 알림',
      type: 'n8n-nodes-base.discord',
      typeVersion: 2,
    },
  ]);

  return {
    id: 'MeetingTranscribe',
    name: '회의 녹취',
    active: false,
    nodes,
    connections: connect(EDGES),
    settings: { executionOrder: 'v1', saveManualExecutions: true },
    pinData: {},
  };
}

export const serialize = (workflow) => `${JSON.stringify(workflow, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--check');
  if (unknown.length > 0) throw new Error(`모르는 인자: ${unknown.join(' ')}`);

  const text = serialize(await buildWorkflow());
  const relative = path.relative(ROOT, WORKFLOW_FILE);
  if (args.includes('--check')) {
    const current = await readFile(WORKFLOW_FILE, 'utf8').catch(() => '');
    if (current !== text) {
      console.error(`${relative}가 코드와 다릅니다. node scripts/build-workflow.js로 다시 만드세요.`);
      process.exit(1);
    }
    console.log(`${relative}가 코드와 같습니다`);
  } else {
    await writeFile(WORKFLOW_FILE, text);
    console.log(`${relative} 작성`);
  }
}
