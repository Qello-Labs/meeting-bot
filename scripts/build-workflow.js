// workflows/src의 Code 노드 코드로 n8n에 가져올 워크플로 JSON을 만든다. 워크플로의 원본은 이 스크립트와 workflows/src다.
//   node scripts/build-workflow.js           workflows/meeting-transcribe.json, workflows/meeting-transcribe-failure.json을 다시 쓴다
//   node scripts/build-workflow.js --check   커밋된 JSON이 코드와 같은지만 확인한다
// 자격 증명은 넣지 않는다. n8n 화면에서 등록하고 노드마다 고른다(workflows/README.md).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORKFLOW_FILE = path.join(ROOT, 'workflows/meeting-transcribe.json');
export const FAILURE_WORKFLOW_FILE = path.join(ROOT, 'workflows/meeting-transcribe-failure.json');
const FAILURE_WORKFLOW_ID = 'MeetingFailAlert';

const OPENAI_BASE = 'https://api.openai.com/v1';
const DISCORD_BASE = 'https://discord.com/api/v10';
// 팀 문서는 Atlassian Confluence에 있다(2026-10-17, 결정 기록 2026-10-17-gh31-confluence-minutes).
// 클래식 API 토큰(Basic Auth)은 사이트 주소로 부른다. 사이트 주소와 스페이스·페이지 ID는 코드 상수로 둔다.
const ATLASSIAN_SITE = 'https://tkv123.atlassian.net';
const CONFLUENCE_BASE = `${ATLASSIAN_SITE}/wiki/api/v2`;
const CONFLUENCE_SPACE = { id: '98307', key: 'SCRUM' }; // Qello 스페이스

// 회의록 템플릿 페이지(설계 5절 E). 실행할 때마다 읽으므로 팀이 Confluence에서 고치면 배포 없이 반영된다.
const TEMPLATE_PAGE = '294915'; // `회의록 템플릿`

// 승인된 회의록을 쓰는 곳(설계 5절 H). Team Docs > `회의록` 페이지 바로 아래에 쓴다. 비어 있으면 쓰기 준비 노드가 실패해 아무것도 쓰지 않는다.
const MINUTES_PARENT_PAGE = '98458'; // `회의록`

// 승인된 회의록의 액션 아이템을 Jira 이슈로 만든다(#32, 결정 기록 2026-10-17-gh32-jira-action-items). Confluence와 같은 사이트·자격 증명이다.
// Qello 프로젝트(SCRUM)의 `작업` 이슈 유형, 보드 1의 스프린트, 스프린트 필드(customfield_10020)는 코드 상수다.
const JIRA = { site: ATLASSIAN_SITE, projectKey: 'SCRUM', boardId: '1', issueTypeId: '10003', sprintField: 'customfield_10020' };

// 실패 알림(설계 5절 "실패 알림"). 실패한 실행을 n8n 컨테이너 안에서 n8n API로 읽는다. 회의 채널을 모르면 실제 회의 채널로 보낸다
// (2026-10-11 사용자 결정, 채널 ID는 코드 상수).
const N8N_API_BASE = 'http://127.0.0.1:5678/api/v1';
const MEETING_CHANNEL = '1547149294015094817';

// Discord 메시지 ID는 길이가 다를 수 있어 길이부터 비교한다. 받은 메시지 중 가장 큰 ID를 다음 after로 쓴다.
// n8n 2.42.6은 첫 요청 전에도 이 식을 계산하고(그때는 응답이 없다), 오류 응답은 본문이 배열이 아니다.
// 식이 깨지면 n8n이 페이지 넘김을 멈추고 오류 본문을 출력으로 내므로(E2E에서 확인) 배열이 아닐 때도 계산되게 하고,
// 그때는 기간 시작 ID를 쓴다. 오류 응답은 완료로 보고 n8n이 붙이는 상태 코드 검사가 오류를 올린다.
const PERIOD = "$('결정 메시지 기간').first().json";
const NEWEST_ID = `(Array.isArray($response.body) ? $response.body.map((m) => m.id).reduce((a, b) => (b.length > a.length || (b.length === a.length && b > a) ? b : a), '0') : ${PERIOD}.afterId)`;

// Discord는 전용 노드로 불러 화면에서 아이콘으로 구분한다. 음성 인식은 OpenAI 전용 노드가 whisper-1 고정이고 프롬프트를 받지 않아
// HTTP Request 노드로 gpt-4o-transcribe를 부른다(2026-10-11 사용자 결정).
const CREDENTIAL_TYPES = { 'n8n-nodes-base.discord': 'discordBotApi' };
// Confluence는 n8n 전용 노드가 없어 HTTP Request 노드에 일반 Basic Auth(Atlassian 계정 이메일 + API 토큰)를 쓴다.

/** 노드에서 고를 자격 증명 종류. 테스트(scripts/e2e-n8n.js)도 이 함수로 테스트 자격 증명을 붙인다. */
export const credentialTypeOf = (node) =>
  node.parameters.nodeCredentialType ?? node.parameters.genericAuthType ?? CREDENTIAL_TYPES[node.type];

const readCode = (name) => readFile(path.join(ROOT, 'workflows/src', `${name}.js`), 'utf8');
// 근거 검증 규칙(shared/draft-rules.js)을 노드 코드 앞에 붙인다. 초안 검증과 수정 검증이 같은 규칙을 쓴다.
// 여러 Code 노드가 같이 쓰는 코드(workflows/src/shared)와 상수를 노드 코드 앞에 붙인다. n8n Code 노드는 다른 파일을 가져올 수 없다.
const withShared = async (name, shared, prefix = '') =>
  [prefix, ...(await Promise.all(shared.map((s) => readCode(`shared/${s}`)))), await readCode(name)].filter(Boolean).join('\n');
const withDraftRules = (name) => withShared(name, ['draft-rules']);

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
  '템플릿 읽기': [2160, 0],
  '초안 요청 만들기': [2400, 0],
  '초안 작성': [2640, 0],
  '초안 검증': [2880, 0],
  '알림 만들기': [3120, 0],
  '회의 채널 알림': [3360, 0],
  '초안 메시지 만들기': [3600, 0],
  '긴 초안 확인': [3840, 0],
  '초안 보내기(첨부)': [4080, -120],
  '초안 보내기': [4080, 120],
  '승인 기다리기': [4320, 0],
  '결정 읽기': [4560, 0],
  '기한 초과 확인': [4800, 0],
  '결정 응답': [5040, 120],
  '승인·거절 확인': [5280, 120],
  '수정 확인': [5520, 240],
  '수정 반영 만들기': [5760, 240],
  '수정 반영': [6000, 240],
  '결과 표시': [5520, -120],
  // 결과 표시 뒤 두 갈래: 위가 Confluence 쓰기(승인일 때만), 아래가 기한 초과 알림(기한 초과일 때만)
  '쓰기 준비': [5760, -240],
  '기한 초과 알림 만들기': [5760, -60],
  '기한 초과 알림': [6000, -60],
  '같은 제목 찾기': [6000, -240],
  '쓰기 판단': [6240, -240],
  '같은 이름 확인': [6480, -240],
  '액션 아이템 고르기': [6720, -180],
  '같은 회의 이슈 찾기': [6960, -180],
  '스프린트 읽기': [7200, -180],
  '이슈 요청 만들기': [7440, -180],
  '새 이슈 확인': [7680, -180],
  'Jira 이슈 만들기': [7920, -120],
  '회의록에 이슈 채우기': [8160, -180],
  '페이지 만들기': [8400, -180],
  '페이지 다시 읽기': [8640, -180],
  '내용 대조': [8880, -180],
  '쓰기 결과 표시': [9120, -240],
};

// Jira 이슈 만들기와 그 뒤 노드. 여기서 실패하면 Jira에 이슈가, Confluence에 페이지가 생겼을 수 있다(둘 다 재시도하지 않는다).
const AFTER_WRITE = ['Jira 이슈 만들기', '회의록에 이슈 채우기', '페이지 만들기', '페이지 다시 읽기', '내용 대조', '쓰기 결과 표시'];

const FAILURE_POSITIONS = {
  '실패': [0, 0],
  '실행 읽기': [240, 0],
  '알림 만들기': [480, 0],
  '실패 알림': [720, 0],
  '초안 메시지 확인': [960, 0],
  '초안 메시지 고치기': [1200, -120],
};

const FAILURE_EDGES = [
  ['실패', '실행 읽기'],
  ['실행 읽기', '알림 만들기'],
  ['알림 만들기', '실패 알림'],
  // 알림을 먼저 보내서 초안 메시지 고치기가 실패해도 알림은 간다. 메시지 ID를 모르면(승인 버튼이 눌리기 전 실패) 고치지 않는다.
  ['실패 알림', '초안 메시지 확인'],
  ['초안 메시지 확인', '초안 메시지 고치기', 0, 0],
];

// [보내는 노드, 받는 노드, 받는 입력 번호, 보내는 출력 번호]. If 노드는 출력 0이 참, 1이 거짓이다.
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
  ['녹취·결정 합치기', '템플릿 읽기'],
  ['템플릿 읽기', '초안 요청 만들기'],
  ['초안 요청 만들기', '초안 작성'],
  ['초안 작성', '초안 검증'],
  ['초안 검증', '알림 만들기'],
  ['알림 만들기', '회의 채널 알림'],
  ['회의 채널 알림', '초안 메시지 만들기'],
  ['초안 메시지 만들기', '긴 초안 확인'],
  ['긴 초안 확인', '초안 보내기(첨부)', 0, 0],
  ['긴 초안 확인', '초안 보내기', 0, 1],
  ['초안 보내기(첨부)', '승인 기다리기'],
  ['초안 보내기', '승인 기다리기'],
  ['승인 기다리기', '결정 읽기'],
  // 기한 초과는 응답할 요청이 없어 바로 결과 표시로 간다. 그 밖에는 녹음 봇에 먼저 응답한다.
  ['결정 읽기', '기한 초과 확인'],
  ['기한 초과 확인', '결과 표시', 0, 0],
  ['기한 초과 확인', '결정 응답', 0, 1],
  ['결정 응답', '승인·거절 확인'],
  ['승인·거절 확인', '결과 표시', 0, 0],
  ['승인·거절 확인', '수정 확인', 0, 1],
  // 고친 초안이 통과하면 같은 메시지를 고친 뒤, 이미 바뀐 판이거나 검증에 실패하면 그대로 다시 기다린다.
  ['수정 확인', '수정 반영 만들기', 0, 0],
  ['수정 확인', '승인 기다리기', 0, 1],
  ['수정 반영 만들기', '수정 반영'],
  ['수정 반영', '승인 기다리기'],
  ['결과 표시', '쓰기 준비'],
  ['결과 표시', '기한 초과 알림 만들기'],
  ['쓰기 준비', '같은 제목 찾기'],
  ['같은 제목 찾기', '쓰기 판단'],
  ['쓰기 판단', '같은 이름 확인'],
  ['같은 이름 확인', '쓰기 결과 표시', 0, 0],
  ['같은 이름 확인', '액션 아이템 고르기', 0, 1],
  ['액션 아이템 고르기', '같은 회의 이슈 찾기'],
  ['같은 회의 이슈 찾기', '스프린트 읽기'],
  ['스프린트 읽기', '이슈 요청 만들기'],
  ['이슈 요청 만들기', '새 이슈 확인'],
  // 만들 이슈가 있으면 만든 뒤, 없으면 바로 회의록에 키를 채운다.
  ['새 이슈 확인', 'Jira 이슈 만들기', 0, 0],
  ['새 이슈 확인', '회의록에 이슈 채우기', 0, 1],
  ['Jira 이슈 만들기', '회의록에 이슈 채우기'],
  ['회의록에 이슈 채우기', '페이지 만들기'],
  ['페이지 만들기', '페이지 다시 읽기'],
  ['페이지 다시 읽기', '내용 대조'],
  ['내용 대조', '쓰기 결과 표시'],
  ['기한 초과 알림 만들기', '기한 초과 알림'],
];

// 승인 기다리기 기한(설계 5절 G: 3일). E2E는 짧게 바꿔 기한 초과를 확인한다.
const APPROVAL_WAIT = { amount: 3, unit: 'days' };

function place(nodes, positions = POSITIONS) {
  return nodes.map((node) => {
    if (!positions[node.name]) throw new Error(`${node.name}의 화면 위치가 없습니다`);
    return { ...node, position: positions[node.name] };
  });
}

function connect(edges) {
  const connections = {};
  for (const [from, to, index = 0, output = 0] of edges) {
    const outputs = (connections[from] ??= { main: [[]] }).main;
    while (outputs.length <= output) outputs.push([]);
    outputs[output].push({ node: to, type: 'main', index });
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
const basicAuth = { authentication: 'genericCredentialType', genericAuthType: 'httpBasicAuth' };

/** 참이면 출력 0, 거짓이면 출력 1로 보내는 If 노드. 조건은 불리언 식 하나다. */
const ifNode = (name, expression, id) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
      conditions: [{ id, leftValue: `={{ ${expression} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  },
  name,
  type: 'n8n-nodes-base.if',
  typeVersion: 2.3,
});

export async function buildWorkflow({
  openaiBase = OPENAI_BASE,
  confluenceBase = CONFLUENCE_BASE,
  jiraBase = JIRA.site,
  approvalWait = APPROVAL_WAIT,
  minutesParentPage = MINUTES_PARENT_PAGE,
} = {}) {
  const confluence = `const CONFLUENCE = ${JSON.stringify({ site: ATLASSIAN_SITE, spaceId: CONFLUENCE_SPACE.id, spaceKey: CONFLUENCE_SPACE.key, parentPageId: minutesParentPage })};`;
  const jira = `const JIRA = ${JSON.stringify(JIRA)};`;
  const discordPatch = (name) => http(
    name,
    {
      method: 'PATCH',
      url: `=${DISCORD_BASE}/channels/{{ $json.textChannelId }}/messages/{{ $json.messageId }}`,
      ...credential('discordBotApi'),
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.body) }}',
    },
    // 같은 내용으로 고치는 것이라 다시 보내도 안전하다.
    { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
  );
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
      // 두 갈래가 모두 끝날 때까지 기다렸다가 빈 항목 하나로 넘긴다. 템플릿 읽기는 한 번만 돌고, 뒤 노드가 두 갈래 결과를 노드 이름으로 읽는다.
      parameters: { mode: 'chooseBranch', chooseBranchMode: 'waitForAll', output: 'empty' },
      name: '녹취·결정 합치기',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
    },
    http(
      '템플릿 읽기',
      {
        method: 'GET',
        url: `${confluenceBase}/pages/${TEMPLATE_PAGE}`,
        ...basicAuth,
        sendQuery: true,
        queryParameters: { parameters: [{ name: 'body-format', value: 'storage' }] },
      },
      // 읽기라 다시 보내도 안전하다. 3번 모두 실패하면 실행을 실패시킨다.
      { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    ),
    code('초안 요청 만들기', await withShared('draft-request', ['confluence-format'])),
    http(
      '초안 작성',
      {
        method: 'POST',
        // 음성 인식과 같은 OpenAI 자격 증명으로 Responses API를 부른다(2026-10-11 사용자 결정: 초안 모델을 OpenAI로).
        url: `${openaiBase}/responses`,
        ...credential('openAiApi'),
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.request) }}',
        // 응답이 몇 분 걸릴 수 있어 넉넉히 기다린다.
        options: { timeout: 600000 },
      },
      // 잘림·거절은 HTTP 200이라 재시도하지 않고 초안 검증이 실패시킨다. 재시도는 연결 오류와 5xx·429 같은 HTTP 오류에만 일어난다
      // (2026-10-11 사용자 결정: 3번 유지).
      { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    ),
    code('초안 검증', await withDraftRules('draft-check')),
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
    code('초안 메시지 만들기', await withShared('approval-message', ['approval-buttons'])),
    // 4,096자를 넘는 초안만 .md 파일을 붙여 보낸다. HTTP 노드 4.2의 multipart는 파일 필드를 비워 건너뛸 수 없어서(E2E에서 확인) 노드를 나눈다.
    ifNode('긴 초안 확인', '$json.attach', 'b7f3c0de-5a1e-4c2b-9d3f-1e2a3b4c5d6e'),
    // 초안에 녹취·채팅 문장이 들어가므로 멘션을 끌 수 있는 HTTP 노드로 보낸다(Discord 노드에는 allowed_mentions가 없다).
    // 다시 보내면 초안이 두 번 올라갈 수 있어 두 노드 모두 재시도하지 않는다.
    http('초안 보내기(첨부)', {
      method: 'POST',
      url: `=${DISCORD_BASE}/channels/{{ $json.textChannelId }}/messages`,
      ...credential('discordBotApi'),
      sendBody: true,
      contentType: 'multipart-form-data',
      bodyParameters: {
        parameters: [
          { name: 'payload_json', value: '={{ JSON.stringify($json.payload) }}' },
          { parameterType: 'formBinaryData', name: 'files[0]', inputDataFieldName: 'draft' },
        ],
      },
    }),
    http('초안 보내기', {
      method: 'POST',
      url: `=${DISCORD_BASE}/channels/{{ $json.textChannelId }}/messages`,
      ...credential('discordBotApi'),
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.payload) }}',
    }),
    {
      // 녹음 봇이 버튼 클릭을 재개 주소로 보낼 때까지 기다린다. 기한이 지나면 받은 항목을 그대로 넘긴다.
      // 녹음 봇에는 결정 응답 노드가 판단(받음, 이미 바뀜, 검증 실패)을 답한다. 다시 기다릴 때마다 기한이 새로 시작된다.
      parameters: {
        resume: 'webhook',
        httpMethod: 'POST',
        responseMode: 'responseNode',
        limitWaitTime: true,
        limitType: 'afterTimeInterval',
        resumeAmount: approvalWait.amount,
        resumeUnit: approvalWait.unit,
        options: {},
      },
      name: '승인 기다리기',
      type: 'n8n-nodes-base.wait',
      typeVersion: 1.1,
      webhookId: '0d0b6a7e-3c1f-4f55-9a3e-6f1c2b8e5d40',
    },
    code('결정 읽기', await withShared('approval-result', ['draft-rules', 'approval-buttons'])),
    ifNode('기한 초과 확인', "$json.outcome === 'timeout'", '5e0f7a3c-1d2b-4c8e-9f60-2a1b3c4d5e01'),
    {
      // 녹음 봇의 재개 요청에 판단을 JSON으로 답한다(n8n 2.42.6 실험). 승인은 Confluence 쓰기를 기다리지 않고 먼저 답한다.
      parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json.response) }}', options: {} },
      name: '결정 응답',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.5,
    },
    ifNode('승인·거절 확인', "['approve', 'reject'].includes($json.outcome)", '5e0f7a3c-1d2b-4c8e-9f60-2a1b3c4d5e02'),
    ifNode('수정 확인', "$json.outcome === 'edited'", '5e0f7a3c-1d2b-4c8e-9f60-2a1b3c4d5e03'),
    code('수정 반영 만들기', await withShared('approval-edit', ['approval-buttons'])),
    discordPatch('수정 반영'),
    discordPatch('결과 표시'),
    code('쓰기 준비', await withShared('minutes-prepare', ['confluence-format'], confluence)),
    http(
      '같은 제목 찾기',
      {
        method: 'GET',
        url: `${confluenceBase}/pages`,
        ...basicAuth,
        sendQuery: true,
        // 상태를 지정하지 않으면 current와 archived 페이지를 찾는다. 제목은 한 스페이스 안에서 겹칠 수 없다.
        queryParameters: {
          parameters: [
            { name: 'space-id', value: CONFLUENCE_SPACE.id },
            { name: 'title', value: '={{ $json.name }}' },
          ],
        },
      },
      // 읽기라 다시 보내도 안전하다. 3번 모두 실패하면 실행을 실패시킨다.
      { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    ),
    code('쓰기 판단', await readCode('minutes-dedupe')),
    ifNode('같은 이름 확인', '$json.duplicate', '5e0f7a3c-1d2b-4c8e-9f60-2a1b3c4d5e04'),
    code('액션 아이템 고르기', `${jira}\n${await readCode('jira-pick')}`),
    http(
      '같은 회의 이슈 찾기',
      {
        method: 'GET',
        url: `${jiraBase}/rest/api/3/search/jql`,
        ...basicAuth,
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'jql', value: '={{ $json.jql }}' },
            { name: 'fields', value: 'summary' },
            { name: 'maxResults', value: '100' },
          ],
        },
      },
      // 읽기라 다시 보내도 안전하다. 3번 모두 실패하면 이슈를 만들지 않고 실행을 실패시킨다.
      { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    ),
    http(
      '스프린트 읽기',
      {
        method: 'GET',
        url: `${jiraBase}/rest/agile/1.0/board/${JIRA.boardId}/sprint`,
        ...basicAuth,
        sendQuery: true,
        queryParameters: { parameters: [{ name: 'state', value: 'active,future' }, { name: 'maxResults', value: '50' }] },
      },
      { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    ),
    code('이슈 요청 만들기', `${jira}\n${await readCode('jira-request')}`),
    ifNode('새 이슈 확인', '$json.create', '5e0f7a3c-1d2b-4c8e-9f60-2a1b3c4d5e05'),
    // 이슈 만들기는 재시도하지 않는다. 응답을 못 받고 다시 보내면 같은 이슈가 두 개 생길 수 있다.
    // 다시 처리할 때는 같은 회의 레이블과 요약으로 이미 있는 이슈를 찾아 새로 만들지 않는다.
    http('Jira 이슈 만들기', {
      method: 'POST',
      url: `${jiraBase}/rest/api/3/issue`,
      ...basicAuth,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.request) }}',
    }),
    code('회의록에 이슈 채우기', await withShared('jira-fill', ['confluence-format'], jira)),
    // 쓰기 요청은 재시도하지 않는다. 응답을 못 받고 다시 보내면 같은 제목 오류로 실패하거나 페이지가 남을 수 있다(설계 5절 H).
    http('페이지 만들기', {
      method: 'POST',
      url: `${confluenceBase}/pages`,
      ...basicAuth,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.request) }}',
    }),
    http(
      '페이지 다시 읽기',
      {
        method: 'GET',
        url: `=${confluenceBase}/pages/{{ $json.id }}`,
        ...basicAuth,
        sendQuery: true,
        queryParameters: { parameters: [{ name: 'body-format', value: 'storage' }] },
      },
      { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    ),
    code('내용 대조', await withShared('minutes-verify', ['confluence-format'], confluence)),
    discordPatch('쓰기 결과 표시'),
    code('기한 초과 알림 만들기', await readCode('approval-timeout')),
    http(
      '기한 초과 알림',
      {
        method: 'POST',
        url: `=${DISCORD_BASE}/channels/{{ $json.textChannelId }}/messages`,
        ...credential('discordBotApi'),
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.body) }}',
      },
    ),
  ]);

  return {
    id: 'MeetingTranscribe',
    name: '회의 녹취',
    active: false,
    nodes,
    connections: connect(EDGES),
    // 실패하면 실패 알림 워크플로가 돈다. 실패 알림 워크플로도 Publish해야 실행된다(n8n 2.42.6).
    settings: { executionOrder: 'v1', saveManualExecutions: true, errorWorkflow: FAILURE_WORKFLOW_ID },
    pinData: {},
  };
}

/** 회의 녹취 워크플로가 실패하면 회의 채널에 알리는 워크플로(설계 5절 "실패 알림"). */
export async function buildFailureWorkflow({ fallbackChannelId = MEETING_CHANNEL } = {}) {
  const constants = [
    `const FALLBACK_CHANNEL_ID = ${JSON.stringify(fallbackChannelId)};`,
    `const NODE_TYPES = ${JSON.stringify(Object.fromEntries((await buildWorkflow()).nodes.map((n) => [n.name, n.type])))};`,
    `const AFTER_WRITE = ${JSON.stringify(AFTER_WRITE)};`,
  ].join('\n');
  const nodes = place([
    { parameters: {}, name: '실패', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1 },
    http(
      '실행 읽기',
      {
        method: 'GET',
        // customData는 includeData=true일 때만 온다(n8n 2.42.6 실험). 실행 데이터 전체가 이 워크플로 실행 기록에도 남는다(설계 6절).
        url: `=${N8N_API_BASE}/executions/{{ $json.execution.id }}`,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendQuery: true,
        queryParameters: { parameters: [{ name: 'includeData', value: 'true' }] },
      },
      // 읽기만 하므로 다시 보내도 안전하다. 끝내 실패하면 오류 항목을 넘겨 고정 채널로 알린다.
      { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: 'continueRegularOutput' },
    ),
    code('알림 만들기', `${constants}\n${await readCode('failure-notice')}`),
    // 다시 보내면 알림이 두 번 갈 수 있어 재시도하지 않는다(기한 초과 알림과 같음).
    http('실패 알림', {
      method: 'POST',
      url: `=${DISCORD_BASE}/channels/{{ $json.channelId }}/messages`,
      ...credential('discordBotApi'),
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.notice) }}',
    }),
    ifNode('초안 메시지 확인', "$('알림 만들기').first().json.draftEdit !== null", '0c5f4e2a-7d1b-4a39-8e6c-2f9b1d3a4c5e'),
    http(
      '초안 메시지 고치기',
      {
        method: 'PATCH',
        url: `=${DISCORD_BASE}/channels/{{ $('알림 만들기').first().json.channelId }}/messages/{{ $('알림 만들기').first().json.draftMessageId }}`,
        ...credential('discordBotApi'),
        sendBody: true,
        specifyBody: 'json',
        jsonBody: "={{ JSON.stringify($('알림 만들기').first().json.draftEdit) }}",
      },
      // 같은 내용으로 고치는 것이라 다시 보내도 안전하다.
      { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    ),
  ], FAILURE_POSITIONS);

  return {
    id: FAILURE_WORKFLOW_ID,
    name: '회의 녹취 실패 알림',
    active: false,
    nodes,
    connections: connect(FAILURE_EDGES),
    settings: { executionOrder: 'v1' },
    pinData: {},
  };
}

export const serialize = (workflow) => `${JSON.stringify(workflow, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--check');
  if (unknown.length > 0) throw new Error(`모르는 인자: ${unknown.join(' ')}`);

  let stale = false;
  for (const [file, build] of [[WORKFLOW_FILE, buildWorkflow], [FAILURE_WORKFLOW_FILE, buildFailureWorkflow]]) {
    const text = serialize(await build());
    const relative = path.relative(ROOT, file);
    if (args.includes('--check')) {
      const current = await readFile(file, 'utf8').catch(() => '');
      if (current !== text) {
        console.error(`${relative}가 코드와 다릅니다. node scripts/build-workflow.js로 다시 만드세요.`);
        stale = true;
      } else {
        console.log(`${relative}가 코드와 같습니다`);
      }
    } else {
      await writeFile(file, text);
      console.log(`${relative} 작성`);
    }
  }
  if (stale) process.exit(1);
}
