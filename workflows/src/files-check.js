// 파일 읽기 노드는 경로를 glob으로 찾아서, 파일이 없으면 오류 없이 항목 0개를 낸다(n8n 2.42.6에서 확인).
// 그대로 두면 워크플로가 조용히 성공으로 끝나므로 읽은 파일이 발화 목록과 하나라도 다르면 실패시킨다.
const expected = $('발화 목록').all().map((item) => item.json.file);
const files = $input.all().filter((item) => item.binary?.data);
if (files.length !== expected.length) {
  throw new Error(`발화 파일 ${expected.length}개 중 ${files.length}개만 읽었습니다. 녹음 폴더를 확인해 주세요`);
}
// 음성 인식 결과를 발화 순서로 맞추므로 읽은 순서도 같아야 한다.
const misplaced = files.findIndex((item, i) => item.binary.data.fileName !== expected[i]);
if (misplaced !== -1) throw new Error(`${misplaced + 1}번째 발화 파일이 발화 목록과 다릅니다`);
return files;
