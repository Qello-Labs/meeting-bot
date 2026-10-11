// 초안 검증까지 끝난 뒤 회의 채널 알림 문구를 만든다.
// Discord 노드에는 멘션을 끄는 옵션이 없어서 녹취·결정 메시지·초안 원문 같은 사람이 쓴 글은 넣지 않고 회의 ID와 숫자, 코드가 정한 오류 종류만 쓴다.
const meeting = $('녹음 정보 확인').first().json;
const transcript = $('녹취 만들기').first().json;
const picked = $('결정 메시지 고르기').first().json;
const check = $('초안 검증').first().json;

const counts = (entries) => entries.map(([label, n]) => `${label} ${n}개`).join(', ');
const removed = [['날짜', check.cleaned.dates.length], ['명세 ID', check.cleaned.specIds.length]].filter(([, n]) => n > 0);
const result = check.draftOk
  ? `초안 검증 통과${removed.length ? `(지운 값: ${counts(removed)})` : ''}`
  : `초안 검증 실패(${counts(Object.entries(check.errorCounts))}${removed.length ? `, 지운 값: ${counts(removed)}` : ''}). 오류 목록은 n8n 실행 기록에 있습니다`;

return [{
  json: {
    guildId: meeting.guildId,
    textChannelId: meeting.textChannelId,
    notice: `회의 ${meeting.meetingId} 녹취 완료, 발화 ${transcript.segmentCount}개, 결정 메시지 ${picked.decisionCount}개, ${result}`,
  },
}];
