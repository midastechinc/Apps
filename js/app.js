// Midas Tech Apps Dashboard JavaScript
document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    const appsGrid = document.getElementById('appsGrid');
    const apisGrid = document.getElementById('apisGrid');
    const databasesGrid = document.getElementById('databasesGrid');
    const totalAppsEl = document.getElementById('totalApps');
    const webAppsEl = document.getElementById('webApps');
    const activeAppsEl = document.getElementById('activeApps');

    let apps = [];
    let apis = [];
    let databases = [];

    // Load apps data
    fetch('data/apps.json')
        .then(response => response.json())
        .then(data => {
            apps = data.apps;
            processServicesData();
            renderApps(apps);
            renderAPIs(apis);
            renderDatabases(databases);
            updateStats(apps);
        })
        .catch(error => {
            console.error('Error loading apps data:', error);
            appsGrid.innerHTML = '<p>Error loading applications. Please check the data file.</p>';
        });

    // Search functionality
    searchInput.addEventListener('input', filterApps);
    categoryFilter.addEventListener('change', filterApps);

    function filterApps() {
        const searchTerm = searchInput.value.toLowerCase();
        const category = categoryFilter.value;

        const filteredApps = apps.filter(app => {
            const matchesSearch = app.name.toLowerCase().includes(searchTerm) ||
                                app.description.toLowerCase().includes(searchTerm) ||
                                app.category.toLowerCase().includes(searchTerm);

            const matchesCategory = category === 'all' || app.category.toLowerCase() === category;

            return matchesSearch && matchesCategory;
        });

        renderApps(filteredApps);
    }

    function processServicesData() {
        const apiMap = new Map();
        const databaseMap = new Map();

        apps.forEach(app => {
            // Process APIs
            if (app.apis && app.apis.length > 0) {
                app.apis.forEach(api => {
                    if (!apiMap.has(api.name)) {
                        apiMap.set(api.name, {
                            name: api.name,
                            type: api.type,
                            cost: api.cost,
                            apps: []
                        });
                    }
                    apiMap.get(api.name).apps.push(app.name);
                });
            }

            // Process Databases
            if (app.databases && app.databases.length > 0) {
                app.databases.forEach(db => {
                    if (!databaseMap.has(db.name)) {
                        databaseMap.set(db.name, {
                            name: db.name,
                            type: db.type,
                            cost: db.cost,
                            apps: []
                        });
                    }
                    databaseMap.get(db.name).apps.push(app.name);
                });
            }
        });

        apis = Array.from(apiMap.values());
        databases = Array.from(databaseMap.values());
    }

    function renderApps(appsToRender) {
        appsGrid.innerHTML = '';

        if (appsToRender.length === 0) {
            appsGrid.innerHTML = '<p>No applications found matching your criteria.</p>';
            return;
        }

        appsToRender.forEach(app => {
            const appCard = createAppCard(app);
            appsGrid.appendChild(appCard);
        });
    }

    function createAppCard(app) {
        const card = document.createElement('div');
        card.className = 'app-card';

        const statusClass = app.status.toLowerCase().replace(' ', '');

        card.innerHTML = `
            <div class="app-header">
                <h3>${app.name}</h3>
                <span class="app-category">${app.category}</span>
            </div>
            <div class="app-content">
                <p class="app-description">${app.description}</p>
                <div class="app-meta">
                    <span class="app-status ${statusClass}">${app.status}</span>
                    <span class="app-date">Updated: ${app.lastUpdated}</span>
                </div>
                <div class="app-links">
                    ${app.links.map(link => createAppLink(link, window.location.protocol === 'file:')).join('')}
                </div>
            </div>
        `;

        return card;
    }

    function createAppLink(link, canOpenLocalFolder) {
        if (link.type === 'folder') {
            const titleText = `Local path: ${link.url}`;

            if (canOpenLocalFolder) {
                return `<a href="${link.url}" class="app-link app-link-local" target="_blank" title="${titleText}">
                            <span>${link.label}</span>
                            <span class="link-note">local folder</span>
                        </a>`;
            }

            return `<span class="app-link app-link-disabled" title="${titleText}\nOpen the dashboard locally to enable this folder link">
                        <span>${link.label}</span>
                        <span class="link-note">local only</span>
                    </span>`;
        }

        const classes = ['app-link'];
        if (link.type === 'github') {
            classes.push('secondary');
        }

        return `<a href="${link.url}" class="${classes.join(' ')}" target="_blank">${link.label}</a>`;
    }

    function renderAPIs(apisToRender) {
        apisGrid.innerHTML = '';

        if (apisToRender.length === 0) {
            apisGrid.innerHTML = '<p>No APIs found.</p>';
            return;
        }

        apisToRender.forEach(api => {
            const apiCard = createServiceCard(api, 'api');
            apisGrid.appendChild(apiCard);
        });
    }

    function renderDatabases(databasesToRender) {
        databasesGrid.innerHTML = '';

        if (databasesToRender.length === 0) {
            databasesGrid.innerHTML = '<p>No databases found.</p>';
            return;
        }

        databasesToRender.forEach(db => {
            const dbCard = createServiceCard(db, 'database');
            databasesGrid.appendChild(dbCard);
        });
    }

    function createServiceCard(service, type) {
        const card = document.createElement('div');
        card.className = 'service-card';

        const costClass = service.cost.toLowerCase().includes('free') ? 'free' :
                         service.cost.toLowerCase().includes('$') || service.cost.toLowerCase().includes('pro') ? 'paid' : 'included';

        card.innerHTML = `
            <div class="service-header">
                <h3>${service.name}</h3>
                <span class="service-type">${service.type}</span>
            </div>
            <div class="service-content">
                <div class="service-meta">
                    <span class="service-cost ${costClass}">${service.cost}</span>
                </div>
                <div class="service-apps">
                    <h4>Used by:</h4>
                    <div class="app-tags">
                        ${service.apps.map(app => `<span class="app-tag">${app}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;

        return card;
    }

    function updateStats(apps) {
        totalAppsEl.textContent = apps.length;
        webAppsEl.textContent = apps.filter(app => app.category === 'Web App').length;
        activeAppsEl.textContent = apps.filter(app => app.status === 'Active').length;
    }
});

// Tab switching functionality
function showTab(tabName) {
    // Hide all tab contents
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => content.classList.remove('active'));

    // Remove active class from all tab buttons
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => button.classList.remove('active'));

    // Show selected tab content
    const selectedTab = document.getElementById(tabName + 'Tab');
    if (selectedTab) {
        selectedTab.classList.add('active');
    }

    // Add active class to clicked button
    const clickedButton = Array.from(tabButtons).find(button =>
        button.textContent.toLowerCase().includes(tabName.toLowerCase())
    );
    if (clickedButton) {
        clickedButton.classList.add('active');
    }
}