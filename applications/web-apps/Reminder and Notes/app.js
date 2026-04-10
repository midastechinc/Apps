const SETTINGS_KEY = "m365-reminder-dashboard-settings";

const sampleItems = [
  {
    section: "notes",
    source: "OneNote",
    title: "Board meeting prep",
    body: "Summarize open action items, budget questions, and the rollout note for the April review.",
    date: "",
    tags: ["sample", "executive"],
    link: ""
  },
  {
    section: "notes",
    source: "OneNote",
    title: "StudioB handoff notes",
    body: "Keep implementation notes, vendor updates, and launch checkpoints together for the next status review.",
    date: "",
    tags: ["sample", "project"],
    link: ""
  },
  {
    section: "tasks",
    source: "Microsoft To Do",
    title: "Approve onboarding checklist",
    body: "Finalize the new employee setup list and assign the remaining follow-up items.",
    date: todayAt(15),
    tags: ["sample", "ops"],
    link: ""
  },
  {
    section: "tasks",
    source: "Microsoft To Do",
    title: "Review service invoices",
    body: "Confirm totals, send approvals, and attach notes for anything that needs a finance reply.",
    date: tomorrowAt(11),
    tags: ["sample", "finance"],
    link: ""
  },
  {
    section: "calendar",
    source: "M365 Calendar",
    title: "Client renewal reminder",
    body: "Reminder to call the client and confirm renewal terms before the contract expiry date.",
    date: todayAt(17),
    tags: ["sample", "client"],
    link: ""
  },
  {
    section: "calendar",
    source: "M365 Calendar",
    title: "Quarterly planning session",
    body: "Calendar event with department leads to review targets, blockers, and timeline changes.",
    date: tomorrowAt(14),
    tags: ["sample", "planning"],
    link: ""
  },
  {
    section: "email",
    source: "Outlook Flagged Mail",
    title: "Flagged: pricing clarification",
    body: "Customer asked for confirmation on revised pricing and wants an answer before tomorrow morning.",
    date: todayAt(13),
    tags: ["sample", "sales"],
    link: ""
  },
  {
    section: "email",
    source: "Outlook Flagged Mail",
    title: "Flagged: contract attachment",
    body: "Attachment needs review and a reply after legal confirms the wording changes.",
    date: tomorrowAt(9),
    tags: ["sample", "legal"],
    link: ""
  }
];

const fileConfig = window.M365_DASHBOARD_CONFIG || {};

const defaults = {
  clientId: fileConfig.clientId || "",
  tenantMode: normalizeTenantMode(fileConfig.tenantId || "organizations"),
  tenantId: isSpecialTenant(fileConfig.tenantId) ? "" : fileConfig.tenantId || "",
  redirectUri: fileConfig.redirectUri || "",
  graphBaseUrl: fileConfig.graphBaseUrl || "https://graph.microsoft.com/v1.0",
  graphScopes: Array.isArray(fileConfig.graphScopes)
    ? fileConfig.graphScopes
    : ["User.Read", "Notes.Read", "Tasks.Read", "Calendars.Read", "Mail.Read"]
};

const state = {
  items: [...sampleItems],
  auth: {
    mode: "setup",
    userText: "No Microsoft account connected"
  },
  settings: loadSettings(),
  calendarView: "month",
  calendarAnchor: startOfDay(new Date())
};

const sectionMap = {
  notes: document.getElementById("notesList"),
  tasks: document.getElementById("tasksList"),
  calendar: document.getElementById("calendarList"),
  email: document.getElementById("emailList")
};

const countMap = {
  notes: document.getElementById("notesCount"),
  tasks: document.getElementById("tasksCount"),
  calendar: document.getElementById("calendarCount"),
  email: document.getElementById("emailCount")
};

const metricNodes = {
  total: document.getElementById("totalItems"),
  dueToday: document.getElementById("dueTodayCount"),
  flagged: document.getElementById("flaggedCount"),
  connected: document.getElementById("connectedCount")
};

const searchInput = document.getElementById("searchInput");
const statusText = document.getElementById("statusText");
const itemTemplate = document.getElementById("itemTemplate");
const authStateChip = document.getElementById("authStateChip");
const authUserText = document.getElementById("authUserText");
const connectButton = document.getElementById("connectButton");
const refreshButton = document.getElementById("refreshButton");
const signOutButton = document.getElementById("signOutButton");
const adminState = document.getElementById("adminState");
const adminForm = document.getElementById("adminForm");
const clientIdInput = document.getElementById("clientIdInput");
const tenantModeInput = document.getElementById("tenantModeInput");
const tenantIdInput = document.getElementById("tenantIdInput");
const redirectUriInput = document.getElementById("redirectUriInput");
const scopesInput = document.getElementById("scopesInput");
const authorityPreview = document.getElementById("authorityPreview");
const resetSettingsButton = document.getElementById("resetSettingsButton");
const adminPanel = document.getElementById("adminPanel");
const calendarBoard = document.getElementById("calendarBoard");
const calendarRangeLabel = document.getElementById("calendarRangeLabel");
const calendarPrevButton = document.getElementById("calendarPrevButton");
const calendarNextButton = document.getElementById("calendarNextButton");
const calendarViewButtons = Array.from(document.querySelectorAll(".calendar-view-button"));

let msalApp = null;
let activeAccount = null;

searchInput.addEventListener("input", render);
connectButton.addEventListener("click", connectMicrosoft365);
refreshButton.addEventListener("click", refreshLiveData);
signOutButton.addEventListener("click", signOutMicrosoft365);
adminForm.addEventListener("submit", saveAdminSettings);
tenantModeInput.addEventListener("change", syncAdminState);
resetSettingsButton.addEventListener("click", resetAdminSettings);
calendarPrevButton.addEventListener("click", () => shiftCalendarRange(-1));
calendarNextButton.addEventListener("click", () => shiftCalendarRange(1));
calendarViewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.calendarView = button.dataset.view;
    syncCalendarButtons();
    render();
  });
});

initialize();

async function initialize() {
  hydrateAdminForm();
  syncAdminState();
  adminPanel.open = !state.settings.clientId;
  render();
  await configureMsalFromSettings();
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return { ...defaults };
    }

    const parsed = JSON.parse(raw);
    return {
      clientId: parsed.clientId || defaults.clientId,
      tenantMode: parsed.tenantMode || defaults.tenantMode,
      tenantId: parsed.tenantId || defaults.tenantId,
      redirectUri: parsed.redirectUri || defaults.redirectUri,
      graphBaseUrl: parsed.graphBaseUrl || defaults.graphBaseUrl,
      graphScopes: Array.isArray(parsed.graphScopes) && parsed.graphScopes.length ? parsed.graphScopes : defaults.graphScopes
    };
  } catch (error) {
    console.warn("Failed to load Microsoft Graph settings.", error);
    return { ...defaults };
  }
}

function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function hydrateAdminForm() {
  clientIdInput.value = state.settings.clientId;
  tenantModeInput.value = state.settings.tenantMode;
  tenantIdInput.value = state.settings.tenantId;
  redirectUriInput.value = state.settings.redirectUri;
  scopesInput.value = state.settings.graphScopes.join(", ");
}

function syncAdminState() {
  const specific = tenantModeInput.value === "specific";
  tenantIdInput.disabled = !specific;
  tenantIdInput.closest("label").style.opacity = specific ? "1" : "0.6";
  authorityPreview.textContent = `Authority preview: https://login.microsoftonline.com/${currentTenantValueFromForm() || "organizations"}`;
  adminState.textContent = state.settings.clientId ? "Saved" : "Local";
}

async function saveAdminSettings(event) {
  event.preventDefault();

  state.settings = {
    clientId: clientIdInput.value.trim(),
    tenantMode: tenantModeInput.value,
    tenantId: tenantIdInput.value.trim(),
    redirectUri: redirectUriInput.value.trim(),
    graphBaseUrl: defaults.graphBaseUrl,
    graphScopes: scopesInput.value
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean)
  };

  if (!state.settings.graphScopes.length) {
    state.settings.graphScopes = [...defaults.graphScopes];
  }

  persistSettings();
  syncAdminState();
  adminPanel.open = false;
  await configureMsalFromSettings();
}

async function resetAdminSettings() {
  state.settings = { ...defaults };
  persistSettings();
  hydrateAdminForm();
  syncAdminState();
  adminPanel.open = true;
  await configureMsalFromSettings();
}

async function configureMsalFromSettings() {
  msalApp = null;
  activeAccount = null;
  state.items = [...sampleItems];

  if (!state.settings.clientId) {
    setAuthMode("setup", "Enter Microsoft Graph settings in the Admin section to enable live sign-in for any tenant.");
    render();
    return;
  }

  if (!window.msal) {
    setAuthMode("setup", "MSAL failed to load, so Microsoft sign-in is unavailable right now.");
    render();
    return;
  }

  msalApp = new window.msal.PublicClientApplication({
    auth: {
      clientId: state.settings.clientId,
      authority: `https://login.microsoftonline.com/${currentTenantValue()}`,
      redirectUri: state.settings.redirectUri || buildDefaultRedirectUri()
    },
    cache: {
      cacheLocation: "localStorage",
      storeAuthStateInCookie: false
    }
  });

  try {
    await msalApp.handleRedirectPromise();
  } catch (error) {
    console.error("MSAL redirect handling failed.", error);
  }

  const accounts = msalApp.getAllAccounts();
  if (accounts.length) {
    activeAccount = accounts[0];
    msalApp.setActiveAccount(activeAccount);
    setAuthMode("loading", "Refreshing Microsoft 365 data...");
    await refreshLiveData();
  } else {
    setAuthMode("disconnected", "Saved Microsoft Graph settings are ready. Connect a tenant account when you are ready to load live data.");
    render();
  }
}

async function connectMicrosoft365() {
  if (!msalApp) {
    setAuthMode("setup", "Save a Client ID in the Admin section first.");
    return;
  }

  try {
    setAuthMode("loading", "Opening Microsoft sign-in...");
    const response = await msalApp.loginPopup({
      scopes: state.settings.graphScopes,
      prompt: "select_account"
    });
    activeAccount = response.account;
    msalApp.setActiveAccount(activeAccount);
    await refreshLiveData();
  } catch (error) {
    console.error("Microsoft login failed.", error);
    setAuthMode("disconnected", "Microsoft sign-in was cancelled or failed. Your saved tenant settings remain in the Admin section.");
    render();
  }
}

async function refreshLiveData() {
  if (!msalApp || !activeAccount) {
    render();
    return;
  }

  try {
    setAuthMode("loading", "Loading OneNote, To Do, Calendar, and flagged mail...");
    const token = await getGraphToken();
    const [profile, notes, tasks, calendar, mail] = await Promise.all([
      fetchGraph("/me?$select=displayName,userPrincipalName", token),
      fetchOneNotePages(token),
      fetchTodoTasks(token),
      fetchCalendarItems(token),
      fetchFlaggedMail(token)
    ]);

    state.items = [...notes, ...tasks, ...calendar, ...mail];
    state.auth.userText = profile.userPrincipalName || activeAccount.username || "Connected";
    setAuthMode(
      "connected",
      `${profile.displayName || activeAccount.username || "Connected user"} is viewing live Microsoft 365 data.`
    );
    render();
  } catch (error) {
    console.error("Graph refresh failed.", error);
    state.items = [...sampleItems];
    setAuthMode("disconnected", "Live refresh failed. Check the Admin settings, redirect URI, tenant mode, and Graph permissions.");
    render();
  }
}

async function signOutMicrosoft365() {
  if (!msalApp || !activeAccount) {
    setAuthMode("disconnected", "No Microsoft session is active right now.");
    render();
    return;
  }

  try {
    await msalApp.logoutPopup({
      account: activeAccount,
      postLogoutRedirectUri: window.location.href
    });
  } catch (error) {
    console.error("Logout failed.", error);
  }

  activeAccount = null;
  state.items = [...sampleItems];
  setAuthMode("disconnected", "Signed out. Saved Microsoft Graph settings are still available in Admin.");
  render();
}

async function getGraphToken() {
  const request = {
    scopes: state.settings.graphScopes,
    account: activeAccount
  };

  try {
    const response = await msalApp.acquireTokenSilent(request);
    return response.accessToken;
  } catch (silentError) {
    const response = await msalApp.acquireTokenPopup(request);
    return response.accessToken;
  }
}

async function fetchOneNotePages(token) {
  const data = await fetchGraph("/me/onenote/pages?$top=8", token);
  const pages = Array.isArray(data.value) ? data.value : [];

  return pages.map((page) => ({
    section: "notes",
    source: "OneNote",
    title: page.title || "Untitled note",
    body: page.parentSection?.displayName
      ? `Section: ${page.parentSection.displayName}`
      : "OneNote page from your connected workspace.",
    date: page.lastModifiedTime || page.createdDateTime || "",
    tags: ["live", "onenote"],
    link: page.links?.oneNoteWebUrl?.href || ""
  }));
}

async function fetchTodoTasks(token) {
  const listsData = await fetchGraph("/me/todo/lists?$top=6", token);
  const lists = Array.isArray(listsData.value) ? listsData.value : [];

  const taskGroups = await Promise.all(
    lists.map(async (list) => {
      const taskData = await fetchGraph(`/me/todo/lists/${list.id}/tasks?$top=8`, token);
      return (taskData.value || []).map((task) => ({
        section: "tasks",
        source: "Microsoft To Do",
        title: task.title || "Untitled task",
        body: task.body?.content || `Task list: ${list.displayName || "My Tasks"}`,
        date: task.dueDateTime?.dateTime || task.reminderDateTime?.dateTime || "",
        tags: ["live", list.displayName || "todo"],
        link: ""
      }));
    })
  );

  return taskGroups.flat().slice(0, 8);
}

async function fetchCalendarItems(token) {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 14);

  const params = new URLSearchParams({
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    $top: "8"
  });

  const data = await fetchGraph(`/me/calendarView?${params.toString()}`, token);
  const events = Array.isArray(data.value) ? data.value : [];

  return events.map((event) => ({
    section: "calendar",
    source: "M365 Calendar",
    title: event.subject || "Untitled event",
    body: event.location?.displayName
      ? `Location: ${event.location.displayName}`
      : event.bodyPreview || "Calendar item from your Microsoft 365 account.",
    date: event.start?.dateTime || "",
    tags: ["live", event.isReminderOn ? "reminder" : "event"],
    link: event.webLink || ""
  }));
}

async function fetchFlaggedMail(token) {
  const data = await fetchGraph(
    "/me/messages?$select=subject,receivedDateTime,flag,from,bodyPreview,webLink&$top=25",
    token
  );

  const messages = Array.isArray(data.value) ? data.value : [];

  return messages
    .filter((message) => message.flag?.flagStatus === "flagged")
    .slice(0, 8)
    .map((message) => ({
      section: "email",
      source: "Outlook Flagged Mail",
      title: message.subject || "No subject",
      body: message.from?.emailAddress?.name
        ? `From ${message.from.emailAddress.name}: ${message.bodyPreview || ""}`
        : message.bodyPreview || "Flagged message",
      date: message.receivedDateTime || "",
      tags: ["live", "flagged"],
      link: message.webLink || ""
    }));
}

async function fetchGraph(path, token) {
  const response = await fetch(`${state.settings.graphBaseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Graph request failed: ${response.status}`);
  }

  return response.json();
}

function render() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = state.items.filter((item) => {
    if (!query) {
      return true;
    }

    const haystack = [item.title, item.body, item.source, item.tags.join(" ")].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  renderMetrics(filtered);
  renderSections(filtered);
  renderCalendar(filtered.filter((item) => item.section === "calendar"));
  renderStatus(filtered, query);
  renderAuth();
}

function renderMetrics(filtered) {
  metricNodes.total.textContent = String(filtered.length);
  metricNodes.dueToday.textContent = String(filtered.filter((item) => isToday(item.date)).length);
  metricNodes.flagged.textContent = String(filtered.filter((item) => item.section === "email").length);
  metricNodes.connected.textContent = state.auth.mode === "connected" ? "4" : "0";
}

function renderSections(filtered) {
  Object.entries(sectionMap).forEach(([section, node]) => {
    if (section === "calendar") {
      return;
    }

    node.replaceChildren();
    const sectionItems = filtered.filter((item) => item.section === section);
    countMap[section].textContent = String(sectionItems.length);

    if (!sectionItems.length) {
      const empty = document.createElement("div");
      empty.className = "empty-block";
      empty.textContent = "No matching items in this section.";
      node.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    sectionItems.forEach((item) => {
      const card = itemTemplate.content.firstElementChild.cloneNode(true);
      card.querySelector(".source-chip").textContent = item.source;
      card.querySelector(".date-chip").textContent = item.date ? formatDateTime(item.date) : "Reference";
      card.querySelector(".item-title").textContent = item.title;
      card.querySelector(".item-body").textContent = item.body;

      const tags = card.querySelector(".item-tags");
      item.tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = tag;
        tags.appendChild(chip);
      });

      const linkNode = card.querySelector(".item-link");
      if (item.link) {
        linkNode.href = item.link;
        linkNode.hidden = false;
      }

      fragment.appendChild(card);
    });

    node.appendChild(fragment);
  });
}

function renderCalendar(items) {
  countMap.calendar.textContent = String(items.length);
  syncCalendarButtons();
  calendarBoard.replaceChildren();

  if (state.calendarView === "day") {
    renderDayView(items);
    return;
  }

  if (state.calendarView === "week") {
    renderWeekView(items);
    return;
  }

  if (state.calendarView === "year") {
    renderYearView(items);
    return;
  }

  renderMonthView(items);
}

function renderDayView(items) {
  const day = startOfDay(state.calendarAnchor);
  calendarRangeLabel.textContent = formatRangeLabel(day, "day");

  const container = document.createElement("div");
  container.className = "calendar-day-view";

  const events = itemsForDay(items, day);
  if (!events.length) {
    container.appendChild(buildEmptyCalendar("No reminders or calendar entries on this day."));
  } else {
    events.forEach((item) => {
      const card = document.createElement("article");
      card.className = "calendar-day-card";
      card.innerHTML = `
        <div class="calendar-day-topline">
          <strong>${escapeHtml(item.title)}</strong>
          <span class="date-chip">${formatTimeOnly(item.date)}</span>
        </div>
        <p class="item-body">${escapeHtml(item.body)}</p>
      `;
      container.appendChild(card);
    });
  }

  calendarBoard.appendChild(container);
}

function renderWeekView(items) {
  const weekStart = startOfWeek(state.calendarAnchor);
  calendarRangeLabel.textContent = formatRangeLabel(weekStart, "week");

  const grid = document.createElement("div");
  grid.className = "calendar-grid week";

  eachWeekday(weekStart).forEach((day) => {
    grid.appendChild(buildDayCell(day, itemsForDay(items, day), true));
  });

  calendarBoard.appendChild(grid);
}

function renderMonthView(items) {
  const monthStart = startOfMonth(state.calendarAnchor);
  calendarRangeLabel.textContent = formatRangeLabel(monthStart, "month");

  const grid = document.createElement("div");
  grid.className = "calendar-grid month";

  weekdayLabels().forEach((label) => {
    const header = document.createElement("div");
    header.className = "calendar-header-cell";
    header.textContent = label;
    grid.appendChild(header);
  });

  monthGridDays(monthStart).forEach((day) => {
    grid.appendChild(buildDayCell(day, itemsForDay(items, day), isSameMonth(day, monthStart)));
  });

  calendarBoard.appendChild(grid);
}

function renderYearView(items) {
  const yearStart = startOfYear(state.calendarAnchor);
  calendarRangeLabel.textContent = formatRangeLabel(yearStart, "year");

  const grid = document.createElement("div");
  grid.className = "calendar-grid year";

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const monthDate = new Date(yearStart.getFullYear(), monthIndex, 1);
    const monthCard = document.createElement("section");
    monthCard.className = "calendar-mini-month";

    const monthEvents = items.filter((item) => isSameMonth(itemDate(item), monthDate)).slice(0, 4);

    const title = document.createElement("h3");
    title.textContent = monthDate.toLocaleDateString(undefined, { month: "long" });
    monthCard.appendChild(title);

    const list = document.createElement("div");
    list.className = "calendar-mini-list";

    if (!monthEvents.length) {
      const empty = document.createElement("div");
      empty.className = "calendar-empty";
      empty.textContent = "No scheduled items";
      list.appendChild(empty);
    } else {
      monthEvents.forEach((item) => {
        const row = document.createElement("div");
        row.className = "calendar-mini-event";
        row.innerHTML = `
          <strong>${escapeHtml(item.title)}</strong>
          <span>${formatMiniMonthDate(item.date)}</span>
        `;
        list.appendChild(row);
      });
    }

    monthCard.appendChild(list);
    grid.appendChild(monthCard);
  }

  calendarBoard.appendChild(grid);
}

function buildDayCell(day, events, inPrimaryRange) {
  const cell = document.createElement("article");
  cell.className = "calendar-cell";
  if (!inPrimaryRange) {
    cell.classList.add("muted");
  }
  if (isSameDay(day, new Date())) {
    cell.classList.add("today");
  }

  const header = document.createElement("div");
  header.className = "calendar-cell-header";
  header.innerHTML = `
    <span class="calendar-cell-label">${day.getDate()}</span>
    <span class="calendar-cell-subtitle">${day.toLocaleDateString(undefined, { weekday: "short" })}</span>
  `;
  cell.appendChild(header);

  const list = document.createElement("div");
  list.className = "calendar-events";

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "calendar-cell-subtitle";
    empty.textContent = "No items";
    list.appendChild(empty);
  } else {
    events.slice(0, 3).forEach((item) => {
      const event = document.createElement("div");
      event.className = "calendar-event";
      event.innerHTML = `
        <strong>${escapeHtml(item.title)}</strong>
        <span>${formatTimeOnly(item.date)}</span>
      `;
      list.appendChild(event);
    });

    if (events.length > 3) {
      const more = document.createElement("div");
      more.className = "calendar-cell-subtitle";
      more.textContent = `+${events.length - 3} more`;
      list.appendChild(more);
    }
  }

  cell.appendChild(list);
  return cell;
}

function buildEmptyCalendar(message) {
  const empty = document.createElement("div");
  empty.className = "calendar-empty";
  empty.textContent = message;
  return empty;
}

function shiftCalendarRange(direction) {
  if (state.calendarView === "day") {
    state.calendarAnchor = addDays(state.calendarAnchor, direction);
  } else if (state.calendarView === "week") {
    state.calendarAnchor = addDays(state.calendarAnchor, direction * 7);
  } else if (state.calendarView === "month") {
    state.calendarAnchor = addMonths(state.calendarAnchor, direction);
  } else {
    state.calendarAnchor = addYears(state.calendarAnchor, direction);
  }

  render();
}

function syncCalendarButtons() {
  calendarViewButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.calendarView);
  });
}

function renderStatus(filtered, query) {
  if (state.auth.mode === "loading") {
    return;
  }

  if (!query) {
    statusText.textContent =
      state.auth.mode === "connected"
        ? "Live Microsoft Graph data is filling the dashboard from OneNote, To Do, Calendar, and flagged mail."
        : "Use the Admin section to enter Microsoft Graph settings for whichever tenant you want to connect.";
    return;
  }

  statusText.textContent = `Showing ${filtered.length} matching item${filtered.length === 1 ? "" : "s"} across the Microsoft 365 dashboard.`;
}

function renderAuth() {
  authStateChip.className = "meta-chip";

  if (state.auth.mode === "connected") {
    authStateChip.classList.add("connected");
    authStateChip.textContent = "Connected";
  } else if (state.auth.mode === "loading") {
    authStateChip.classList.add("loading");
    authStateChip.textContent = "Loading";
  } else if (state.auth.mode === "setup") {
    authStateChip.textContent = "Setup needed";
  } else {
    authStateChip.textContent = "Not connected";
  }

  authUserText.textContent = state.auth.userText;
  refreshButton.disabled = state.auth.mode !== "connected";
  signOutButton.disabled = state.auth.mode !== "connected";
}

function setAuthMode(mode, statusMessage) {
  state.auth.mode = mode;
  state.auth.userText =
    mode === "connected"
      ? state.auth.userText
      : mode === "loading"
        ? "Contacting Microsoft 365..."
        : mode === "setup"
          ? "Microsoft Graph settings not configured"
          : "No Microsoft account connected";
  statusText.textContent = statusMessage;
  renderAuth();
}

function currentTenantValue() {
  if (state.settings.tenantMode === "specific") {
    return state.settings.tenantId || "organizations";
  }

  return state.settings.tenantMode || "organizations";
}

function currentTenantValueFromForm() {
  if (tenantModeInput.value === "specific") {
    return tenantIdInput.value.trim();
  }

  return tenantModeInput.value;
}

function buildDefaultRedirectUri() {
  const current = window.location.href;
  return current.endsWith("index.html") ? current.replace(/index\.html$/, "blank.html") : `${current.replace(/\/?$/, "/")}blank.html`;
}

function normalizeTenantMode(value) {
  return isSpecialTenant(value) ? value : value ? "specific" : "organizations";
}

function isSpecialTenant(value) {
  return ["organizations", "common", "consumers"].includes(value);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Reference";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatTimeOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "All day";
  }

  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatMiniMonthDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Undated";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function formatRangeLabel(date, view) {
  if (view === "day") {
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  if (view === "week") {
    const end = addDays(date, 6);
    return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }

  if (view === "month") {
    return date.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric"
    });
  }

  return date.toLocaleDateString(undefined, { year: "numeric" });
}

function itemsForDay(items, day) {
  return items
    .filter((item) => isSameDay(itemDate(item), day))
    .sort((left, right) => itemDate(left) - itemDate(right));
}

function itemDate(item) {
  const parsed = new Date(item.date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function weekdayLabels() {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
}

function eachWeekday(weekStart) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function monthGridDays(monthStart) {
  const gridStart = startOfWeek(monthStart);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date) {
  const next = startOfDay(date);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date, amount) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount, 1);
  return next;
}

function addYears(date, amount) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + amount, 0, 1);
  return next;
}

function isSameDay(left, right) {
  if (!left || !right) {
    return false;
  }

  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isSameMonth(left, right) {
  if (!left || !right) {
    return false;
  }

  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isToday(value) {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function todayAt(hour) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function tomorrowAt(hour) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}
