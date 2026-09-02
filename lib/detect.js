/**
 * lib/detect.js - 活跃 AI 探测与端点解析(ai-route 与 git hook 共用真源)
 *
 * 探测"最近活跃的 AI CLI 会话",解析出可用 API 端点(三级回退):
 *   1. 活跃 provider 直连(~/.pi/agent 的 model-hub.json + auth.json)
 *   2. 模型名映射(glm/claude/doubao 前缀 -> 火山网关)
 *   3. ~/.opencommit 静态配置
 *
 * 导出: detectActiveAi() / route() / staticEndpoint()
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const os = require('os');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { return null; }
}

// 在目录树中找 mtime 最新的 .jsonl(限深,避免全盘扫)
function newestJsonl(rootDir, maxDepth) {
  let best = null;
  function walk(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (depth < maxDepth) walk(p, depth + 1);
      } else if (ent.name.endsWith('.jsonl')) {
        let st; try { st = fs.statSync(p); } catch (e) { continue; }
        if (!best || st.mtimeMs > best.mtime) best = { path: p, mtime: st.mtimeMs };
      }
    }
  }
  walk(rootDir, 0);
  return best;
}

// pi: 最新会话 jsonl 最后一条的 provider/modelId
function srcPi() {
  const newest = newestJsonl(path.join(os.homedir(), '.pi', 'agent', 'sessions'), 2);
  if (!newest) return null;
  try {
    const lines = fs.readFileSync(newest.path, 'utf-8').trim().split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      let d; try { d = JSON.parse(lines[i]); } catch (e) { continue; }
      if (d.provider && d.modelId) {
        return { name: 'pi', mtime: newest.mtime, provider: d.provider, model: d.modelId };
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

// claude code: ~/.claude/projects 最新 jsonl 里最后的 assistant.model
function srcClaude() {
  const newest = newestJsonl(path.join(os.homedir(), '.claude', 'projects'), 2);
  if (!newest) return null;
  try {
    const lines = fs.readFileSync(newest.path, 'utf-8').trim().split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      let d; try { d = JSON.parse(lines[i]); } catch (e) { continue; }
      const m = d.message || {};
      if (m.role === 'assistant' && m.model) {
        return { name: 'claude', mtime: newest.mtime, provider: null, model: m.model };
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

// opencode: opencode.db message 表(需系统 sqlite3 CLI)
function srcOpencode() {
  const db = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  if (!fs.existsSync(db)) return null;
  let mtime;
  try { mtime = fs.statSync(db).mtimeMs; } catch (e) { return null; }
  try {
    const out = execFileSync('sqlite3', ['-readonly', db,
      "SELECT data FROM message WHERE data LIKE '%modelID%' ORDER BY time_updated DESC LIMIT 1"],
      { encoding: 'utf-8', timeout: 5000 });
    const d = JSON.parse(out.trim().split('\n')[0]);
    const model = (d.modelID) || (d.model && d.model.modelID);
    const provider = (d.providerID) || (d.model && d.model.providerID);
    if (model) return { name: 'opencode', mtime, provider: provider || null, model };
  } catch (e) { /* sqlite3 缺失或 db 忙 */ }
  return null;
}

// codex: sessions jsonl 的 turn_context.payload.model
function srcCodex() {
  const newest = newestJsonl(path.join(os.homedir(), '.codex', 'sessions'), 4);
  if (!newest) return null;
  try {
    const lines = fs.readFileSync(newest.path, 'utf-8').trim().split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      let d; try { d = JSON.parse(lines[i]); } catch (e) { continue; }
      const p = d.payload || {};
      if (p.type === 'turn_context' && p.model) {
        return { name: 'codex', mtime: newest.mtime, provider: null, model: p.model };
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

// 汇总: env 直通优先(pi 会话内),否则取 mtime 最新源
function detectActiveAi() {
  if (process.env.PI_PROVIDER && process.env.PI_MODEL) {
    return { name: 'pi(env)', mtime: Infinity, provider: process.env.PI_PROVIDER, model: process.env.PI_MODEL };
  }
  const sources = [srcPi(), srcClaude(), srcOpencode(), srcCodex()].filter(Boolean);
  sources.sort((a, b) => b.mtime - a.mtime);
  return sources[0] || null;
}

// provider -> { api, baseUrl, key, model };commandcode 双端点路由内置
function resolvePiProvider(provider, model) {
  const agentDir = path.join(os.homedir(), '.pi', 'agent');
  const hub = readJson(path.join(agentDir, 'model-hub.json'));
  const auth = readJson(path.join(agentDir, 'auth.json'));
  if (!hub || !auth) return null;
  const prov = (hub.providers || []).find(x => x.id === provider);
  const cred = auth[provider];
  if (!prov || !cred || !cred.key || !model) return null;
  let api = prov.api;
  if (provider === 'commandcode' && !/^claude-/.test(model)) api = 'openai-completions';
  return { api, baseUrl: prov.baseUrl, key: cred.key, model };
}

// 模型名 -> 可用端点(火山网关接受 glm/claude/doubao 系列)
function resolveByModelName(model) {
  const agentDir = path.join(os.homedir(), '.pi', 'agent');
  const hub = readJson(path.join(agentDir, 'model-hub.json'));
  const auth = readJson(path.join(agentDir, 'auth.json'));
  if (!hub || !auth) return null;
  function pick(providerId) {
    const prov = (hub.providers || []).find(x => x.id === providerId);
    const cred = auth[providerId];
    if (!prov || !cred || !cred.key || cred.key === '<YOUR_TOKEN>') return null;
    return { api: prov.api, baseUrl: prov.baseUrl, key: cred.key, model };
  }
  if (/^(glm-|claude-|doubao-)/i.test(model)) {
    return pick('ark-coding') || pick('ark-plan');
  }
  return null;
}

// ~/.opencommit 静态配置(最终兜底)
function staticEndpoint() {
  const cfg = {};
  try {
    for (const line of fs.readFileSync(path.join(os.homedir(), '.opencommit'), 'utf-8').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0) cfg[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch (e) { return null; }
  if (cfg.OCO_API_KEY && cfg.OCO_MODEL && cfg.OCO_API_KEY !== 'undefined') {
    const provider = (cfg.OCO_AI_PROVIDER || 'openai').toLowerCase();
    return {
      api: provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
      baseUrl: cfg.OCO_API_URL && cfg.OCO_API_URL !== 'undefined' ? cfg.OCO_API_URL : null,
      key: cfg.OCO_API_KEY,
      model: cfg.OCO_MODEL
    };
  }
  return null;
}

// 汇总路由:活跃源 + 去重后的候选端点列表(按优先级)
function route() {
  const active = detectActiveAi();
  const eps = [];
  if (active) {
    if (active.provider) {
      const r = resolvePiProvider(active.provider, active.model);
      if (r) eps.push(r);
    }
    const r2 = resolveByModelName(active.model);
    if (r2 && (!eps.length || eps[0].baseUrl !== r2.baseUrl)) eps.push(r2);
  }
  const st = staticEndpoint();
  if (st && (!eps.length || eps[0].baseUrl !== st.baseUrl)) eps.push(st);
  return { active, eps };
}

module.exports = { detectActiveAi, route, staticEndpoint };
