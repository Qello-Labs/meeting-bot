# n8n 워크플로

이 폴더의 워크플로 JSON은 n8n 컨테이너의 `/workflows`에 읽기 전용으로 연결된다(`docker-compose.yml`).

| 워크플로 | 파일 | 단계 |
| --- | --- | --- |
| 회의 녹취 | `meeting-transcribe.json` | 설계 문서 9절 5단계 |

## 원본은 코드다

JSON을 직접 고치지 않는다. Code 노드 코드는 `workflows/src/*.js`에, 노드 구성은 `scripts/build-workflow.js`에 있고
JSON은 스크립트가 만든다.

```bash
node scripts/build-workflow.js           # workflows/*.json 다시 만들기
node scripts/build-workflow.js --check   # 커밋된 JSON이 코드와 같은지 확인(npm test에도 들어 있다)
```

n8n 화면에서 보고, 실행하고, 임시로 고치는 것은 자유다. 확정한 수정은 코드로 옮긴다. 놓치지 않도록 화면에서 내려받은 JSON을
저장소 JSON과 비교한다.

```bash
node scripts/diff-workflow.js <화면에서 내려받은 JSON>
```

노드 이름 기준으로 `type`, `typeVersion`, `parameters`, 노드 설정(재시도 등), 연결만 비교한다. 위치, ID, 자격 증명은 무시한다.
n8n 화면에서 저장하면 기본값과 같은 파라미터가 JSON에서 빠지는데, 이 값들은 `diff-workflow.js`의 기본값 표로 같게 본다.
차이가 없으면 0, 있으면 1로 끝난다.

## 회의 녹취

녹음 봇이 회의를 끝내면 manifest를 `http://n8n:5678/webhook/meeting-ended`로 보낸다.

| 노드 | 하는 일 |
| --- | --- |
| 회의 종료 (Webhook) | manifest를 받자마자 응답한다. 음성 인식이 길어도 녹음 봇 요청이 끊기지 않게 하기 위해서다 |
| 녹음 정보 확인 (Code) | 회의 ID, 파일 이름, 서버·채널 ID 형식을 확인한다. 경로와 Discord 요청에 들어가는 값이라 형식이 맞는 것만 받는다 |
| 발화 목록 (Code) | 발화마다 `/recordings/<회의 ID>/segments/<파일>` 경로를 만든다 |
| 발화 파일 읽기 | 파일을 읽는다. 파일이 없으면 오류 없이 0건을 내므로(n8n 2.42.6) 다음 노드가 확인한다 |
| 발화 파일 확인 (Code) | 읽은 파일의 개수와 순서가 발화 목록과 다르면 실패시킨다 |
| 음성 인식 (HTTP Request) | OpenAI `gpt-4o-transcribe`. 언어 `ko`, 참석자 이름을 프롬프트로 넘긴다. 5개씩 보내고 실패하면 노드 전체를 3번까지 다시 시도한다 |
| 녹취 만들기 (Code) | `[HH:MM:SS] 화자: 내용`을 시각 순으로 합치고 끊긴 구간을 끼워 넣는다. 녹취는 n8n 실행 기록(7일 보관)에만 남는다 |
| 회의 채널 알림 (Discord) | 회의 채널에 `회의 <회의 ID> 녹취 완료, 발화 N개`만 보낸다 |

- 음성 인식은 OpenAI 전용 노드가 아니라 HTTP Request 노드를 쓴다. n8n 2.42.6의 OpenAI 노드는 음성 인식 모델이 `whisper-1`로
  고정이고 프롬프트를 받지 않는다. 같은 테스트 녹음으로 비교한 결과는 [결정 기록](../docs/decisions/2026-10-11-gh13-transcription-nodes.md)에 있다.
- Discord 노드에는 멘션을 끄는 옵션(`allowed_mentions`)이 없다. 그래서 알림 문구를 코드가 만든 회의 ID와 숫자로만 채운다.
  녹취나 오류 문구처럼 사람이 쓴 글이 들어가는 메시지에는 이 노드를 쓰지 않는다.
- 노드 전체를 다시 시도하므로 발화 하나만 실패해도 회의 전체 발화를 다시 보낸다(E2E: 발화 6개에 요청 1건 실패 → 요청 12건).
- 이 단계에는 실패 알림 워크플로가 없다(10단계). 실패하면 n8n 실행 기록에 오류로 남는다.

## 가져오기

가져오기와 n8n 시작을 동시에 하지 않는다. 처음 만든 DB에서 둘이 함께 마이그레이션을 돌리면 n8n이 `malformed JSON` 오류로 멈춘다
(n8n 2.42.6에서 확인). n8n을 멈춘 상태에서 일회용 컨테이너로 가져온 뒤 n8n을 띄운다.

```bash
docker compose stop n8n
docker compose run --rm --no-deps n8n import:workflow --input=/workflows/meeting-transcribe.json
docker compose start n8n
```

같은 ID의 워크플로가 있으면 덮어쓰고 꺼진 상태가 된다. 자격 증명 연결도 비워진다. n8n 화면에서 노드마다 자격 증명을 고른 뒤
Publish한다.

| 노드 | 자격 증명 |
| --- | --- |
| 음성 인식 | OpenAI (API 키) |
| 회의 채널 알림 | Discord Bot (녹음 봇과 같은 토큰) |

n8n 화면의 AI 도우미(Connect a model)는 연결하지 않는다. 워크플로와 실행 데이터(녹취 포함)가 모델 제공자로 간다.

## 확인하기

```bash
npm run test:workflow   # Code 노드를 n8n 없이 순서대로 실행, 차이 검사, --check
npm run e2e:n8n         # 실제 n8n 2.42.6 + 가짜 OpenAI·Discord 서버. Docker와 openssl 필요, 비용 없음
```

E2E는 별도 compose 프로젝트(`meeting-bot-gh13-e2e`)와 임시 폴더를 쓰고 끝나면 지운다. Docker volume은 만들지 않는다.
Discord 노드는 주소가 `https://discord.com/api/v10`로 고정이라, 테스트 네트워크 안에서만 `discord.com`을 가짜 서버로 돌리고
실행할 때 만든 테스트 CA를 n8n이 믿게 한다(`NODE_EXTRA_CA_CERTS`). 실패 원인을 보려면 `node scripts/e2e-n8n.js --keep`.

## 넣지 않는 것

자격 증명 값, Webhook 비밀 경로, 서버 주소는 JSON에 넣지 않는다(`AGENTS.md` 3.4). 자격 증명은 n8n 화면에서만 등록한다.
`meeting-ended`는 compose 내부 주소로만 부르는 고정 경로이고 n8n은 서버 `127.0.0.1`에만 열려 있다.
