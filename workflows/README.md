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
단, 한 노드에서 갈라진 갈래들의 위아래 순서는 실행 순서를 정하므로 비교한다.
n8n 화면에서 저장하면 기본값과 같은 파라미터가 JSON에서 빠진다(안쪽 설정과 배열 항목 안의 값도 빠진다). 이 값들은
`diff-workflow.js`의 기본값 표로 같게 본다. 새 노드를 쓰면 화면에서 저장해 보고 빠지는 값을 표에 더한다.
차이가 없으면 0, 있으면 1로 끝난다.

## 회의 녹취

녹음 봇이 회의를 끝내면 manifest를 `http://n8n:5678/webhook/meeting-ended`로 보낸다.

```
                    ┌─ 결정 메시지 기간 → 결정 메시지 조회 → 결정 메시지 고르기 ─┐ (위)
… → 발화 파일 확인 ─┤                                                          ├→ 녹취·결정 합치기 → 알림 만들기 → 회의 채널 알림
                    └─ 음성 인식 → 녹취 만들기 ────────────────────────────────┘ (아래)
```

| 노드 | 하는 일 |
| --- | --- |
| 회의 종료 (Webhook) | manifest를 받자마자 응답한다. 음성 인식이 길어도 녹음 봇 요청이 끊기지 않게 하기 위해서다 |
| 녹음 정보 확인 (Code) | 회의 ID, 파일 이름, 서버·채널 ID 형식을 확인한다. 경로와 Discord 요청에 들어가는 값이라 형식이 맞는 것만 받는다 |
| 발화 목록 (Code) | 발화마다 `/recordings/<회의 ID>/segments/<파일>` 경로를 만든다 |
| 발화 파일 읽기 | 파일을 읽는다. 파일이 없으면 오류 없이 0건을 내므로(n8n 2.42.6) 다음 노드가 확인한다 |
| 발화 파일 확인 (Code) | 읽은 파일의 개수와 순서가 발화 목록과 다르면 실패시킨다 |
| 결정 메시지 기간 (Code) | 지난 회의 끝 시각(워크플로 static data, 9단계에서 갱신)부터 이번 회의 종료까지를 Discord 메시지 ID로 바꾼다. 저장값이 없거나 이상하면 회의 시작 7일 전부터 본다 |
| 결정 메시지 조회 (HTTP Request) | 회의 채널 메시지를 기간 시작 ID(`after`)부터 100개씩 받는다. 100개 미만이거나 회의 종료를 넘으면 멈추고, 요청은 50번까지 한다 |
| 결정 메시지 고르기 (Code) | 기간 안에 사람이 쓴 메시지(봇·Webhook·시스템 메시지 제외) 중 ✅ 반응이 1개 이상인 것만 고른다. 링크, 표시 이름, 내용, 첨부 이름, 시각을 남기고 작성자 ID는 남기지 않는다 |
| 음성 인식 (HTTP Request) | OpenAI `gpt-4o-transcribe`. 언어 `ko`, 참석자 이름을 프롬프트로 넘긴다. 5개씩 보내고 실패하면 노드 전체를 3번까지 다시 시도한다 |
| 녹취 만들기 (Code) | `[HH:MM:SS] 화자: 내용`을 시각 순으로 합치고 끊긴 구간을 끼워 넣는다. 녹취는 n8n 실행 기록(7일 보관)에만 남는다 |
| 녹취·결정 합치기 (Merge) | 두 갈래가 모두 끝날 때까지 기다린다 |
| 알림 만들기 (Code) | `회의 <회의 ID> 녹취 완료, 발화 N개, 결정 메시지 M개`를 만든다 |
| 회의 채널 알림 (Discord) | 위 문구만 회의 채널에 보낸다 |

- 음성 인식은 OpenAI 전용 노드가 아니라 HTTP Request 노드를 쓴다. n8n 2.42.6의 OpenAI 노드는 음성 인식 모델이 `whisper-1`로
  고정이고 프롬프트를 받지 않는다. 같은 테스트 녹음으로 비교한 결과는 [결정 기록](../docs/decisions/2026-10-11-gh13-transcription-nodes.md)에 있다.
- Discord 노드에는 멘션을 끄는 옵션(`allowed_mentions`)이 없다. 그래서 알림 문구를 코드가 만든 회의 ID와 숫자로만 채운다.
  녹취나 오류 문구처럼 사람이 쓴 글이 들어가는 메시지에는 이 노드를 쓰지 않는다.
- 노드 전체를 다시 시도하므로 발화 하나만 실패해도 회의 전체 발화를 다시 보낸다(E2E: 발화 6개에 요청 1건 실패 → 요청 12건).
- n8n(executionOrder v1)은 갈래를 동시에 돌리지 않고 화면 위쪽 갈래부터 하나씩 끝까지 실행한다. 결정 메시지 갈래를 위에 두어
  Discord 쪽이 실패하면 음성 인식(유료) 전에 멈춘다. 화면에서 두 갈래의 위아래를 바꾸지 않는다(차이 검사가 찾는다).
- 결정 메시지는 ✅ 반응으로 표시한다. 메시지 본문의 ✅는 보지 않는다(`AGENTS.md` 3.2).
- 다음 경우에는 결정이 조용히 빠지지 않게 실행을 실패시킨다.
  - 조회가 실패했다. 페이지 넘김 중 오류 응답을 받으면 n8n 2.42.6이 오류 본문을 출력으로 내고 성공으로 끝낼 수 있어서,
    페이지 넘김 식이 오류 응답에서도 깨지지 않게 하고 고르기 노드가 메시지가 아닌 항목을 거부한다.
  - 요청 50번(5,000개)으로 회의 종료에 닿지 못했다.
  - ✅ 메시지의 내용과 첨부가 모두 비었다. Message Content Intent가 꺼져 있으면 이렇게 온다.
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
| 결정 메시지 조회 | Discord Bot (녹음 봇과 같은 토큰) |
| 회의 채널 알림 | Discord Bot |

Discord 봇은 회의 채널의 메시지 기록 보기 권한과 Message Content Intent가 있어야 결정 메시지를 읽는다.

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
