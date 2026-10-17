// 녹음 봇의 승인·수정·거절 버튼과 수정 모달 처리를 Discord와 n8n 없이 확인한다.
// 상호작용과 n8n 응답은 가짜 객체로 흉내 내고 서명은 지어낸 값이다.
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { editModal, handleApprovalButton, parseApprovalId, resumeUrlOf } from '../src/approval.js';

const SIGNATURE = 'ab'.repeat(32);
const WEBHOOK = 'http://n8n:5678/webhook/meeting-ended';
const idOf = (action, rev = 1, execution = '4821') => `mb:${action}:${execution}:${rev}:${SIGNATURE}`;
const DRAFT = '| 필드 | 값 |\n| ---| --- |\n| 일시 | 2026-10-14 |';

// 버튼 ID: 이 봇의 승인·수정·거절 버튼만 읽는다. 판 번호는 숫자로 읽는다.
assert.deepEqual(parseApprovalId(idOf('approve')), { action: 'approve', executionId: '4821', rev: 1, signature: SIGNATURE });
assert.deepEqual(parseApprovalId(idOf('reject', 12, '9999999')), { action: 'reject', executionId: '9999999', rev: 12, signature: SIGNATURE });
assert.deepEqual(parseApprovalId(idOf('edit', 3)), { action: 'edit', executionId: '4821', rev: 3, signature: SIGNATURE });
for (const id of [
  `mb:delete:4821:1:${SIGNATURE}`, // 없는 동작
  `mb:approve:4821:${SIGNATURE}`, // 판 번호 없음(8단계 형식)
  `mb:approve:4821:x:${SIGNATURE}`, // 판 번호가 숫자가 아님
  `mb:approve:4821:1:${SIGNATURE.slice(1)}`, // 서명 63자
  `mb:approve:4821:1:${SIGNATURE.toUpperCase()}`, // n8n 서명은 소문자 hex
  `mb:approve:48a1:1:${SIGNATURE}`, // 실행 ID가 숫자가 아님
  `mb:approve:4821:1:${SIGNATURE}:x`, // 뒤에 더 붙음
  `mb:approve:../4821:1:${SIGNATURE}`, // 경로 조작
  `other:approve:4821:1:${SIGNATURE}`, // 다른 봇의 버튼
  '',
  undefined,
]) {
  assert.equal(parseApprovalId(id), null, String(id));
}

// 재개 주소: 회의 종료 Webhook과 같은 n8n(compose 내부 주소)의 webhook-waiting 경로다. 판 번호는 주소에 넣지 않는다.
assert.equal(resumeUrlOf(WEBHOOK, parseApprovalId(idOf('approve', 7))), `http://n8n:5678/webhook-waiting/4821?signature=${SIGNATURE}`);

// 수정 모달: 모달 ID는 버튼 ID와 같고, 텍스트 입력을 초안으로 채우며 한도는 4,000자다.
assert.deepEqual(editModal(idOf('edit'), DRAFT), {
  custom_id: idOf('edit'),
  title: '회의록 초안 수정',
  components: [{
    type: 1,
    components: [{
      type: 4, custom_id: 'draft', style: 2, label: '근거 형식을 지켜 고쳐 주세요', value: DRAFT, min_length: 1, max_length: 4000, required: true,
    }],
  }],
});

/** discord.js 상호작용 흉내. 호출 순서를 log에 남긴다. */
function fakeInteraction({ customId = idOf('approve'), kind = 'button', user = {}, embed = DRAFT, submitted } = {}) {
  const log = [];
  return {
    log,
    customId,
    user: { bot: false, username: 'doyeon', globalName: '도연', id: '500000000000000001', ...user },
    deferred: false,
    message: { embeds: embed === null ? [] : [{ description: embed }] },
    fields: { getTextInputValue: (name) => (name === 'draft' ? submitted : undefined) },
    isButton: () => kind === 'button',
    isModalSubmit: () => kind === 'modal',
    async deferReply(options) {
      log.push(['defer', options]);
      this.deferred = true;
    },
    async reply(options) {
      log.push(['reply', options]);
    },
    async showModal(modal) {
      log.push(['modal', modal]);
    },
    async editReply(content) {
      log.push(['edit', content]);
    },
  };
}

/** n8n 흉내. 받은 요청을 남기고 정한 상태 코드와 응답(결정 응답 노드의 JSON)으로 답한다. */
function fakeN8n(status = 200, answer = { result: 'accepted' }, { fail } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (fail) throw fail;
    return { ok: status >= 200 && status < 300, status, json: async () => answer };
  };
  return { calls, fetch };
}

async function act(options = {}, n8n = fakeN8n(), webhookUrl = WEBHOOK) {
  const interaction = fakeInteraction(options);
  const handled = await handleApprovalButton(interaction, { webhookUrl, fetch: n8n.fetch });
  return { handled, interaction, n8n };
}
const editsOf = (interaction) => interaction.log.filter(([kind]) => kind === 'edit').map(([, text]) => text);

// 승인·거절: 먼저 지연 응답(누른 사람에게만)하고 n8n 재개 주소로 결정, 판 번호, 표시 이름을 보낸다. Discord ID는 보내지 않는다.
for (const [action, label] of [['approve', '승인'], ['reject', '거절']]) {
  const n8n = fakeN8n(200, { result: 'accepted', decision: action });
  const { handled, interaction } = await act({ customId: idOf(action, 2) }, n8n);
  assert.equal(handled, true);
  assert.deepEqual(interaction.log[0], ['defer', { flags: MessageFlags.Ephemeral }], 'n8n을 부르기 전에 응답한다');
  assert.equal(n8n.calls.length, 1);
  assert.equal(n8n.calls[0].url, `http://n8n:5678/webhook-waiting/4821?signature=${SIGNATURE}`);
  assert.equal(n8n.calls[0].init.method, 'POST');
  assert.equal(n8n.calls[0].init.headers['content-type'], 'application/json');
  assert.ok(n8n.calls[0].init.signal instanceof AbortSignal, '응답이 없으면 시간 제한으로 끊는다');
  assert.deepEqual(n8n.calls[0].body, { decision: action, rev: 2, by: '도연' });
  assert.ok(!n8n.calls[0].init.body.includes('500000000000000001'), 'Discord ID를 보내지 않는다');
  assert.deepEqual(editsOf(interaction), [`${label}했습니다. 회의 채널의 초안 메시지에 결과가 표시됩니다.`]);
}

// 전역 표시 이름이 없으면 사용자 이름을 보낸다.
{
  const n8n = fakeN8n();
  await act({ user: { globalName: null } }, n8n);
  assert.equal(n8n.calls[0].body.by, 'doyeon');
}

// 수정 버튼: n8n을 부르지 않고 3초 안에 바로 모달을 연다. 모달은 초안 메시지의 embed 본문으로 채운다.
{
  const n8n = fakeN8n();
  const { handled, interaction } = await act({ customId: idOf('edit', 2) }, n8n);
  assert.equal(handled, true);
  assert.deepEqual(interaction.log, [['modal', editModal(idOf('edit', 2), DRAFT)]]);
  assert.equal(n8n.calls.length, 0);
}

// embed가 없거나 4,000자를 넘으면 모달을 열지 않고 안내한다(n8n은 이런 초안에 수정 버튼을 달지 않는다).
for (const embed of [null, '가'.repeat(4001)]) {
  const n8n = fakeN8n();
  const { interaction } = await act({ customId: idOf('edit'), embed }, n8n);
  assert.deepEqual(interaction.log, [['reply', { content: '이 초안은 모달로 고칠 수 없습니다. 승인한 뒤 Confluence에서 고쳐 주세요.', flags: MessageFlags.Ephemeral }]]);
  assert.equal(n8n.calls.length, 0);
}

// 수정 모달 제출: 고친 본문과 판 번호를 n8n에 보낸다. 판단에 따라 안내한다.
{
  const n8n = fakeN8n(200, { result: 'accepted', decision: 'edit' });
  const { handled, interaction } = await act({ customId: idOf('edit', 2), kind: 'modal', submitted: `${DRAFT}\n고침` }, n8n);
  assert.equal(handled, true);
  assert.deepEqual(interaction.log[0], ['defer', { flags: MessageFlags.Ephemeral }]);
  assert.deepEqual(n8n.calls[0].body, { decision: 'edit', rev: 2, by: '도연', draft: `${DRAFT}\n고침` });
  assert.deepEqual(editsOf(interaction), ['수정했습니다. 회의 채널의 초안 메시지에 결과가 표시됩니다.']);
}

// n8n 판단: 이미 바뀜, 검증 실패(오류 종류별 개수), 알 수 없는 응답.
{
  const stale = await act({}, fakeN8n(200, { result: 'stale', rev: 3 }));
  assert.deepEqual(editsOf(stale.interaction), ['그 사이 초안이 바뀌었습니다. 회의 채널의 최신 초안 메시지에서 다시 눌러 주세요.']);
  const invalid = await act(
    { customId: idOf('edit'), kind: 'modal', submitted: DRAFT },
    fakeN8n(200, { result: 'invalid', errorCounts: { '녹취에 없는 시각': 1, 자리표시자: 2 } }),
  );
  assert.deepEqual(editsOf(invalid.interaction), ['고친 초안이 근거 검증을 통과하지 못해 반영하지 않았습니다(녹취에 없는 시각 1개, 자리표시자 2개). 고치기 전 초안이 그대로 있습니다.']);
  const odd = await act({}, fakeN8n(200, null));
  assert.deepEqual(editsOf(odd.interaction), ['n8n이 알 수 없는 응답을 보냈습니다. 회의 채널의 초안 메시지를 확인해 주세요.']);
}

// 틀린 서명(401), 이미 끝난 실행(409), 경로 없음(404)은 실행을 바꾸지 못하고, 누른 사람에게 안내한다.
for (const status of [401, 404, 409]) {
  const { interaction } = await act({}, fakeN8n(status, null));
  assert.deepEqual(editsOf(interaction), ['이미 처리됐거나 유효하지 않은 버튼입니다.'], `HTTP ${status}`);
}

// n8n 오류와 연결 실패는 다시 누르라고 안내한다. 안내에 재개 주소(서명)를 넣지 않는다.
{
  const { interaction } = await act({}, fakeN8n(500, null));
  assert.deepEqual(editsOf(interaction), ['n8n이 결정을 받지 못했습니다(HTTP 500). 잠시 뒤 다시 눌러 주세요.']);
  const timeout = Object.assign(new Error(`connect to http://n8n:5678/webhook-waiting/4821?signature=${SIGNATURE}`), { name: 'TimeoutError' });
  const failed = await act({}, fakeN8n(200, null, { fail: timeout }));
  assert.deepEqual(editsOf(failed.interaction), ['n8n에 연결하지 못했습니다(TimeoutError). 잠시 뒤 다시 눌러 주세요.']);
  assert.ok(!editsOf(failed.interaction)[0].includes(SIGNATURE));
}

// n8n 주소가 없으면 부르지 않고 안내한다.
{
  const n8n = fakeN8n();
  const { interaction } = await act({}, n8n, '');
  assert.equal(n8n.calls.length, 0);
  assert.deepEqual(editsOf(interaction), ['MEETING_ENDED_WEBHOOK_URL이 없어 n8n에 결정을 보내지 못했습니다.']);
}

// 봇 계정의 클릭과 제출은 응답도 n8n 호출도 하지 않는다.
for (const kind of ['button', 'modal']) {
  const n8n = fakeN8n();
  const { handled, interaction } = await act({ customId: idOf('edit'), kind, user: { bot: true }, submitted: DRAFT }, n8n);
  assert.equal(handled, true);
  assert.deepEqual(interaction.log, []);
  assert.equal(n8n.calls.length, 0);
}

// 버튼·모달이 아니거나 다른 ID면 처리하지 않는다(슬래시 명령 처리로 넘어간다). 모달은 수정 모달만 받는다.
for (const options of [
  { kind: 'command' },
  { customId: 'other-bot:approve' },
  { customId: `mb:approve:4821:${SIGNATURE}` },
  { customId: idOf('approve'), kind: 'modal', submitted: DRAFT },
]) {
  const n8n = fakeN8n();
  const { handled, interaction } = await act(options, n8n);
  assert.equal(handled, false, JSON.stringify(options));
  assert.deepEqual(interaction.log, []);
  assert.equal(n8n.calls.length, 0);
}

console.log('승인 버튼 오프라인 테스트 통과');
