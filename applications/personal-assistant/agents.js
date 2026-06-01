const { getConfig } = require('./config-manager');
const { getToolDefinitions, executeTool } = require('./tools');

const conversationHistory = {};
const MAX_HISTORY_PAIRS = 10;
const MAX_TOOL_ROUNDS = 5;

function jidToNumber(jid) {
  return String(jid ?? '').replace(/@.*$/, '').replace(/[^0-9]/g, '');
}

function normalizeNumber(raw) {
  return String(raw ?? '').replace(/[^0-9]/g, '');
}

function routeMessage(senderJid, text) {
  const config = getConfig();
  const senderNumber = jidToNumber(senderJid);
  const { mainNumber, familyNumbers } = config;

  const normalizedMain = normalizeNumber(mainNumber);
  const isMain = mainNumber && senderNumber === normalizedMain;
  const isFamily = familyNumbers.some(n => normalizeNumber(n) === senderNumber);

  console.log(`[MSG] from=${senderJid} number=${senderNumber} isMain=${isMain} isFamily=${isFamily} mainConfigured=${normalizedMain}`);

  if (!isMain && !isFamily) {
    console.log(`[MSG] IGNORED — number not in whitelist`);
    return null;
  }

  let agent, cleanText, agentType;

  if (isMain) {
    if (text.startsWith('!fam ')) {
      agent = config.familyAgent;
      cleanText = text.slice(5).trim();
      agentType = 'family';
    } else {
      agent = config.businessAgent;
      cleanText = text.startsWith('!biz ') ? text.slice(5).trim() : text.trim();
      agentType = 'business';
    }
  } else {
    agent = config.familyAgent;
    cleanText = text.trim();
    agentType = 'family';
  }

  return { agent, cleanText, config, agentType };
}

async function processMessage(senderJid, text) {
  console.log(`[MSG] received: "${text.slice(0, 60)}" from ${senderJid}`);
  const routed = routeMessage(senderJid, text);
  if (!routed) return null;

  console.log(`[MSG] routed to agent: ${routed.agent.name} (${routed.agentType})`);
  const { agent, cleanText, config, agentType } = routed;
  return callLLM(senderJid, cleanText, agent, config.llm, agentType);
}

async function processBriefing() {
  const config = getConfig();
  if (!config.mainNumber) {
    console.log('[BRIEFING] No main number configured');
    return null;
  }

  const briefingPrompt = [
    'Give me a morning briefing. Please:',
    '1. Check my M365 Outlook calendar for today and tomorrow\'s events',
    '2. Check my unread emails for anything important or urgent',
    '3. Check my To Do list for pending tasks',
    '4. Check the family Google Calendar for upcoming family events',
    '',
    'Summarize everything concisely. Format for WhatsApp (plain text, use line breaks, no markdown). Keep it under 400 words.'
  ].join('\n');

  const syntheticJid = `briefing_${Date.now()}`;
  const reply = await callLLM(syntheticJid, briefingPrompt, config.businessAgent, config.llm, 'business');
  delete conversationHistory[syntheticJid];
  return reply;
}

function buildSystemPrompt(agent, config, agentType) {
  let prompt = agent.systemPrompt || '';

  const familyMembers = config.familyMembers || [];
  if (familyMembers.length > 0) {
    const lines = familyMembers
      .filter(m => m.name && m.number)
      .map(m => `  - ${m.name}${m.relationship ? ` (${m.relationship})` : ''}: ${m.number}`)
      .join('\n');
    if (lines) {
      prompt += `\n\nKnown family members:\n${lines}\nWhen someone messages you, address them by name if their number matches.`;
    }
  }

  const familyCalId = config.googleFamilyCalendarId;
  if (familyCalId) {
    prompt += `\n\nFamily shared Google Calendar ID: ${familyCalId}`;
    prompt += `\nAlways use calendar_id="${familyCalId}" when calling google_list_events or google_create_event for family events.`;
  }

  const now = new Date();
  const localTime = now.toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    dateStyle: 'full',
    timeStyle: 'short'
  });
  prompt += `\n\nCurrent date/time: ${localTime} (Toronto/Eastern).`;

  return prompt;
}

function buildMessagesPayload(senderJid, userText, agent, config, agentType) {
  ensureHistory(senderJid);
  conversationHistory[senderJid].push({ role: 'user', content: userText });
  return [
    { role: 'system', content: buildSystemPrompt(agent, config, agentType) },
    ...conversationHistory[senderJid]
  ];
}

async function callLLM(senderJid, userText, agent, llmConfig, agentType = 'business') {
  if (!llmConfig?.apiKey) {
    return 'LLM API key not configured. Please set it in the Personal Assistant management UI.';
  }

  const config = getConfig();
  const tools = getToolDefinitions(agentType);
  const messages = buildMessagesPayload(senderJid, userText, agent, config, agentType);

  let finalReply = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const reqBody = {
      model: llmConfig.model,
      messages,
      max_tokens: 1500
    };

    if (tools.length > 0) {
      reqBody.tools = tools;
      reqBody.tool_choice = 'auto';
    }

    const response = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.apiKey}`
      },
      body: JSON.stringify(reqBody)
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error(`[LLM] error ${response.status}: ${errBody}`);
      throw new Error(`LLM API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const assistantMsg = data.choices?.[0]?.message;
    if (!assistantMsg) break;

    const toolCalls = assistantMsg.tool_calls;

    if (toolCalls?.length > 0) {
      console.log(`[LLM] tool calls requested (round ${round + 1}):`, toolCalls.map(tc => tc.function.name));
      messages.push(assistantMsg);

      const results = await Promise.all(
        toolCalls.map(async tc => {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          const result = await executeTool(tc.function.name, args);
          return {
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          };
        })
      );

      messages.push(...results);
      continue;
    }

    finalReply = assistantMsg.content ?? 'Sorry, I could not process your request.';
    break;
  }

  if (!finalReply) finalReply = 'Sorry, I could not process your request after multiple attempts.';

  conversationHistory[senderJid].push({ role: 'assistant', content: finalReply });
  trimHistory(senderJid);
  console.log(`[LLM] response ready (${finalReply.length} chars)`);

  return finalReply;
}

function ensureHistory(senderJid) {
  if (!conversationHistory[senderJid]) conversationHistory[senderJid] = [];
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

module.exports = { processMessage, processBriefing, clearHistory, listConversations };
