// E2E 테스트용 가짜 OpenAI(음성 인식, Responses API), Discord, ClickUp(템플릿 페이지 조회). 워크플로가 보낸 요청을 기록하고 각 API 형태의 응답을 낸다.
// OpenAI·ClickUp은 http :8080/openai, /clickup으로, Discord는 https :443(테스트 네트워크 안의 discord.com)으로 받는다. Discord 요청은 /discord/...로 기록한다.
//   GET  /__requests                  지금까지 받은 요청
//   POST /__fail-next-transcription   다음 음성 인식 요청 하나에 500을 낸다(재시도 확인용)
//   POST /__messages                  회의 채널 메시지 목록을 바꾼다(JSON 배열). 메시지 조회는 이 목록에서 after 뒤를 준다
//   POST /__messages-fail             메시지 조회가 계속 500을 낸다(조회 실패 확인용). /__messages로 목록을 다시 넣으면 풀린다
//   POST /__template                  템플릿 페이지 본문을 정한다({ content }). 조회 실패도 풀린다
//   POST /__template-fail             템플릿 페이지 조회가 계속 500을 낸다
//   POST /__llm                       Responses API가 낼 응답을 정한다({ status, body }). 바꿀 때까지 같은 응답을 낸다
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const requests = [];
let failNext = 0;
let channelMessages = [];
let messagesFail = false;
let templateContent = null;
let templateFail = false;
let llm = null;

function parseMultipart(buffer, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '');
  if (!boundary) return null;
  const parts = {};
  for (const raw of buffer.toString('latin1').split(`--${boundary[1] ?? boundary[2]}`).slice(1, -1)) {
    const [head, ...rest] = raw.replace(/^\r\n/, '').split('\r\n\r\n');
    const body = Buffer.from(rest.join('\r\n\r\n').replace(/\r\n$/, ''), 'latin1');
    const name = /name="([^"]*)"/.exec(head)?.[1];
    const filename = /filename="([^"]*)"/.exec(head)?.[1];
    parts[name] = filename ? { filename, size: body.length } : body.toString('utf8');
  }
  return parts;
}

function route(req, path, query, body) {
  if (req.method === 'POST' && path === '/openai/audio/transcriptions') {
    if (failNext > 0) {
      failNext -= 1;
      return { status: 500, body: { error: { message: 'e2e injected failure' } } };
    }
    // 파일 이름의 시작 시각을 그대로 말한 것처럼 돌려줘 순서가 섞이면 드러나게 한다.
    const name = body.multipart?.file?.filename ?? '';
    return { status: 200, body: { text: `${Number(name.slice(0, 9)) / 1000}초 발화` } };
  }
  if (req.method === 'GET' && /^\/discord\/channels\/\d+\/messages$/.test(path)) {
    if (messagesFail) return { status: 500, body: { message: 'e2e injected failure' } };
    // Discord처럼 after 바로 뒤의 메시지를 limit개까지, 최신 순으로 준다.
    const after = BigInt(query.after ?? '0');
    const limit = Math.min(Number(query.limit ?? 50), 100);
    const page = channelMessages
      .filter((m) => BigInt(m.id) > after)
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
      .slice(0, limit)
      .reverse();
    return { status: 200, body: page };
  }
  if (req.method === 'POST' && /^\/discord\/channels\/\d+\/messages$/.test(path)) {
    // 초안 메시지는 multipart(payload_json + 파일)로, 알림은 JSON으로 온다.
    const payload = body.multipart?.payload_json ? JSON.parse(body.multipart.payload_json) : body.json;
    return { status: 200, body: { id: String(1_600_000_000_000_000_000n + BigInt(requests.length)), channel_id: path.split('/')[3], content: payload?.content } };
  }
  const message = /^\/discord\/channels\/(\d+)\/messages\/(\d+)$/.exec(path);
  if (req.method === 'PATCH' && message) {
    return { status: 200, body: { id: message[2], channel_id: message[1], content: body.json?.content } };
  }
  const page = /^\/clickup\/api\/v3\/workspaces\/([^/]+)\/docs\/([^/]+)\/pages\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && page) {
    if (templateFail || templateContent === null) return { status: 500, body: { err: 'e2e injected failure' } };
    return { status: 200, body: { id: page[3], doc_id: page[2], workspace_id: page[1], name: '회의록 템플릿', content: templateContent } };
  }
  if (req.method === 'POST' && path === '/openai/responses') {
    if (!llm) return { status: 500, body: { error: { type: 'server_error', message: 'e2e response not set' } } };
    return { status: llm.status ?? 200, body: llm.body };
  }
  return { status: 404, body: { message: `no route ${req.method} ${path}` } };
}

function handler(prefix) {
  return (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://mock');
      if (prefix) url.pathname = `${prefix}${url.pathname.replace(/^\/api\/v10/, '')}`;
      const reply = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const buffer = Buffer.concat(chunks);
      const type = req.headers['content-type'] ?? '';
      const body = {};
      if (type.includes('application/json') && buffer.length) body.json = JSON.parse(buffer.toString('utf8'));
      if (type.includes('multipart/form-data')) body.multipart = parseMultipart(buffer, type);
      if (url.pathname === '/__requests') return reply(200, requests);
      if (url.pathname === '/__fail-next-transcription') {
        failNext += 1;
        return reply(200, { failNext });
      }
      if (url.pathname === '/__messages') {
        channelMessages = body.json ?? [];
        messagesFail = false;
        return reply(200, { count: channelMessages.length });
      }
      if (url.pathname === '/__messages-fail') {
        messagesFail = true;
        return reply(200, { messagesFail });
      }
      if (url.pathname === '/__template') {
        templateContent = body.json?.content ?? null;
        templateFail = false;
        return reply(200, { length: templateContent?.length ?? 0 });
      }
      if (url.pathname === '/__template-fail') {
        templateFail = true;
        return reply(200, { templateFail });
      }
      if (url.pathname === '/__llm') {
        llm = body.json ?? null;
        return reply(200, { status: llm?.status ?? 200 });
      }
      const query = Object.fromEntries(url.searchParams);
      const result = route(req, url.pathname, query, body);
      requests.push({ method: req.method, path: url.pathname, query, status: result.status, authorization: req.headers.authorization ?? null, ...body });
      return reply(result.status, result.body);
    });
  };
}

http.createServer(handler('')).listen(8080, () => console.log('mock APIs on :8080'));
https
  .createServer({ key: readFileSync('/certs/server.key'), cert: readFileSync('/certs/server.pem') }, handler('/discord'))
  .listen(443, () => console.log('mock discord.com on :443'));
