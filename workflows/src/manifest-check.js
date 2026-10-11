// 녹음 봇이 보낸 manifest를 확인한다. 회의 ID, 파일 이름, 서버·채널 ID는 파일 경로와 Discord 요청에 들어가므로 형식이 맞는 것만 받는다.
// 틀리면 실행을 실패시켜 조용히 끝나지 않게 한다. 오류 메시지에는 값을 넣지 않는다(참석자 ID가 실행 기록에 남지 않게).
const manifest = $input.first().json.body;
const errors = [];
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isMs = (value) => Number.isFinite(value) && value >= 0;

if (!isObject(manifest)) throw new Error('manifest가 JSON 객체가 아닙니다');
if (!/^\d{8}-\d{4}$/.test(manifest.meetingId ?? '')) errors.push('meetingId 형식이 다릅니다');
if (!/^\d{17,20}$/.test(manifest.guildId ?? '')) errors.push('guildId 형식이 다릅니다');
if (!/^\d{17,20}$/.test(manifest.textChannelId ?? '')) errors.push('textChannelId 형식이 다릅니다');
for (const key of ['startedAt', 'endedAt']) {
  if (typeof manifest[key] !== 'string' || Number.isNaN(Date.parse(manifest[key]))) errors.push(`${key}가 시각이 아닙니다`);
}

const participants = Array.isArray(manifest.participants) ? manifest.participants : [];
if (!Array.isArray(manifest.participants)) errors.push('participants가 배열이 아닙니다');

const segments = Array.isArray(manifest.segments) ? manifest.segments : [];
if (!Array.isArray(manifest.segments)) errors.push('segments가 배열이 아닙니다');
else if (segments.length === 0) errors.push('녹음된 발화가 없습니다');
const files = new Set();
segments.forEach((s, i) => {
  if (!/^\d{9}-\d+\.webm$/.test(s?.file ?? '')) errors.push(`segments[${i}].file 형식이 다릅니다`);
  else if (files.has(s.file)) errors.push(`segments[${i}].file이 중복됩니다`);
  else files.add(s.file);
  if (!isMs(s?.startMs) || !isMs(s?.endMs) || s.endMs < s.startMs) errors.push(`segments[${i}] 시각이 잘못됐습니다`);
});

const gaps = manifest.gaps ?? [];
if (!Array.isArray(gaps)) errors.push('gaps가 배열이 아닙니다');
else gaps.forEach((g, i) => {
  if (!isMs(g?.startMs) || (g.endMs !== undefined && (!isMs(g.endMs) || g.endMs < g.startMs))) {
    errors.push(`gaps[${i}] 시각이 잘못됐습니다`);
  }
});

if (errors.length > 0) throw new Error(`manifest를 처리할 수 없습니다: ${errors.join(', ')}`);

// 녹음 봇은 서버 멤버 정보를 못 읽으면 표시 이름 자리에 Discord ID를 넣는다.
// ID가 녹취와 OpenAI 프롬프트에 들어가지 않게 "참석자 N"으로 바꾼다.
const names = new Map();
const nameOf = (userId, displayName) => {
  if (names.has(userId)) return names.get(userId);
  const usable = typeof displayName === 'string' && displayName.trim() !== '' && !/^\d{17,20}$/.test(displayName.trim());
  const name = usable ? displayName.trim() : `참석자 ${names.size + 1}`;
  names.set(userId, name);
  return name;
};
participants.forEach((p) => nameOf(p?.userId, p?.displayName));
// 참석자 이름은 음성 인식 프롬프트를 만든 뒤에 화자를 더해 회의록 참석자 칸에 쓴다. 말한 사람이 participants에 없어도 참석자다.
const prompt = names.size > 0 ? `참석자: ${[...new Set(names.values())].join(', ')}` : '';
const speakers = segments.map((s) => nameOf(s.userId, s.displayName));

return [{
  json: {
    meetingId: manifest.meetingId,
    guildId: manifest.guildId,
    textChannelId: manifest.textChannelId,
    startedAt: manifest.startedAt,
    endedAt: manifest.endedAt,
    // 참석자 이름을 알려 주면 음성 인식이 이름을 덜 틀린다.
    prompt,
    attendees: [...new Set(names.values())],
    segments: segments.map((s, i) => ({
      file: s.file,
      startMs: s.startMs,
      endMs: s.endMs,
      speaker: speakers[i],
    })),
    gaps: gaps.map((g) => ({ startMs: g.startMs, endMs: g.endMs ?? null, reason: typeof g.reason === 'string' ? g.reason : '' })),
  },
}];
