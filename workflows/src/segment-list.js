// 발화마다 항목 하나를 만들어 파일 읽기 노드에 넘긴다. 파일 이름은 앞 노드에서 형식을 확인했다.
const { meetingId, segments } = $('녹음 정보 확인').first().json;
return segments.map((segment) => ({
  json: { file: segment.file, path: `/recordings/${meetingId}/segments/${segment.file}` },
}));
