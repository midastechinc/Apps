const { getConfig, updateConfig } = require('../config-manager');

async function getAccessToken() {
  const config = getConfig();
  const m365 = config.integrations?.m365;
  if (!m365?.enabled || !m365?.clientId || !m365?.tenantId) return null;

  if (m365.accessToken && m365.tokenExpiry && Date.now() < m365.tokenExpiry - 60000) {
    return m365.accessToken;
  }

  if (!m365.refreshToken || !m365.clientSecret) return null;

  try {
    const resp = await fetch(
      `https://login.microsoftonline.com/${m365.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: m365.clientId,
          client_secret: m365.clientSecret,
          refresh_token: m365.refreshToken,
          grant_type: 'refresh_token',
          scope: 'Calendars.ReadWrite Mail.Read Mail.ReadWrite Tasks.ReadWrite Notes.ReadWrite offline_access User.Read'
        })
      }
    );

    if (!resp.ok) {
      console.error('[M365] Token refresh HTTP error:', resp.status, await resp.text());
      return null;
    }

    const data = await resp.json();
    const updated = {
      ...m365,
      accessToken: data.access_token,
      tokenExpiry: Date.now() + (data.expires_in || 3600) * 1000
    };
    if (data.refresh_token) updated.refreshToken = data.refresh_token;
    updateConfig({ integrations: { m365: updated } });
    return data.access_token;
  } catch (err) {
    console.error('[M365] Token refresh error:', err.message);
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
    if (!resp.ok) return 'Untitled YouTube Video';
    const data = await resp.json();
    return data.title || 'Untitled YouTube Video';
  } catch {
    return 'Untitled YouTube Video';
  }
}

async function saveYouTubeLink({ url }) {
  const title = await fetchYouTubeTitle(url);
  console.log('[OneNote] Saving YouTube link:', { url, title });

  // Find "YouTube Links" page — try $search first, then $filter
  let page = null;

  const searchData = await graphFetch(
    `/me/onenote/pages?$search=${encodeURIComponent('YouTube Links')}&$select=id,title&$top=20`
  );
  if (!searchData.error && searchData.value?.length) {
    page = searchData.value.find(p => p.title === 'YouTube Links') ||
           searchData.value.find(p => p.title?.toLowerCase().includes('youtube'));
    console.log('[OneNote] Search found pages:', searchData.value.map(p => p.title));
  } else {
    console.error('[OneNote] Search error or empty:', searchData.error);
  }

  if (!page) {
    const filterData = await graphFetch(
      `/me/onenote/pages?$filter=title%20eq%20'YouTube%20Links'&$select=id,title&$top=1`
    );
    if (!filterData.error && filterData.value?.length) {
      page = filterData.value[0];
      console.log('[OneNote] Filter found page:', page.title);
    } else {
      console.error('[OneNote] Filter error or empty:', filterData.error);
    }
  }

  if (!page) {
    return { error: 'Could not find "YouTube Links" page in OneNote. Please make sure the page exists with that exact name.' };
  }

  console.log('[OneNote] Using page:', page.id, page.title);

  // Read current content to get next number
  const html = await graphFetchText(`/me/onenote/pages/${page.id}/content`);
  const numbers = html
    ? [...html.matchAll(/>\s*(\d+)\.\s/g)].map(m => parseInt(m[1]))
    : [];
  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  console.log('[OneNote] Next entry number:', nextNumber);

  // HTML-escape title (video titles can contain &, <, >)
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Append the numbered entry
  const token = await getAccessToken();
  if (!token) return { error: 'M365 token unavailable for OneNote write' };

  const patchBody = JSON.stringify([{
    target: 'body',
    action: 'append',
    content: `<p>${nextNumber}. ${safeTitle} - ${url}</p>`
  }]);

  const patchResp = await fetch(`https://graph.microsoft.com/v1.0/me/onenote/pages/${page.id}/content`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: patchBody
  });

  if (!patchResp.ok) {
    const errText = await patchResp.text();
    console.error('[OneNote] PATCH failed:', patchResp.status, errText);
    return { error: `OneNote write failed (${patchResp.status}): ${errText}` };
  }

  console.log('[OneNote] Successfully appended entry', nextNumber);
  return { success: true, number: nextNumber, title, url };
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

  const data = await graphFetch(`/me/calendarView?${params}`);
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

  const data = await graphFetch('/me/events', {
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

async function listEmails({ top = 5, unread_only = false, folder = 'inbox' } = {}) {
  const params = new URLSearchParams({
    $top: String(top),
    $orderby: 'receivedDateTime desc',
    $select: 'subject,from,receivedDateTime,bodyPreview,isRead,importance'
  });
  if (unread_only) params.append('$filter', 'isRead eq false');

  const data = await graphFetch(`/me/mailFolders/${folder}/messages?${params}`);
  if (data.error) return data;

  return {
    emails: (data.value || []).map(e => ({
      id: e.id,
      subject: e.subject,
      from: e.from?.emailAddress?.name || e.from?.emailAddress?.address,
      received: e.receivedDateTime,
      preview: e.bodyPreview?.slice(0, 300) || '',
      is_read: e.isRead,
      importance: e.importance
    }))
  };
}

async function listTodos({ list_name = '' } = {}) {
  const listsData = await graphFetch('/me/todo/lists');
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

  const tasksData = await graphFetch(`/me/todo/lists/${targetList.id}/tasks?${params}`);
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

async function createTodo({ title, list_name = '', due_date = null }) {
  const listsData = await graphFetch('/me/todo/lists');
  if (listsData.error) return listsData;

  const lists = listsData.value || [];
  let targetList = list_name
    ? lists.find(l => l.displayName.toLowerCase().includes(list_name.toLowerCase()))
    : null;
  if (!targetList) targetList = lists.find(l => l.wellknownListName === 'defaultList') || lists[0];
  if (!targetList) return { error: 'No To Do list found' };

  const task = { title };
  if (due_date) task.dueDateTime = { dateTime: new Date(due_date).toISOString(), timeZone: 'UTC' };

  const data = await graphFetch(`/me/todo/lists/${targetList.id}/tasks`, {
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

  const data = await graphFetch(`/me/onenote/pages?${params}`);
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

function isConfigured() {
  const config = getConfig();
  const m365 = config.integrations?.m365;
  return !!(m365?.enabled && m365?.clientId && m365?.tenantId && (m365?.accessToken || m365?.refreshToken));
}

module.exports = { listCalendarEvents, createCalendarEvent, listEmails, listTodos, createTodo, searchOneNote, saveYouTubeLink, isConfigured };
