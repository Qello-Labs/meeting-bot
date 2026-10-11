// 음성 인식 결과를 회의 시작 기준 시각 순 녹취로 합친다. 이 [HH:MM:SS] 문자열이 이후 단계에서 녹취 근거의 식별자가 된다.
// 녹취 원문은 이 노드 출력(n8n 실행 기록, 7일 보관)에만 남긴다. 회의 채널 알림 문구는 알림 만들기 노드가 만든다.
const meeting = $('녹음 정보 확인').first().json;
const texts = $input.all().map((item) => item.json.text);
if (texts.length !== meeting.segments.length) {
  throw new Error(`음성 인식 결과 수(${texts.length})가 발화 수(${meeting.segments.length})와 다릅니다`);
}

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

const lines = [];
let empty = 0;
meeting.segments.forEach((segment, i) => {
  const text = typeof texts[i] === 'string' ? texts[i].replace(/\s+/g, ' ').trim() : '';
  if (text === '') {
    empty += 1;
    return;
  }
  lines.push({ ms: segment.startMs, order: 1, text: `[${clock(segment.startMs)}] ${segment.speaker}: ${text}` });
});
// 녹음이 끊긴 구간도 시각 순으로 끼워 넣는다. 그 사이의 말은 녹음되지 않았다.
for (const gap of meeting.gaps) {
  const length = gap.endMs === null ? '회의 끝까지' : `약 ${Math.round((gap.endMs - gap.startMs) / 1000)}초`;
  const reason = gap.reason ? `, ${gap.reason}` : '';
  lines.push({ ms: gap.startMs, order: 0, text: `[${clock(gap.startMs)}] (녹음 끊김 ${length}${reason})` });
}
lines.sort((a, b) => a.ms - b.ms || a.order - b.order);

const segmentCount = meeting.segments.length;
return [{
  json: {
    meetingId: meeting.meetingId,
    guildId: meeting.guildId,
    textChannelId: meeting.textChannelId,
    transcript: lines.map((line) => line.text).join('\n'),
    segmentCount,
    emptyCount: empty,
  },
}];
