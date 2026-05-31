/**
 * server.js — Research Chat Backend
 *
 * 两组设计：
 *   A 组（无次数限制）：讨论生成式 AI 与教育公平
 *   B 组（最多 4 次）：讨论生成式 AI 与教育公平
 *
 * Setup:
 *   npm install
 *   export DEEPSEEK_API_KEY=sk-...
 *   node server.js
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ════════════════════════════════════════════════════════════
// 组别配置
// ════════════════════════════════════════════════════════════
const GROUP_CONFIG = {
  A: {
    limit: 100,   // Unlimited interaction 
    taskId: 'task_a',
    systemPrompt: `你是一位教育研究领域的学习助手，正在协助一项关于生成式人工智能与教育公平的研究。当前讨论题目：人工智能技术正在快速进入教育领域。有人认为 AI 能扩大优质教育资源的获取机会，从而促进教育公平；也有人认为 AI 可能进一步扩大不同学生之间的差距。你认为人工智能会促进还是削弱教育公平？
你的角色：
- 用中文回答，语气亲切、启发性强，鼓励学生深入思考
- 尽量不要经常提问
- 每次回答不超过 200 字，简洁有力`
  },
  B: {
    limit: 4,     // At most 4 times for interaction 
    taskId: 'task_b',
    systemPrompt: `你是一位教育研究领域的学习助手，正在协助一项关于生成式人工智能与教育公平的研究。当前讨论题目：人工智能技术正在快速进入教育领域。有人认为 AI 能扩大优质教育资源的获取机会，从而促进教育公平；也有人认为 AI 可能进一步扩大不同学生之间的差距。你认为人工智能会促进还是削弱教育公平？
你的角色：
- 用中文回答，语气亲切、启发性强，鼓励学生深入思考
- 尽量不要经常提问
- 每次回答不超过 200 字，简洁有力`
  }
};

// ════════════════════════════════════════════════════════════
// 参与者注册表（P01–P200）
// ════════════════════════════════════════════════════════════
const VALID_PIDS = new Set(
  Array.from({ length: 200 }, (_, i) => 'P' + String(i + 1).padStart(3, '0'))
);

// 内存状态：pid → { group: 'A'|'B'|null, remaining: number }
const participantState = new Map();

function getState(pid) {
  if (!participantState.has(pid)) {
    // group 和 remaining 在选组时初始化
    participantState.set(pid, { group: null, remaining: null });
  }
  return participantState.get(pid);
}

// ════════════════════════════════════════════════════════════
// 并发限制（原生实现，无需 p-limit）
// ════════════════════════════════════════════════════════════
function makeLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve).catch(reject).finally(() => { active--; next(); });
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
const limit = makeLimiter(10);

// ════════════════════════════════════════════════════════════
// 日志
// ════════════════════════════════════════════════════════════
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

function writeLog(pid, entry) {
  const file = path.join(LOG_DIR, `${pid}.ndjson`);
  try {
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error(`[LOG ERROR] ${pid}:`, err.message);
  }
}

// ════════════════════════════════════════════════════════════
// GET /api/status?pid=P07
// 登录验证，返回 PID 是否有效及当前状态
// ════════════════════════════════════════════════════════════
app.get('/api/status', (req, res) => {
  const pid = (req.query.pid || '').toUpperCase().trim();
  if (!VALID_PIDS.has(pid)) {
    return res.status(403).json({ valid: false, error: '编号无效，请联系研究人员。' });
  }
  const state = getState(pid);
  res.json({
    valid: true,
    group: state.group,          // null 表示尚未选组
    remaining: state.remaining,
  });
});

// ════════════════════════════════════════════════════════════
// POST /api/select-group
// 参与者选组（每个 PID 只能选一次）
// body: { pid, group: 'A'|'B', sessionId }
// ════════════════════════════════════════════════════════════
app.post('/api/select-group', (req, res) => {
  const { pid, group, sessionId } = req.body;
  const cleanPid = (pid || '').toUpperCase().trim();
  const cleanGroup = (group || '').toUpperCase().trim();

  if (!VALID_PIDS.has(cleanPid)) {
    return res.status(403).json({ error: '编号无效，请联系研究人员。' });
  }
  if (!['A', 'B'].includes(cleanGroup)) {
    return res.status(400).json({ error: '组别无效。' });
  }

  const state = getState(cleanPid);

  // 如果已经选过组，直接返回现有状态（防止刷新重选）
  if (state.group !== null) {
    return res.json({ group: state.group, remaining: state.remaining });
  }

  // 初始化组别和剩余次数
  state.group     = cleanGroup;
  state.remaining = GROUP_CONFIG[cleanGroup].limit;

  writeLog(cleanPid, {
    pid: cleanPid, sessionId: sessionId || null,
    eventType: 'group_selected', group: cleanGroup,
    timestamp: new Date().toISOString(),
  });

  console.log(`[GROUP] ${cleanPid} → 组别 ${cleanGroup} (限制: ${state.remaining})`);
  res.json({ group: cleanGroup, remaining: state.remaining });
});

// ════════════════════════════════════════════════════════════
// POST /api/chat
// ════════════════════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  const { pid, sessionId, message, taskId } = req.body;
  const cleanPid = (pid || '').toUpperCase().trim();

  if (!VALID_PIDS.has(cleanPid)) {
    return res.status(403).json({ error: '编号无效。', remaining: 0 });
  }

  const state = getState(cleanPid);

  if (!state.group) {
    return res.status(400).json({ error: '尚未选择组别。', remaining: 0 });
  }

  const config = GROUP_CONFIG[state.group];

  // B 组检查次数限制；A 组不限制
  if (state.group === 'B' && state.remaining <= 0) {
    return res.status(429).json({ error: '您的提问次数已达上限。', remaining: 0 });
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: '消息内容不能为空。' });
  }

  // 扣减次数（A 组 remaining 永远 100，不影响体验）
  state.remaining--;
  const submissionN = config.limit - state.remaining;
  const reqStart    = Date.now();

  let reply = '';
  try {
    reply = await limit(() => callDeepSeek(message, config.systemPrompt));
  } catch (err) {
    state.remaining++;
    console.error(`[API ERROR] ${cleanPid}:`, err.message);
    return res.status(502).json({ error: 'AI 服务暂时不可用，请稍后重试。' });
  }

  const latencyMs = Date.now() - reqStart;

  writeLog(cleanPid, {
    pid: cleanPid, sessionId: sessionId || null,
    group: state.group,
    taskId: taskId || config.taskId,
    eventType: 'submission',
    submissionN,
    timestamp: new Date().toISOString(),
    userMessage: message,
    aiResponse: reply,
    latencyMs,
    remaining: state.group === 'B' ? state.remaining : '无限制',
  });

  console.log(`[CHAT] ${cleanPid} 组别${state.group} 第${submissionN}次 | ${latencyMs}ms | 剩余${state.group === 'B' ? state.remaining : '∞'}`);

  res.json({
    reply,
    remaining: state.group === 'B' ? state.remaining : 999,
    group: state.group,
  });
});

// ════════════════════════════════════════════════════════════
// POST /api/log  （点击流、论文保存/提交等事件）
// ════════════════════════════════════════════════════════════
app.post('/api/log', (req, res) => {
  const { pid, sessionId, eventType, timestamp, taskId, ...rest } = req.body;
  const cleanPid = (pid || '').toUpperCase().trim();
  if (!VALID_PIDS.has(cleanPid)) return res.sendStatus(204);

  const state = getState(cleanPid);

  writeLog(cleanPid, {
    pid: cleanPid,
    sessionId: sessionId || null,
    group: state.group || null,
    taskId: taskId || 'unknown',
    eventType: eventType || 'unknown',
    timestamp: timestamp || new Date().toISOString(),
    ...rest
  });

  res.sendStatus(204);
});

// ════════════════════════════════════════════════════════════
// GET /api/admin/logs
// ════════════════════════════════════════════════════════════
app.get('/api/admin/logs', (req, res) => {
  const summary = [];
  for (const [pid, state] of participantState.entries()) {
    summary.push({
      pid,
      group: state.group,
      remaining: state.remaining,
      used: state.group ? GROUP_CONFIG[state.group].limit - state.remaining : 0,
    });
  }
  summary.sort((a, b) => a.pid.localeCompare(b.pid));
  res.json({ participants: summary, logDir: LOG_DIR });
});

// ════════════════════════════════════════════════════════════
// DeepSeek API 调用
// ════════════════════════════════════════════════════════════
async function callDeepSeek(userMessage, systemPrompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY env var not set');

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:       'deepseek-chat',
      max_tokens:  512,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '（无回复）';
}

// ════════════════════════════════════════════════════════════
// 启动
// ════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n🟧 研究服务器启动  →  http://localhost:${PORT}`);
  console.log(`   DeepSeek Key:    ${!!process.env.DEEPSEEK_API_KEY}`);
  console.log(`   参与者 ID:        P01 – P200（共 ${VALID_PIDS.size} 个）`);
  console.log(`   A 组限制:         无限制`);
  console.log(`   B 组限制:         4 次\n`);
});
