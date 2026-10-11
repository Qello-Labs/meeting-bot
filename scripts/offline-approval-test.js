// 녹음 봇의 승인·거절 버튼 처리를 Discord와 n8n 없이 확인한다. 상호작용과 n8n 응답은 가짜 객체로 흉내 내고 서명은 지어낸 값이다.
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { handleApprovalButton, parseApprovalId, resumeUrlOf } from '../src/approval.js';

const SIGNATURE = 'ab'.repeat(32);
const WEBHOOK = 'http://n8n:5678/webhook/meeting-ended';

// 버튼 ID: 이 봇의 승인·거절 버튼만 읽는다.
assert.deepEqual(parseApprovalId(`mb:approve:4821:${SIGNATURE}`), { action: 'approve', executionId: '4821', signature: SIGNATURE });
assert.deepEqual(parseApprovalId(`mb:reject:9999999:${SIGNATURE}`), { action: 'reject', executionId: '9999999', signature: SIGNATURE });
for (const id of [
  `mb:edit:4821:${SIGNATURE}`, // 없는 동작
  `mb:approve:4821:${SIGNATURE.slice(1)}`, // 서명 63자
  `mb:approve:4821:${SIGNATURE.toUpperCase()}`, // n8n 서명은 소문자 hex
  `mb:approve:48a1:${SIGNATURE}`, // 실행 ID가 숫자가 아님
  `mb:approve:4821:${SIGNATURE}:x`, // 뒤에 더 붙음
  `mb:approve:../4821:${SIGNATURE}`, // 경로 조작
  `other:approve:4821:${SIGNATURE}`, // 다른 봇의 버튼
  '',
  undefined,
]) {
  assert.equal(parseApprovalId(id), null, String(id));
}

// 재개 주소: 회의 종료 Webhook과 같은 n8n(compose 내부 주소)의 webhook-waiting 경로다.
assert.equal(
  resumeUrlOf(WEBHOOK, { executionId: '4821', signature: SIGNATURE }),
  `http://n8n:5678/webhook-waiting/4821?signature=${SIGNATURE}`,
);

/** discord.js 상호작용 흉내. 호출 순서를 log에 남긴다. */
function fakeInteraction({ customId = `mb:approve:4821:${SIGNATURE}`, button = true, user = {} } = {}) {
  const log = [];
  return {
    log,
    customId,
    user: { bot: false, username: 'doyeon', globalName: '도연', id: '500000000000000001', ...user },
    deferred: false,
    isButton: () => button,
    async deferReply(options) {
      log.push(['defer', options]);
      this.deferred = true;
    },
    async editReply(content) {
      log.push(['reply', content]);
    },
  };
}

/** n8n 흉내. 받은 요청을 남기고 정한 상태 코드로 답한다. */
function fakeN8n(status = 200, { fail } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (fail) throw fail;
    return { ok: status >= 200 && status < 300, status };
  };
  return { calls, fetch };
}

async function click(options = {}, n8n = fakeN8n(), webhookUrl = WEBHOOK) {
  const interaction = fakeInteraction(options);
  const handled = await handleApprovalButton(interaction, { webhookUrl, fetch: n8n.fetch });
  return { handled, interaction, n8n };
}
const replyOf = (interaction) => interaction.log.filter(([kind]) => kind === 'reply').map(([, text]) => text);

// 승인·거절: 먼저 지연 응답(누른 사람에게만)하고 n8n 재개 주소로 결정과 표시 이름을 보낸다. Discord ID는 보내지 않는다.
for (const [action, label] of [['approve', '승인'], ['reject', '거절']]) {
  const n8n = fakeN8n(200);
  const { handled, interaction } = await click({ customId: `mb:${action}:4821:${SIGNATURE}` }, n8n);
  assert.equal(handled, true);
  assert.deepEqual(interaction.log[0], ['defer', { flags: MessageFlags.Ephemeral }], 'n8n을 부르기 전에 응답한다');
  assert.equal(n8n.calls.length, 1);
  assert.equal(n8n.calls[0].url, `http://n8n:5678/webhook-waiting/4821?signature=${SIGNATURE}`);
  assert.equal(n8n.calls[0].init.method, 'POST');
  assert.equal(n8n.calls[0].init.headers['content-type'], 'application/json');
  assert.ok(n8n.calls[0].init.signal instanceof AbortSignal, '응답이 없으면 시간 제한으로 끊는다');
  assert.deepEqual(n8n.calls[0].body, { decision: action, by: '도연' });
  assert.ok(!n8n.calls[0].init.body.includes('500000000000000001'), 'Discord ID를 보내지 않는다');
  assert.deepEqual(replyOf(interaction), [`${label}했습니다. 회의 채널의 초안 메시지에 결과가 표시됩니다.`]);
}

// 전역 표시 이름이 없으면 사용자 이름을 보낸다.
{
  const n8n = fakeN8n(200);
  await click({ user: { globalName: null } }, n8n);
  assert.equal(n8n.calls[0].body.by, 'doyeon');
}

// 틀린 서명(401), 이미 끝난 실행(409), 경로 없음(404)은 실행을 바꾸지 못하고, 누른 사람에게 안내한다.
for (const status of [401, 404, 409]) {
  const { interaction } = await click({}, fakeN8n(status));
  assert.deepEqual(replyOf(interaction), ['이미 처리됐거나 유효하지 않은 버튼입니다.'], `HTTP ${status}`);
}

// n8n 오류와 연결 실패는 다시 누르라고 안내한다. 안내에 재개 주소(서명)를 넣지 않는다.
{
  const { interaction } = await click({}, fakeN8n(500));
  assert.deepEqual(replyOf(interaction), ['n8n이 결정을 받지 못했습니다(HTTP 500). 잠시 뒤 다시 눌러 주세요.']);
  const timeout = Object.assign(new Error(`connect to http://n8n:5678/webhook-waiting/4821?signature=${SIGNATURE}`), { name: 'TimeoutError' });
  const failed = await click({}, fakeN8n(200, { fail: timeout }));
  assert.deepEqual(replyOf(failed.interaction), ['n8n에 연결하지 못했습니다(TimeoutError). 잠시 뒤 다시 눌러 주세요.']);
  assert.ok(!replyOf(failed.interaction)[0].includes(SIGNATURE));
}

// n8n 주소가 없으면 부르지 않고 안내한다.
{
  const n8n = fakeN8n(200);
  const { interaction } = await click({}, n8n, '');
  assert.equal(n8n.calls.length, 0);
  assert.deepEqual(replyOf(interaction), ['MEETING_ENDED_WEBHOOK_URL이 없어 n8n에 결정을 보내지 못했습니다.']);
}

// 봇 계정의 클릭은 응답도 n8n 호출도 하지 않는다.
{
  const n8n = fakeN8n(200);
  const { handled, interaction } = await click({ user: { bot: true } }, n8n);
  assert.equal(handled, true);
  assert.deepEqual(interaction.log, []);
  assert.equal(n8n.calls.length, 0);
}

// 버튼이 아니거나 다른 버튼이면 처리하지 않는다(슬래시 명령 처리로 넘어간다).
for (const options of [{ button: false }, { customId: 'other-bot:approve' }, { customId: `mb:edit:4821:${SIGNATURE}` }]) {
  const n8n = fakeN8n(200);
  const { handled, interaction } = await click(options, n8n);
  assert.equal(handled, false, JSON.stringify(options));
  assert.deepEqual(interaction.log, []);
  assert.equal(n8n.calls.length, 0);
}

console.log('승인 버튼 오프라인 테스트 통과');
