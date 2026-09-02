/**
 * lib/convert.js - openai <-> anthropic 协议转换(最小可用)
 *
 * 请求/响应双向映射;system 消息提取;结尾 assistant 补位;
 * 工具调用/图片不转换(非流式文本场景)。
 */
'use strict';

function openaiToAnthropicReq(body, model) {
  const messages = [];
  const systemParts = [];
  for (const m of (body.messages || [])) {
    if (m.role === 'system') { systemParts.push(m.content); continue; }
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  if (messages.length && messages[messages.length - 1].role === 'assistant') {
    messages.push({ role: 'user', content: '(continue)' });
  }
  const req = {
    model,
    max_tokens: body.max_tokens || body.max_completion_tokens || 1024,
    messages,
    ...(systemParts.length ? { system: systemParts.join('\n\n') } : {})
  };
  if (body.stream !== undefined) req.stream = !!body.stream;
  return req;
}

function anthropicToOpenaiReq(body, model) {
  const messages = [];
  if (body.system) messages.push({ role: 'system', content: body.system });
  for (const m of (body.messages || [])) {
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  const req = { model, messages, max_tokens: body.max_tokens || 1024 };
  if (body.stream !== undefined) req.stream = !!body.stream;
  return req;
}

function anthropicToOpenaiResp(r) {
  const text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const inTok = (r.usage && r.usage.input_tokens) || 0;
  const outTok = (r.usage && r.usage.output_tokens) || 0;
  return {
    id: r.id || 'chatcmpl-route', object: 'chat.completion',
    created: Math.floor(Date.now() / 1000), model: r.model,
    choices: [{
      index: 0, message: { role: 'assistant', content: text },
      finish_reason: r.stop_reason === 'end_turn' ? 'stop' : (r.stop_reason || 'stop')
    }],
    usage: { prompt_tokens: inTok, completion_tokens: outTok, total_tokens: inTok + outTok }
  };
}

function openaiToAnthropicResp(r) {
  const msg = (r.choices && r.choices[0] && r.choices[0].message) || {};
  return {
    id: r.id || 'msg-route', type: 'message', role: 'assistant', model: r.model,
    content: [{ type: 'text', text: String(msg.content || '') }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: (r.usage && r.usage.prompt_tokens) || 0,
      output_tokens: (r.usage && r.usage.completion_tokens) || 0
    }
  };
}

// 入口协议名 -> 请求转换
function convertRequest(isAnthropicIn, upstreamIsAnthropic, body, model) {
  if (isAnthropicIn) {
    return upstreamIsAnthropic ? body : anthropicToOpenaiReq(body, model);
  }
  return upstreamIsAnthropic ? openaiToAnthropicReq(body, model) : { ...body, model };
}

// 上游响应 -> 入口协议
function convertResponse(isAnthropicIn, upstreamIsAnthropic, resp) {
  if (isAnthropicIn) {
    return upstreamIsAnthropic ? resp : openaiToAnthropicResp(resp);
  }
  return upstreamIsAnthropic ? anthropicToOpenaiResp(resp) : resp;
}

// 流式请求的模拟响应(wantStream 时把一次性结果切成 SSE)
function sseChunks(isAnthropicIn, out) {
  const content = isAnthropicIn
    ? ((out.content || []).map(b => b.text).join('\n'))
    : (out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content) || '';
  if (isAnthropicIn) {
    return [
      'event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: out }) + '\n\n',
      'event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } }) + '\n\n',
      'event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n'
    ];
  }
  return [
    'data: ' + JSON.stringify({ id: out.id, object: 'chat.completion.chunk', model: out.model, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] }) + '\n\n',
    'data: [DONE]\n\n'
  ];
}

module.exports = { convertRequest, convertResponse, sseChunks };
