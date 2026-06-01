document.addEventListener('DOMContentLoaded', () => {
    const LS_BACKEND = 'pa_backend_url';
    const LS_ADMIN_KEY = 'pa_admin_key';

    let backendUrl = localStorage.getItem(LS_BACKEND) || '';
    let adminKey = localStorage.getItem(LS_ADMIN_KEY) || '';

    const statusCallout = document.getElementById('statusCallout');
    const statusText = document.getElementById('statusText');
    const statusBadge = document.getElementById('statusBadge');
    const connectedAtEl = document.getElementById('connectedAt');
    const bizAgentNameEl = document.getElementById('bizAgentName');
    const famAgentNameEl = document.getElementById('famAgentName');
    const qrBanner = document.getElementById('qrBanner');
    const qrImage = document.getElementById('qrImage');
    const backendDialog = document.getElementById('backendDialog');
    const changeBackendBtn = document.getElementById('changeBackendBtn');
    const backendUrlInput = document.getElementById('backendUrl');
    const adminKeyInput = document.getElementById('adminKeyInput');
    const saveBackendBtn = document.getElementById('saveBackendBtn');
    const refreshStatusBtn = document.getElementById('refreshStatusBtn');
    const agentsForm = document.getElementById('agentsForm');
    const contactsForm = document.getElementById('contactsForm');
    const llmForm = document.getElementById('llmForm');
    const refreshConvosBtn = document.getElementById('refreshConvosBtn');
    const convosGrid = document.getElementById('convosGrid');
    const resetSessionBtn = document.getElementById('resetSessionBtn');
    const resetFeedback = document.getElementById('resetFeedback');

    const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
    tabButtons.forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));

    changeBackendBtn.addEventListener('click', openBackendDialog);
    saveBackendBtn.addEventListener('click', saveBackend);
    refreshStatusBtn.addEventListener('click', loadStatus);
    refreshConvosBtn.addEventListener('click', loadConversations);
    agentsForm.addEventListener('submit', saveAgents);
    contactsForm.addEventListener('submit', saveContacts);
    llmForm.addEventListener('submit', saveLlm);
    resetSessionBtn.addEventListener('click', resetWhatsAppSession);

    document.querySelectorAll('.preset-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.getElementById('llmBaseUrl').value = pill.dataset.base;
            document.getElementById('llmModel').value = pill.dataset.model;
        });
    });

    init();

    function init() {
        if (!backendUrl) {
            openBackendDialog();
        } else {
            loadStatus();
            loadConfig();
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
    }

    function openBackendDialog() {
        backendUrlInput.value = backendUrl;
        adminKeyInput.value = adminKey;
        if (backendDialog.showModal) {
            backendDialog.showModal();
        } else {
            backendDialog.setAttribute('open', '');
        }
    }

    function saveBackend() {
        backendUrl = backendUrlInput.value.trim().replace(/\/$/, '');
        adminKey = adminKeyInput.value.trim();
        localStorage.setItem(LS_BACKEND, backendUrl);
        localStorage.setItem(LS_ADMIN_KEY, adminKey);
        backendDialog.close?.() ?? backendDialog.removeAttribute('open');
        loadStatus();
        loadConfig();
    }

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

    let statusPollTimer = null;

    async function loadStatus() {
        clearTimeout(statusPollTimer);
        statusText.textContent = 'Checking…';

        try {
            const data = await apiFetch('/api/status');
            renderStatus(data);
            if (!data.connected) {
                statusPollTimer = setTimeout(loadStatus, 5000);
            }
        } catch (err) {
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
            connectedAtEl.textContent = data.connectedAt
                ? new Date(data.connectedAt).toLocaleString()
                : '—';
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
        if (state === 'ok') statusCallout.style.borderColor = 'rgba(23, 123, 82, 0.4)';
        if (state === 'err') statusCallout.style.borderColor = 'rgba(196, 74, 61, 0.4)';
        if (state === 'warn') statusCallout.style.borderColor = 'rgba(181, 117, 20, 0.4)';
    }

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
            const familyNumbers = raw
                .split('\n')
                .map(n => n.replace(/[^0-9]/g, ''))
                .filter(Boolean);

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
            const apiKeyVal = document.getElementById('llmApiKey').value.trim();
            await apiFetch('/api/config', {
                method: 'PUT',
                body: JSON.stringify({
                    llm: {
                        baseUrl: document.getElementById('llmBaseUrl').value.trim().replace(/\/$/, ''),
                        apiKey: apiKeyVal,
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

    function showFeedback(el, message, type) {
        el.textContent = message;
        el.className = `save-feedback ${type}`;
        setTimeout(() => { el.textContent = ''; el.className = 'save-feedback'; }, 3000);
    }

    function escapeHtml(v) {
        return String(v ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(v) { return escapeHtml(v); }

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
});
