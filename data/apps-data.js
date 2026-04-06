window.MIDAS_APPS_DATA = {
  "apps": [
    {
      "name": "Search Tool",
      "category": "Web App",
      "description": "Local file search engine with OCR support. The web UI can launch from the dashboard, and the local server can be started from a batch file when needed.",
      "status": "Active",
      "lastUpdated": "2026-04-06",
      "notes": [
        "Best experience comes from starting the local server first.",
        "Source is currently tracked inside the Apps repository."
      ],
      "apis": [
        {
          "name": "File System Access API",
          "type": "Browser API",
          "cost": "Free"
        },
        {
          "name": "Google Fonts API",
          "type": "Web Service",
          "cost": "Free"
        }
      ],
      "databases": [],
      "links": [
        {
          "label": "Launch",
          "url": "applications/web-apps/Search Tool/index.html",
          "type": "app"
        },
        {
          "label": "Start Locally",
          "url": "applications/web-apps/Search Tool/launch.bat",
          "type": "start"
        },
        {
          "label": "GitHub",
          "url": "https://github.com/midastechinc/Apps",
          "type": "github"
        }
      ]
    },
    {
      "name": "Midas Portfolio",
      "category": "Web App",
      "description": "Investment dashboard and portfolio tracker for Midas Tech with a deployed GitHub Pages front end and Supabase backend.",
      "status": "Active",
      "lastUpdated": "2026-04-06",
      "notes": [
        "Primary live deployment verified on Vercel.",
        "GitHub repository verified."
      ],
      "apis": [
        {
          "name": "Supabase API",
          "type": "Backend as a Service",
          "cost": "$25/month (Pro plan)"
        },
        {
          "name": "Google Fonts API",
          "type": "Web Service",
          "cost": "Free"
        }
      ],
      "databases": [
        {
          "name": "Supabase PostgreSQL",
          "type": "Cloud",
          "cost": "Included in Supabase Pro"
        }
      ],
      "links": [
        {
          "label": "Launch",
          "url": "https://midastechinc.github.io/portfolio/",
          "type": "app"
        },
        {
          "label": "GitHub",
          "url": "https://github.com/midastechinc/portfolio",
          "type": "github"
        }
      ]
    },
    {
      "name": "Studio B Post Designer",
      "category": "Web App",
      "description": "Luxury Instagram post designer for Studio B with a live GitHub Pages deployment and dedicated source repository.",
      "status": "Active",
      "lastUpdated": "2026-04-06",
      "notes": [
        "Live deployment verified on GitHub Pages.",
        "Standalone GitHub repository verified."
      ],
      "apis": [
        {
          "name": "Google Fonts API",
          "type": "Web Service",
          "cost": "Free"
        }
      ],
      "databases": [],
      "links": [
        {
          "label": "Launch",
          "url": "https://studiob-home-post-studio.vercel.app/",
          "type": "app"
        },
        {
          "label": "GitHub",
          "url": "https://github.com/midastechinc/studiob-home-post-studio",
          "type": "github"
        }
      ]
    },
    {
      "name": "PDF Sign Here Stamp",
      "category": "Web App",
      "description": "Professional PDF signing tool with auto-placement of signature stamps. The current dashboard links point at the repo-hosted app copy and the dedicated source repo.",
      "status": "Active",
      "lastUpdated": "2026-04-06",
      "notes": [
        "Repo-hosted launch path verified locally.",
        "Standalone GitHub repository verified."
      ],
      "apis": [],
      "databases": [],
      "links": [
        {
          "label": "Launch",
          "url": "applications/web-apps/Signhere-Stamp-Project/PDF-Signhere-Stamp/index.html",
          "type": "app"
        },
        {
          "label": "GitHub",
          "url": "https://github.com/midastechinc/PDF-Signhere-Stamp",
          "type": "github"
        }
      ]
    },
    {
      "name": "StudioB Issue Tracker",
      "category": "Desktop App",
      "description": "Desktop-based issue and case tracking system with user authentication and a packaged Windows executable.",
      "status": "Active",
      "lastUpdated": "2026-04-06",
      "notes": [
        "Installer executable verified locally.",
        "Standalone GitHub repo is missing, so source currently points to the Apps repository folder."
      ],
      "apis": [],
      "databases": [
        {
          "name": "SQLite",
          "type": "Local",
          "cost": "Free"
        }
      ],
      "links": [
        {
          "label": "Start Locally",
          "url": "applications/desktop-apps/Issue Tracker/RUN.bat",
          "type": "start"
        },
        {
          "label": "Download",
          "url": "applications/desktop-apps/Issue Tracker/dist/StudioB_IssueTracker.exe",
          "type": "download"
        },
        {
          "label": "GitHub",
          "url": "https://github.com/midastechinc/Apps",
          "type": "github"
        }
      ]
    },
    {
      "name": "Midas Payroll Desktop",
      "category": "Desktop App",
      "description": "Ontario payroll processing and compliance desktop application with installer packaging, local persistence, and update flow support.",
      "status": "Active",
      "lastUpdated": "2026-04-06",
      "notes": [
        "Installer executable verified locally.",
        "Standalone GitHub repository verified."
      ],
      "apis": [],
      "databases": [
        {
          "name": "SQLite",
          "type": "Local",
          "cost": "Free"
        }
      ],
      "links": [
        {
          "label": "Start Locally",
          "url": "applications/desktop-apps/Payroll Project/Start Payroll Desktop.bat",
          "type": "start"
        },
        {
          "label": "Download",
          "url": "https://github.com/midastechinc/Cursor/releases/download/v0.1.17/Midas.Payroll-Setup-0.1.17.exe",
          "type": "download"
        },
        {
          "label": "GitHub",
          "url": "https://github.com/midastechinc/Cursor",
          "type": "github"
        }
      ]
    },
    {
      "name": "Midas Tech Gallery",
      "category": "Mobile App",
      "description": "Photo gallery app for Android built with Capacitor. The source is currently stored inside the Apps repository under the Codex Project folder.",
      "status": "Development",
      "lastUpdated": "2026-04-06",
      "notes": [
        "Standalone GitHub repository is missing.",
        "Source currently lives under the Apps repository."
      ],
      "apis": [
        {
          "name": "Capacitor Camera API",
          "type": "Native Bridge",
          "cost": "Free"
        },
        {
          "name": "Capacitor Filesystem API",
          "type": "Native Bridge",
          "cost": "Free"
        }
      ],
      "databases": [],
      "links": [
        {
          "label": "GitHub",
          "url": "https://github.com/midastechinc/Apps",
          "type": "github"
        }
      ]
    },
    {
      "name": "Lead Tracker",
      "category": "Web App",
      "description": "LinkedIn lead scraping workflow with a live dashboard UI, local automation batch files, and Supabase-backed storage.",
      "status": "Active",
      "lastUpdated": "2026-04-06",
      "notes": [
        "Live deployment verified on GitHub Pages.",
        "Standalone GitHub repo is missing, so source currently points to the Apps repository folder."
      ],
      "apis": [
        {
          "name": "Supabase API",
          "type": "Backend as a Service",
          "cost": "$25/month (Pro plan)"
        }
      ],
      "databases": [
        {
          "name": "SQLite",
          "type": "Local",
          "cost": "Free"
        },
        {
          "name": "Supabase PostgreSQL",
          "type": "Cloud",
          "cost": "Included in Supabase Pro"
        }
      ],
      "links": [
        {
          "label": "Launch",
          "url": "https://midastechinc.github.io/Leads/",
          "type": "app"
        },
        {
          "label": "Bootstrap Session",
          "url": "applications/web-apps/LeadTracker/Bootstrap LinkedIn Session.bat",
          "type": "start"
        },
        {
          "label": "Run Pull",
          "url": "applications/web-apps/LeadTracker/Run LinkedIn Pull.bat",
          "type": "start"
        },
        {
          "label": "GitHub",
          "url": "https://github.com/midastechinc/Apps",
          "type": "github"
        }
      ]
    },
    {
      "name": "ScanSnap Daily Processor",
      "category": "Scripts",
      "description": "Automated daily processor for ScanSnap document handling. Current source is only partially synced locally, so the dashboard exposes the repo folder and a source download package.",
      "status": "Active",
      "lastUpdated": "2026-04-06",
      "notes": [
        "Standalone GitHub repo is missing.",
        "Local source package is limited to currently synced files."
      ],
      "apis": [
        {
          "name": "Power Automate API",
          "type": "Microsoft 365",
          "cost": "Included in M365 Business"
        }
      ],
      "databases": [],
      "links": [
        {
          "label": "Download Repo",
          "url": "https://github.com/midastechinc/Apps/archive/refs/heads/main.zip",
          "type": "download"
        },
        {
          "label": "GitHub",
          "url": "https://github.com/midastechinc/Apps",
          "type": "github"
        }
      ]
    },
    {
      "name": "Codex Project Scripts",
      "category": "Scripts",
      "description": "Collection of PowerShell and utility scripts for Midas Tech operations, signatures, reporting, and documentation tasks.",
      "status": "Active",
      "lastUpdated": "2026-04-06",
      "notes": [
        "A local source package has been prepared from the top-level script set.",
        "Source currently lives in the Apps repository."
      ],
      "apis": [
        {
          "name": "Power Automate API",
          "type": "Microsoft 365",
          "cost": "Included in M365 Business"
        }
      ],
      "databases": [],
      "links": [
        {
          "label": "Download Repo",
          "url": "https://github.com/midastechinc/Apps/archive/refs/heads/main.zip",
          "type": "download"
        },
        {
          "label": "GitHub",
          "url": "https://github.com/midastechinc/Apps",
          "type": "github"
        }
      ]
    },
    {
      "name": "Power Automate Workflows",
      "category": "Workflows",
      "description": "Microsoft Power Automate flows for document management and business process automation, with export packages stored locally in the dashboard repo.",
      "status": "Active",
      "lastUpdated": "2026-04-06",
      "notes": [
        "Local workflow export packages are available for download.",
        "Source currently lives in the Apps repository."
      ],
      "apis": [
        {
          "name": "Power Automate API",
          "type": "Microsoft 365",
          "cost": "Included in M365 Business"
        },
        {
          "name": "SharePoint REST API",
          "type": "Microsoft 365",
          "cost": "Included in M365 Business"
        }
      ],
      "databases": [
        {
          "name": "SharePoint Lists",
          "type": "Cloud",
          "cost": "Included in M365 Business"
        }
      ],
      "links": [
        {
          "label": "Download Scan Flow",
          "url": "applications/workflows/Powerautomade Flow/MidasTechDocumentScanFlow_20260326005922.zip",
          "type": "download"
        },
        {
          "label": "Download Categories Flow",
          "url": "applications/workflows/Powerautomade Flow/MidasTechMasterCategoriesFlow_20260326010536.zip",
          "type": "download"
        },
        {
          "label": "GitHub",
          "url": "https://github.com/midastechinc/Apps",
          "type": "github"
        }
      ]
    }
  ]
}
;
