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

// Discord는 전용 노드로 불러 화면에서 아이콘으로 구분한다. 음성 인식은 OpenAI 전용 노드가 whisper-1 고정이고 프롬프트를 받지 않아
// HTTP Request 노드로 gpt-4o-transcribe를 부른다(2026-10-11 사용자 결정).
const CREDENTIAL_TYPES = { 'n8n-nodes-base.discord': 'discordBotApi' };

/** 노드에서 고를 자격 증명 종류. 테스트(scripts/e2e-n8n.js)도 이 함수로 테스트 자격 증명을 붙인다. */
export const credentialTypeOf = (node) => node.parameters.nodeCredentialType ?? CREDENTIAL_TYPES[node.type];

const readCode = (name) => readFile(path.join(ROOT, 'workflows/src', `${name}.js`), 'utf8');

/** 노드를 왼쪽에서 오른쪽으로 한 줄로 놓는다. 화면 배치는 차이 검사에서 비교하지 않는다. */
function layout(nodes) {
  return nodes.map((node, i) => ({ ...node, position: [i * 240, 0] }));
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

/** 노드 이름 순서대로 한 줄로 잇는다. */
function chain(names) {
  const connections = {};
  for (let i = 0; i < names.length - 1; i += 1) {
    connections[names[i]] = { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] };
  }
  return connections;
}

export async function buildWorkflow({ openaiBase = OPENAI_BASE } = {}) {
  const meeting = "$('녹음 정보 확인').first().json";
  const nodes = layout([
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
      // 녹취 원문은 보내지 않는다. Discord 노드에는 멘션을 끄는 옵션이 없어서, 알림 문구를 코드가 만든 회의 ID와 숫자로만 채운다.
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
    connections: chain(nodes.map((node) => node.name)),
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
