# Midas Tech Apps Dashboard

A centralized dashboard for all Midas Tech applications, providing easy access and organization.

## Features

- **Application Catalog**: Browse all web, desktop, and mobile applications
- **Search & Filter**: Find applications quickly by name, description, or category
- **Status Tracking**: See which applications are active, in development, or archived
- **Quick Access**: Direct links to launch applications or view source code
- **Statistics**: Overview of total applications and categories

## Adding New Applications

To add a new application to the dashboard:

1. Edit `data/apps.json`
2. Add a new object to the `apps` array with the following structure:
   ```json
   {
     "name": "Application Name",
     "category": "Web App|Desktop App|Mobile App|Scripts",
     "description": "Brief description of the application",
     "status": "Active|Development|Archived",
     "lastUpdated": "YYYY-MM-DD",
     "links": [
       {
         "label": "Launch|Download|GitHub",
         "url": "https://...",
         "type": "app|github"
       }
     ]
   }
   ```

3. Commit and push changes to update the live dashboard

## Deployment

This dashboard is hosted on GitHub Pages at `https://midastechinc.github.io/Apps/`

To deploy updates:
1. Make changes to the code
2. Commit and push to the `main` branch
3. GitHub Pages will automatically update

## Technologies Used

- HTML5
- CSS3 (Custom properties, Grid, Flexbox)
- Vanilla JavaScript (ES6+)
- JSON for data storage

## Future Enhancements

- User authentication for admin features
- Application usage analytics
- Automated deployment from other repos
- API integration for dynamic updates
- Dark mode support

## Contributing

All Midas Tech applications should be added to this dashboard for centralized access and management.

For questions or suggestions, contact the development team.