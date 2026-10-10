import { execFile } from 'node:child_process';
import { rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * OpenAI 음성 인식은 ogg를 받지 않는다(지원 형식: mp3, mp4, mpeg, mpga, m4a, wav, webm).
 * Opus를 다시 인코딩하지 않고 webm 컨테이너로만 옮긴다.
 */
async function toWebm(oggPath) {
  const webmPath = oggPath.replace(/\.ogg$/, '.webm');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', oggPath, '-c:a', 'copy', webmPath]);
  await rm(oggPath);
  return webmPath;
}

/**
 * 짧은 발화(맞장구, 기침)를 버리고 webm으로 바꾼 뒤 manifest.json을 쓴다.
 */
export async function finalizeRecording(result, { minSegmentMs }) {
  const segmentsDir = path.join(result.dir, 'segments');
  const names = new Map(result.participants.map((p) => [p.userId, p.displayName]));
  const kept = [];
  let dropped = 0;

  for (const segment of result.segments) {
    const oggPath = path.join(segmentsDir, segment.file);
    const size = await stat(oggPath).then((s) => s.size, () => 0);
    if (segment.endMs - segment.startMs < minSegmentMs || size === 0) {
      await rm(oggPath, { force: true });
      dropped += 1;
      continue;
    }
    try {
      const webmPath = await toWebm(oggPath);
      kept.push({
        ...segment,
        file: path.basename(webmPath),
        displayName: names.get(segment.userId) ?? segment.userId,
      });
    } catch (error) {
      console.warn(`변환 실패 ${segment.file}: ${error.message}`);
      dropped += 1;
    }
  }

  const manifest = { ...result, segments: kept };
  delete manifest.dir;
  await writeFile(path.join(result.dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { manifest, dropped };
}

/**
 * n8n Webhook에 회의가 끝났다고 알린다. 음성 파일은 보내지 않고, n8n이 공유 폴더에서 직접 읽는다.
 */
export async function notifyN8n(webhookUrl, manifest) {
  if (!webhookUrl) return { skipped: true };
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  if (!response.ok) throw new Error(`n8n 응답 ${response.status}`);
  return { skipped: false };
}
