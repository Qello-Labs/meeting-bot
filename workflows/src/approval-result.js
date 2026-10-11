// 승인 기다리기(Wait)가 재개된 이유를 읽고 다음에 할 일을 정한다(설계 5절 G).
// 녹음 봇이 버튼·모달로 재개하면 본문에 { decision, rev, by, draft? }가 온다. 3일이 지나 재개되면 본문 없이 받은 항목이 그대로 온다.
// 같은 실행에서 다시 기다려도 재개 주소가 같아서(n8n 2.42.6 실험) 판 번호가 지금 판과 다르면 반영하지 않는다(늦은 클릭, 동시 수정).
// 고친 초안은 초안 검증과 같은 규칙(shared/draft-rules.js의 verifyDraft)으로 다시 검증한다.
// outcome: approve | reject | timeout | edited | editInvalid | stale. timeout이 아니면 response를 응답 노드가 녹음 봇에 돌려준다.
const DECISIONS = { approve: '승인', reject: '거절', edit: '수정' };

const meeting = $('녹음 정보 확인').first().json;
// 초안은 길이에 따라 두 노드 중 하나로 보냈다. 고쳐도 같은 메시지를 고치므로 메시지 ID는 그대로다.
const sent = ($('초안 보내기').isExecuted ? $('초안 보내기') : $('초안 보내기(첨부)')).first().json;
// 지금 판과 초안: 수정된 적이 있으면 수정 반영 만들기의 가장 최근 출력, 아니면 처음 초안이다(반복 안의 $()는 가장 최근 출력, 실험 확인).
const current = ($('수정 반영 만들기').isExecuted ? $('수정 반영 만들기') : $('초안 메시지 만들기')).first().json;
const body = $input.first().json.body;

const base = { textChannelId: sent.channel_id, messageId: sent.id, rev: current.rev, draft: current.draft };
const settle = (content) => ({ content: `회의 ${meeting.meetingId} 회의록 초안: ${content}`, components: [], allowed_mentions: { parse: [] } });

if (body === undefined) {
  return [{ json: { ...base, outcome: 'timeout', by: null, response: null, body: settle('기한 초과(3일 동안 승인·거절 없음)') } }];
}
if (!Object.hasOwn(DECISIONS, body?.decision) || !Number.isInteger(body?.rev)) {
  throw new Error('승인 기다리기에 알 수 없는 결정이 왔습니다');
}
// 누른 사람의 표시 이름만 받는다. 메시지에 그대로 쓰므로 줄바꿈을 없애고 길이를 줄인다.
const by = String(body.by ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || '알 수 없음';

if (body.rev !== current.rev) {
  return [{ json: { ...base, outcome: 'stale', by, response: { result: 'stale', rev: current.rev } } }];
}
if (body.decision === 'approve') {
  return [{ json: { ...base, outcome: 'approve', by, response: { result: 'accepted', decision: 'approve' }, body: settle(`승인(${by}). ClickUp에 쓰는 중입니다`) } }];
}
if (body.decision === 'reject') {
  return [{ json: { ...base, outcome: 'reject', by, response: { result: 'accepted', decision: 'reject' }, body: settle(`거절(${by})`) } }];
}

// 수정: 모달 한도(4,000자) 안의 본문만 받는다. 검증에 실패하면 지금 초안을 그대로 두고 다시 기다린다(2026-10-11 사용자 결정).
if (typeof body.draft !== 'string' || body.draft.trim() === '' || [...body.draft].length > EDIT_LIMIT) {
  throw new Error('고친 초안이 비었거나 모달 한도를 넘습니다');
}
const { template, meetingDate } = $('초안 요청 만들기').first().json;
const verified = verifyDraft(body.draft.replace(/\r\n/g, '\n').trim(), {
  template,
  meetingDate,
  attendees: meeting.attendees,
  transcript: $('녹취 만들기').first().json.transcript,
  decisions: $('결정 메시지 고르기').first().json.decisions,
});
if (!verified.draftOk) {
  return [{ json: { ...base, outcome: 'editInvalid', by, errors: verified.errors, response: { result: 'invalid', errorCounts: verified.errorCounts } } }];
}
return [{ json: { ...base, outcome: 'edited', by, edited: verified, response: { result: 'accepted', decision: 'edit' } } }];
