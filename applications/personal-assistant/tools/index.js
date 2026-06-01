const datetime = require('./datetime');
const googleCalendar = require('./google-calendar');
const m365 = require('./m365');

const DEFINITIONS = {
  get_current_time: {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Get the current date and time in Toronto (Eastern) timezone.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  get_current_date: {
    type: 'function',
    function: {
      name: 'get_current_date',
      description: 'Get today\'s date and day of the week in Toronto (Eastern) timezone.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  google_list_events: {
    type: 'function',
    function: {
      name: 'google_list_events',
      description: 'List upcoming events from Google Calendar (shared family calendar).',
      parameters: {
        type: 'object',
        properties: {
          days_ahead: { type: 'integer', description: 'Days ahead to search (default: 7)' },
          calendar_id: { type: 'string', description: 'Calendar ID, default is "primary"' },
          max_results: { type: 'integer', description: 'Max events to return (default: 15)' }
        },
        required: []
      }
    }
  },
  google_create_event: {
    type: 'function',
    function: {
      name: 'google_create_event',
      description: 'Create a new event in Google Calendar.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title' },
          start_time: { type: 'string', description: 'Start datetime e.g. "2025-06-10T14:00:00"' },
          end_time: { type: 'string', description: 'End datetime e.g. "2025-06-10T15:00:00"' },
          description: { type: 'string', description: 'Event notes (optional)' },
          calendar_id: { type: 'string', description: 'Calendar ID (default: primary)' }
        },
        required: ['summary', 'start_time', 'end_time']
      }
    }
  },
  google_list_calendars: {
    type: 'function',
    function: {
      name: 'google_list_calendars',
      description: 'List all available Google Calendars to find their IDs.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  m365_list_calendar_events: {
    type: 'function',
    function: {
      name: 'm365_list_calendar_events',
      description: 'List upcoming events from Microsoft 365 Outlook Calendar.',
      parameters: {
        type: 'object',
        properties: {
          days_ahead: { type: 'integer', description: 'Days ahead to look (default: 7)' },
          top: { type: 'integer', description: 'Max events to return (default: 10)' }
        },
        required: []
      }
    }
  },
  m365_create_calendar_event: {
    type: 'function',
    function: {
      name: 'm365_create_calendar_event',
      description: 'Create a new event in Microsoft 365 Outlook Calendar.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Event subject/title' },
          start: { type: 'string', description: 'Start datetime ISO e.g. "2025-06-10T14:00:00"' },
          end: { type: 'string', description: 'End datetime ISO' },
          body: { type: 'string', description: 'Event description (optional)' },
          location: { type: 'string', description: 'Location (optional)' }
        },
        required: ['subject', 'start', 'end']
      }
    }
  },
  m365_list_emails: {
    type: 'function',
    function: {
      name: 'm365_list_emails',
      description: 'List recent emails from Outlook inbox.',
      parameters: {
        type: 'object',
        properties: {
          top: { type: 'integer', description: 'Max emails to return (default: 5)' },
          unread_only: { type: 'boolean', description: 'Only show unread emails (default: false)' }
        },
        required: []
      }
    }
  },
  m365_list_todos: {
    type: 'function',
    function: {
      name: 'm365_list_todos',
      description: 'List pending tasks from Microsoft To Do.',
      parameters: {
        type: 'object',
        properties: {
          list_name: { type: 'string', description: 'Task list name (default: Tasks)' }
        },
        required: []
      }
    }
  },
  m365_create_todo: {
    type: 'function',
    function: {
      name: 'm365_create_todo',
      description: 'Create a new task in Microsoft To Do.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          list_name: { type: 'string', description: 'List name (default: Tasks)' },
          due_date: { type: 'string', description: 'Due date ISO (optional)' }
        },
        required: ['title']
      }
    }
  },
  m365_search_onenote: {
    type: 'function',
    function: {
      name: 'm365_search_onenote',
      description: 'Search Microsoft OneNote pages by keyword.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  },
  m365_save_link: {
    type: 'function',
    function: {
      name: 'm365_save_link',
      description: 'Save a YouTube, Facebook, or Instagram link to the matching OneNote page (YouTube Links, Facebook Links, or Instagram Links) with a sequential number and the page title.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full URL to save (YouTube, Facebook, or Instagram)' }
        },
        required: ['url']
      }
    }
  },
  m365_list_onenote_structure: {
    type: 'function',
    function: {
      name: 'm365_list_onenote_structure',
      description: 'List all OneNote notebooks, sections, and page titles. Use this to diagnose why a page cannot be found.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  }
};

const AGENT_TOOLS = {
  business: [
    'get_current_time', 'get_current_date',
    'google_list_events', 'google_create_event', 'google_list_calendars',
    'm365_list_calendar_events', 'm365_create_calendar_event',
    'm365_list_emails', 'm365_list_todos', 'm365_create_todo',
    'm365_search_onenote', 'm365_save_link', 'm365_list_onenote_structure'
  ],
  family: [
    'get_current_time', 'get_current_date',
    'google_list_events', 'google_create_event', 'google_list_calendars'
  ]
};

function getToolDefinitions(agentType) {
  const allowed = AGENT_TOOLS[agentType] || AGENT_TOOLS.business;
  const googleOk = googleCalendar.isConfigured();
  const m365Ok = m365.isConfigured();

  return allowed
    .filter(name => {
      if (name.startsWith('google_') && !googleOk) return false;
      if (name.startsWith('m365_') && !m365Ok) return false;
      return true;
    })
    .map(name => DEFINITIONS[name])
    .filter(Boolean);
}

async function executeTool(toolName, args) {
  console.log(`[TOOL] ${toolName}(${JSON.stringify(args)})`);
  try {
    switch (toolName) {
      case 'get_current_time':            return datetime.get_current_time();
      case 'get_current_date':            return datetime.get_current_date();
      case 'google_list_events':          return await googleCalendar.listEvents(args);
      case 'google_create_event':         return await googleCalendar.createEvent(args);
      case 'google_list_calendars':       return await googleCalendar.listCalendars();
      case 'm365_list_calendar_events':   return await m365.listCalendarEvents(args);
      case 'm365_create_calendar_event':  return await m365.createCalendarEvent(args);
      case 'm365_list_emails':            return await m365.listEmails(args);
      case 'm365_list_todos':             return await m365.listTodos(args);
      case 'm365_create_todo':            return await m365.createTodo(args);
      case 'm365_search_onenote':         return await m365.searchOneNote(args);
      case 'm365_save_link':                  return await m365.saveLink(args);
      case 'm365_list_onenote_structure':    return await m365.listOneNoteStructure();
      default:                               return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[TOOL] ${toolName} error:`, err.message);
    return { error: err.message };
  }
}

module.exports = { getToolDefinitions, executeTool };
