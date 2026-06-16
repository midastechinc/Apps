const { getConfig, updateConfig } = require('../config-manager');

const USER_PRINCIPAL = 'ali@midastech.ca';

// client_credentials token (for calendar, email, tasks, contacts, OneDrive, SharePoint)
let _cachedToken = null;
let _tokenExpiry = 0;

// Delegated token for OneNote (Microsoft blocked app-only access to OneNote API from March 2025)
let _cachedOneNoteToken = null;
let _oneNoteTokenExpiry = 0;

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

async function getOneNoteAccessToken() {
  // 1. In-memory cache
  if (_cachedOneNoteToken && Date.now() < _oneNoteTokenExpiry - 60000) return _cachedOneNoteToken;

  const config = getConfig();
  const m365 = config.integrations?.m365;
  if (!m365?.clientId || !m365?.tenantId || !m365?.clientSecret) return null;

  // 2. Persisted access token (saved by OAuth callback or fix_onenote.py) — use directly if not expired
  if (m365.oneNoteAccessToken && m365.oneNoteTokenExpiry && Date.now() < m365.oneNoteTokenExpiry - 60000) {
    _cachedOneNoteToken = m365.oneNoteAccessToken;
    _oneNoteTokenExpiry = m365.oneNoteTokenExpiry;
    console.log('[M365] OneNote: using persisted access token (expires', new Date(m365.oneNoteTokenExpiry).toISOString(), ')');
    return _cachedOneNoteToken;
  }

  // 3. Try refresh_token
  const refreshToken = m365.oneNoteRefreshToken || m365.refreshToken;
  if (!refreshToken) {
    console.error('[M365] OneNote: no refresh token in config. Visit /api/auth/onenote?key=ADMINKEY to authenticate.');
    return null;
  }

  try {
    const resp = await fetch(
      `https://login.microsoftonline.com/${m365.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: m365.clientId,
          client_secret: m365.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: 'https://graph.microsoft.com/Notes.ReadWrite.All offline_access'
        })
      }
    );
    if (!resp.ok) {
      const err = await resp.text();
      console.error('[M365] OneNote token refresh failed:', resp.status, err.slice(0, 400));
      return null;
    }
    const data = await resp.json();
    _cachedOneNoteToken = data.access_token;
    _oneNoteTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    // Persist to disk so it survives Railway restarts
    const cur = getConfig().integrations?.m365 || {};
    updateConfig({ integrations: { m365: { ...cur,
      oneNoteAccessToken: data.access_token,
      oneNoteTokenExpiry: _oneNoteTokenExpiry,
      ...(data.refresh_token ? { oneNoteRefreshToken: data.refresh_token } : {})
    }}});
    console.log('[M365] OneNote token refreshed, expires', new Date(_oneNoteTokenExpiry).toISOString());
    return _cachedOneNoteToken;
  } catch (err) {
    console.error('[M365] OneNote token refresh error:', err.message);
    return null;
  }
}

async function graphFetch(endpoint, options = {}) {
  // OneNote API requires delegated (user) tokens — Microsoft blocked app-only access March 2025
  const needsDelegated = endpoint.includes('/onenote/');
  const token = needsDelegated ? await getOneNoteAccessToken() : await getAccessToken();
  if (!token) {
    return needsDelegated
      ? { error: 'OneNote not authenticated. Visit the management UI → Integrations → Connect OneNote.' }
      : { error: 'M365 not configured or token unavailable. Set credentials in the Integrations tab.' };
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

  // 204 No Content (DELETE) and 202 Accepted (sendMail, reply) have no body
  if (resp.status === 204 || resp.status === 202) return {};
  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('json')) return {};
  return resp.json();
}

async function graphFetchText(endpoint) {
  const needsDelegated = endpoint.includes('/onenote/');
  const token = needsDelegated ? await getOneNoteAccessToken() : await getAccessToken();
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

// Site-specific OneNote endpoint — avoids Error 10008 (>5000 items across all SharePoint libraries)
let _oneNoteSiteEndpoint = null;

async function getOneNoteEndpoint() {
  if (_oneNoteSiteEndpoint) return _oneNoteSiteEndpoint;
  _oneNoteSiteEndpoint = `/users/${USER_PRINCIPAL}/onenote`;
  return _oneNoteSiteEndpoint;
}

async function oneNoteFetch(path, options = {}) {
  return graphFetch(`${await getOneNoteEndpoint()}${path}`, options);
}

async function oneNoteTextFetch(path) {
  return graphFetchText(`${await getOneNoteEndpoint()}${path}`);
}

function cacheOneNoteSectionId(sectionName, sectionId) {
  const cur = getConfig().integrations?.m365 || {};
  const sections = { ...(cur.oneNoteSections || {}), [sectionName.toLowerCase()]: sectionId };
  updateConfig({ integrations: { m365: { ...cur, oneNoteSections: sections } } });
  console.log(`[OneNote] Cached section "${sectionName}" = ${sectionId}`);
}

// Valid OneNote (Graph) compound IDs always contain "!", e.g. 1-{hex}!{n}-{guid}.
// A bare GUID (like a SharePoint wdsectionfileid) is NOT usable for page operations
// and is the source of error 20112. Use this to reject/purge bad cached values.
function isCompoundOneNoteId(id) {
  return typeof id === 'string' && id.includes('!');
}

const norm = s => (s || '').toLowerCase().replace(/[-_\s]+/g, '');

// A page's parent section name: Graph v1.0 uses displayName; older responses use name.
const sectionDisplayName = p => p?.parentSection?.displayName || p?.parentSection?.name || '';

// Pull page-title candidates out of a OneNote/SharePoint link in any form.
// In these links each item appears as "Name|{guid}" (encoded as Name%7C{guid}),
// e.g. "...Travel.one|{secGuid}/DALLAS-2026|{pageGuid}/...". The page title is the
// "Name" that precedes a guid and is NOT a "*.one" section file. Robust to partial
// encoding and missing trailing slashes.
function extractOneNoteTitles(raw) {
  const titles = [];
  const sources = [raw];
  try { sources.push(decodeURIComponent(raw)); } catch {}
  for (let s of sources) {
    s = s.replace(/%7C/gi, '|').replace(/%2F/gi, '/').replace(/%28/gi, '(').replace(/%29/gi, ')');
    const re = /([^/|()]+?)\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/gi;
    let m;
    while ((m = re.exec(s)) !== null) {
      let name = m[1].replace(/^.*[(/]/, '').trim(); // drop any leading path/paren junk
      if (name && !/\.one$/i.test(name) && !titles.includes(name)) titles.push(name);
    }
  }
  return titles;
}

async function findSectionId(sectionName) {
  const key = sectionName.toLowerCase();

  // 1. Config cache — fastest path. Only trust real compound IDs; purge legacy bad GUIDs.
  const cur = getConfig().integrations?.m365;
  const cached = cur?.oneNoteSections?.[key];
  if (cached) {
    if (isCompoundOneNoteId(cached)) {
      console.log(`[OneNote] Using cached section ID for "${sectionName}"`);
      return cached;
    }
    console.log(`[OneNote] Purging bad cached section ID for "${sectionName}" (not a compound ID): ${cached}`);
    const sections = { ...(cur.oneNoteSections || {}) };
    delete sections[key];
    updateConfig({ integrations: { m365: { ...cur, oneNoteSections: sections } } });
  }

  // 2. Page full-text search. OneNote `search=` is index-based (works under Error 10008).
  //    IMPORTANT: $expand is NOT supported on the search endpoint (causes 20108).
  //    parentSection.id is returned inline by default; displayName may or may not be.
  //    Strategy: if displayName is available in the response, match directly. Otherwise
  //    verify each candidate section ID with a direct GET /sections/{id} call (which is
  //    a single-resource lookup, safe under 10008). Try section name first, then common
  //    fallback words so any page in the section can surface the section ID.
  const searchAndVerify = async (query) => {
    const data = await oneNoteFetch(`/pages?search=${encodeURIComponent(query)}&$top=50`);
    if (data.error) { console.log(`[OneNote] Page search "${query}" error: ${data.error}`); return null; }

    // Fast path: displayName already in response
    const direct = (data.value || []).find(p =>
      isCompoundOneNoteId(p.parentSection?.id) && norm(sectionDisplayName(p)) === norm(sectionName)
    );
    if (direct) return direct.parentSection.id;

    // Slow path: verify each unique compound section ID with a direct section fetch
    const candidateIds = [...new Set(
      (data.value || []).map(p => p.parentSection?.id).filter(id => isCompoundOneNoteId(id))
    )].slice(0, 5); // cap at 5 candidates
    for (const secId of candidateIds) {
      const sec = await oneNoteFetch(`/sections/${secId}?$select=id,displayName`);
      if (!sec.error && norm(sec.displayName) === norm(sectionName)) return secId;
    }
    return null;
  };

  for (const term of [sectionName, 'note', 'the']) {
    const secId = await searchAndVerify(term);
    if (secId) {
      console.log(`[OneNote] Found section "${sectionName}" via search("${term}") → ${secId}`);
      cacheOneNoteSectionId(sectionName, secId);
      return secId;
    }
  }

  console.log(`[OneNote] Section "${sectionName}" not found. Use m365_set_onenote_section with a page title (e.g. "DALLAS-2026") or a page link from that section.`);
  return null;
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

  // Use OneNote full-text search (`search=`, NOT OData `$search`) — served by the search
  // index, so it keeps working even when bulk enumeration fails with Error 10008.
  const searchData = await oneNoteFetch(`/pages?search=${encodeURIComponent(titleToFind)}&$top=20`);
  if (!searchData.error) {
    const found = (searchData.value || []).find(p => p.title?.toLowerCase() === lower);
    if (found) {
      console.log(`[OneNote] Found "${titleToFind}" via pages search API`);
      return found;
    }
  }

  // Fallback: discover sections via Drive .onetoc2 search, query each section's pages
  const tocSearch = await graphFetch(
    `/users/${USER_PRINCIPAL}/drive/search(q='.onetoc2')?$select=id,name,parentReference&$top=30`
  );
  if (!tocSearch.error && tocSearch.value?.length > 0) {
    const folderIds = [...new Set(
      tocSearch.value.map(f => f.parentReference?.id).filter(Boolean)
    )];
    for (const folderId of folderIds) {
      const sectionsData = await graphFetch(
        `/users/${USER_PRINCIPAL}/drive/items/${folderId}/onenote/sections?$select=id,displayName&$top=100`
      );
      if (sectionsData.error) continue;
      for (const sec of (sectionsData.value || [])) {
        const pagesData = await oneNoteFetch(`/sections/${sec.id}/pages?$select=id,title&$top=100`);
        if (pagesData.error) continue;
        const found = (pagesData.value || []).find(p => p.title?.toLowerCase() === lower);
        if (found) {
          console.log(`[OneNote] Found "${titleToFind}" in section "${sec.displayName}" via Drive`);
          return found;
        }
      }
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

async function saveLink({ url }) {
  const platform = detectPlatform(url);
  if (!platform) return { error: 'URL is not from YouTube, Facebook, or Instagram.' };

  const cfg = PLATFORM_CONFIG[platform];
  console.log(`[OneNote] Saving ${platform} link via page-per-link approach:`, url);

  // Fetch title
  let title = platform === 'youtube'
    ? await fetchYouTubeTitle(url)
    : await fetchPageTitle(url);
  if (!title) title = `${cfg.pageName.replace(' Links', '')} Post`;

  // Determine next number — list pages in the cached section if we have its ID
  const sectionIdKey = `${cfg.pageIdKey}_sectionId`;
  let sectionId = getConfig().integrations?.m365?.[sectionIdKey];
  let nextNumber = 1;

  if (sectionId) {
    const pagesData = await oneNoteFetch(`/sections/${sectionId}/pages?$select=id,title&$top=100`);
    if (!pagesData.error) {
      nextNumber = (pagesData.value || []).length + 1;
    }
  }

  // POST a new page into the named section — sectionName auto-creates the section if missing
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeUrl = url.replace(/&/g, '&amp;');
  const pageTitle = `#${nextNumber}: ${safeTitle}`;
  const pageHtml = `<!DOCTYPE html><html><head><title>${pageTitle}</title></head><body><p><a href="${safeUrl}">${safeTitle}</a></p></body></html>`;

  const result = await oneNoteFetch(`/pages?sectionName=${encodeURIComponent(cfg.pageName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/html' },
    body: pageHtml
  });

  if (result?.error) {
    console.error('[OneNote] Page create failed:', result.error);
    return result;
  }

  // Cache the section ID from the POST response for fast counting next time
  const newSectionId = result?.parentSection?.id;
  if (newSectionId && newSectionId !== sectionId) {
    const m365 = getConfig().integrations?.m365 || {};
    updateConfig({ integrations: { m365: { ...m365, [sectionIdKey]: newSectionId } } });
    console.log(`[OneNote] Cached section "${cfg.pageName}" id: ${newSectionId}`);
  }

  console.log(`[OneNote] Created page "${pageTitle}" in section "${cfg.pageName}"`);
  return { success: true, number: nextNumber, title, url, platform, page: cfg.pageName };
}

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
    $select: 'id,subject,start,end,location,bodyPreview,isAllDay,organizer'
  });

  const data = await graphFetch(`/users/ali@midastech.ca/calendarView?${params}`, {
    headers: { Prefer: 'outlook.timezone="America/Toronto"' }
  });
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

async function listTodos({ list_name = '', top = 20 } = {}) {
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
    $top: String(top)
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
    $select: 'id,title,createdDateTime,lastModifiedDateTime,links'
  });

  const data = await oneNoteFetch(`/pages?${params}`);
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
  // Use Drive .onetoc2 search to discover notebooks without triggering Error 10008
  const tocSearch = await graphFetch(
    `/users/${USER_PRINCIPAL}/drive/search(q='.onetoc2')?$select=id,name,parentReference&$top=30`
  );
  if (tocSearch.error) return { error: tocSearch.error };

  const folderIds = [...new Set(
    (tocSearch.value || []).map(f => f.parentReference?.id).filter(Boolean)
  )];

  if (folderIds.length === 0) return { structure: [], note: 'No OneNote notebooks found in Drive.' };

  const result = [];
  for (const folderId of folderIds) {
    const folderData = await graphFetch(
      `/users/${USER_PRINCIPAL}/drive/items/${folderId}?$select=name`
    );
    const notebookName = folderData.name || folderId;

    const sectionsData = await graphFetch(
      `/users/${USER_PRINCIPAL}/drive/items/${folderId}/onenote/sections?$select=id,displayName&$top=100`
    );
    if (sectionsData.error) continue;

    result.push({
      notebook: notebookName,
      sections: (sectionsData.value || []).map(s => ({ id: s.id, name: s.displayName }))
    });
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
  const fetchOptions = search ? { headers: { ConsistencyLevel: 'eventual' } } : {};
  const data = await graphFetch(`/users/${USER_PRINCIPAL}/contacts?${params}`, fetchOptions);
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

// ─── Out of Office ────────────────────────────────────────────────────────────

async function getOutOfOfficeStatus() {
  const data = await graphFetch(`/users/${USER_PRINCIPAL}/mailboxSettings`);
  if (data.error) return data;
  const s = data.automaticRepliesSetting;
  return {
    status: s?.status,
    enabled: s?.status !== 'disabled',
    internalMessage: s?.internalReplyMessage || null,
    externalMessage: s?.externalReplyMessage || null,
    start: s?.scheduledStartDateTime?.dateTime || null,
    end: s?.scheduledEndDateTime?.dateTime || null
  };
}

async function setOutOfOffice({ enabled, message, internal_message = null, start = null, end = null }) {
  const setting = { automaticRepliesSetting: {} };

  if (!enabled) {
    setting.automaticRepliesSetting.status = 'disabled';
  } else if (start && end) {
    setting.automaticRepliesSetting.status = 'scheduled';
    setting.automaticRepliesSetting.scheduledStartDateTime = {
      dateTime: new Date(start).toISOString().slice(0, 19),
      timeZone: 'America/Toronto'
    };
    setting.automaticRepliesSetting.scheduledEndDateTime = {
      dateTime: new Date(end).toISOString().slice(0, 19),
      timeZone: 'America/Toronto'
    };
  } else {
    setting.automaticRepliesSetting.status = 'alwaysEnabled';
  }

  if (message) {
    setting.automaticRepliesSetting.externalReplyMessage = message;
    setting.automaticRepliesSetting.internalReplyMessage = internal_message || message;
  }

  const data = await graphFetch(`/users/${USER_PRINCIPAL}/mailboxSettings`, {
    method: 'PATCH',
    body: JSON.stringify(setting)
  });
  if (data.error) return data;

  const status = data.automaticRepliesSetting?.status
    || (enabled ? (start && end ? 'scheduled' : 'alwaysEnabled') : 'disabled');
  console.log(`[M365] Out of office set to: ${status}`);
  return { success: true, status };
}

// ─── Email Drafts ─────────────────────────────────────────────────────────────

async function createEmailDraft({ to = null, subject, body, cc = null }) {
  if (!subject || !body) return { error: 'subject and body are required' };
  const message = { subject, body: { contentType: 'text', content: body } };
  if (to) {
    message.toRecipients = (Array.isArray(to) ? to : [to]).map(addr => ({
      emailAddress: { address: addr }
    }));
  }
  if (cc) {
    message.ccRecipients = (Array.isArray(cc) ? cc : [cc]).map(addr => ({
      emailAddress: { address: addr }
    }));
  }
  const data = await graphFetch(`/users/${USER_PRINCIPAL}/messages`, {
    method: 'POST',
    body: JSON.stringify(message)
  });
  if (data.error) return data;
  console.log(`[M365] Draft created: "${subject}"`);
  return { success: true, draft_id: data.id, subject: data.subject };
}

async function sendDraft({ draft_id }) {
  if (!draft_id) return { error: 'draft_id is required' };
  const data = await graphFetch(`/users/${USER_PRINCIPAL}/messages/${draft_id}/send`, {
    method: 'POST'
  });
  if (data.error) return data;
  console.log(`[M365] Draft ${draft_id} sent`);
  return { success: true, draft_id };
}

// ─── OneNote Pages ────────────────────────────────────────────────────────────

async function createOneNotePage({ notebook_name = '', section_name = '', title, content = '' }) {
  if (!title) return { error: 'title is required' };

  const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' });
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeContent = (content || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
  const html = `<!DOCTYPE html><html><head><title>${safeTitle}</title></head><body><h1>${safeTitle}</h1>${safeContent ? `<p>${safeContent}</p>` : ''}<p style="color:#999;font-size:0.8em;">Created by Claudia — ${now}</p></body></html>`;

  const postPage = (endpoint) => graphFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xhtml+xml' },
    body: html
  });
  const ok = (pageData) => {
    // Cache the canonical section ID from the response so the next create is a direct hit
    if (section_name && isCompoundOneNoteId(pageData.parentSection?.id)) cacheOneNoteSectionId(section_name, pageData.parentSection.id);
    return { success: true, title, section: section_name || 'default', page_id: pageData.id, url: pageData.links?.oneNoteWebUrl?.href || null };
  };
  // Friendly guidance when the account's library is over the 5,000-item API limit.
  const tooManyItems = `Microsoft is blocking notebook lookups on your account (error 10008 — a OneDrive/SharePoint library has over 5,000 OneNote items). To save into "${section_name}" anyway, register the section once using either:\n• A page title: "set onenote section ${section_name || 'travel'} DALLAS-2026" (or any page title from that section)\n• A page link: open a page inside "${section_name || 'travel'}" in OneNote, tap "Copy Link to Page", and send: "set onenote section ${section_name || 'travel'} <link>"\nAfter that I'll save straight to the section.`;
  const is10008 = (e) => /10008/.test(e || '');

  if (section_name) {
    // 1. Direct create using a known-good compound section ID (cache or page-search discovery).
    //    Direct-by-ID writes are the only OneNote operation that keeps working under Error 10008.
    const sectionId = await findSectionId(section_name);
    if (sectionId) {
      const pageData = await postPage(`/users/${USER_PRINCIPAL}/onenote/sections/${sectionId}/pages`);
      if (!pageData.error) {
        console.log(`[M365] OneNote page created: "${title}" in section ${sectionId}`);
        return ok(pageData);
      }
      console.log(`[OneNote] Section ID ${sectionId} rejected (${pageData.error}); clearing cache`);
      const cur2 = getConfig().integrations?.m365 || {};
      const sections2 = { ...(cur2.oneNoteSections || {}) };
      delete sections2[section_name.toLowerCase()];
      updateConfig({ integrations: { m365: { ...cur2, oneNoteSections: sections2 } } });
      if (is10008(pageData.error)) return { error: tooManyItems };
    }

    // 2. Fallback: create by section NAME in the default notebook (auto-creates the section).
    //    This needs server-side enumeration, so it fails with 10008 on oversized libraries —
    //    in that case guide the user to register the section via a page link instead.
    const byName = await postPage(
      `/users/${USER_PRINCIPAL}/onenote/pages?sectionName=${encodeURIComponent(section_name)}`
    );
    if (!byName.error) {
      console.log(`[M365] OneNote page created via sectionName="${section_name}"`);
      return ok(byName);
    }
    if (is10008(byName.error)) return { error: tooManyItems };
    return { error: `Could not create the OneNote page in "${section_name}": ${byName.error}` };
  }

  // No section specified → default section of the default notebook
  const def = await postPage(`/users/${USER_PRINCIPAL}/onenote/pages`);
  if (!def.error) {
    console.log(`[M365] OneNote page created in default section: "${title}"`);
    return ok(def);
  }
  if (is10008(def.error)) return { error: tooManyItems };
  return { error: `Could not create the OneNote page: ${def.error}` };
}

async function readOneNotePage({ page_id, page_title = null }) {
  let id = page_id;
  if (!id && page_title) {
    const page = await findOneNotePageByTitle(page_title);
    if (!page) return { error: `Page "${page_title}" not found. Try m365_search_onenote first.` };
    id = page.id;
  }
  if (!id) return { error: 'page_id or page_title is required' };

  const html = await oneNoteTextFetch(`/pages/${id}/content`);
  if (!html) return { error: 'Could not read page content.' };

  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/h[1-6]>|<\/li>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { page_id: id, content: text };
}

// ─── Find Meeting Times ───────────────────────────────────────────────────────

async function findMeetingTimes({ duration_minutes = 60, start, end, attendees = [] }) {
  if (!start || !end) return { error: 'start and end are required (ISO datetime strings defining the search window)' };

  const body = {
    attendees: (Array.isArray(attendees) ? attendees : [attendees])
      .filter(Boolean)
      .map(email => ({ emailAddress: { address: email }, type: 'required' })),
    timeConstraint: {
      activityDomain: 'work',
      timeslots: [{
        start: { dateTime: new Date(start).toISOString().slice(0, 19), timeZone: 'America/Toronto' },
        end:   { dateTime: new Date(end).toISOString().slice(0, 19),   timeZone: 'America/Toronto' }
      }]
    },
    meetingDuration: `PT${duration_minutes}M`,
    maxCandidates: 6,
    returnSuggestionReasons: true
  };

  const data = await graphFetch(`/users/${USER_PRINCIPAL}/findMeetingTimes`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  if (data.error) return data;

  return {
    duration_minutes,
    suggestions: (data.meetingTimeSuggestions || []).map(s => ({
      start: s.meetingTimeSlot?.start?.dateTime,
      end: s.meetingTimeSlot?.end?.dateTime,
      confidence: Math.round((s.confidence || 0) * 100) + '%'
    }))
  };
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

async function setOneNoteSection({ section_name, section_id_or_url }) {
  if (!section_name || !section_id_or_url) return { error: 'section_name and section_id_or_url are required' };
  const decoded = decodeURIComponent(section_id_or_url);

  // Case 1: user pasted a real Graph compound section ID directly (contains "!").
  if (isCompoundOneNoteId(decoded.trim()) && !/\s/.test(decoded.trim())) {
    cacheOneNoteSectionId(section_name, decoded.trim());
    return { success: true, section_name, section_id: decoded.trim(), message: `Saved section ID for "${section_name}".` };
  }

  // helper: full-text search (OneNote `search=`, not OData `$search`).
  // NOTE: $expand is NOT supported on the search endpoint — omit it.
  // parentSection.id is returned inline by default.
  const searchForPage = async (query, requireTitleMatch) => {
    const data = await oneNoteFetch(`/pages?search=${encodeURIComponent(query)}&$top=20`);
    if (data.error) return { error: data.error };
    const page = (data.value || []).find(p =>
      isCompoundOneNoteId(p.parentSection?.id) &&
      (!requireTitleMatch || norm(p.title).includes(norm(query)) || norm(query).includes(norm(p.title)))
    );
    return { page };
  };

  // Case 2a: plain page title (no URL characters) — user said e.g. "set onenote section travel DALLAS-2026"
  const isUrl = decoded.includes('http') || decoded.includes('/') || decoded.includes('\\') || decoded.includes('|');
  if (!isUrl) {
    const { page, error } = await searchForPage(decoded.trim(), true);
    if (error) return { error: `Couldn't search OneNote: ${error}` };
    if (page?.parentSection?.id) {
      console.log(`[OneNote] Resolved section "${sectionDisplayName(page)}" → ${page.parentSection.id} via page title "${page.title}"`);
      cacheOneNoteSectionId(section_name, page.parentSection.id);
      return { success: true, section_name, section_id: page.parentSection.id, message: `Done — "${section_name}" is now linked to the "${sectionDisplayName(page)}" section (found via page "${page.title}"). I can save notes there now.` };
    }
    return { error: `No page titled "${decoded.trim()}" was found in OneNote. Try another page title from the "${section_name}" section, or copy a page link from OneNote and send that instead.` };
  }

  // Case 2b: a OneNote/SharePoint link — extract page titles from the URL and search each one.
  const titleCandidates = extractOneNoteTitles(section_id_or_url);
  console.log(`[OneNote] setOneNoteSection: page-title candidates from link: ${JSON.stringify(titleCandidates)}`);

  let lastError = null;
  for (const cand of titleCandidates) {
    const { page, error } = await searchForPage(cand, true);
    if (error) { lastError = error; continue; }
    if (page?.parentSection?.id) {
      console.log(`[OneNote] Resolved section "${sectionDisplayName(page)}" → ${page.parentSection.id} via page "${page.title}"`);
      cacheOneNoteSectionId(section_name, page.parentSection.id);
      return { success: true, section_name, section_id: page.parentSection.id, message: `Done — "${section_name}" is now linked to the "${sectionDisplayName(page)}" section (found via the page "${page.title}"). I can save notes there now.` };
    }
  }

  // Fallback: search by the section name itself and match on the parent section's name.
  const { page: byName, error: nameErr } = await searchForPage(section_name, false);
  if (byName && norm(sectionDisplayName(byName)) === norm(section_name)) {
    console.log(`[OneNote] Resolved section "${sectionDisplayName(byName)}" → ${byName.parentSection.id} via section-name search`);
    cacheOneNoteSectionId(section_name, byName.parentSection.id);
    return { success: true, section_name, section_id: byName.parentSection.id, message: `Done — "${section_name}" is now linked to the "${sectionDisplayName(byName)}" section. I can save notes there now.` };
  }
  lastError = lastError || nameErr;

  if (lastError) {
    return { error: `Couldn't search OneNote: ${lastError}` };
  }
  return { error: `I couldn't locate that page in OneNote search. You can also just send me the title of any page inside "${section_name}" (e.g. "set onenote section ${section_name} DALLAS-2026"). Or open a PAGE inside "${section_name}" in OneNote, use "Copy Link to Page", and send me that link. ${titleCandidates.length ? `(I looked for: ${titleCandidates.join(', ')}.)` : ''}`.trim() };
}

function isConfigured() {
  const config = getConfig();
  const m365 = config.integrations?.m365;
  return !!(m365?.enabled && m365?.clientId && m365?.tenantId && m365?.clientSecret);
}

module.exports = {
  listCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, findMeetingTimes,
  getOutOfOfficeStatus, setOutOfOffice,
  listEmails, searchEmails, readEmail, sendEmail, replyToEmail, createEmailDraft, sendDraft,
  listTodos, createTodo, completeTodo, updateTodo,
  listContacts, createContact,
  searchOneNote, saveLink, listOneNoteStructure, getPageIdsForLinkPages,
  createOneNotePage, readOneNotePage, setOneNoteSection,
  searchOneDrive, listOneDriveFolder, getOneDriveShareLink,
  listSharePointSites, searchSharePoint, listSharePointFiles,
  isConfigured,

  // Debug helpers for /api/debug/onenote
  debugGetPageDetail: (pageId) => oneNoteFetch(
    `/pages/${pageId}?$expand=parentSection($select=id,displayName,$expand=parentNotebook($select=id,displayName))`
  ),
  debugListNotebookSections: (notebookId) => oneNoteFetch(
    `/notebooks/${notebookId}/sections?$select=id,displayName&$top=100`
  ),
  debugTocSearch: () => graphFetch(
    `/users/${USER_PRINCIPAL}/drive/search(q='.onetoc2')?$select=id,name,parentReference&$top=30`
  )
};

