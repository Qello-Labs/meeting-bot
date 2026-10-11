// 두 갈래(결정 메시지, 녹취)가 모두 끝난 뒤 회의 채널 알림 문구를 만든다.
// Discord 노드에는 멘션을 끄는 옵션이 없어서 녹취·결정 메시지 원문 같은 사람이 쓴 글은 넣지 않고 회의 ID와 숫자만 쓴다.
const meeting = $('녹음 정보 확인').first().json;
const transcript = $('녹취 만들기').first().json;
const picked = $('결정 메시지 고르기').first().json;
return [{
  json: {
    guildId: meeting.guildId,
    textChannelId: meeting.textChannelId,
    notice: `회의 ${meeting.meetingId} 녹취 완료, 발화 ${transcript.segmentCount}개, 결정 메시지 ${picked.decisionCount}개`,
  },
}];
