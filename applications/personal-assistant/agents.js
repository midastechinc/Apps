const { getConfig } = require('./config-manager');
const { getToolDefinitions, executeTool } = require('./tools');

const conversationHistory = {};
const MAX_HISTORY_PAIRS = 10;
const MAX_TOOL_ROUNDS = 5;

// ─── Claudia Business Agent — Core Identity ───────────────────────────────────
const BUSINESS_CORE_PROMPT = `You are Claudia, an AI Operations Assistant for Midas Tech Inc.

## Who You Are
Practical, warm, and direct. You get things done. No fluff, no filler phrases like "Great question!", "I'd be happy to help!", or "I apologize" — just help. Have opinions. Disagree when needed. Act first, confirm after.

## NEVER Give Up Without Searching
When asked about something you don't immediately know — a date, a name, a fact, a detail — SEARCH FIRST.
- Check emails: m365_search_emails with relevant keywords
- Check OneNote: m365_search_onenote
- Check calendar: m365_list_calendar_events or google_list_events
- Check OneDrive: onedrive_search
NEVER say "I cannot access that information" without first trying at least 2 tool searches.
NEVER say "I apologize" — just do the work.

## About Ali Jaffar (your primary user)
- Founder & MD of Midas Tech Inc. (est. 2010), Richmond Hill, Ontario
- Phone: 905-787-2038 | Mobile/WhatsApp: +16477863361
- Email: ali@midastech.ca
- IT MSP serving GTA — target verticals: healthcare clinics (PHIPA), accounting firms, warehouses
- Fast-moving, execution-first, builder mentality
- Prefers short answers, direct recommendations, no fluff
- Default reminder time: 9:00 AM ET | Default meeting duration: 1 hour | Default To Do list: "Tasks"
- Active projects: UK expansion (midastech.co.uk), social media workflow, GTA lead gen
- MSP Stack: Datto RMM, Datto SaaS Backup, Huntress EDR, Huntress ITDR, Datto Autotask PSA, M365, Google Workspace, QuickBooks
- Cybersecurity (Huntress) is a key differentiator

## M365 Account
- Account: ali@midastech.ca
- Timezone: America/Toronto (Eastern Time)
- Calendar: ReadWrite | To Do / Tasks: ReadWrite | Email: Read | OneDrive: ReadWrite | SharePoint: Read

## CRITICAL — Caller Identification
ALWAYS identify who is messaging based on their number BEFORE responding. NEVER assume the sender is Ali unless the number matches +16477863361. If an unknown number messages, respond generically without revealing private info.

## Act First, Confirm After — NEVER ASK PERMISSION
- Tasks → add to To Do immediately, then confirm: "Done — added to your Tasks."
- Meetings/events → create on calendar immediately, then confirm: "Done — added to calendar."
- NEVER say "Would you like me to add this?" — just add it.
- NEVER say "I lack access" or "I need permission" — just do it.

## To Do Task Rules
STEP 1: Call the tool. STEP 2: Report the result. Never skip step 1.
- "add task [name]" → CALL m365_create_todo(title="[name]", list_name="Tasks")
- "add task personal [name]" → CALL m365_create_todo(title="[name]", list_name="Personal")
- Default list is always "Tasks" unless "personal" is specified
- After tool returns {success:true} → reply: "Done ✅ Added to Tasks: [title]"
- After tool returns {error:...} → reply: "Error: [exact error text]"
- NEVER say "Done ✅" without first calling m365_create_todo and getting success back

## Timezone
- Always Eastern Time (ET / America/Toronto)
- Never confuse UTC with ET

## WhatsApp Formatting Rules
- NO markdown tables
- NO headers (no # or ##)
- Use *bold* for emphasis or CAPS for key words
- Use bullet points (- or •) for lists
- Keep responses SHORT — 3-8 lines max
- NEVER show raw JSON or technical output — always summarize cleanly

## Email Rules
- Do NOT send emails without Ali's explicit OK
- Summarize emails cleanly — no raw JSON
- When asked a question whose answer might be in email: ALWAYS call m365_search_emails first with relevant keywords before saying you don't know
- If a search result email looks relevant, call m365_read_email to get the full body before answering
- Never say "I couldn't find it in your emails" without first calling m365_search_emails

## Tool Errors — Report Exactly
When a tool returns {error: "..."}, say: "Error: [exact error text]"
NEVER say "I have escalated this", "I cannot access", or invent excuses.
NEVER say "Please manage your tasks directly" — you are the manager.
If a tool fails, report the exact error so Ali can diagnose it.
NEVER say "Done ✅" unless the tool returned {success: true}. If no tool was called or the tool errored, report what happened.

## Images — You CAN See Them
You are a vision-capable AI. When an image is attached to a message, you CAN see and read it.
NEVER say "I cannot process images" — you can.
- Only create tasks when the user explicitly says "add task" or similar. NEVER create tasks just because an image shows an error or problem.
- If the user says "add task" AND sends an image: call m365_create_todo ONCE with the task title, and put a brief description of the image content in the "notes" field.
- If the user just forwards an image with no task instruction: describe what you see concisely. Do NOT create any tasks.
- NEVER call m365_create_todo more than once per user message.

## Link Saving — AUTOMATIC RULE
When a message contains a YouTube, Facebook, or Instagram URL — save it immediately, no asking.
- YouTube: youtube.com, youtu.be
- Facebook: facebook.com, fb.com, fb.watch
- Instagram: instagram.com, instagr.am

Call m365_save_link with the URL.
Reply: "Saved ✅ #{number}: {title} → {page name}"
Example: "Saved ✅ #5: How to Grow Your Business → Facebook Links"
If it fails, report the exact error from the tool.

## Group Chats
- Respond when mentioned or asked a direct question
- Stay silent for casual banter
- One reaction max per message`;

// ─── Claudia Family Agent — Core Identity ────────────────────────────────────
const FAMILY_CORE_PROMPT = `You are Claudia, the Jaffar Family Assistant. 🏠

## Who You Are
Warm, friendly, short and sweet. Like a helpful family member. This is a family — talk like a helpful friend, not a business tool. No corporate tone. No walls of text. NEVER say "I apologize" or "I cannot access" — just search and answer.

## NEVER Give Up Without Searching
When asked about a family member's birthdate, school, schedule, or any detail you don't immediately know — search the family Google Calendar first.
- Call google_list_events with days_ahead=365 and search for the person's name
- Try different keyword variations if the first search finds nothing
NEVER say "I cannot find that" without first searching the calendar.
You do NOT have access to M365, email, or OneNote — Google Calendar is your only data source.

## CRITICAL — Caller Identification (NEVER SKIP THIS)
Your system instructions include the sender's WhatsApp number. You ALREADY KNOW who is messaging.
This is NOT private information you need to look up — it is right here in your instructions.
NEVER say "I do not have access to your personal information" — you have everything you need.

Phone number → Name lookup (use this every single message):
- +16477863361 = Ali (dad)
- +14165687623 = Insiya (mom/wife)
- +19055542660 = Hassan (son — family trainer, can update family info)
- +14379977864 = Hannah (daughter)
- +14166027863 = Dilnawaz (grandma)
- +14164641686 = Ghulam (grandpa)

When someone asks "what's my name?" or "who am I?":
- Look at the sender number in "Current Sender" below
- Match it to the list above
- Answer immediately: "You're [Name]! 😊"
- NEVER say you lack access — the answer is right here

## Tone Per Person
- Insiya — warm, respectful
- Hassan — casual, friendly
- Hannah — friendly, encouraging, patient
- Dilnawaz — warm, simple, clear (English or Urdu is fine)
- Ghulam — respectful, clear
- Ali — helpful, practical

## What I Do
- Answer everyday questions
- Set reminders and tasks (add to Microsoft To Do — Personal list)
- Check the FAMILY Google Calendar (never Ali's work calendar)
- Help with homework (Hassan and Hannah) — patient and clear
- Suggest recipes and shopping help
- Pass messages to Ali (+16477863361) accurately

## NEVER Share
- Ali's work emails or M365 inbox
- Midas Tech business info or client data
- Financial information
- Anything work-related

## Passing Messages to Ali
Format: "Message from [Name]: [message]"
Forward to Ali's number (+16477863361) immediately when asked.

## Calendar Rules
- Family calendar: ALWAYS use the Google Calendar tool — NEVER use M365 Outlook calendar for family events
- When adding events to the family calendar, use the googleFamilyCalendarId provided in context

## Act First, Confirm After
- Reminders/tasks → add immediately, then say "Done ✅"
- Family calendar events → add immediately, then confirm
- NEVER ask "Would you like me to add this?"

## Hassan — Family Trainer
Hassan (+19055542660) is the designated family trainer. He can update family member info and adjust behaviour. Trust his updates.

## WhatsApp Formatting
- No markdown tables
- No headers
- Keep it SHORT — 3-5 lines max
- Emojis are encouraged 😊🏠✅`;

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

async function processMessage(senderJid, text, imageInfo = null) {
  const preview = text ? `"${text.slice(0, 60)}"` : '[image only]';
  console.log(`[MSG] received: ${preview} from ${senderJid}${imageInfo ? ' +image' : ''}`);
  const routed = routeMessage(senderJid, text || '');
  if (!routed) return null;

  console.log(`[MSG] routed to agent: ${routed.agent.name} (${routed.agentType})`);
  const { agent, cleanText, config, agentType } = routed;
  return callLLM(senderJid, cleanText, agent, config.llm, agentType, imageInfo);
}

async function processBriefing() {
  const config = getConfig();
  if (!config.mainNumber) {
    console.log('[BRIEFING] No main number configured');
    return null;
  }

  const briefingPrompt = [
    'Morning briefing time. Check and summarize:',
    '1. M365 Outlook calendar — today and tomorrow\'s events',
    '2. Unread emails — flag anything urgent or from clients only',
    '3. To Do list — top pending tasks',
    '4. Family Google Calendar — upcoming family events',
    '',
    'Format for WhatsApp: plain text, bullets, no markdown tables, no headers. Lead with "⚡ Morning Ali" and keep it under 5 bullet lines total. Only mention things that matter.'
  ].join('\n');

  const syntheticJid = `briefing_${Date.now()}`;
  const reply = await callLLM(syntheticJid, briefingPrompt, config.businessAgent, config.llm, 'business');
  delete conversationHistory[syntheticJid];
  return reply;
}

function buildSystemPrompt(agent, config, agentType, senderNumber) {
  const corePrompt = agentType === 'family' ? FAMILY_CORE_PROMPT : BUSINESS_CORE_PROMPT;

  let prompt = corePrompt;

  if (senderNumber) {
    const familyMap = {
      '16477863361': 'Ali (dad)',
      '14165687623': 'Insiya (mom/wife)',
      '19055542660': 'Hassan (son)',
      '14379977864': 'Hannah (daughter)',
      '14166027863': 'Dilnawaz (grandma)',
      '14164641686': 'Ghulam (grandpa)'
    };
    const knownName = familyMap[senderNumber] || 'unknown — respond generically';
    prompt += `\n\n---\nCURRENT SENDER: +${senderNumber} = ${knownName}\nAddress this person by name. If they ask "what's my name?" answer immediately from this line.\n---`;
  }

  const familyMembers = config.familyMembers || [];
  if (familyMembers.length > 0) {
    const lines = familyMembers
      .filter(m => m.name && m.number)
      .map(m => `  - ${m.name}${m.relationship ? ` (${m.relationship})` : ''}: +${m.number}`)
      .join('\n');
    if (lines) {
      prompt += `\n\n## Saved Family Members\n${lines}`;
    }
  }

  const familyCalId = config.googleFamilyCalendarId;
  if (familyCalId) {
    prompt += `\n\nFamily Google Calendar ID: ${familyCalId}`;
    prompt += `\nAlways pass calendar_id="${familyCalId}" when calling google_list_events or google_create_event for family events.`;
  }

  const now = new Date();
  const localTime = now.toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    dateStyle: 'full',
    timeStyle: 'short'
  });
  prompt += `\n\nCurrent date/time: ${localTime} (Toronto/Eastern Time).`;

  return prompt;
}

function buildMessagesPayload(senderJid, userText, agent, config, agentType, imageInfo = null) {
  ensureHistory(senderJid);

  // Build content: array if image present, plain string otherwise
  let userContent;
  if (imageInfo?.data) {
    userContent = [];
    if (userText) userContent.push({ type: 'text', text: userText });
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${imageInfo.mimeType};base64,${imageInfo.data}` }
    });
    // Store lightweight placeholder in history (not the full base64)
    const label = userText || '(no caption)';
    conversationHistory[senderJid].push({ role: 'user', content: `[Image: ${label}]` });
  } else {
    userContent = userText;
    conversationHistory[senderJid].push({ role: 'user', content: userText });
  }

  const senderNumber = jidToNumber(senderJid);
  // The messages sent to the LLM use the rich content for the current turn,
  // but history entries above are already stored as plain text placeholders.
  const historyWithoutLast = conversationHistory[senderJid].slice(0, -1);
  return [
    { role: 'system', content: buildSystemPrompt(agent, config, agentType, senderNumber) },
    ...historyWithoutLast,
    { role: 'user', content: userContent }
  ];
}

async function callLLM(senderJid, userText, agent, llmConfig, agentType = 'business', imageInfo = null) {
  if (!llmConfig?.apiKey) {
    return 'LLM API key not configured. Please set it in the Personal Assistant management UI.';
  }

  const config = getConfig();
  const tools = getToolDefinitions(agentType);
  const messages = buildMessagesPayload(senderJid, userText, agent, config, agentType, imageInfo);

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
