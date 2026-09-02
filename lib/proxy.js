/**
 * lib/proxy.js - ai-route 本地代理服务器
 *
 * POST /v1/chat/completions (OpenAI 兼容入口)
 * POST /v1/messages         (Anthropic Messages 入口)
 * GET  /v1/models           (返回当前路由候选模型)
 *
 * 每请求实时路由(3s 缓存);参数清洗(剥 temperature/top_p/penalties);
 * 请求 model 被改写为活跃 AI 模型;流式降级为一次性 SSE;
 * 端点故障自动逐级回退(所有候选耗尽才 502)。
 */
'use strict';

const http = require('http');
const { route } = require('./detect');
const { convertRequest, convertResponse, sseChunks } = require('./convert');

function joinUrl(base, suffix) {
  return base.replace(/\/+$/, '') + suffix;
}

async function callUpstream(ep, reqBody) {
  const url = ep.api === 'anthropic-messages'
    ? joinUrl(ep.baseUrl, '/v1/messages')
    : joinUrl(ep.baseUrl, '/chat/completions');
  const headers = { 'Content-Type': 'application/json' };
  if (ep.api === 'anthropic-messages') {
    headers['x-api-key'] = ep.key;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = 'Bearer ' + ep.key;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(reqBody), signal: ctrl.signal
    });
    const text = await r.text();
    if (!r.ok) {
      const err = new Error('upstream ' + r.status + ': ' + text.slice(0, 300));
      err.status = r.status;
      throw err;
    }
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

function stripSamplingParams(req) {
  delete req.temperature;
  delete req.top_p;
  delete req.frequency_penalty;
  delete req.presence_penalty;
  return req;
}

function startProxy(port) {
  let cache = { at: 0, val: null };
  function currentRoute() {
    if (cache.val && Date.now() - cache.at < 3000) return cache.val;
    cache = { at: Date.now(), val: route() };
    return cache.val;
  }

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) {
      const { eps } = currentRoute();
      const data = {
        object: 'list',
        data: (eps || []).map(e => ({ id: e.model, object: 'model', owned_by: 'ai-route' }))
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }
    const isPost = req.method === 'POST';
    const isChat = url === '/v1/chat/completions' || url === '/chat/completions';
    const isMsg = url === '/v1/messages' || url === '/messages';
    if (!isPost || (!isChat && !isMsg)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found: ' + req.method + ' ' + url } }));
      return;
    }
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw || '{}'); } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'bad json' } }));
        return;
      }
      const wantStream = !!body.stream;
      const { active, eps } = currentRoute();
      if (!eps.length) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'ai-route: no active AI / no usable endpoint' } }));
        return;
      }
      const isAnthropicIn = isMsg;
      for (let i = 0; i < eps.length; i++) {
        const ep = eps[i];
        try {
          let upReq = convertRequest(isAnthropicIn, ep.api === 'anthropic-messages', body, ep.model);
          stripSamplingParams(upReq);
          upReq.stream = false;
          const upResp = await callUpstream(ep, upReq);
          const out = convertResponse(isAnthropicIn, ep.api === 'anthropic-messages', upResp);
          if (wantStream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            for (const chunk of sseChunks(isAnthropicIn, out)) res.write(chunk);
            res.end();
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(out));
          }
          process.stderr.write('[ai-route] ' + (active ? active.name : '?') + ' -> ' +
            ep.api + ' ' + ep.model + ' @ ' + ep.baseUrl + (i ? ' (fallback #' + (i + 1) + ')' : '') + '\n');
          return;
        } catch (e) {
          process.stderr.write('[ai-route] endpoint ' + i + ' failed: ' + String(e.message).slice(0, 120) + '\n');
        }
      }
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'ai-route: all endpoints failed', type: 'route_error' } }));
    });
  });
  server.listen(port, '127.0.0.1', () => {
    const { active, eps } = currentRoute();
    process.stderr.write('[ai-route] listening on http://127.0.0.1:' + port + '\n');
    if (active) process.stderr.write('[ai-route] active AI: ' + active.name + ' (' + active.model + ')\n');
    (eps || []).forEach((e, i) =>
      process.stderr.write('[ai-route] endpoint[' + i + ']: ' + e.api + ' ' + e.model + ' @ ' + e.baseUrl + '\n'));
  });
}

module.exports = { startProxy };
