// Example: secure sync with DataJud, with retries and error handling.
const fetch = require('node-fetch');

async function syncProcessWithDataJud(numeroCnj, { db, normalize, emitEvent, maxRetries = 3 } = {}) {
  if (!process.env.SECRET_TOKEN) throw new Error('Missing SECRET_TOKEN');
  if (!numeroCnj) throw new TypeError('numeroCnj is required');

  const url = `https://api-publica.cnj.jus.br/datajud/v1/processo/${encodeURIComponent(numeroCnj)}`;
  const headers = { 'Authorization': `Bearer ${process.env.SECRET_TOKEN}` };

  let attempt = 0;
  const backoff = (n) => 1000 * Math.pow(2, n); // ms

  while (attempt <= maxRetries) {
    try {
      const res = await fetch(url, { headers });

      if (res.status === 429) { // rate limited
        const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
        const wait = retryAfter > 0 ? retryAfter * 1000 : backoff(attempt);
        await new Promise(r => setTimeout(r, wait));
        attempt++;
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`DataJud request failed: ${res.status} ${res.statusText} ${text}`);
      }

      const data = await res.json();

      // Normalize canonical representation (assumes normalize is provided)
      const canonicalProcess = (typeof normalize === 'function') ? normalize(data) : data;

      // Persist with idempotency — assume db.upsert exists and handles conflicts on numero_cnj
      if (!db || typeof db.upsert !== 'function') {
        throw new Error('db.upsert is required to persist the process');
      }
      await db.upsert('processes', canonicalProcess, { conflictKeys: ['numero_cnj'] });

      // Emit event for downstream processing
      if (typeof emitEvent === 'function') {
        await emitEvent('PROCESSO_ATUALIZADO', canonicalProcess.id, canonicalProcess);
      }

      return canonicalProcess;
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) throw err;
      // simple jittered backoff
      await new Promise(r => setTimeout(r, backoff(attempt) + Math.floor(Math.random() * 300)));
    }
  }
}

module.exports = { syncProcessWithDataJud };
