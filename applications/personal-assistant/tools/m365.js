const { getConfig, updateConfig } = require('../config-manager');

const USER_PRINCIPAL = 'ali@midastech.ca';

// Cache token in memory to avoid hammering the token endpoint
let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  const config = getConfig();
  const m365 = config.integrations?.m365;
  if (!m365?.enabled || !m365?.clientId || !m365?.tenantId || !m365?.clientSecret) return null;

  // Return cached token if still valid (with 60s buffer)
  if (_cachedToken && Date.now() < _tokenExpiry - 60000) return _cachedToken;

  try {
    const resp = await fetch(
      `https://login.microsoftonline.com/${m365.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: m365.clientId,
          client_secret: m365.clientSecret,
          grant_type: 'client_credentials',
          scope: 'https://graph.microsoft.com/.default'
        })
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      console.error('[M365] Token fetch error:', resp.status, err.slice(0, 300));
      return null;
    }

    const data = await resp.json();
    _cachedToken = data.access_token;
    _tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    console.log('[M365] Token obtained via client_credentials');
    return _cachedToken;
  } catch (err) {
    console.error('[M365] Token fetch error:', err.message);
    return null;
  }
}

async function graphFetch(endpoint, options = {}) {
  const token = await getAccessToken();
  if (!token) {
    return { error: 'M365 not configured or token unavailable. Set credentials in the Integrations tab.' };
  }

  const resp = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!resp.ok) {
    const body = await resp.text();
    return { error: `Microsoft Graph ${resp.status}: ${body}` };
  }

  return resp.json();
}

async function graphFetchText(endpoint) {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const resp = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) return null;
    return resp.text();
  } catch {
    return null;
  }
}

async function fetchYouTubeTitle(url) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const resp = await fetch(oembedUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.title || null;
  } catch {
    return null;
  }
}

async function fetchPageTitle(url) {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
                 || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (ogMatch) return ogMatch[1].trim();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) return titleMatch[1].replace(/ [|\-–•] Facebook$/, '').replace(/ [|\-–•] Instagram$/, '').trim();
    return null;
  } catch {
    return null;
  }
}

function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/facebook\.com|fb\.com|fb\.watch/i.test(url)) return 'facebook';
  if (/instagram\.com|instagr\.am/i.test(url)) return 'instagram';
  return null;
}

const PLATFORM_CONFIG = {
  youtube:   { pageName: 'YouTube Links',   pageIdKey: 'youtubeLinksPageId',   hardcodedId: '1-a9da38968f2a4e05826e53d9b8c8f5e4!55-07f6fff2-e3b3-4a32-ad6f-3835ead68a3e' },
  facebook:  { pageName: 'Facebook Links',  pageIdKey: 'facebookLinksPageId',  hardcodedId: null },
  instagram: { pageName: 'Instagram Links', pageIdKey: 'instagramLinksPageId', hardcodedId: null }
};

async function findOneNotePageByTitle(titleToFind) {
  const lower = titleToFind.toLowerCase();

  // Fastest: direct search API across all pages in all notebooks
  const searchData = await graphFetch(`/users/ali@midastech.ca/onenote/pages?$search="${encodeURIComponent(titleToFind)}"&$select=id,title&$top=20`);
  if (!searchData.error) {
    const found = (searchData.value || []).find(p => p.title?.toLowerCase() === lower);
    if (found) {
      console.log(`[OneNote] Found "${titleToFind}" via pages search API`);
      return found;
    }
  }

  // Flat sections endpoint — covers Quick Notes and all sections across all notebooks
  const allSections = await graphFetch('/users/ali@midastech.ca/onenote/sections?$select=id,displayName&$top=100');
  if (!allSections.error) {
    for (const sec of (allSections.value || [])) {
      const pagesData = await graphFetch(`/users/ali@midastech.ca/onenote/sections/${sec.id}/pages?$select=id,title&$top=100`);
      if (pagesData.error) continue;
      const found = (pagesData.value || []).find(p => p.title?.toLowerCase() === lower);
      if (found) {
        console.log(`[OneNote] Found "${titleToFind}" in section "${sec.displayName}" via flat sections`);
        return found;
      }
    }
  }

  // Final fallback: traverse notebooks → sections (handles section groups)
  const notebooksData = await graphFetch('/users/ali@midastech.ca/onenote/notebooks?$select=id,displayName&$top=50');
  if (notebooksData.error) return null;
  for (const nb of (notebooksData.value || [])) {
    const sectionsData = await graphFetch(`/users/ali@midastech.ca/onenote/notebooks/${nb.id}/sections?$select=id,displayName&$top=50`);
    if (sectionsData.error) continue;
    for (const sec of (sectionsData.value || [])) {
      const pagesData = await graphFetch(`/users/ali@midastech.ca/onenote/sections/${sec.id}/pages?$select=id,title&$top=100`);
      if (pagesData.error) continue;
      const found = (pagesData.value || []).find(p => p.title?.toLowerCase() === lower);
      if (found) return found;
    }
  }
  return null;
}

async function getPageId(platform) {
  const cfg = PLATFORM_CONFIG[platform];
  if (!cfg) return null;
  if (cfg.hardcodedId) return cfg.hardcodedId;

  // Check config cache
  const config = getConfig();
  const cached = config.integrations?.m365?.[cfg.pageIdKey];
  if (cached) return cached;

  // Search notebooks
  const page = await findOneNotePageByTitle(cfg.pageName);
  if (!page) return null;

  // Cache for next time
  const m365 = config.integrations?.m365 || {};
  updateConfig({ integrations: { m365: { ...m365, [cfg.pageIdKey]: page.id } } });
  console.log(`[OneNote] Cached ${cfg.pageIdKey} = ${page.id}`);
  return page.id;
}

async function appendToOneNotePage(pageId, nextNumber, title, url) {
  const token = await getAccessToken();
  if (!token) return { error: 'M365 token unavailable' };

  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const patchBody = JSON.stringify([{
    target: 'body',
    action: 'append',
    content: `<p>${nextNumber}. <a href="${url}">${safeTitle}</a></p>`
  }]);

  const patchResp = await fetch(`https://graph.microsoft.com/v1.0/users/ali@midastech.ca/onenote/pages/${pageId}/content`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: patchBody
  });

  if (!patchResp.ok) {
    const errText = await patchResp.text();
    console.error('[OneNote] PATCH failed:', patchResp.status, errText);
    return { error: `OneNote write failed (${patchResp.status}): ${errText}` };
  }

  // Verify the write actually committed
  await new Promise(r => setTimeout(r, 1500));
  const verifyHtml = await graphFetchText(`/users/ali@midastech.ca/onenote/pages/${pageId}/content`);
  if (verifyHtml && !verifyHtml.includes(url)) {
    return { error: 'OneNote accepted the request but the entry did not appear. Token may need Notes.ReadWrite.All scope.' };
  }
  return null;
}

async function saveLink({ url }) {
  const platform = detectPlatform(url);
  if (!platform) return { error: 'URL is not from YouTube, Facebook, or Instagram.' };

  const cfg = PLATFORM_CONFIG[platform];
  console.log(`[OneNote] Saving ${platform} link:`, url);

  // Fetch title
  let title = platform === 'youtube'
    ? await fetchYouTubeTitle(url)
    : await fetchPageTitle(url);
  if (!title) title = `${cfg.pageName.replace(' Links', '')} Post`;

  // Get page ID
  const pageId = await getPageId(platform);
  if (!pageId) {
    return { error: `Could not find "${cfg.pageName}" page in OneNote. Please create it first.` };
  }

  // Count existing entries
  const html = await graphFetchText(`/users/ali@midastech.ca/onenote/pages/${pageId}/content`);
  const numbers = html ? [...html.matchAll(/>\s*(\d+)\.\s/g)].map(m => parseInt(m[1])) : [];
  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;

  const err = await appendToOneNotePage(pageId, nextNumber, title, url);
  if (err) return err;

  console.log(`[OneNote] Saved ${platform} entry #${nextNumber}`);
  return { success: true, number: nextNumber, title, url, platform, page: cfg.pageName };
}

async function listCalendarEvents({ days_ahead = 7, top = 10 } = {}) {
  const now = new Date();
  const end = new Date(now.getTime() + days_ahead * 86400000);
  const params = new URLSearchParams({
    startDateTime: now.toISOString(),
    endDateTime: end.toISOString(),
    $top: String(top),
    $orderby: 'start/dateTime',
    $select: 'subject,start,end,location,bodyPreview,isAllDay,organizer'
  });

  const data = await graphFetch(`/users/ali@midastech.ca/calendarView?${params}`);
  if (data.error) return data;

  return {
    range_days: days_ahead,
    events: (data.value || []).map(e => ({
      id: e.id,
      subject: e.subject,
      start: e.start?.dateTime,
      end: e.end?.dateTime,
      all_day: e.isAllDay,
      location: e.location?.displayName || null,
      preview: e.bodyPreview?.slice(0, 200) || null,
      organizer: e.organizer?.emailAddress?.name || null
    }))
  };
}

async function createCalendarEvent({ subject, start, end, body = '', location = '' }) {
  const event = {
    subject,
    body: { contentType: 'text', content: body },
    start: { dateTime: new Date(start).toISOString(), timeZone: 'America/Toronto' },
    end: { dateTime: new Date(end).toISOString(), timeZone: 'America/Toronto' }
  };
  if (location) event.location = { displayName: location };

  const data = await graphFetch('/users/ali@midastech.ca/events', {
    method: 'POST',
    body: JSON.stringify(event)
  });
  if (data.error) return data;

  return {
    success: true,
    event_id: data.id,
    subject: data.subject,
    start: data.start?.dateTime
  };
}

async function listEmails({ top = 10, unread_only = false, folder = 'inbox' } = {}) {
  const params = new URLSearchParams({
    $top: String(top),
    $orderby: 'receivedDateTime desc',
    $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead,importance'
  });
  if (unread_only) params.append('$filter', 'isRead eq false');

  const data = await graphFetch(`/users/ali@midastech.ca/mailFolders/${folder}/messages?${params}`);
  if (data.error) return data;

  return {
    emails: (data.value || []).map(e => ({
      id: e.id,
      subject: e.subject,
      from: e.from?.emailAddress?.name || e.from?.emailAddress?.address,
      received: e.receivedDateTime,
      preview: e.bodyPreview?.slice(0, 500) || '',
      is_read: e.isRead,
      importance: e.importance
    }))
  };
}

async function searchEmails({ query, top = 15, folder = 'inbox' } = {}) {
  const params = new URLSearchParams({
    $search: `"${query}"`,
    $top: String(top),
    $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead'
  });

  const data = await graphFetch(`/users/ali@midastech.ca/mailFolders/${folder}/messages?${params}`);
  if (data.error) return data;

  return {
    query,
    emails: (data.value || []).map(e => ({
      id: e.id,
      subject: e.subject,
      from: e.from?.emailAddress?.name || e.from?.emailAddress?.address,
      received: e.receivedDateTime,
      preview: e.bodyPreview?.slice(0, 800) || '',
      is_read: e.isRead
    }))
  };
}

async function readEmail({ email_id } = {}) {
  if (!email_id) return { error: 'email_id required' };
  const params = new URLSearchParams({
    $select: 'id,subject,from,toRecipients,receivedDateTime,body,isRead'
  });
  const data = await graphFetch(`/users/ali@midastech.ca/messages/${email_id}?${params}`);
  if (data.error) return data;

  // Strip HTML tags for a clean readable body
  const rawBody = data.body?.content || '';
  const cleanBody = rawBody
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{3,}/g, '\n\n')
    .trim()
    .slice(0, 3000);

  return {
    id: data.id,
    subject: data.subject,
    from: data.from?.emailAddress?.name || data.from?.emailAddress?.address,
    to: (data.toRecipients || []).map(r => r.emailAddress?.address).join(', '),
    received: data.receivedDateTime,
    body: cleanBody
  };
}

async function listTodos({ list_name = '' } = {}) {
  const listsData = await graphFetch('/users/ali@midastech.ca/todo/lists');
  if (listsData.error) return listsData;

  const lists = listsData.value || [];
  let targetList = list_name
    ? lists.find(l => l.displayName.toLowerCase().includes(list_name.toLowerCase()))
    : null;
  if (!targetList) {
    targetList = lists.find(l => l.wellknownListName === 'defaultList') || lists[0];
  }
  if (!targetList) return { tasks: [], list: 'none' };

  const params = new URLSearchParams({
    $filter: "status ne 'completed'",
    $orderby: 'createdDateTime desc',
    $top: '20'
  });

  const tasksData = await graphFetch(`/users/ali@midastech.ca/todo/lists/${targetList.id}/tasks?${params}`);
  if (tasksData.error) return tasksData;

  return {
    list: targetList.displayName,
    tasks: (tasksData.value || []).map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      due: t.dueDateTime?.dateTime || null,
      importance: t.importance
    }))
  };
}

async function createTodo({ title, list_name = '', due_date = null, notes = null }) {
  const listsData = await graphFetch('/users/ali@midastech.ca/todo/lists');
  if (listsData.error) return listsData;

  const lists = listsData.value || [];
  let targetList = list_name
    ? lists.find(l => l.displayName.toLowerCase().includes(list_name.toLowerCase()))
    : null;
  if (!targetList) targetList = lists.find(l => l.wellknownListName === 'defaultList') || lists[0];
  if (!targetList) return { error: 'No To Do list found' };

  const task = { title };
  if (due_date) task.dueDateTime = { dateTime: new Date(due_date).toISOString(), timeZone: 'UTC' };
  if (notes) task.body = { content: notes, contentType: 'text' };

  const data = await graphFetch(`/users/ali@midastech.ca/todo/lists/${targetList.id}/tasks`, {
    method: 'POST',
    body: JSON.stringify(task)
  });
  if (data.error) return data;

  return { success: true, task_id: data.id, title: data.title };
}

async function searchOneNote({ query }) {
  const params = new URLSearchParams({
    search: query,
    $top: '5',
    $select: 'title,createdDateTime,lastModifiedDateTime,links'
  });

  const data = await graphFetch(`/users/ali@midastech.ca/onenote/pages?${params}`);
  if (data.error) return data;

  return {
    query,
    pages: (data.value || []).map(p => ({
      id: p.id,
      title: p.title,
      created: p.createdDateTime,
      modified: p.lastModifiedDateTime,
      url: p.links?.oneNoteWebUrl?.href || null
    }))
  };
}

async function listOneNoteStructure() {
  const notebooksData = await graphFetch('/users/ali@midastech.ca/onenote/notebooks?$select=id,displayName&$top=50');
  if (notebooksData.error) return { error: notebooksData.error };

  const result = [];
  for (const nb of (notebooksData.value || [])) {
    const sectionsData = await graphFetch(`/users/ali@midastech.ca/onenote/notebooks/${nb.id}/sections?$select=id,displayName&$top=50`);
    const sections = [];
    for (const sec of (sectionsData.value || [])) {
      const pagesData = await graphFetch(`/users/ali@midastech.ca/onenote/sections/${sec.id}/pages?$select=id,title&$top=50`);
      sections.push({
        section: sec.displayName,
        pages: (pagesData.value || []).map(p => ({ title: p.title, id: p.id }))
      });
    }
    result.push({ notebook: nb.displayName, sections });
  }
  return { structure: result };
}

async function getPageIdsForLinkPages() {
  // Diagnostic: find the IDs of YouTube Links, Facebook Links, Instagram Links pages
  const targets = ['YouTube Links', 'Facebook Links', 'Instagram Links'];
  const result = {};
  for (const title of targets) {
    const page = await findOneNotePageByTitle(title);
    result[title] = page ? page.id : 'NOT FOUND';
  }
  return result;
}

// ─── Email — send & reply ─────────────────────────────────────────────────────

async function sendEmail({ to, subject, body, cc = null }) {
  if (!to || !subject || !body) return { error: 'to, subject, and body are required' };
  const message = {
    subject,
    body: { contentType: 'text', content: body },
    toRecipients: (Array.isArray(to) ? to : [to]).map(addr => ({
      emailAddress: { address: addr }
    }))
  };
  if (cc) {
    message.ccRecipients = (Array.isArray(cc) ? cc : [cc]).map(addr => ({
      emailAddress: { address: addr }
    }));
  }
  const data = await graphFetch(`/users/${USER_PRINCIPAL}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({ message, saveToSentItems: true })
  });
  if (data.error) return data;
  console.log(`[M365] Email sent to ${to} — "${subject}"`);
  return { success: true, to, subject };
}

async function replyToEmail({ email_id, reply_text }) {
  if (!email_id || !reply_text) return { error: 'email_id and reply_text are required' };
  const data = await graphFetch(`/users/${USER_PRINCIPAL}/messages/${email_id}/reply`, {
    method: 'POST',
    body: JSON.stringify({ comment: reply_text })
  });
  if (data.error) return data;
  console.log(`[M365] Reply sent to email ${email_id}`);
  return { success: true, email_id };
}

// ─── Calendar — update & delete ───────────────────────────────────────────────

async function updateCalendarEvent({ event_id, subject, start, end, body, location }) {
  if (!event_id) return { error: 'event_id is required' };
  const patch = {};
  if (subject) patch.subject = subject;
  if (body !== undefined) patch.body = { contentType: 'text', content: body };
  if (start) patch.start = { dateTime: new Date(start).toISOString(), timeZone: 'America/Toronto' };
  if (end) patch.end = { dateTime: new Date(end).toISOString(), timeZone: 'America/Toronto' };
  if (location) patch.location = { displayName: location };
  const data = await graphFetch(`/users/${USER_PRINCIPAL}/events/${event_id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
  if (data.error) return data;
  return { success: true, event_id, subject: data.subject };
}

async function deleteCalendarEvent({ event_id }) {
  if (!event_id) return { error: 'event_id is required' };
  const data = await graphFetch(`/users/${USER_PRINCIPAL}/events/${event_id}`, { method: 'DELETE' });
  if (data.error) return data;
  return { success: true, event_id };
}

// ─── To Do — complete & update ────────────────────────────────────────────────

async function completeTodo({ task_id, list_name = '' }) {
  if (!task_id) return { error: 'task_id is required' };
  const listsData = await graphFetch(`/users/${USER_PRINCIPAL}/todo/lists`);
  if (listsData.error) return listsData;
  const lists = listsData.value || [];
  let list = list_name
    ? lists.find(l => l.displayName.toLowerCase().includes(list_name.toLowerCase()))
    : null;
  if (!list) list = lists.find(l => l.wellknownListName === 'defaultList') || lists[0];
  if (!list) return { error: 'No To Do list found' };
  const data = await graphFetch(`/users/${USER_PRINCIPAL}/todo/lists/${list.id}/tasks/${task_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' })
  });
  if (data.error) return data;
  return { success: true, task_id, title: data.title, status: 'completed' };
}

async function updateTodo({ task_id, list_name = '', title, due_date, notes }) {
  if (!task_id) return { error: 'task_id is required' };
  const listsData = await graphFetch(`/users/${USER_PRINCIPAL}/todo/lists`);
  if (listsData.error) return listsData;
  const lists = listsData.value || [];
  let list = list_name
    ? lists.find(l => l.displayName.toLowerCase().includes(list_name.toLowerCase()))
    : null;
  if (!list) list = lists.find(l => l.wellknownListName === 'defaultList') || lists[0];
  if (!list) return { error: 'No To Do list found' };
  const patch = {};
  if (title) patch.title = title;
  if (due_date) patch.dueDateTime = { dateTime: new Date(due_date).toISOString(), timeZone: 'UTC' };
  if (notes !== undefined) patch.body = { content: notes, contentType: 'text' };
  const data = await graphFetch(`/users/${USER_PRINCIPAL}/todo/lists/${list.id}/tasks/${task_id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
  if (data.error) return data;
  return { success: true, task_id, title: data.title };
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

async function listContacts({ top = 20, search = '' } = {}) {
  const params = new URLSearchParams({
    $top: String(top),
    $orderby: 'displayName',
    $select: 'id,displayName,emailAddresses,mobilePhone,businessPhones,companyName,jobTitle'
  });
  if (search) params.set('$search', `"${search}"`);
  const data = await graphFetch(`/users/${USER_PRINCIPAL}/contacts?${params}`);
  if (data.error) return data;
  return {
    contacts: (data.value || []).map(c => ({
      id: c.id,
      name: c.displayName,
      email: c.emailAddresses?.[0]?.address || null,
      phone: c.mobilePhone || c.businessPhones?.[0] || null,
      company: c.companyName || null,
      title: c.jobTitle || null
    }))
  };
}

async function createContact({ name, email, phone = null, company = null, title = null }) {
  if (!name) return { error: 'name is required' };
  const contact = { displayName: name };
  if (email) contact.emailAddresses = [{ address: email, name }];
  if (phone) contact.mobilePhone = phone;
  if (company) contact.companyName = company;
  if (title) contact.jobTitle = title;
  const data = await graphFetch(`/users/${USER_PRINCIPAL}/contacts`, {
    method: 'POST',
    body: JSON.stringify(contact)
  });
  if (data.error) return data;
  console.log(`[M365] Contact created: "${name}"`);
  return { success: true, id: data.id, name: data.displayName };
}

// ─── Sticky Notes ─────────────────────────────────────────────────────────────

async function createStickyNote({ content }) {
  if (!content) return { error: 'content required' };

  const token = await getAccessToken();
  if (!token) return { error: 'M365 not configured or token unavailable.' };

  const data = await graphFetch(`/users/${USER_PRINCIPAL}/shortNotes`, {
    method: 'POST',
    body: JSON.stringify({ body: { content, contentType: 'text' } })
  });

  if (data.error) return data;

  console.log(`[M365] Sticky note created: "${content.slice(0, 50)}"`);
  return { success: true, id: data.id, content };
}

// ─── OneDrive ─────────────────────────────────────────────────────────────────

function escapeODataQuery(q) {
  return String(q).replace(/'/g, "''");
}

async function searchOneDrive({ query, top = 10 } = {}) {
  const params = new URLSearchParams({
    $top: String(top),
    $select: 'id,name,size,lastModifiedDateTime,webUrl,file,folder,parentReference'
  });
  const data = await graphFetch(`/users/ali@midastech.ca/drive/search(q='${escapeODataQuery(query)}')?${params}`);
  if (data.error) return data;
  return {
    query,
    items: (data.value || []).map(item => ({
      id: item.id,
      name: item.name,
      type: item.file ? 'file' : 'folder',
      size: item.size ? `${Math.round(item.size / 1024)}KB` : null,
      modified: item.lastModifiedDateTime,
      url: item.webUrl,
      path: (item.parentReference?.path || '').replace('/drive/root:', '') || '/'
    }))
  };
}

async function listOneDriveFolder({ folder_path = '/' } = {}) {
  const base = (folder_path === '/' || !folder_path)
    ? '/users/ali@midastech.ca/drive/root/children'
    : `/users/ali@midastech.ca/drive/root:${encodeURIComponent(folder_path)}:/children`;
  const params = new URLSearchParams({
    $top: '50',
    $select: 'id,name,size,lastModifiedDateTime,webUrl,file,folder',
    $orderby: 'name'
  });
  const data = await graphFetch(`${base}?${params}`);
  if (data.error) return data;
  return {
    folder: folder_path,
    items: (data.value || []).map(item => ({
      id: item.id,
      name: item.name,
      type: item.file ? 'file' : 'folder',
      size: item.size ? `${Math.round(item.size / 1024)}KB` : null,
      modified: item.lastModifiedDateTime,
      url: item.webUrl
    }))
  };
}

async function getOneDriveShareLink({ item_id, link_type = 'view' }) {
  const data = await graphFetch(`/users/ali@midastech.ca/drive/items/${item_id}/createLink`, {
    method: 'POST',
    body: JSON.stringify({ type: link_type, scope: 'organization' })
  });
  if (data.error) return data;
  return { success: true, item_id, link: data.link?.webUrl, type: data.link?.type };
}

// ─── SharePoint ───────────────────────────────────────────────────────────────

async function listSharePointSites({ search = '' } = {}) {
  const params = new URLSearchParams({
    search: search || '*',
    $top: '20',
    $select: 'id,displayName,webUrl,description'
  });
  const data = await graphFetch(`/sites?${params}`);
  if (data.error) return data;
  return {
    sites: (data.value || []).map(s => ({
      id: s.id,
      name: s.displayName,
      url: s.webUrl,
      description: s.description || null
    }))
  };
}

async function searchSharePoint({ query, site_id = null, top = 10 } = {}) {
  const base = site_id
    ? `/sites/${site_id}/drive/search(q='${escapeODataQuery(query)}')`
    : `/sites/root/drive/search(q='${escapeODataQuery(query)}')`;
  const params = new URLSearchParams({
    $top: String(top),
    $select: 'id,name,size,lastModifiedDateTime,webUrl,file,folder,parentReference'
  });
  const data = await graphFetch(`${base}?${params}`);
  if (data.error) return data;
  return {
    query,
    items: (data.value || []).map(item => ({
      id: item.id,
      name: item.name,
      type: item.file ? 'file' : 'folder',
      size: item.size ? `${Math.round(item.size / 1024)}KB` : null,
      modified: item.lastModifiedDateTime,
      url: item.webUrl,
      path: (item.parentReference?.path || '').replace('/drive/root:', '') || '/'
    }))
  };
}

async function listSharePointFiles({ site_id, folder_path = '/' } = {}) {
  if (!site_id) return { error: 'site_id is required. Use sharepoint_list_sites first to find site IDs.' };
  const base = (folder_path === '/' || !folder_path)
    ? `/sites/${site_id}/drive/root/children`
    : `/sites/${site_id}/drive/root:${encodeURIComponent(folder_path)}:/children`;
  const params = new URLSearchParams({
    $top: '50',
    $select: 'id,name,size,lastModifiedDateTime,webUrl,file,folder',
    $orderby: 'name'
  });
  const data = await graphFetch(`${base}?${params}`);
  if (data.error) return data;
  return {
    site_id,
    folder: folder_path,
    items: (data.value || []).map(item => ({
      id: item.id,
      name: item.name,
      type: item.file ? 'file' : 'folder',
      size: item.size ? `${Math.round(item.size / 1024)}KB` : null,
      modified: item.lastModifiedDateTime,
      url: item.webUrl
    }))
  };
}

function isConfigured() {
  const config = getConfig();
  const m365 = config.integrations?.m365;
  return !!(m365?.enabled && m365?.clientId && m365?.tenantId && m365?.clientSecret);
}

module.exports = {
  listCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
  listEmails, searchEmails, readEmail, sendEmail, replyToEmail,
  listTodos, createTodo, completeTodo, updateTodo,
  listContacts, createContact,
  searchOneNote, saveLink, listOneNoteStructure, getPageIdsForLinkPages,
  searchOneDrive, listOneDriveFolder, getOneDriveShareLink,
  listSharePointSites, searchSharePoint, listSharePointFiles,
  createStickyNote,
  isConfigured
};

