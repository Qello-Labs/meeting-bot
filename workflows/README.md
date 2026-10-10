# n8n 워크플로

이 폴더의 워크플로 JSON은 n8n 컨테이너의 `/workflows`에 읽기 전용으로 연결된다(`docker-compose.yml`).
워크플로는 설계 문서 9절 5단계부터 추가한다.

## 가져오기

```bash
docker compose exec n8n n8n import:workflow --input=/workflows/<파일>.json
```

가져온 워크플로는 꺼진 상태다. n8n 화면에서 자격 증명을 고르고 Publish한다.

## 넣지 않는 것

자격 증명 값, Webhook 비밀 경로, 서버 주소는 JSON에 넣지 않는다(`AGENTS.md` 3.4). 자격 증명은 n8n 화면에서만 등록한다.
