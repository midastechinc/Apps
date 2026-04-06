// Midas Tech Apps Dashboard JavaScript
document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    const appsGrid = document.getElementById('appsGrid');
    const totalAppsEl = document.getElementById('totalApps');
    const webAppsEl = document.getElementById('webApps');
    const activeAppsEl = document.getElementById('activeApps');

    let apps = [];

    // Load apps data
    fetch('data/apps.json')
        .then(response => response.json())
        .then(data => {
            apps = data.apps;
            renderApps(apps);
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
                    ${app.links.map(link => `<a href="${link.url}" class="app-link ${link.type === 'github' ? 'secondary' : ''}" target="_blank">${link.label}</a>`).join('')}
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