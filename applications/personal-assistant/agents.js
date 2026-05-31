const { getConfig } = require('./config-manager');

const conversationHistory = {};
const MAX_HISTORY_PAIRS = 10;

function routeMessage(senderJid, text) {
  const config = getConfig();
  const senderNumber = jidToNumber(senderJid);
  const { mainNumber, familyNumbers } = config;

  const isMain = mainNumber && senderNumber === normalizeNumber(mainNumber);
  const isFamily = familyNumbers.some(n => normalizeNumber(n) === senderNumber);

  if (!isMain && !isFamily) return null;

  let agent, cleanText;

  if (isMain) {
    if (text.startsWith('!fam ')) {
      agent = config.familyAgent;
      cleanText = text.slice(5).trim();
    } else {
      agent = config.businessAgent;
      cleanText = text.startsWith('!biz ') ? text.slice(5).trim() : text.trim();
    }
  } else {
    agent = config.familyAgent;
    cleanText = text.trim();
  }

  return { agent, cleanText, config };
}

async function processMessage(senderJid, text) {
  const routed = routeMessage(senderJid, text);
  if (!routed) return null;

  const { agent, cleanText, config } = routed;
  return callLLM(senderJid, cleanText, agent, config.llm);
}

async function callLLM(senderJid, userText, agent, llmConfig) {
  if (!llmConfig.apiKey) {
    return 'LLM API key not configured. Please set it in the Personal Assistant management UI.';
  }

  ensureHistory(senderJid);
  conversationHistory[senderJid].push({ role: 'user', content: userText });

  const messages = [
    { role: 'system', content: agent.systemPrompt },
    ...conversationHistory[senderJid]
  ];

  const response = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llmConfig.apiKey}`
    },
    body: JSON.stringify({
      model: llmConfig.model,
      messages,
      max_tokens: 1024
    })
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`LLM API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content ?? 'Sorry, I could not process your request.';

  conversationHistory[senderJid].push({ role: 'assistant', content: reply });
  trimHistory(senderJid);

  return reply;
}

function ensureHistory(senderJid) {
  if (!conversationHistory[senderJid]) {
    conversationHistory[senderJid] = [];
  }
}

function trimHistory(senderJid) {
  const hist = conversationHistory[senderJid];
  const maxMessages = MAX_HISTORY_PAIRS * 2;
  if (hist.length > maxMessages) {
    conversationHistory[senderJid] = hist.slice(-maxMessages);
  }
}

function clearHistory(senderJid) {
  delete conversationHistory[senderJid];
}

function listConversations() {
  return Object.entries(conversationHistory).map(([jid, messages]) => ({
    jid,
    number: jidToNumber(jid),
    messageCount: messages.length,
    lastMessage: messages[messages.length - 1]?.content?.slice(0, 80) ?? ''
  }));
}

function jidToNumber(jid) {
  return String(jid ?? '').replace(/@.*$/, '').replace(/[^0-9]/g, '');
}

function normalizeNumber(raw) {
  return String(raw ?? '').replace(/[^0-9]/g, '');
}

module.exports = { processMessage, clearHistory, listConversations };
