document.addEventListener('DOMContentLoaded', () => {
    const LS_BACKEND = 'pa_backend_url';
    const LS_ADMIN_KEY = 'pa_admin_key';

    let backendUrl = localStorage.getItem(LS_BACKEND) || '';
    let adminKey = localStorage.getItem(LS_ADMIN_KEY) || '';

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const statusCallout     = document.getElementById('statusCallout');
    const statusText        = document.getElementById('statusText');
    const statusBadge       = document.getElementById('statusBadge');
    const connectedAtEl     = document.getElementById('connectedAt');
    const bizAgentNameEl    = document.getElementById('bizAgentName');
    const famAgentNameEl    = document.getElementById('famAgentName');
    const qrBanner          = document.getElementById('qrBanner');
    const qrImage           = document.getElementById('qrImage');
    const backendDialog     = document.getElementById('backendDialog');
    const changeBackendBtn  = document.getElementById('changeBackendBtn');
    const backendUrlInput   = document.getElementById('backendUrl');
    const adminKeyInput     = document.getElementById('adminKeyInput');
    const saveBackendBtn    = document.getElementById('saveBackendBtn');
    const refreshStatusBtn  = document.getElementById('refreshStatusBtn');
    const agentsForm        = document.getElementById('agentsForm');
    const contactsForm      = document.getElementById('contactsForm');
    const llmForm           = document.getElementById('llmForm');
    const scheduleForm      = document.getElementById('scheduleForm');
    const refreshConvosBtn  = document.getElementById('refreshConvosBtn');
    const convosGrid        = document.getElementById('convosGrid');
    const resetSessionBtn   = document.getElementById('resetSessionBtn');
    const resetFeedback     = document.getElementById('resetFeedback');
    const familyMembersList = document.getElementById('familyMembersList');
    const addFamilyMemberBtn= document.getElementById('addFamilyMemberBtn');
    const saveFamilyMembersBtn = document.getElementById('saveFamilyMembersBtn');

    // ── Tabs ──────────────────────────────────────────────────────────────────
    const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
    tabButtons.forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));

    // ── Wire events ───────────────────────────────────────────────────────────
    changeBackendBtn.addEventListener('click', openBackendDialog);
    saveBackendBtn.addEventListener('click', saveBackend);
    refreshStatusBtn.addEventListener('click', loadStatus);
    refreshConvosBtn.addEventListener('click', loadConversations);
    agentsForm.addEventListener('submit', saveAgents);
    contactsForm.addEventListener('submit', saveContacts);
    llmForm.addEventListener('submit', saveLlm);
    scheduleForm.addEventListener('submit', saveSchedule);
    resetSessionBtn.addEventListener('click', resetWhatsAppSession);
    addFamilyMemberBtn.addEventListener('click', addFamilyMemberRow);
    saveFamilyMembersBtn.addEventListener('click', saveFamilyMembers);

    document.querySelectorAll('.preset-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.getElementById('llmBaseUrl').value = pill.dataset.base;
            document.getElementById('llmModel').value = pill.dataset.model;
        });
    });

    document.getElementById('saveGoogleBtn').addEventListener('click', saveGoogleCreds);
    document.getElementById('clearGoogleBtn').addEventListener('click', clearGoogleCreds);
    document.getElementById('saveM365Btn').addEventListener('click', saveM365Creds);

    init();

    // ── Init ──────────────────────────────────────────────────────────────────
    function init() {
        if (!backendUrl) {
            openBackendDialog();
        } else {
            loadStatus();
            loadConfig();
            loadFamilyMembers();
            loadSchedule();
            loadIntegrations();
        }
    }

    function activateTab(tabName) {
        document.querySelectorAll('.tab-content').forEach(panel => {
            panel.classList.toggle('active', panel.id === `tab-${tabName}`);
        });
        tabButtons.forEach(btn => {
            const active = btn.dataset.tab === tabName;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', String(active));
        });
        if (tabName === 'convos') loadConversations();
        if (tabName === 'integrations') loadIntegrations();
    }

    // ── Backend dialog ────────────────────────────────────────────────────────
    function openBackendDialog() {
        backendUrlInput.value = backendUrl;
        adminKeyInput.value = adminKey;
        if (backendDialog.showModal) backendDialog.showModal();
        else backendDialog.setAttribute('open', '');
    }

    function saveBackend() {
        backendUrl = backendUrlInput.value.trim().replace(/\/$/, '');
        adminKey = adminKeyInput.value.trim();
        localStorage.setItem(LS_BACKEND, backendUrl);
        localStorage.setItem(LS_ADMIN_KEY, adminKey);
        backendDialog.close?.() ?? backendDialog.removeAttribute('open');
        loadStatus();
        loadConfig();
        loadFamilyMembers();
        loadSchedule();
        loadIntegrations();
    }

    // ── API helper ────────────────────────────────────────────────────────────
    async function apiFetch(path, options = {}) {
        if (!backendUrl) throw new Error('Backend URL not configured.');
        const url = `${backendUrl}${path}`;
        const headers = { 'Content-Type': 'application/json', ...options.headers };
        if (adminKey) headers['Authorization'] = `Bearer ${adminKey}`;
        const res = await fetch(url, { ...options, headers });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${body}`);
        }
        return res.json();
    }

    // ── Status ────────────────────────────────────────────────────────────────
    let statusPollTimer = null;

    async function loadStatus() {
        clearTimeout(statusPollTimer);
        statusText.textContent = 'Checking…';
        try {
            const data = await apiFetch('/api/status');
            renderStatus(data);
            if (!data.connected) statusPollTimer = setTimeout(loadStatus, 5000);
        } catch {
            statusText.textContent = 'Unreachable';
            statusBadge.textContent = 'Error';
            statusBadge.className = 'stat-value status-disconnected';
            setCalloutState('err');
            qrBanner.style.display = 'none';
        }
    }

    function renderStatus(data) {
        if (data.connected) {
            statusText.textContent = 'Connected';
            statusBadge.textContent = 'Online';
            statusBadge.className = 'stat-value status-connected';
            connectedAtEl.textContent = data.connectedAt ? new Date(data.connectedAt).toLocaleString() : '—';
            setCalloutState('ok');
            qrBanner.style.display = 'none';
        } else if (data.qr) {
            statusText.textContent = 'Scan QR Code';
            statusBadge.textContent = 'Waiting';
            statusBadge.className = 'stat-value status-unknown';
            connectedAtEl.textContent = '—';
            setCalloutState('warn');
            qrImage.src = data.qr;
            qrBanner.style.display = 'block';
        } else {
            statusText.textContent = 'Disconnected';
            statusBadge.textContent = 'Offline';
            statusBadge.className = 'stat-value status-disconnected';
            connectedAtEl.textContent = '—';
            setCalloutState('err');
            qrBanner.style.display = 'none';
        }
    }

    function setCalloutState(state) {
        statusCallout.style.borderColor = '';
        if (state === 'ok')   statusCallout.style.borderColor = 'rgba(23, 123, 82, 0.4)';
        if (state === 'err')  statusCallout.style.borderColor = 'rgba(196, 74, 61, 0.4)';
        if (state === 'warn') statusCallout.style.borderColor = 'rgba(181, 117, 20, 0.4)';
    }

    // ── Config (agents + LLM) ─────────────────────────────────────────────────
    async function loadConfig() {
        try {
            const cfg = await apiFetch('/api/config');
            populateForms(cfg);
        } catch (err) {
            console.warn('Could not load config:', err.message);
        }
    }

    function populateForms(cfg) {
        document.getElementById('bizName').value = cfg.businessAgent?.name ?? '';
        document.getElementById('bizPrompt').value = cfg.businessAgent?.systemPrompt ?? '';
        document.getElementById('famName').value = cfg.familyAgent?.name ?? '';
        document.getElementById('famPrompt').value = cfg.familyAgent?.systemPrompt ?? '';
        document.getElementById('mainNumber').value = cfg.mainNumber ?? '';
        document.getElementById('familyNumbers').value = (cfg.familyNumbers ?? []).join('\n');
        document.getElementById('llmBaseUrl').value = cfg.llm?.baseUrl ?? '';
        document.getElementById('llmApiKey').value = cfg.llm?.apiKey ?? '';
        document.getElementById('llmModel').value = cfg.llm?.model ?? '';
        bizAgentNameEl.textContent = cfg.businessAgent?.name || 'Business';
        famAgentNameEl.textContent = cfg.familyAgent?.name || 'Family';
    }

    async function saveAgents(e) {
        e.preventDefault();
        const feedback = document.getElementById('agentsFeedback');
        const btn = document.getElementById('saveAgentsBtn');
        btn.disabled = true;
        try {
            await apiFetch('/api/config', {
                method: 'PUT',
                body: JSON.stringify({
                    businessAgent: {
                        name: document.getElementById('bizName').value.trim(),
                        systemPrompt: document.getElementById('bizPrompt').value.trim()
                    },
                    familyAgent: {
                        name: document.getElementById('famName').value.trim(),
                        systemPrompt: document.getElementById('famPrompt').value.trim()
                    }
                })
            });
            showFeedback(feedback, 'Saved.', 'ok');
            await loadConfig();
        } catch (err) {
            showFeedback(feedback, `Error: ${err.message}`, 'err');
        } finally {
            btn.disabled = false;
        }
    }

    async function saveContacts(e) {
        e.preventDefault();
        const feedback = document.getElementById('contactsFeedback');
        const btn = document.getElementById('saveContactsBtn');
        btn.disabled = true;
        try {
            const raw = document.getElementById('familyNumbers').value;
            const familyNumbers = raw.split('\n').map(n => n.replace(/[^0-9]/g, '')).filter(Boolean);
            await apiFetch('/api/config', {
                method: 'PUT',
                body: JSON.stringify({
                    mainNumber: document.getElementById('mainNumber').value.replace(/[^0-9]/g, ''),
                    familyNumbers
                })
            });
            showFeedback(feedback, 'Saved.', 'ok');
        } catch (err) {
            showFeedback(feedback, `Error: ${err.message}`, 'err');
        } finally {
            btn.disabled = false;
        }
    }

    async function saveLlm(e) {
        e.preventDefault();
        const feedback = document.getElementById('llmFeedback');
        const btn = document.getElementById('saveLlmBtn');
        btn.disabled = true;
        try {
            await apiFetch('/api/config', {
                method: 'PUT',
                body: JSON.stringify({
                    llm: {
                        baseUrl: document.getElementById('llmBaseUrl').value.trim().replace(/\/$/, ''),
                        apiKey: document.getElementById('llmApiKey').value.trim(),
                        model: document.getElementById('llmModel').value.trim()
                    }
                })
            });
            showFeedback(feedback, 'Saved.', 'ok');
        } catch (err) {
            showFeedback(feedback, `Error: ${err.message}`, 'err');
        } finally {
            btn.disabled = false;
        }
    }

    // ── Schedule ──────────────────────────────────────────────────────────────
    async function loadSchedule() {
        try {
            const s = await apiFetch('/api/schedule');
            document.getElementById('briefingEnabled').checked = !!s.morningBriefingEnabled;
            document.getElementById('briefingTime').value = s.morningBriefingTime || '08:00';
        } catch {}
    }

    async function saveSchedule(e) {
        e.preventDefault();
        const feedback = document.getElementById('scheduleFeedback');
        const btn = document.getElementById('saveScheduleBtn');
        btn.disabled = true;
        try {
            await apiFetch('/api/schedule', {
                method: 'PUT',
                body: JSON.stringify({
                    morningBriefingEnabled: document.getElementById('briefingEnabled').checked,
                    morningBriefingTime: document.getElementById('briefingTime').value,
                    timezone: 'America/Toronto'
                })
            });
            showFeedback(feedback, 'Saved.', 'ok');
        } catch (err) {
            showFeedback(feedback, `Error: ${err.message}`, 'err');
        } finally {
            btn.disabled = false;
        }
    }

    // ── Family members ────────────────────────────────────────────────────────
    async function loadFamilyMembers() {
        try {
            const members = await apiFetch('/api/family-members');
            renderFamilyMembers(members);
        } catch {}
    }

    function renderFamilyMembers(members) {
        familyMembersList.innerHTML = '';
        (members || []).forEach(m => addFamilyMemberRow(m));
    }

    function addFamilyMemberRow(data = {}) {
        const row = document.createElement('div');
        row.className = 'family-member-row';
        row.innerHTML = `
            <input class="form-input" type="text" placeholder="Name" value="${escapeAttr(data.name || '')}" data-field="name">
            <input class="form-input" type="tel" placeholder="Number (digits only)" value="${escapeAttr(data.number || '')}" data-field="number">
            <input class="form-input" type="text" placeholder="Relationship (wife, son…)" value="${escapeAttr(data.relationship || '')}" data-field="relationship">
            <button class="app-link app-link--danger" type="button">Remove</button>
        `;
        row.querySelector('button').addEventListener('click', () => row.remove());
        familyMembersList.appendChild(row);
    }

    async function saveFamilyMembers() {
        const feedback = document.getElementById('familyMembersFeedback');
        const rows = Array.from(familyMembersList.querySelectorAll('.family-member-row'));
        const familyMembers = rows.map(row => ({
            name: row.querySelector('[data-field="name"]').value.trim(),
            number: row.querySelector('[data-field="number"]').value.replace(/[^0-9]/g, ''),
            relationship: row.querySelector('[data-field="relationship"]').value.trim()
        })).filter(m => m.name && m.number);

        try {
            await apiFetch('/api/family-members', {
                method: 'PUT',
                body: JSON.stringify({ familyMembers })
            });
            showFeedback(feedback, `Saved ${familyMembers.length} member(s).`, 'ok');
        } catch (err) {
            showFeedback(feedback, `Error: ${err.message}`, 'err');
        }
    }

    // ── Integrations ──────────────────────────────────────────────────────────
    async function loadIntegrations() {
        try {
            const data = await apiFetch('/api/integrations');
            renderIntegrationStatus(data);
        } catch {}
    }

    function renderIntegrationStatus(data) {
        const googleStatus = document.getElementById('googleStatus');
        const clearGoogleBtn = document.getElementById('clearGoogleBtn');
        if (data.google?.configured) {
            googleStatus.textContent = 'Connected';
            googleStatus.className = 'int-badge int-badge--connected';
            clearGoogleBtn.style.display = '';
        } else {
            googleStatus.textContent = 'Not configured';
            googleStatus.className = 'int-badge int-badge--unconfigured';
            clearGoogleBtn.style.display = 'none';
        }

        const m365Status = document.getElementById('m365Status');
        if (data.m365?.configured) {
            m365Status.textContent = 'Connected';
            m365Status.className = 'int-badge int-badge--connected';
        } else if (data.m365?.hasClientId || data.m365?.hasTenantId) {
            m365Status.textContent = 'Partial';
            m365Status.className = 'int-badge int-badge--partial';
        } else {
            m365Status.textContent = 'Not configured';
            m365Status.className = 'int-badge int-badge--unconfigured';
        }
    }

    async function saveGoogleCreds() {
        const feedback = document.getElementById('googleFeedback');
        const tokenText = document.getElementById('googleTokenJson').value.trim();
        if (!tokenText) { showFeedback(feedback, 'Paste your token.json content first.', 'err'); return; }
        try {
            JSON.parse(tokenText);
        } catch {
            showFeedback(feedback, 'Invalid JSON. Check your token.json.', 'err');
            return;
        }
        try {
            await apiFetch('/api/integrations/google', {
                method: 'POST',
                body: JSON.stringify({ tokenJson: tokenText })
            });
            document.getElementById('googleTokenJson').value = '';
            showFeedback(feedback, 'Google Calendar connected.', 'ok');
            await loadIntegrations();
        } catch (err) {
            showFeedback(feedback, `Error: ${err.message}`, 'err');
        }
    }

    async function clearGoogleCreds() {
        if (!confirm('Disconnect Google Calendar?')) return;
        const feedback = document.getElementById('googleFeedback');
        try {
            await apiFetch('/api/integrations/google', { method: 'DELETE' });
            showFeedback(feedback, 'Disconnected.', 'ok');
            await loadIntegrations();
        } catch (err) {
            showFeedback(feedback, `Error: ${err.message}`, 'err');
        }
    }

    async function saveM365Creds() {
        const feedback = document.getElementById('m365Feedback');
        const tenantId = document.getElementById('m365TenantId').value.trim();
        const clientId = document.getElementById('m365ClientId').value.trim();
        const clientSecret = document.getElementById('m365ClientSecret').value.trim();
        const refreshToken = document.getElementById('m365RefreshToken').value.trim();

        if (!tenantId || !clientId) {
            showFeedback(feedback, 'Tenant ID and Client ID are required.', 'err');
            return;
        }
        try {
            await apiFetch('/api/integrations/m365', {
                method: 'PUT',
                body: JSON.stringify({ tenantId, clientId, clientSecret, refreshToken })
            });
            showFeedback(feedback, 'M365 credentials saved.', 'ok');
            await loadIntegrations();
        } catch (err) {
            showFeedback(feedback, `Error: ${err.message}`, 'err');
        }
    }

    // ── Conversations ─────────────────────────────────────────────────────────
    async function loadConversations() {
        convosGrid.innerHTML = '<p class="empty-state">Loading…</p>';
        try {
            const convos = await apiFetch('/api/conversations');
            renderConversations(convos);
        } catch (err) {
            convosGrid.innerHTML = `<p class="empty-state">Could not load: ${escapeHtml(err.message)}</p>`;
        }
    }

    function renderConversations(convos) {
        if (!convos.length) {
            convosGrid.innerHTML = '<p class="empty-state">No active conversations yet.</p>';
            return;
        }
        convosGrid.innerHTML = '';
        for (const c of convos) {
            const card = document.createElement('article');
            card.className = 'convo-card';
            card.innerHTML = `
                <div class="convo-number">+${escapeHtml(c.number)}</div>
                <div class="convo-meta">${escapeHtml(c.messageCount)} messages</div>
                <div class="convo-last">${escapeHtml(c.lastMessage)}…</div>
                <div class="convo-actions">
                    <button class="app-link app-link--danger" type="button" data-jid="${escapeAttr(c.jid)}">Clear History</button>
                </div>
            `;
            card.querySelector('[data-jid]').addEventListener('click', () => clearConvo(c.jid));
            convosGrid.appendChild(card);
        }
    }

    async function clearConvo(jid) {
        try {
            await apiFetch(`/api/conversations/${encodeURIComponent(jid)}`, { method: 'DELETE' });
            loadConversations();
        } catch (err) {
            alert(`Could not clear: ${err.message}`);
        }
    }

    // ── Reset session ─────────────────────────────────────────────────────────
    async function resetWhatsAppSession() {
        if (!confirm('This will disconnect WhatsApp and require a new QR scan. Your config (contacts, LLM) will be preserved. Continue?')) return;
        resetSessionBtn.disabled = true;
        try {
            await apiFetch('/api/reset-session', { method: 'POST' });
            showFeedback(resetFeedback, 'Session cleared. Scan the new QR code below.', 'ok');
            setTimeout(loadStatus, 2000);
        } catch (err) {
            showFeedback(resetFeedback, `Error: ${err.message}`, 'err');
        } finally {
            resetSessionBtn.disabled = false;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function showFeedback(el, message, type) {
        el.textContent = message;
        el.className = `save-feedback ${type}`;
        setTimeout(() => { el.textContent = ''; el.className = 'save-feedback'; }, 3500);
    }

    function escapeHtml(v) {
        return String(v ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function escapeAttr(v) { return escapeHtml(v); }
});
