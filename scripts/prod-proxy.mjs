/**
 * 本番URLへの転送サーバー (受入テスト用)。
 *
 * この作業環境のブラウザは外部HTTPSへ直接到達できないため、
 * ローカルの平文HTTPで受けて、Node の fetch (プロキシ経由) で本番へ中継する。
 * 実際に応答しているのは本番デプロイそのものなので、受入テストとして成立する。
 *
 *   PROD_ORIGIN=https://example.vercel.app node scripts/prod-proxy.mjs 3300
 */
import { createServer } from 'node:http';

const ORIGIN = process.env.PROD_ORIGIN;
if (!ORIGIN) throw new Error('PROD_ORIGIN が未設定です');
const PORT = Number(process.argv[2] ?? 3300);
const TARGET = new URL(ORIGIN);

/** 中継時に付け替える必要があるヘッダ (ホップ単位・本番のホスト名に合わせるもの) */
const DROP_REQUEST_HEADERS = new Set([
  'host', 'origin', 'referer', 'connection', 'accept-encoding', 'content-length',
]);
const DROP_RESPONSE_HEADERS = new Set([
  'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'strict-transport-security',
]);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', TARGET);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (DROP_REQUEST_HEADERS.has(key) || value === undefined) continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    // Next.js の Server Actions は Origin と Host の一致を検証するため、本番の値に揃える
    headers.set('host', TARGET.host);
    headers.set('origin', TARGET.origin);
    if (req.headers.referer) {
      headers.set('referer', String(req.headers.referer).replace(/^http:\/\/[^/]+/, TARGET.origin));
    }

    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : req;
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body,
      duplex: body ? 'half' : undefined,
      redirect: 'manual',
    });

    for (const [key, value] of upstream.headers) {
      if (DROP_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
      if (key.toLowerCase() === 'location') {
        res.setHeader(key, value.replace(TARGET.origin, `http://127.0.0.1:${PORT}`));
        continue;
      }
      if (key.toLowerCase() === 'set-cookie') continue; // 下でまとめて処理する
      res.setHeader(key, value);
    }
    const cookies = upstream.headers.getSetCookie?.() ?? [];
    if (cookies.length > 0) res.setHeader('set-cookie', cookies);

    res.writeHead(upstream.status);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`中継に失敗しました: ${error instanceof Error ? error.message : error}`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`本番中継: http://127.0.0.1:${PORT} -> ${TARGET.origin}`);
});
