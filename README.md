# Midas Tech Apps Dashboard

A centralized dashboard for all Midas Tech applications, providing easy access and organization.

## Features

- **📱 Application Catalog**: Browse all web, desktop, and mobile applications
- **🔍 Search & Filter**: Find applications quickly by name, description, or category
- **📊 Status Tracking**: See which applications are active, in development, or archived
- **🔗 Quick Access**: Direct links to launch applications or view source code
- **📈 Statistics**: Overview of total applications and categories
- **🔌 API Monitoring**: Track all external APIs and their usage across applications
- **💾 Database Inventory**: Monitor database systems and storage solutions

## Dashboard Sections

### Applications Tab
- Grid view of all applications with descriptions and links
- Category filtering (Web Apps, Desktop Apps, Mobile Apps, Scripts)
- Search functionality across app names and descriptions
- Status indicators (Active, Development, Archived)

### APIs Tab
- Overview of all external APIs used across applications
- Cost tracking (Free, Paid, Included in subscriptions)
- Application usage mapping
- Service type categorization

### Databases Tab
- Database systems inventory
- Cost and hosting type information
- Application dependencies
- Local vs cloud storage tracking

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
     "apis": [
       {
         "name": "API Name",
         "type": "API Type",
         "cost": "Cost information"
       }
     ],
     "databases": [
       {
         "name": "Database Name",
         "type": "Local|Cloud",
         "cost": "Cost information"
       }
     ],
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

## API & Database Tracking

The dashboard automatically aggregates API and database usage across all applications:

- **APIs**: External services, web APIs, native APIs
- **Databases**: SQL databases, NoSQL, cloud storage, local storage
- **Costs**: Free, paid subscriptions, included in other services
- **Dependencies**: Which applications use which services

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
- Cost tracking and budget alerts
- Service health monitoring

## Contributing

All Midas Tech applications should be added to this dashboard for centralized access and management.

For questions or suggestions, contact the development team.