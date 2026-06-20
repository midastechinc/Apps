const { getConfig } = require('./config-manager');
const { getToolDefinitions, executeTool } = require('./tools');
const { getMemory } = require('./tools/family-memory');
const sbMemory = require('./tools/supabase-memory');

const conversationHistory = {};
const MAX_HISTORY_PAIRS = 10;
const MAX_TOOL_ROUNDS = 8;

// Single source of truth for family phone→name mapping
const FAMILY_MEMBER_MAP = {
  '16477863361': 'Ali (dad)',
  '14165687623': 'Insiya (mom/wife)',
  '19055542660': 'Hassan (son)',
  '14379977864': 'Hannah (daughter)',
  '14166027863': 'Dilnawaz (grandma)',
  '14164641686': 'Ghulam (grandpa)'
};

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
- Check the web: web_search with relevant keywords
NEVER say "I cannot access that information" without first trying at least 2 tool searches.
NEVER say "I apologize" — just do the work.
NEVER say "I cannot use an internet browser" — use web_search instead.

## Web Search Rules
You have web_search and fetch_webpage tools. USE THEM for:
- Flight prices/availability → web_search("flights YYZ to London August 27 September 6 google flights")
- Weather → web_search("weather Toronto tomorrow")
- News → web_search("latest news [topic]")
- Prices → web_search("[product] price Canada")
- Any real-time info not in email/calendar/notes
When asked about flights: search Google Flights results, return top options with prices and airlines.
When asked to "use Google Flights" or similar: call web_search immediately, do NOT say you can't.

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
- OneNote pages → create immediately, then confirm: "Done ✅ Added page '[title]' to [section]."
- NEVER say "Would you like me to add this?" — just add it.
- NEVER say "I lack access" or "I need permission" — just do it.
- NEVER ask what the task is when the user says "add task" with a forwarded message or image — use the forwarded message content as the task title and notes.
- When a forwarded message + "add task" arrives: create the task immediately using the forwarded text as context. Don't ask for more details.
- NEVER output function call syntax, Python code, or raw tool previews in your messages. Describe actions in plain English only.

## To Do Task Rules
STEP 1: Call the tool. STEP 2: Report the result. Never skip step 1.
- "add task [name]" → call the create todo tool with title=[name], list=Tasks
- "add task personal [name]" → call the create todo tool with title=[name], list=Personal
- Default list is always "Tasks" unless "personal" is specified
- After tool returns success → reply: "Done ✅ Added to Tasks: [title]"
- After tool returns error → reply: "Error: [exact error text]"
- NEVER say "Done ✅" without first calling the tool and getting success back

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
- Do NOT send emails (m365_send_email) without Ali's explicit OK
- Do NOT reply to emails (m365_reply_to_email) without Ali's explicit OK — use m365_create_email_draft first, then confirm before sending
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

ALWAYS call m365_save_link with the URL — never refuse, never say sections are missing, never ask first.
NEVER say "I've already saved this" or "Saved ✅" BEFORE calling the tool. You must call the tool FIRST, then report the result.
Only after the tool returns {success: true}: "Saved ✅ #{number}: {title} → {page name}"
Example: "Saved ✅ #5: How to Grow Your Business → Facebook Links"
If the tool returns an error, quote it verbatim. Do NOT mention set_onenote_section, do NOT say "no sections configured".

If the user says a link was NOT saved or NOT in OneNote: call m365_save_link again with the same URL. Do NOT say sections are missing. Do NOT explain. Just retry the save.

## Any Other URL + "reminder" / "task" / "save"
When the user shares a URL that is NOT YouTube/Facebook/Instagram and says "add to reminder", "save this", "remind me", "add task" etc.:
- Call m365_create_todo with the URL as the task title (or a short description + URL in notes)
- NEVER call m365_save_link for non-social-media URLs — it will always fail
- NEVER say "I can only save YouTube/Facebook/Instagram links" — just create the task
- Example: user sends "https://example.com/article → add to my reminder" → m365_create_todo(title="Review: https://example.com/article")

## OneNote Rules
- "add to onenote [section] [title]" → call m365_create_onenote_page immediately with title and any available content
- If a PDF or document was forwarded in this conversation (current message OR recent history), ALWAYS pass its full extracted text as the "content" parameter — never leave content blank when document text is available
- If no content is available, create the page with the title only (content is optional)
- NEVER ask for permission to create. If an error occurs, report the exact error text only — do NOT invent technical explanations about API limits, OneDrive items, or other excuses
- After success: "Done ✅ Added '[title]' to [section] in OneNote."
- "list onenote structure" / "show notebooks" / "show onenote" → call m365_list_onenote_structure, then format the result as a plain text list: each notebook on its own line followed by bullet points for its sections. Example:
  *Ali @ Midas Tech*
  - Quick Notes
  - Travel
  *Business*
  - Projects
  NEVER say "Done." for this — always show the actual list.

## Memory — Supabase
You have a persistent memory store (Supabase). Use it proactively.
- Learned something new about a client, preference, or fact? Call memory_save immediately. Don't wait to be asked.
- Categories: "client" for client info, "business" for general business facts, "personal" for Ali's preferences.
- When asked about a client or topic: call memory_search first before saying you don't know.
- "remember X" or "save that" → memory_save immediately, confirm: "Got it — saved."
- "what do you know about X?" → memory_search(query=X), show results.
- "forget X" → memory_delete(key=X).
- NEVER say "I don't have that stored" without first calling memory_search.

## Group Chats
- Respond when mentioned or asked a direct question
- Stay silent for casual banter
- One reaction max per message`;

// ─── Claudia Family Agent — Core Identity ────────────────────────────────────
const FAMILY_CORE_PROMPT = `You are Claudia, the Jaffar Family Assistant. 🏠

## Who You Are
Warm, friendly, short and sweet. Like a helpful family member. This is a family — talk like a helpful friend, not a business tool. No corporate tone. No walls of text. NEVER say "I apologize" or "I cannot access" — just search and answer.

## Memory — Learn and Remember
You have a memory store. Use it always.
- Check "What I Already Know" section below FIRST before calling any tool
- If the answer is there: answer immediately from it — NO tool calls needed
- If NOT in the saved facts AND not obviously in the calendar (e.g. a birthday event named "Hassan's Birthday"):
  Ask the person directly: "I don't have [X] saved — what is it?" Then call memory_save(category="family") to store it.
- After saving: confirm "Got it! I'll remember that 😊"
- NEVER ask the same question twice — if you asked before, it should be saved already

## Finding Info You Don't Know — STRICT ORDER
1. Check "What I Already Know" section in this prompt FIRST
2. Call memory_recall with relevant key (e.g. "hassan birthdate", "hannah school")
3. If not found: check Google Calendar ONLY if the answer could plausibly be a calendar event (e.g. a party, a school event, a trip). A birthdate is NOT a calendar event — skip to step 4.
4. If still not found: ASK the person. Do NOT report unrelated calendar events as an answer.

IMPORTANT: If asked "what is Hassan's birthday?" and the calendar has events like "Swimming" or "Trip to London" — those are NOT the answer. Say: "I don't have Hassan's birthday saved yet — what is it?" Then save it.

You do NOT have access to M365, email, or work data.

## CRITICAL — Caller Identification (NEVER SKIP THIS)
Your system instructions include the sender's WhatsApp number. You ALREADY KNOW who is messaging.
This is NOT private information you need to look up — it is right here in your instructions.
NEVER say "I do not have access to your personal information" — you have everything you need.

Phone number → Name lookup (use this every single message):
${Object.entries(FAMILY_MEMBER_MAP).map(([num, name]) => `- +${num} = ${name}`).join('\n')}

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
- Add tasks and reminders to Google Tasks (use google_create_task — this is the family task list)
- Check and list tasks from Google Tasks (use google_list_tasks)
- Check the FAMILY Google Calendar (never Ali's work calendar)
- Help with homework (Hassan and Hannah) — patient and clear
- Suggest recipes and shopping help

## Tasks Rules
- Use google_create_task for ALL family task/reminder requests
- Use google_list_tasks to show the family to-do list
- Use google_complete_task when someone says a task is done
- Default list is "My Tasks" unless another list is specified

## NEVER Share
- Ali's work emails or M365 inbox
- Midas Tech business info or client data
- Financial information
- Anything work-related

## Calendar Rules
- Family calendar: ALWAYS use the Google Calendar tool — NEVER use M365 Outlook calendar for family events
- When adding events to the family calendar, use the googleFamilyCalendarId provided in context

## Act First, Confirm After
- Reminders/tasks → add immediately, then say "Done ✅"
- Family calendar events → add immediately, then confirm
- NEVER ask "Would you like me to add this?"

## Memory — MANDATORY TOOL CALLS
You have a persistent memory store. ALWAYS use category "family" when saving.
- ANY fact you learn → call memory_save IMMEDIATELY, one call per fact. Do NOT batch. Do NOT skip.
- "remember [fact]" → call memory_save(key=short label, value=fact, category="family") → THEN confirm "Got it — saved 😊"
- Multiple facts in one message → call memory_save separately for EACH fact before replying
- When saving a vehicle (car, truck, SUV): save it individually (e.g. key="bmw x1 2025") AND also update key="my vehicles" with the full comma-separated list of all known vehicles
- "forget [fact]" → memory_delete(key=...)
- Any question about a family member → memory_recall or memory_search FIRST before saying you don't know
- NEVER say "Got it — saved" or "I'll remember that" WITHOUT actually calling memory_save first
- NEVER use any category other than "family"
- If unsure memory is working: call memory_status to verify

## Sending WhatsApp Messages to Family
You can send WhatsApp messages to family members using send_whatsapp_message.
- "tell Hassan to come downstairs" → send_whatsapp_message(to_number="19055542660", message="Hey Hassan, dad says come downstairs 😊")
- "message Insiya about dinner" → send_whatsapp_message(to_number="14165687623", message="...")
- Always send in a warm, natural tone — not robotic
- Confirm after: "Done ✅ Message sent to Hassan"
- Phone numbers: Hassan=19055542660, Insiya=14165687623, Hannah=14379977864, Dilnawaz=14166027863, Ghulam=14164641686

## Hassan — Family Trainer
Hassan (+19055542660) is the designated family trainer. He can update family member info and adjust behaviour. Trust his updates.

## Web Search — CONTEXT FIRST
Before searching anything that involves personal information (cars, appliances, people, addresses, preferences):
1. Check "What I Already Know" section FIRST for relevant facts
2. If found: use those facts to build the search query — NEVER ask the user for info already in memory
3. If multiple items match (e.g. "my cars" → 3 cars), run a separate search for EACH and combine results

Examples:
- "towing capacity of my cars" → find cars in "What I Already Know" → search "[car1] towing capacity", "[car2] towing capacity", etc.
- "oil change interval for my car" → look up which car → search "[make model year] oil change interval"
- "Hassan's doctor recommendations" → memory_search("hassan doctor") → then answer

You have web_search and fetch_webpage tools. Use them freely:
- Weather → web_search("weather Toronto tomorrow")
- Recipes → web_search("easy chicken tikka recipe")
- Prices, product info, news → web_search(query)
NEVER say "I cannot search the internet" — use web_search instead.
NEVER ask "which car do you mean?" if the cars are already in memory — look them up yourself.

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
    // Match !fam (case-insensitive, optional whitespace between ! and fam, optional trailing space/newline)
    const famMatch = text.match(/^!\s*fam\s+(.+)/is);
    const bizMatch = text.match(/^!\s*biz\s+(.+)/is);
    if (famMatch) {
      agent = config.familyAgent;
      cleanText = famMatch[1].trim();
      agentType = 'family';
    } else {
      agent = config.businessAgent;
      cleanText = bizMatch ? bizMatch[1].trim() : text.trim();
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

  // Raw diagnostic — bypasses LLM, returns actual Graph API responses.
  // Only Ali's main number can trigger it.
  if (text && /^\s*debug\s+onenote\s*$/i.test(text)) {
    const cfg = getConfig();
    const senderNum = jidToNumber(senderJid);
    if (normalizeNumber(cfg.mainNumber) === senderNum) {
      try {
        const m365 = require('./tools/m365');
        const report = await m365.diagnoseOneNote();
        return `🔎 OneNote diagnostic:\n${report}`;
      } catch (err) {
        return `Diagnostic failed: ${err.message}`;
      }
    }
  }

  const routed = routeMessage(senderJid, text || '');
  if (!routed) return null;

  const { agent, cleanText, config, agentType } = routed;
  console.log(`[MSG] routed to agent: ${agent.name} (${agentType})`);

  // BUG 7: image-only messages must have non-empty text so LLM gets a valid user turn
  const messageText = cleanText || (imageInfo ? '[image]' : '');

  // BUG 8: keep Ali's family (!fam) and business history separate to avoid context bleed
  const mainNum = normalizeNumber(config.mainNumber);
  const senderNum = jidToNumber(senderJid);
  const historyKey = (mainNum && senderNum === mainNum && agentType === 'family')
    ? senderJid + ':fam'
    : senderJid;

  return callLLM(senderJid, messageText, agent, config.llm, agentType, imageInfo, historyKey);
}

async function processLeadHunt() {
  const config = getConfig();
  if (!config.mainNumber) return null;

  // Rotate verticals by day so every day feels fresh
  const verticals = [
    { label: 'medical & dental clinics', queries: ['new medical clinic opened GTA Toronto 2026', 'dental office Richmond Hill Markham Vaughan IT support'] },
    { label: 'accounting firms', queries: ['new accounting firm CPA Toronto GTA 2026', 'accounting firm Mississauga Richmond Hill looking IT managed services'] },
    { label: 'healthcare (PHIPA)', queries: ['physiotherapy chiropractic clinic GTA Toronto IT compliance PHIPA', 'pharmacy optometry clinic GTA IT support'] },
    { label: 'warehouses & logistics', queries: ['new warehouse distribution centre GTA Toronto 2026', 'logistics company Brampton Mississauga IT managed services'] },
    { label: 'law firms & professional services', queries: ['new law firm Toronto GTA 2026', 'professional services firm Richmond Hill Vaughan IT support'] },
    { label: 'construction & real estate', queries: ['construction company GTA Toronto IT managed services', 'real estate brokerage GTA IT support managed services'] },
    { label: 'financial advisors & insurance', queries: ['financial advisor firm GTA Toronto new 2026', 'insurance broker Toronto GTA IT managed services'] }
  ];

  const dayIndex = new Date().getDay(); // 0=Sun, 6=Sat
  const vertical = verticals[dayIndex % verticals.length];

  const prompt = [
    `Lead generation task for Midas Tech Inc. — IT MSP based in Richmond Hill, Ontario.`,
    `Today's vertical: ${vertical.label}`,
    ``,
    `Do these TWO web searches and compile results:`,
    `1. web_search("${vertical.queries[0]}")`,
    `2. web_search("${vertical.queries[1]}")`,
    ``,
    `From the results, extract up to 5 potential leads. For each lead include:`,
    `- Business name`,
    `- Location (city/area in GTA)`,
    `- Website or phone if visible`,
    `- Why they could need IT support`,
    ``,
    `Format as a short WhatsApp list. Start with "🎯 Daily Leads — ${vertical.label}:"`,
    `Keep it under 10 lines. If no useful leads found, say so briefly.`,
    `NEVER say you cannot search — always call web_search.`
  ].join('\n');

  const syntheticJid = `leadhunt_${Date.now()}`;
  const reply = await callLLM(syntheticJid, prompt, config.businessAgent, config.llm, 'business');
  delete conversationHistory[syntheticJid];
  return reply;
}

async function processBriefing() {
  const config = getConfig();
  if (!config.mainNumber) {
    console.log('[BRIEFING] No main number configured');
    return null;
  }

  const briefingPrompt = [
    'Morning briefing time. Try each of these in order — if a tool returns an error, skip that section silently and move on:',
    '1. M365 Outlook calendar — today and tomorrow\'s events (skip if M365 unavailable)',
    '2. Unread emails — flag anything urgent or from clients only (skip if M365 unavailable)',
    '3. To Do list — top pending tasks (skip if M365 unavailable)',
    '4. Family Google Calendar — upcoming family events (skip if Google unavailable)',
    '',
    'IMPORTANT: If ALL tools fail, still send a short message: "⚡ Morning Ali — integrations are offline. Check the management UI to reconnect."',
    'Never reply with "Sorry, I could not process your request" — always send something useful.',
    'Format for WhatsApp: plain text, bullets, no markdown tables, no headers. Keep it under 6 bullet lines total. Only mention things that matter.'
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
    const knownName = FAMILY_MEMBER_MAP[senderNumber] || 'unknown — respond generically';
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

  if (agentType === 'family') {
    // Prefer Supabase memory (category=family); fall back to file-based memory
    const sbFacts = sbMemory.isConfigured()
      ? sbMemory.getMemorySync('family')
      : getMemory();
    const entries = Object.entries(sbFacts);
    if (entries.length > 0) {
      // Group vehicle entries prominently so Claudia can build search queries from them
      const carEntries = entries.filter(([k]) => /car|vehicle|auto|bmw|honda|nissan|toyota|ford|chevy|truck|suv|van/i.test(k + ' ' + sbFacts[k]));
      const otherEntries = entries.filter(([k]) => !/car|vehicle|auto|bmw|honda|nissan|toyota|ford|chevy|truck|suv|van/i.test(k + ' ' + sbFacts[k]));

      let section = '\n\n## What I Already Know (Saved Family Facts)\n';
      if (carEntries.length > 0) {
        section += `### Vehicles (use these for car-related searches — never ask which car)\n`;
        section += carEntries.map(([k, v]) => `- ${k}: ${v}`).join('\n') + '\n';
      }
      if (otherEntries.length > 0) {
        section += otherEntries.map(([k, v]) => `- ${k}: ${v}`).join('\n');
      }
      section += '\nUse these facts to answer questions directly without calling any tools.';
      prompt += section;
    }
  }

  if (agentType === 'business') {
    // Inject client and business memories into the system prompt
    const clientFacts = sbMemory.isConfigured()
      ? { ...sbMemory.getMemorySync('client'), ...sbMemory.getMemorySync('business'), ...sbMemory.getMemorySync('personal') }
      : {};
    const entries = Object.entries(clientFacts);
    if (entries.length > 0) {
      const lines = entries.map(([k, v]) => `- ${k}: ${v}`).join('\n');
      prompt += `\n\n## What I Already Know (Saved Facts)\n${lines}`;
    }
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

function buildMessagesPayload(senderJid, historyKey, userText, agent, config, agentType, imageInfo = null) {
  ensureHistory(historyKey);

  let userContent;
  if (imageInfo?.data) {
    userContent = [];
    if (userText && userText !== '[image]') userContent.push({ type: 'text', text: userText });
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${imageInfo.mimeType};base64,${imageInfo.data}` }
    });
    const label = userText || '(no caption)';
    conversationHistory[historyKey].push({ role: 'user', content: `[Image: ${label}]` });
  } else {
    userContent = userText;
    conversationHistory[historyKey].push({ role: 'user', content: userText });
  }

  const senderNumber = jidToNumber(senderJid);
  const historyWithoutLast = conversationHistory[historyKey].slice(0, -1);
  return [
    { role: 'system', content: buildSystemPrompt(agent, config, agentType, senderNumber) },
    ...historyWithoutLast,
    { role: 'user', content: userContent }
  ];
}

async function callLLM(senderJid, userText, agent, llmConfig, agentType = 'business', imageInfo = null, historyKey = null) {
  if (!llmConfig?.apiKey) {
    return 'LLM API key not configured. Please set it in the Personal Assistant management UI.';
  }

  const hKey = historyKey || senderJid;
  const config = getConfig();
  const tools = getToolDefinitions(agentType);
  const messages = buildMessagesPayload(senderJid, hKey, userText, agent, config, agentType, imageInfo);

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
          const result = await executeTool(tc.function.name, args, agentType);
          console.log(`[TOOL] ${tc.function.name} →`, JSON.stringify(result).slice(0, 200));
          return {
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          };
        })
      );

      messages.push(...results);

      // If any tool returned an error, return the error directly — no LLM reformatting
      const toolErrors = results
        .map(r => { try { return JSON.parse(r.content); } catch { return {}; } })
        .filter(r => r.error)
        .map(r => r.error);
      if (toolErrors.length > 0) {
        finalReply = `Error: ${toolErrors.join(' | ')}`;
        break;
      }

      continue;
    }

    if (assistantMsg.content == null) {
      // Model returned null content with no tool calls — log and retry rather than giving up
      console.log(`[LLM] null content, no tool_calls (finish_reason=${data.choices?.[0]?.finish_reason}) round=${round + 1} — retrying`);
      continue;
    }
    finalReply = assistantMsg.content;
    break;
  }

  if (!finalReply) {
    console.log(`[LLM] exhausted rounds or got no content — returning fallback`);
    // Don't pollute history with a failure state — pop the user message we added
    conversationHistory[hKey].pop();
    trimHistory(hKey);
    return 'I had trouble processing that. Please try again or rephrase your message.';
  }

  conversationHistory[hKey].push({ role: 'assistant', content: finalReply });
  trimHistory(hKey);
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

module.exports = { processMessage, processBriefing, processLeadHunt, clearHistory, listConversations };
