// 검증을 통과한 고친 초안으로 같은 초안 메시지를 바꾼다(2026-10-11 사용자 결정: 같은 메시지를 고친다).
// 판 번호를 올린 새 버튼을 달아, 옛 버튼(이전 판)으로는 다시 재개해도 반영되지 않게 한다. 그 뒤 승인 기다리기로 돌아간다.
// 고친 초안은 모달 한도(4,000자) 안이라 embed 하나에 들어간다. 버튼은 shared/approval-buttons.js의 approvalButtons가 만든다.
const decision = $('결정 읽기').first().json;
const meeting = $('녹음 정보 확인').first().json;
const { meetingDate } = $('초안 요청 만들기').first().json;

const rev = decision.rev + 1;
const draft = decision.edited.draft;
return [{
  json: {
    // rev와 draft는 다음 결정 읽기가 지금 판과 초안으로 읽는다.
    rev,
    draft,
    textChannelId: decision.textChannelId,
    messageId: decision.messageId,
    body: {
      content: `회의 ${meeting.meetingId} 회의록 초안입니다(수정: ${decision.by}). 3일 안에 승인 또는 거절을 눌러 주세요.`,
      embeds: [{ title: `회의록 초안 (${meetingDate})`, description: draft }],
      components: approvalButtons(rev, draft),
      allowed_mentions: { parse: [] },
    },
  },
}];
