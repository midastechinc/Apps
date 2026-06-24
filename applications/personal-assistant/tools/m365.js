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

// Cache a resolved compound PAGE id for a link-collection page (youtube/facebook/instagram)
function cacheLinkPageId(platform, pageId) {
  const cur = getConfig().integrations?.m365 || {};
  const pageIds = { ...(cur.pageIds || {}), [platform]: pageId };
  updateConfig({ integrations: { m365: { ...cur, pageIds } } });
  console.log(`[OneNote] Cached ${platform} link-page id = ${pageId}`);
}

// Valid OneNote (Graph) compound IDs always contain "!", e.g. 1-{hex}!{n}-{guid}.
// A bare GUID (a SharePoint file id) is NOT usable for Graph page/section operations.
function isCompoundOneNoteId(id) {
  return typeof id === 'string' && id.includes('!');
}

const norm = s => (s || '').toLowerCase().replace(/[-_\s]+/g, '');

async function findSectionId(sectionName) {
  const key = sectionName.toLowerCase();

  // 1. Config cache — fastest path, avoids all API calls
  const cur = getConfig().integrations?.m365;
  const cached = cur?.oneNoteSections?.[key];
  if (cached) {
    console.log(`[OneNote] Using cached section ID for "${sectionName}"`);
    return cached;
  }

  // 2. Navigate from known page IDs → parentNotebook → sections.
  //    Direct-by-ID access never triggers Error 10008.
  //    Use the hardcoded YouTube page plus any page IDs already cached from config.
  const knownPageIds = [
    '1-a9da38968f2a4e05826e53d9b8c8f5e4!55-07f6fff2-e3b3-4a32-ad6f-3835ead68a3e', // YouTube Links page
    ...(Object.values(cur?.pageIds || {})) // any other cached page IDs
  ].filter(Boolean);

  const checkedNotebookIds = new Set();
  for (const anchorPageId of knownPageIds) {
    const pageDetail = await oneNoteFetch(
      `/pages/${anchorPageId}?$expand=parentSection($select=id;$expand=parentNotebook($select=id,displayName))`
    );
    const nbId = pageDetail?.parentSection?.parentNotebook?.id;
    console.log(`[OneNote] Anchor ${anchorPageId.slice(-8)} → notebook ${nbId || 'not found'}, err: ${pageDetail?.error || 'none'}`);
    if (!nbId || checkedNotebookIds.has(nbId)) continue;
    checkedNotebookIds.add(nbId);

    const sectionsData = await oneNoteFetch(
      `/notebooks/${nbId}/sections?$select=id,displayName&$top=100`
    );
    console.log(`[OneNote] Notebook "${pageDetail.parentSection?.parentNotebook?.displayName}" sections: ${JSON.stringify(
      sectionsData.value?.map(s => s.displayName) || sectionsData.error
    )}`);
    if (sectionsData.error) continue;
    const match = (sectionsData.value || []).find(s =>
      s.displayName.toLowerCase().includes(key)
    );
    if (match) {
      console.log(`[OneNote] Found section "${match.displayName}" in notebook "${pageDetail.parentSection?.parentNotebook?.displayName}"`);
      cacheOneNoteSectionId(sectionName, match.id);
      return match.id;
    }
  }

  // 3. Drive .onetoc2 search (works for personal OneDrive; may not find SharePoint-hosted notebooks)
  console.log(`[OneNote] Trying Drive .onetoc2 discovery for "${sectionName}"...`);
  const tocSearch = await graphFetch(
    `/users/${USER_PRINCIPAL}/drive/search(q='.onetoc2')?$select=id,name,parentReference&$top=30`
  );
  console.log(`[OneNote] .onetoc2 search: error=${tocSearch.error || 'none'}, count=${tocSearch.value?.length ?? 0}`);

  if (!tocSearch.error && tocSearch.value?.length > 0) {
    const folderIds = [...new Set(
      tocSearch.value.map(f => f.parentReference?.id).filter(Boolean)
    )];
    for (const folderId of folderIds) {
      const sectionsData = await graphFetch(
        `/users/${USER_PRINCIPAL}/drive/items/${folderId}/onenote/sections?$select=id,displayName&$top=100`
      );
      if (sectionsData.error) {
        console.log(`[OneNote] drive/items/${folderId}/onenote/sections error: ${sectionsData.error}`);
        continue;
      }
      const match = (sectionsData.value || []).find(s =>
        s.displayName.toLowerCase().includes(key)
      );
      if (match) {
        console.log(`[OneNote] Found section "${match.displayName}" via Drive folder ${folderId}`);
        cacheOneNoteSectionId(sectionName, match.id);
        return match.id;
      }
    }
  }

  console.log(`[OneNote] Section "${sectionName}" not found. Cache it via m365_set_onenote_section.`);
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

// Page GUIDs from SharePoint URLs: wdsectionfileid = 07f6fff2-e3b3-4a32-ad6f-3835ead68a3e (Quick Notes section)
// Compound ID format: 1-{pageGuid_noDashes}!55-{sectionGuid}
const PLATFORM_CONFIG = {
  youtube:   { pageName: 'YouTube Links',   pageIdKey: 'youtubeLinksPageId',   hardcodedId: '1-a9da38968f2a4e05826e53d9b8c8f5e4!55-07f6fff2-e3b3-4a32-ad6f-3835ead68a3e' },
  facebook:  { pageName: 'Facebook Links',  pageIdKey: 'facebookLinksPageId',  hardcodedId: '1-25d5be0215efd24398babb6118988ec9!55-07f6fff2-e3b3-4a32-ad6f-3835ead68a3e' },
  instagram: { pageName: 'Instagram Links', pageIdKey: 'instagramLinksPageId', hardcodedId: null }
};

// Resolve and cache the Graph API compound section ID for the "Quick Notes" section.
// Navigates from the YouTube anchor page whose section is known.
async function getQuickNotesSectionId() {
  const cur = getConfig().integrations?.m365 || {};
  if (cur.quickNotesSectionId && isCompoundOneNoteId(cur.quickNotesSectionId)) {
    return cur.quickNotesSectionId;
  }
  const ANCHOR = '1-a9da38968f2a4e05826e53d9b8c8f5e4!55-07f6fff2-e3b3-4a32-ad6f-3835ead68a3e';
  const detail = await oneNoteFetch(`/pages/${ANCHOR}?$expand=parentSection($select=id,displayName)`);
  const sectionId = detail?.parentSection?.id;
  if (sectionId && isCompoundOneNoteId(sectionId)) {
    console.log(`[OneNote] Quick Notes section ID: ${sectionId} ("${detail.parentSection?.displayName}")`);
    updateConfig({ integrations: { m365: { ...cur, quickNotesSectionId: sectionId } } });
    return sectionId;
  }
  console.log(`[OneNote] getQuickNotesSectionId anchor navigation failed: ${detail?.error || 'no parentSection'}`);
  return await findSectionId('Quick Notes');
}

async function findOneNotePageByTitle(titleToFind) {
  const lower = titleToFind.toLowerCase();

  // Use OneNote full-text search (`search=`, index-based — works under Error 10008).
  // Do NOT add $top or $select here: those trigger Error 20108 on the search endpoint.
  const searchData = await oneNoteFetch(`/pages?search=${encodeURIComponent(titleToFind)}`);
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

// Resolve the compound PAGE id of a link-collection page ("YouTube Links", "Facebook Links",
// "Instagram Links"). These are PAGES inside the "Quick Notes" section — NOT sections.
// Chain: hardcoded compound id → cached compound id → full-text search → notebook navigation.
async function findLinkPageId(platform) {
  const cfg = PLATFORM_CONFIG[platform];
  if (!cfg) return null;
  const wanted = norm(cfg.pageName);
  const cur = getConfig().integrations?.m365 || {};

  // 1. Hardcoded compound id (YouTube anchor)
  if (cfg.hardcodedId && isCompoundOneNoteId(cfg.hardcodedId)) {
    return { id: cfg.hardcodedId };
  }

  // 2. Previously cached compound id
  const cached = cur.pageIds?.[platform] || cur[cfg.pageIdKey];
  if (cached && isCompoundOneNoteId(cached)) {
    return { id: cached };
  }

  // 3. Full-text search — index-based, works under Error 10008. NO $top (causes 20108).
  const searchData = await oneNoteFetch(`/pages?search=${encodeURIComponent(cfg.pageName)}`);
  if (!searchData.error) {
    const hit = (searchData.value || []).find(p => norm(p.title) === wanted && isCompoundOneNoteId(p.id));
    if (hit) {
      console.log(`[OneNote] Resolved "${cfg.pageName}" page via search → ${hit.id}`);
      cacheLinkPageId(platform, hit.id);
      return { id: hit.id, sectionId: hit.parentSection?.id };
    }
    console.log(`[OneNote] Search for "${cfg.pageName}" returned ${(searchData.value || []).length} pages, no exact title match`);
  } else {
    console.log(`[OneNote] findLinkPageId search error: ${searchData.error}`);
  }

  // 4. Navigate from YouTube anchor page → notebook → every section → pages → exact title match
  const ANCHOR = '1-a9da38968f2a4e05826e53d9b8c8f5e4!55-07f6fff2-e3b3-4a32-ad6f-3835ead68a3e';
  const anchor = await oneNoteFetch(
    `/pages/${ANCHOR}?$expand=parentSection($select=id;$expand=parentNotebook($select=id))`
  );
  const nbId = anchor?.parentSection?.parentNotebook?.id;
  if (nbId) {
    const sectionsData = await oneNoteFetch(`/notebooks/${nbId}/sections?$select=id,displayName`);
    for (const sec of (sectionsData.value || []).slice(0, 25)) {
      const pagesData = await oneNoteFetch(`/sections/${sec.id}/pages?$select=id,title`);
      if (pagesData.error) continue;
      const hit = (pagesData.value || []).find(p => norm(p.title) === wanted && isCompoundOneNoteId(p.id));
      if (hit) {
        console.log(`[OneNote] Resolved "${cfg.pageName}" page via notebook nav (section "${sec.displayName}") → ${hit.id}`);
        cacheLinkPageId(platform, hit.id);
        return { id: hit.id, sectionId: sec.id };
      }
    }
  } else {
    console.log(`[OneNote] findLinkPageId: anchor navigation failed (err: ${anchor?.error || 'no notebook'})`);
  }

  return null;
}

async function saveLink({ url }) {
  const platform = detectPlatform(url);
  if (!platform) return { error: 'URL is not from YouTube, Facebook, or Instagram.' };

  const cfg = PLATFORM_CONFIG[platform];
  console.log(`[OneNote] saveLink ${platform}: ${url.slice(0, 80)}`);

  let title = platform === 'youtube'
    ? await fetchYouTubeTitle(url)
    : await fetchPageTitle(url);
  if (!title) title = `${cfg.pageName.replace(' Links', '')} Post`;
  console.log(`[OneNote] title: "${title}"`);

  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  // Use a URL-derived signature for verification (title can false-positive if page already contains that word)
  const urlSig = url.replace(/https?:\/\//i, '').replace(/[^a-z0-9]/gi, '').slice(0, 25).toLowerCase();

  // ── APPROACH 1: PATCH-append to the specific link-collection page ────────────
  // This is the preferred approach — keeps all links for a platform on one page.
  // YouTube has a hardcoded compound ID (known working); Facebook now has one too.
  const page = await findLinkPageId(platform);
  if (page?.id) {
    const pageId = page.id;
    console.log(`[OneNote] PATCH-append to "${cfg.pageName}" page ${pageId.slice(-16)}`);

    const existingHtml = await oneNoteTextFetch(`/pages/${pageId}/content`);
    const nums = existingHtml
      ? [...existingHtml.matchAll(/>\s*(\d+)[.)]\s/g)].map(m => parseInt(m[1], 10))
      : [];
    const nextNumber = nums.length ? Math.max(...nums) + 1 : 1;

    const patch = await oneNoteFetch(`/pages/${pageId}/content`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        target: 'body',
        action: 'append',
        content: `<p>${nextNumber}. <a href="${safeUrl}">${safeTitle}</a></p>`
      }])
    });

    if (!patch?.error) {
      // Verify using URL signature — avoid title false-positives
      await new Promise(r => setTimeout(r, 1500));
      const verify = await oneNoteTextFetch(`/pages/${pageId}/content`);
      const patchOk = !verify || verify.length < 60 || urlSig.length < 8 || norm(verify).includes(urlSig.slice(0, 20));
      if (patchOk) {
        console.log(`[OneNote] PATCH OK — #${nextNumber} in "${cfg.pageName}" (${pageId.slice(-12)})`);
        return { success: true, number: nextNumber, title, url, platform, page: cfg.pageName };
      }
      console.warn(`[OneNote] PATCH verify failed for "${cfg.pageName}" (urlSig="${urlSig.slice(0,20)}") — falling back to POST`);
    } else {
      console.warn(`[OneNote] PATCH error for "${cfg.pageName}": ${patch.error} — trying POST fallback`);
    }
  } else {
    console.log(`[OneNote] findLinkPageId returned null for ${platform} — trying POST`);
  }

  // ── APPROACH 2: POST a new page to Quick Notes section ──────────────────────
  // Fallback when PATCH verify fails. Creates a page per link in the section.
  const sectionId = await getQuickNotesSectionId();
  if (!sectionId) {
    return { error: `Couldn't save link to OneNote — PATCH failed and Quick Notes section not found. Reconnect OneNote in Integrations.` };
  }

  const now = new Date().toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  const html = `<!DOCTYPE html><html><head><title>${safeTitle}</title></head><body><h1>${safeTitle}</h1><p><a href="${safeUrl}">${safeUrl}</a></p><p style="color:#888;font-size:0.85em;">${cfg.pageName.replace(' Links', '')} — ${now}</p></body></html>`;

  const data = await oneNoteFetch(`/sections/${sectionId}/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xhtml+xml' },
    body: html
  });

  if (data.error) {
    console.error(`[OneNote] POST fallback also failed (section ${sectionId.slice(-12)}): ${data.error}`);
    return { error: `Couldn't save link to OneNote: ${data.error}` };
  }

  console.log(`[OneNote] POST new page "${title}" in Quick Notes (PATCH fallback worked)`);
  return { success: true, title, url, platform, page: cfg.pageName };
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
    $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead,importance,hasAttachments',
    $expand: 'attachments($select=id,name,contentType)'
  });
  if (unread_only) params.append('$filter', 'isRead eq false');

  const data = await graphFetch(`/users/ali@midastech.ca/mailFolders/${folder}/messages?${params}`);
  if (data.error) return data;

  return {
    emails: (data.value || []).map(e => {
      const attachments = (e.attachments || []).map(a => ({ name: a.name, type: a.contentType }));
      return {
        id: e.id,
        subject: e.subject,
        from: e.from?.emailAddress?.name || e.from?.emailAddress?.address,
        received: e.receivedDateTime,
        preview: e.bodyPreview?.slice(0, 500) || '',
        is_read: e.isRead,
        importance: e.importance,
        attachment_count: attachments.length,
        attachments,
      };
    })
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

async function listEmailAttachments({ email_id } = {}) {
  if (!email_id) return { error: 'email_id required' };
  const data = await graphFetch(`/users/${USER_PRINCIPAL}/messages/${email_id}/attachments?$select=id,name,contentType,size`);
  if (data.error) return data;
  const attachments = (data.value || []).map(a => ({
    id: a.id,
    name: a.name,
    type: a.contentType,
    size_kb: Math.round((a.size || 0) / 1024),
  }));
  return { email_id, attachments };
}

async function readEmailPdf({ email_id, attachment_id, attachment_name } = {}) {
  if (!email_id) return { error: 'email_id required' };

  // Resolve attachment_id from name if needed
  let resolvedId = attachment_id;
  if (!resolvedId) {
    const list = await listEmailAttachments({ email_id });
    if (list.error) return list;
    const match = attachment_name
      ? list.attachments.find(a => a.name.toLowerCase().includes(attachment_name.toLowerCase()) && a.type?.includes('pdf'))
      : list.attachments.find(a => a.type?.includes('pdf'));
    if (!match) return { error: 'No PDF attachment found in this email' };
    resolvedId = match.id;
  }

  const data = await graphFetch(`/users/${USER_PRINCIPAL}/messages/${email_id}/attachments/${resolvedId}`);
  if (data.error) return data;

  const base64 = data.contentBytes;
  if (!base64) return { error: 'Attachment has no content' };

  try {
    const pdfParse = require('pdf-parse');
    const buffer = Buffer.from(base64, 'base64');
    const parsed = await pdfParse(buffer);
    const text = parsed.text.replace(/\s{3,}/g, '\n\n').trim().slice(0, 6000);
    return {
      filename: data.name,
      pages: parsed.numpages,
      text: text + (parsed.text.length > 6000 ? '\n\n[truncated]' : ''),
    };
  } catch (err) {
    return { error: `PDF parse failed: ${err.message}` };
  }
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
  // NOTE: $top and $select cannot be combined with search= (triggers Error 20108)
  const data = await oneNoteFetch(`/pages?search=${encodeURIComponent(query)}`);
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
  // Primary: OneNote notebooks API (delegated token, works for SharePoint-hosted notebooks)
  const nbData = await oneNoteFetch(`/notebooks?$select=id,displayName&$top=50`);
  if (!nbData.error && nbData.value?.length > 0) {
    const result = [];
    for (const nb of nbData.value) {
      const sectionsData = await oneNoteFetch(`/notebooks/${nb.id}/sections?$select=id,displayName`);
      result.push({
        notebook: nb.displayName,
        id: nb.id,
        sections: sectionsData.error
          ? [`(error loading sections: ${sectionsData.error})`]
          : (sectionsData.value || []).map(s => ({ id: s.id, name: s.displayName }))
      });
    }
    return { structure: result };
  }
  console.log('[OneNote] listOneNoteStructure: /notebooks returned error or empty:', nbData.error || '0 results');

  // Fallback: Drive .onetoc2 discovery (for OneDrive-hosted notebooks)
  const tocSearch = await graphFetch(
    `/users/${USER_PRINCIPAL}/drive/search(q='.onetoc2')?$select=id,name,parentReference&$top=30`
  );
  if (tocSearch.error) return { error: `Could not list OneNote structure: ${tocSearch.error}` };

  const folderIds = [...new Set(
    (tocSearch.value || []).map(f => f.parentReference?.id).filter(Boolean)
  )];
  if (folderIds.length === 0) return { structure: [], note: 'No OneNote notebooks found.' };

  const result = [];
  for (const folderId of folderIds) {
    const folderData = await graphFetch(`/users/${USER_PRINCIPAL}/drive/items/${folderId}?$select=name`);
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

// Raw, LLM-bypassing OneNote diagnostic. Returns a compact text report of the
// ACTUAL Graph API responses so we can see ground truth instead of guessing.
async function diagnoseOneNote() {
  const lines = [];
  const short = id => (id || '').length > 40 ? id.slice(0, 24) + '…' + id.slice(-8) : id;

  // 1. Token
  const token = await getOneNoteAccessToken();
  lines.push(`1) OneNote token: ${token ? 'OK' : 'MISSING — reconnect OneNote'}`);
  if (!token) return lines.join('\n');

  // 1b. Compare /me/onenote vs /users/{id}/onenote (delegated tokens can differ per MS docs)
  const meNb = await graphFetch(`/me/onenote/notebooks?$select=id,displayName&$top=50`);
  const usersNb = await graphFetch(`/users/${USER_PRINCIPAL}/onenote/notebooks?$select=id,displayName&$top=50`);
  const summ = r => r.error ? `ERR ${String(r.error).slice(0, 60)}` : `${(r.value || []).length} nbs`;
  lines.push(`1b) /me/onenote: ${summ(meNb)} | /users/{id}/onenote: ${summ(usersNb)}`);

  // 2. Notebooks
  const nb = await oneNoteFetch(`/notebooks?$select=id,displayName&$top=50`);
  if (nb.error) {
    lines.push(`2) /notebooks ERROR: ${String(nb.error).slice(0, 160)}`);
  } else {
    const names = (nb.value || []).map(n => n.displayName);
    lines.push(`2) Notebooks (${names.length}): ${names.join(', ') || 'none'}`);
    // 3. Sections of each notebook
    for (const n of (nb.value || []).slice(0, 5)) {
      const sec = await oneNoteFetch(`/notebooks/${n.id}/sections?$select=id,displayName`);
      if (sec.error) { lines.push(`   • "${n.displayName}" sections ERROR: ${String(sec.error).slice(0, 100)}`); continue; }
      const sNames = (sec.value || []).map(s => s.displayName);
      lines.push(`   • "${n.displayName}": ${sNames.join(', ') || '(no sections)'}`);
    }
  }

  // 4. YouTube anchor page resolution + section ID
  const ANCHOR = '1-a9da38968f2a4e05826e53d9b8c8f5e4!55-07f6fff2-e3b3-4a32-ad6f-3835ead68a3e';
  const anchor = await oneNoteFetch(`/pages/${ANCHOR}?$expand=parentSection($select=id,displayName;$expand=parentNotebook($select=id,displayName))`);
  if (anchor.error) {
    lines.push(`4) YouTube anchor page ERROR: ${String(anchor.error).slice(0, 160)}`);
  } else {
    const secId = anchor.parentSection?.id || 'none';
    lines.push(`4) YouTube anchor → section "${anchor.parentSection?.displayName}" (${short(secId)}) in nb "${anchor.parentSection?.parentNotebook?.displayName}"`);
    // 4b. Test POST a page to that section (dry-run write test)
    if (anchor.parentSection?.id) {
      const testHtml = `<!DOCTYPE html><html><head><title>Claudia Write Test</title></head><body><p>Write test — can be deleted</p></body></html>`;
      const testPost = await oneNoteFetch(`/sections/${anchor.parentSection.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xhtml+xml' },
        body: testHtml
      });
      if (testPost.error) {
        lines.push(`4b) POST write test FAILED: ${String(testPost.error).slice(0, 120)}`);
      } else {
        lines.push(`4b) POST write test OK → page id ${short(testPost.id || '')}`);
      }
    }
  }

  // 5. Find the three link pages by search
  for (const name of ['YouTube Links', 'Facebook Links', 'Instagram Links']) {
    const data = await oneNoteFetch(`/pages?search=${encodeURIComponent(name)}`);
    if (data.error) { lines.push(`5) search "${name}" ERROR: ${String(data.error).slice(0, 100)}`); continue; }
    const exact = (data.value || []).filter(p => norm(p.title) === norm(name));
    if (exact.length) {
      lines.push(`5) "${name}": FOUND ${exact.length} — ids: ${exact.map(p => short(p.id)).join(', ')}`);
    } else {
      const titles = (data.value || []).slice(0, 3).map(p => p.title);
      lines.push(`5) "${name}": no exact match (${(data.value || []).length} hits${titles.length ? ': ' + titles.join(' | ') : ''})`);
    }
  }

  // 6. Cached config
  const cur = getConfig().integrations?.m365 || {};
  lines.push(`6) Cached pageIds: ${JSON.stringify(cur.pageIds || {})}`);
  lines.push(`   Cached sections: ${JSON.stringify(cur.oneNoteSections || {})}`);
  lines.push(`   quickNotesSectionId: ${cur.quickNotesSectionId || '(not cached)'}`);

  return lines.join('\n');
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
    $select: 'id,displayName,emailAddresses,mobilePhone,businessPhones,companyName,jobTitle'
  });
  // $orderby and $search cannot be combined — only add orderby when not searching
  if (search) {
    params.set('$search', `"${search}"`);
  } else {
    params.set('$orderby', 'displayName');
  }
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

  // Find the section ID without enumerating all notebooks (avoids Error 10008)
  if (section_name) {
    const sectionId = await findSectionId(section_name);
    if (sectionId) {
      const pageData = await graphFetch(`/users/${USER_PRINCIPAL}/onenote/sections/${sectionId}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xhtml+xml' },
        body: html
      });
      if (!pageData.error) {
        console.log(`[M365] OneNote page created: "${title}" in section ${sectionId}`);
        cacheOneNoteSectionId(section_name, sectionId);
        return { success: true, title, section: section_name, page_id: pageData.id, url: pageData.links?.oneNoteWebUrl?.href || null };
      }
      console.log(`[OneNote] Cached ID ${sectionId} rejected: ${pageData.error} — clearing and retrying discovery`);
      // Cached ID wrong format — clear it then retry discovery without cache
      const cur2 = getConfig().integrations?.m365 || {};
      const sections2 = { ...(cur2.oneNoteSections || {}) };
      delete sections2[section_name.toLowerCase()];
      updateConfig({ integrations: { m365: { ...cur2, oneNoteSections: sections2 } } });
      // Retry findSectionId (cache is now empty so it runs full discovery)
      const retrySectionId = await findSectionId(section_name);
      if (retrySectionId) {
        const retryData = await graphFetch(`/users/${USER_PRINCIPAL}/onenote/sections/${retrySectionId}/pages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/xhtml+xml' },
          body: html
        });
        if (!retryData.error) {
          console.log(`[M365] OneNote page created on retry: "${title}" in section ${retrySectionId}`);
          return { success: true, title, section: section_name, page_id: retryData.id, url: retryData.links?.oneNoteWebUrl?.href || null };
        }
        return { error: `OneNote API error after rediscovery: ${retryData.error}` };
      }
    }
  }

  // Could not find the section — ask user to provide the section URL
  return { error: `Could not find OneNote section "${section_name || '(none specified)'}". Please open OneNote, right-click the section tab, copy the link, and send it to me with: "Set my OneNote section [section name] to [URL]"` };
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

  // If the URL contains a PAGE path (SectionName|sectionId/PageTitle|pageId/)
  // search for that page to get the REAL Graph API section ID (not the SharePoint file ID).
  const pageMatch = decoded.match(/\.one\|[^/]+\/([^|/]+)\|[0-9a-f-]+\//i);
  const pageTitle = pageMatch?.[1]?.replace(/-/g, ' ').trim();
  if (pageTitle) {
    console.log(`[OneNote] setOneNoteSection: detected page URL, searching for page "${pageTitle}"`);
    const searchData = await oneNoteFetch(
      `/pages?$search="${pageTitle}"&$expand=parentSection($select=id,displayName)&$select=id,title&$top=10`
    );
    if (!searchData.error) {
      const page = (searchData.value || []).find(p =>
        p.title?.toLowerCase().includes(pageTitle.toLowerCase()) ||
        pageTitle.toLowerCase().includes(p.title?.toLowerCase())
      );
      if (page?.parentSection?.id) {
        const sectionId = page.parentSection.id;
        console.log(`[OneNote] Found real section ID via page search: ${sectionId} (section: "${page.parentSection.displayName}")`);
        cacheOneNoteSectionId(section_name, sectionId);
        return { success: true, section_name, section_id: sectionId, message: `Saved! Found the real section ID for "${section_name}" via the page "${page.title}".` };
      }
    }
    console.log(`[OneNote] Page search for "${pageTitle}" returned no results (error: ${searchData.error || 'none, 0 results'})`);
  }

  // Fall back: extract GUID directly from URL
  // Priority 1: wdsectionfileid param
  const wdSection = decoded.match(/wdsectionfileid[=\s{]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  // Priority 2: GUID after pipe in wd=target(SectionName|GUID/) pattern
  const wdTarget = decoded.match(/\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  const anyGuid = decoded.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  const sectionId = wdSection?.[1] || wdTarget?.[1] || anyGuid?.[0] || section_id_or_url.trim();
  cacheOneNoteSectionId(section_name, sectionId);
  return { success: true, section_name, section_id: sectionId, message: `Saved section ID for "${section_name}" (note: this is a SharePoint file ID — it may not work directly with the Graph API).` };
}

function isConfigured() {
  const config = getConfig();
  const m365 = config.integrations?.m365;
  return !!(m365?.enabled && m365?.clientId && m365?.tenantId && m365?.clientSecret);
}

module.exports = {
  getAccessToken,
  listCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, findMeetingTimes,
  getOutOfOfficeStatus, setOutOfOffice,
  listEmails, searchEmails, readEmail, listEmailAttachments, readEmailPdf, sendEmail, replyToEmail, createEmailDraft, sendDraft,
  listTodos, createTodo, completeTodo, updateTodo,
  listContacts, createContact,
  searchOneNote, saveLink, listOneNoteStructure, getPageIdsForLinkPages, diagnoseOneNote,
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

