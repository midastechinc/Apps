document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    const appsGrid = document.getElementById('appsGrid');
    const apisGrid = document.getElementById('apisGrid');
    const databasesGrid = document.getElementById('databasesGrid');
    const totalAppsEl = document.getElementById('totalApps');
    const webAppsEl = document.getElementById('webApps');
    const localToolsEl = document.getElementById('localTools');
    const sourceLinksEl = document.getElementById('sourceLinks');
    const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
    const launcherDialog = createLauncherDialog();
    const launcherTitle = launcherDialog.querySelector('[data-launcher-title]');
    const launcherPath = launcherDialog.querySelector('[data-launcher-path]');
    const launcherCommand = launcherDialog.querySelector('[data-launcher-command]');
    const launcherFolder = launcherDialog.querySelector('[data-launcher-folder]');
    const launcherCopyPath = launcherDialog.querySelector('[data-launcher-copy-path]');
    const launcherCopyCommand = launcherDialog.querySelector('[data-launcher-copy-command]');

    let apps = [];
    let apis = [];
    let databases = [];

    bindEvents();
    loadDashboard();

    function bindEvents() {
        searchInput.addEventListener('input', filterApps);
        categoryFilter.addEventListener('change', filterApps);

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                setActiveTab(button.dataset.tab || 'apps');
            });
        });

        document.addEventListener('click', event => {
            const trigger = event.target.closest('[data-launcher-trigger]');

            if (!trigger) {
                return;
            }

            openLauncherDialog(trigger.dataset.appName || 'Local tool', trigger.dataset.scriptUrl || '');
        });

        launcherCopyPath.addEventListener('click', () => {
            copyLauncherText(launcherPath.textContent || '', launcherCopyPath, 'Path copied');
        });

        launcherCopyCommand.addEventListener('click', () => {
            copyLauncherText(launcherCommand.textContent || '', launcherCopyCommand, 'Command copied');
        });
    }

    function loadDashboard() {
        if (window.MIDAS_APPS_DATA && Array.isArray(window.MIDAS_APPS_DATA.apps)) {
            hydrateDashboard(window.MIDAS_APPS_DATA);
            return;
        }

        fetch('data/apps.json')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                return response.json();
            })
            .then(hydrateDashboard)
            .catch(error => {
                console.error('Error loading apps data:', error);
                appsGrid.innerHTML = '<p class="empty-state">Unable to load the application inventory. Check <code>data/apps.json</code>.</p>';
            });
    }

    function hydrateDashboard(data) {
        apps = Array.isArray(data.apps) ? data.apps.map(normalizeApp) : [];
        processServicesData();
        renderApps(apps);
        renderAPIs(apis);
        renderDatabases(databases);
        updateStats(apps);
    }

    function normalizeApp(app) {
        return {
            ...app,
            notes: Array.isArray(app.notes) ? app.notes : [],
            links: Array.isArray(app.links) ? app.links : [],
            apis: Array.isArray(app.apis) ? app.apis : [],
            databases: Array.isArray(app.databases) ? app.databases : []
        };
    }

    function filterApps() {
        const searchTerm = searchInput.value.trim().toLowerCase();
        const category = categoryFilter.value;

        const filteredApps = apps.filter(app => {
            const haystack = [
                app.name,
                app.description,
                app.category,
                app.status,
                app.lastUpdated,
                ...app.notes,
                ...app.links.map(link => link.label),
                ...app.apis.map(api => api.name),
                ...app.databases.map(database => database.name)
            ].join(' ').toLowerCase();

            const matchesSearch = searchTerm === '' || haystack.includes(searchTerm);
            const matchesCategory = category === 'all' || app.category.toLowerCase() === category;

            return matchesSearch && matchesCategory;
        });

        renderApps(filteredApps);
    }

    function processServicesData() {
        const apiMap = new Map();
        const databaseMap = new Map();

        apps.forEach(app => {
            app.apis.forEach(api => {
                if (!apiMap.has(api.name)) {
                    apiMap.set(api.name, {
                        name: api.name,
                        type: api.type,
                        cost: api.cost,
                        url: api.url || '',
                        apps: []
                    });
                }

                apiMap.get(api.name).apps.push(app.name);
            });

            app.databases.forEach(database => {
                if (!databaseMap.has(database.name)) {
                    databaseMap.set(database.name, {
                        name: database.name,
                        type: database.type,
                        cost: database.cost,
                        url: database.url || '',
                        apps: []
                    });
                }

                databaseMap.get(database.name).apps.push(app.name);
            });
        });

        apis = Array.from(apiMap.values()).sort((left, right) => left.name.localeCompare(right.name));
        databases = Array.from(databaseMap.values()).sort((left, right) => left.name.localeCompare(right.name));
    }

    function renderApps(appsToRender) {
        appsGrid.innerHTML = '';

        if (appsToRender.length === 0) {
            appsGrid.innerHTML = '<p class="empty-state">No applications match the current search and category filters.</p>';
            return;
        }

        appsToRender.forEach(app => {
            appsGrid.appendChild(createAppCard(app));
        });
    }

    function createAppCard(app) {
        const card = document.createElement('article');
        card.className = 'app-card';

        const statusClass = cssSafeToken(app.status);
        const notesMarkup = app.notes.length > 0
            ? `
                <div class="note-stack">
                    ${app.notes.map(note => `<span class="note-pill">${escapeHtml(note)}</span>`).join('')}
                </div>
            `
            : '';

        const apiMarkup = app.apis.length > 0
            ? `
                <div class="services-block">
                    <p class="services-label">APIs</p>
                    <div class="service-pills">
                        ${app.apis.map(api => `<span class="service-pill">${escapeHtml(api.name)}</span>`).join('')}
                    </div>
                </div>
            `
            : '';

        const databaseMarkup = app.databases.length > 0
            ? `
                <div class="services-block">
                    <p class="services-label">Databases</p>
                    <div class="service-pills">
                        ${app.databases.map(database => `<span class="service-pill">${escapeHtml(database.name)}</span>`).join('')}
                    </div>
                </div>
            `
            : '';

        const actionMarkup = app.links.length > 0
            ? app.links.map(createAppLink).join('')
            : '<span class="app-link app-link-disabled">No actions available</span>';

        card.innerHTML = `
            <div class="app-topline">
                <div>
                    <p class="app-kicker">${escapeHtml(app.category)}</p>
                    <h3 class="app-title">${escapeHtml(app.name)}</h3>
                </div>
                <span class="app-status ${statusClass}">${escapeHtml(app.status)}</span>
            </div>
            <p class="app-description">${escapeHtml(app.description)}</p>
            <div class="app-metrics">
                <span class="metric-pill">Updated ${escapeHtml(app.lastUpdated)}</span>
                <span class="metric-pill">${app.apis.length} API${app.apis.length === 1 ? '' : 's'}</span>
                <span class="metric-pill">${app.databases.length} Database${app.databases.length === 1 ? '' : 's'}</span>
                <span class="metric-pill">${app.links.length} Action${app.links.length === 1 ? '' : 's'}</span>
            </div>
            ${notesMarkup}
            ${apiMarkup}
            ${databaseMarkup}
            <div class="app-actions">
                ${actionMarkup}
            </div>
        `;

        return card;
    }

    function createAppLink(link) {
        if (!link || !link.url) {
            return '<span class="app-link app-link-disabled">Unavailable</span>';
        }

        const isRepoAsset = isRelativeRepoAsset(link.url);
        const assetType = isRepoAsset ? getRepoAssetType(link.url) : 'external';
        const classes = ['app-link'];
        const safeLabel = escapeHtml(link.label || 'Open');

        if (link.type === 'github') {
            classes.push('secondary');
        } else if (link.type === 'download' || assetType === 'download') {
            classes.push('download');
        } else if (link.type === 'start' || assetType === 'local-launch') {
            classes.push('start');
        }

        if ((link.type === 'start' || assetType === 'local-launch') && window.location.protocol !== 'file:') {
            return `<span class="${classes.join(' ')} app-link-disabled" title="This local action only works when the dashboard is opened from your computer">${safeLabel}</span>`;
        }

        if (link.type === 'start' || assetType === 'local-launch') {
            const absoluteUrl = resolveAbsoluteUrl(link.url);

            return `
                <button
                    type="button"
                    class="${classes.join(' ')}"
                    data-launcher-trigger="true"
                    data-app-name="${escapeAttribute(link.label || 'Local tool')}"
                    data-script-url="${escapeAttribute(absoluteUrl)}"
                >
                    ${safeLabel}
                </button>
            `;
        }

        const href = isRepoAsset ? encodeURI(link.url) : escapeAttribute(link.url);
        const attributes = [`href="${href}"`];

        if ((link.type === 'download' || assetType === 'download') && isRepoAsset) {
            attributes.push('download');
        } else {
            attributes.push('target="_blank"', 'rel="noopener noreferrer"');
        }

        return `<a ${attributes.join(' ')} class="${classes.join(' ')}">${safeLabel}</a>`;
    }

    function renderAPIs(apisToRender) {
        apisGrid.innerHTML = '';

        if (apisToRender.length === 0) {
            apisGrid.innerHTML = '<p class="empty-state">No APIs are listed in the current inventory.</p>';
            return;
        }

        apisToRender.forEach(api => {
            apisGrid.appendChild(createServiceCard(api));
        });
    }

    function renderDatabases(databasesToRender) {
        databasesGrid.innerHTML = '';

        if (databasesToRender.length === 0) {
            databasesGrid.innerHTML = '<p class="empty-state">No databases are listed in the current inventory.</p>';
            return;
        }

        databasesToRender.forEach(database => {
            databasesGrid.appendChild(createServiceCard(database));
        });
    }

    function createServiceCard(service) {
        const card = document.createElement('article');
        card.className = 'service-card';

        const costClass = classifyCost(service.cost);
        const usedByMarkup = service.apps
            .sort((left, right) => left.localeCompare(right))
            .map(appName => `<span class="app-tag">${escapeHtml(appName)}</span>`)
            .join('');
        const websiteMarkup = service.url
            ? `<div class="service-actions"><a class="app-link secondary service-link" href="${escapeAttribute(service.url)}" target="_blank" rel="noopener noreferrer">Website</a></div>`
            : '';

        card.innerHTML = `
            <div class="service-head">
                <div>
                    <h3>${escapeHtml(service.name)}</h3>
                    <span class="service-type">${escapeHtml(service.type)}</span>
                </div>
                <span class="service-cost ${costClass}">${escapeHtml(service.cost)}</span>
            </div>
            <div class="services-block">
                <p class="services-label">Used By</p>
                <div class="app-tags">${usedByMarkup}</div>
            </div>
            ${websiteMarkup}
        `;

        return card;
    }

    function updateStats(appsToCount) {
        totalAppsEl.textContent = String(appsToCount.length);
        webAppsEl.textContent = String(appsToCount.filter(app => app.category === 'Web App').length);
        localToolsEl.textContent = String(appsToCount.filter(app => app.links.some(link => link.type === 'start' || getRepoAssetType(link.url || '') === 'local-launch')).length);
        sourceLinksEl.textContent = String(appsToCount.filter(app => app.links.some(link => link.type === 'github')).length);
    }

    function setActiveTab(tabName) {
        document.querySelectorAll('.tab-content').forEach(panel => {
            panel.classList.toggle('active', panel.id === `${tabName}Tab`);
        });

        tabButtons.forEach(button => {
            const isActive = button.dataset.tab === tabName;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', String(isActive));
        });
    }

    function isRelativeRepoAsset(url) {
        return typeof url === 'string' && !/^https?:\/\//i.test(url) && !/^mailto:/i.test(url);
    }

    function resolveAbsoluteUrl(url) {
        try {
            return new URL(url, window.location.href).href;
        } catch (error) {
            console.warn('Unable to resolve local launcher URL:', url, error);
            return String(url || '');
        }
    }

    function getRepoAssetType(url) {
        const normalized = String(url || '').toLowerCase();

        if (normalized.endsWith('.html') || normalized.endsWith('.htm')) {
            return 'web';
        }

        if (normalized.endsWith('.exe') || normalized.endsWith('.msi') || normalized.endsWith('.zip') || normalized.endsWith('.7z')) {
            return 'download';
        }

        if (normalized.endsWith('.bat') || normalized.endsWith('.cmd') || normalized.endsWith('.ps1') || normalized.endsWith('.vbs')) {
            return 'local-launch';
        }

        return 'file';
    }

    function classifyCost(cost) {
        const normalized = String(cost || '').toLowerCase();

        if (normalized.includes('free')) {
            return 'free';
        }

        if (normalized.includes('$') || normalized.includes('pro')) {
            return 'paid';
        }

        return 'included';
    }

    function cssSafeToken(value) {
        return String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttribute(value) {
        return escapeHtml(value);
    }

    function createLauncherDialog() {
        const dialog = document.createElement('dialog');
        dialog.className = 'launcher-dialog';
        dialog.innerHTML = `
            <form method="dialog" class="launcher-dialog-panel">
                <div class="launcher-dialog-head">
                    <div>
                        <p class="launcher-kicker">Local Launcher</p>
                        <h2 data-launcher-title>Start locally</h2>
                    </div>
                    <button type="submit" class="launcher-close" aria-label="Close local launcher help">Close</button>
                </div>
                <p class="launcher-body">
                    Browsers cannot run batch files directly, so the dashboard now gives you the exact Windows path and launch command instead.
                </p>
                <div class="launcher-block">
                    <p class="launcher-label">Script Path</p>
                    <code class="launcher-code" data-launcher-path></code>
                    <button type="button" class="app-link secondary launcher-action" data-launcher-copy-path>Copy Path</button>
                </div>
                <div class="launcher-block">
                    <p class="launcher-label">PowerShell Command</p>
                    <code class="launcher-code" data-launcher-command></code>
                    <button type="button" class="app-link start launcher-action" data-launcher-copy-command>Copy Command</button>
                </div>
                <div class="launcher-footer">
                    <a class="app-link secondary launcher-folder-link" data-launcher-folder target="_blank" rel="noopener noreferrer">Open Folder</a>
                </div>
            </form>
        `;

        document.body.appendChild(dialog);
        return dialog;
    }

    function openLauncherDialog(appName, scriptUrl) {
        const scriptPath = fileUrlToWindowsPath(scriptUrl);
        const folderUrl = getParentFolderUrl(scriptUrl);
        const command = buildPowerShellCommand(scriptPath);

        launcherTitle.textContent = appName;
        launcherPath.textContent = scriptPath;
        launcherCommand.textContent = command;
        launcherFolder.setAttribute('href', folderUrl);

        if (typeof launcherDialog.showModal === 'function') {
            launcherDialog.showModal();
        } else {
            launcherDialog.setAttribute('open', 'open');
        }
    }

    function fileUrlToWindowsPath(scriptUrl) {
        if (!/^file:/i.test(scriptUrl)) {
            return scriptUrl;
        }

        try {
            const parsed = new URL(scriptUrl);
            const pathname = decodeURIComponent(parsed.pathname || '').replace(/^\/+/, '');
            return pathname.replace(/\//g, '\\');
        } catch (error) {
            console.warn('Unable to parse file URL for launcher:', scriptUrl, error);
            return scriptUrl;
        }
    }

    function getParentFolderUrl(scriptUrl) {
        try {
            return new URL('./', scriptUrl).href;
        } catch (error) {
            console.warn('Unable to resolve launcher folder:', scriptUrl, error);
            return scriptUrl;
        }
    }

    function buildPowerShellCommand(scriptPath) {
        const escapedPath = String(scriptPath || '').replace(/'/g, "''");
        return `Start-Process -FilePath '${escapedPath}'`;
    }

    function copyLauncherText(text, button, successLabel) {
        if (!navigator.clipboard || !text) {
            return;
        }

        navigator.clipboard.writeText(text)
            .then(() => {
                const originalLabel = button.textContent;
                button.textContent = successLabel;

                window.setTimeout(() => {
                    button.textContent = originalLabel;
                }, 1400);
            })
            .catch(error => {
                console.warn('Unable to copy launcher text:', error);
            });
    }
});
