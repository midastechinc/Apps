const datetime = require('./datetime');
const googleCalendar = require('./google-calendar');
const googleTasks = require('./google-tasks');
const m365 = require('./m365');
const familyMemory = require('./family-memory');
const sbMemory = require('./supabase-memory');
const web = require('./web');
const whatsapp = require('../whatsapp');
const geocode = require('./geocode');
const googleDocs = require('./google-docs');

const DEFINITIONS = {
  memory_save: {
    type: 'function',
    function: {
      name: 'memory_save',
      description: 'Save a fact, preference, or piece of information to persistent memory. Use categories: "family", "client", "business", "personal". Call this immediately whenever you learn something worth remembering.',
      parameters: {
        type: 'object',
        properties: {
          key:      { type: 'string', description: 'Short identifier, e.g. "rogers contract end" or "hassan birthday"' },
          value:    { type: 'string', description: 'The information to remember' },
          category: { type: 'string', description: 'Category: family, client, business, or personal' }
        },
        required: ['key', 'value']
      }
    }
  },
  memory_recall: {
    type: 'function',
    function: {
      name: 'memory_recall',
      description: 'Look up a previously saved memory by key. Supports partial matching.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The key or partial key to look up' }
        },
        required: ['key']
      }
    }
  },
  memory_search: {
    type: 'function',
    function: {
      name: 'memory_search',
      description: 'Search all memories by keyword — searches both keys and values. Optionally filter by category.',
      parameters: {
        type: 'object',
        properties: {
          query:    { type: 'string', description: 'Keyword to search for' },
          category: { type: 'string', description: 'Optional: filter by category (family, client, business, personal)' }
        },
        required: ['query']
      }
    }
  },
  memory_list: {
    type: 'function',
    function: {
      name: 'memory_list',
      description: 'List all saved memories, optionally filtered by category.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional: filter by category (family, client, business, personal)' }
        },
        required: []
      }
    }
  },
  memory_delete: {
    type: 'function',
    function: {
      name: 'memory_delete',
      description: 'Delete a saved memory by key.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The exact key to delete' }
        },
        required: ['key']
      }
    }
  },
  memory_status: {
    type: 'function',
    function: {
      name: 'memory_status',
      description: 'Check whether persistent memory (Supabase) is connected and working. Use this to diagnose memory issues.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  send_whatsapp_message: {
    type: 'function',
    function: {
      name: 'send_whatsapp_message',
      description: 'Send a WhatsApp message to a family member on behalf of Ali. Use this when Ali asks you to message someone (e.g. "tell Hassan to come downstairs", "message Insiya about dinner").',
      parameters: {
        type: 'object',
        properties: {
          to_number: { type: 'string', description: 'The recipient phone number with country code, no + or spaces (e.g. "19055542660" for Hassan)' },
          message:   { type: 'string', description: 'The message text to send' }
        },
        required: ['to_number', 'message']
      }
    }
  },
  geocode_location: {
    type: 'function',
    function: {
      name: 'geocode_location',
      description: 'Convert GPS coordinates to an accurate street address (reverse geocoding) and optionally find nearby places. Use this whenever a location pin is shared — much more accurate than web search for addresses and nearby places.',
      parameters: {
        type: 'object',
        properties: {
          lat:    { type: 'number', description: 'Latitude from the shared location' },
          lng:    { type: 'number', description: 'Longitude from the shared location' },
          nearby: { type: 'string', description: 'Optional: type of place to find nearby, e.g. "cafe", "gas station", "pharmacy", "restaurant", "grocery", "atm"' },
          radius: { type: 'number', description: 'Search radius in metres (default 500, max 2000)' }
        },
        required: ['lat', 'lng']
      }
    }
  },
  family_save_memory: {
    type: 'function',
    function: {
      name: 'family_save_memory',
      description: 'Save a fact about the family for future reference. Use this immediately after learning new information (birthdate, school, preference, etc.) so it is remembered next time.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'What this fact is about, e.g. "hassan birthdate", "hannah school", "insiya favourite colour"' },
          value: { type: 'string', description: 'The fact/answer to remember' }
        },
        required: ['key', 'value']
      }
    }
  },
  family_recall_memory: {
    type: 'function',
    function: {
      name: 'family_recall_memory',
      description: 'Look up a previously saved fact about the family.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'What to look up, e.g. "hassan birthdate"' }
        },
        required: ['key']
      }
    }
  },
  family_list_memory: {
    type: 'function',
    function: {
      name: 'family_list_memory',
      description: 'List all saved family facts.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
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
  google_list_tasks: {
    type: 'function',
    function: {
      name: 'google_list_tasks',
      description: 'List tasks from Google Tasks. Use for family to-do items, shopping lists, reminders.',
      parameters: {
        type: 'object',
        properties: {
          list_name: { type: 'string', description: 'Task list name (default: "My Tasks")' },
          show_completed: { type: 'boolean', description: 'Include completed tasks (default: false)' }
        },
        required: []
      }
    }
  },
  google_create_task: {
    type: 'function',
    function: {
      name: 'google_create_task',
      description: 'Create a task in Google Tasks.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          notes: { type: 'string', description: 'Optional notes or details' },
          due: { type: 'string', description: 'Optional due date (ISO format or natural language)' },
          list_name: { type: 'string', description: 'Task list name (default: "My Tasks")' }
        },
        required: ['title']
      }
    }
  },
  google_complete_task: {
    type: 'function',
    function: {
      name: 'google_complete_task',
      description: 'Mark a Google Task as completed.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID from google_list_tasks' },
          list_name: { type: 'string', description: 'Task list name (default: "My Tasks")' }
        },
        required: ['task_id']
      }
    }
  },
  google_create_doc: {
    type: 'function',
    function: {
      name: 'google_create_doc',
      description: 'Create a new Google Doc with a title and optional content. Returns the document URL. Use for meeting notes, drafts, proposals, reports, or any document the user asks to create.',
      parameters: {
        type: 'object',
        properties: {
          title:   { type: 'string', description: 'The document title' },
          content: { type: 'string', description: 'Optional initial content/body of the document (plain text)' }
        },
        required: ['title']
      }
    }
  },
  google_append_doc: {
    type: 'function',
    function: {
      name: 'google_append_doc',
      description: 'Append text to an existing Google Doc by its document ID.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'The Google Doc document ID (from a previous google_create_doc call)' },
          content:    { type: 'string', description: 'Text to append to the document' }
        },
        required: ['documentId', 'content']
      }
    }
  },
  google_read_doc: {
    type: 'function',
    function: {
      name: 'google_read_doc',
      description: 'Read the full text content of a Google Doc by its document ID or URL. Use this to answer questions about what is in a Google Doc.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'Google Doc document ID or full URL (e.g. https://docs.google.com/document/d/...)' }
        },
        required: ['documentId']
      }
    }
  },
  google_search_drive: {
    type: 'function',
    function: {
      name: 'google_search_drive',
      description: 'Search Google Drive for documents by name. Use this when the user refers to a doc by name (e.g. "the recipes doc", "my grocery list doc") and you need to find its ID.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term — part of the file name to look for' },
          type:  { type: 'string', description: 'File type: "document" (default) or "spreadsheet"' }
        },
        required: ['query']
      }
    }
  },
  google_update_doc: {
    type: 'function',
    function: {
      name: 'google_update_doc',
      description: 'Edit or fix content in an existing Google Doc. Two modes: (1) find-and-replace: pass replacements=[{find, replace}] to fix specific text. (2) full rewrite: pass newContent to replace all content. Accepts doc name, ID, or URL.',
      parameters: {
        type: 'object',
        properties: {
          documentId:   { type: 'string', description: 'Google Doc name, ID, or full URL' },
          replacements: {
            type: 'array',
            description: 'List of find-and-replace pairs. Use for targeted fixes.',
            items: {
              type: 'object',
              properties: {
                find:    { type: 'string', description: 'Text to find (case-insensitive)' },
                replace: { type: 'string', description: 'Replacement text (empty string to delete)' }
              },
              required: ['find', 'replace']
            }
          },
          newContent: { type: 'string', description: 'Full new content to replace the entire document body (use for complete rewrites or heavy edits)' }
        },
        required: ['documentId']
      }
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
      description: 'List recent emails from Outlook inbox with preview.',
      parameters: {
        type: 'object',
        properties: {
          top: { type: 'integer', description: 'Max emails to return (default: 10)' },
          unread_only: { type: 'boolean', description: 'Only show unread emails (default: false)' },
          folder: { type: 'string', description: 'Folder name (default: inbox)' }
        },
        required: []
      }
    }
  },
  m365_search_emails: {
    type: 'function',
    function: {
      name: 'm365_search_emails',
      description: 'Search emails by keyword across subject, body, and sender. Use this to find specific information that might be in an email.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keyword or phrase, e.g. "school", "invoice", "Hassan"' },
          top: { type: 'integer', description: 'Max results (default: 15)' },
          folder: { type: 'string', description: 'Folder to search (default: inbox)' }
        },
        required: ['query']
      }
    }
  },
  m365_read_email: {
    type: 'function',
    function: {
      name: 'm365_read_email',
      description: 'Read the full body of a specific email by its ID. Use after listing or searching emails to get complete content.',
      parameters: {
        type: 'object',
        properties: {
          email_id: { type: 'string', description: 'The email ID from m365_list_emails or m365_search_emails' }
        },
        required: ['email_id']
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
          due_date: { type: 'string', description: 'Due date ISO (optional)' },
          notes: { type: 'string', description: 'Optional task notes/body, e.g. details from a forwarded image or screenshot' }
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
      description: 'List all OneNote notebooks and their sections. Call this when the user asks to see their notebooks, sections, or OneNote structure. Always show the full list to the user.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  m365_set_onenote_section: {
    type: 'function',
    function: {
      name: 'm365_set_onenote_section',
      description: 'Save a OneNote section ID or URL for a named section so Claudia can use it directly without needing to enumerate all notebooks. Use when the user provides a OneNote section link or ID.',
      parameters: {
        type: 'object',
        properties: {
          section_name: { type: 'string', description: 'Section name (e.g. "travel", "work", "personal")' },
          section_id_or_url: { type: 'string', description: 'The OneNote section ID (GUID format) or the full URL of the section from OneNote web' }
        },
        required: ['section_name', 'section_id_or_url']
      }
    }
  },
  m365_send_email: {
    type: 'function',
    function: {
      name: 'm365_send_email',
      description: 'Send an email from ali@midastech.ca via Outlook.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address (or comma-separated list)' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body (plain text)' },
          cc: { type: 'string', description: 'CC email address (optional)' }
        },
        required: ['to', 'subject', 'body']
      }
    }
  },
  m365_reply_to_email: {
    type: 'function',
    function: {
      name: 'm365_reply_to_email',
      description: 'Reply to an existing email by its ID.',
      parameters: {
        type: 'object',
        properties: {
          email_id: { type: 'string', description: 'Email ID from m365_list_emails or m365_search_emails' },
          reply_text: { type: 'string', description: 'The reply message text' }
        },
        required: ['email_id', 'reply_text']
      }
    }
  },
  m365_find_meeting_times: {
    type: 'function',
    function: {
      name: 'm365_find_meeting_times',
      description: 'Find available meeting time slots within a given window. Use to answer "when am I free?" or to suggest meeting times.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'Start of search window, ISO datetime e.g. "2025-06-10T08:00:00"' },
          end:   { type: 'string', description: 'End of search window, ISO datetime e.g. "2025-06-10T18:00:00"' },
          duration_minutes: { type: 'integer', description: 'Meeting length in minutes (default: 60)' },
          attendees: { type: 'array', items: { type: 'string' }, description: 'Optional list of attendee email addresses to check availability' }
        },
        required: ['start', 'end']
      }
    }
  },
  m365_update_calendar_event: {
    type: 'function',
    function: {
      name: 'm365_update_calendar_event',
      description: 'Update/reschedule an existing Outlook calendar event.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Event ID from m365_list_calendar_events' },
          subject: { type: 'string', description: 'New subject (optional)' },
          start: { type: 'string', description: 'New start datetime ISO (optional)' },
          end: { type: 'string', description: 'New end datetime ISO (optional)' },
          body: { type: 'string', description: 'New description (optional)' },
          location: { type: 'string', description: 'New location (optional)' }
        },
        required: ['event_id']
      }
    }
  },
  m365_delete_calendar_event: {
    type: 'function',
    function: {
      name: 'm365_delete_calendar_event',
      description: 'Delete/cancel an Outlook calendar event.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Event ID from m365_list_calendar_events' }
        },
        required: ['event_id']
      }
    }
  },
  m365_complete_todo: {
    type: 'function',
    function: {
      name: 'm365_complete_todo',
      description: 'Mark a Microsoft To Do task as completed.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID from m365_list_todos' },
          list_name: { type: 'string', description: 'List name (default: Tasks)' }
        },
        required: ['task_id']
      }
    }
  },
  m365_update_todo: {
    type: 'function',
    function: {
      name: 'm365_update_todo',
      description: 'Update a Microsoft To Do task — change title, due date, or notes.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID from m365_list_todos' },
          list_name: { type: 'string', description: 'List name (default: Tasks)' },
          title: { type: 'string', description: 'New title (optional)' },
          due_date: { type: 'string', description: 'New due date ISO (optional)' },
          notes: { type: 'string', description: 'New notes (optional)' }
        },
        required: ['task_id']
      }
    }
  },
  m365_list_contacts: {
    type: 'function',
    function: {
      name: 'm365_list_contacts',
      description: 'List or search Outlook contacts.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Filter by name, email, or company (optional)' },
          top: { type: 'integer', description: 'Max contacts to return (default: 20)' }
        },
        required: []
      }
    }
  },
  m365_get_out_of_office: {
    type: 'function',
    function: {
      name: 'm365_get_out_of_office',
      description: 'Check whether out-of-office / automatic reply is currently enabled.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  m365_set_out_of_office: {
    type: 'function',
    function: {
      name: 'm365_set_out_of_office',
      description: 'Enable or disable automatic out-of-office reply in Outlook.',
      parameters: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'true to enable, false to disable' },
          message: { type: 'string', description: 'Reply message text (required when enabling)' },
          internal_message: { type: 'string', description: 'Different message for internal (same org) senders (optional)' },
          start: { type: 'string', description: 'Schedule start datetime ISO (optional — omit for always-on)' },
          end:   { type: 'string', description: 'Schedule end datetime ISO (optional)' }
        },
        required: ['enabled']
      }
    }
  },
  m365_create_email_draft: {
    type: 'function',
    function: {
      name: 'm365_create_email_draft',
      description: 'Save an email as a draft in Outlook without sending it. Use when asked to draft or prepare an email for review.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body (plain text)' },
          to: { type: 'string', description: 'Recipient email address (optional — can be added later)' },
          cc: { type: 'string', description: 'CC email address (optional)' }
        },
        required: ['subject', 'body']
      }
    }
  },
  m365_send_draft: {
    type: 'function',
    function: {
      name: 'm365_send_draft',
      description: 'Send a previously created email draft by its ID.',
      parameters: {
        type: 'object',
        properties: {
          draft_id: { type: 'string', description: 'Draft ID from m365_create_email_draft' }
        },
        required: ['draft_id']
      }
    }
  },
  m365_create_onenote_page: {
    type: 'function',
    function: {
      name: 'm365_create_onenote_page',
      description: 'Create a new page in a OneNote notebook. Use for saving meeting notes, ideas, or any content to OneNote.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Page title' },
          content: { type: 'string', description: 'Page content (plain text, newlines supported). When a PDF or document was in the conversation, pass its full extracted text here.' },
          notebook_name: { type: 'string', description: 'Notebook name to save into (optional, uses first notebook if not specified)' },
          section_name:  { type: 'string', description: 'Section name within the notebook (optional, uses first section if not specified)' }
        },
        required: ['title']
      }
    }
  },
  m365_read_onenote_page: {
    type: 'function',
    function: {
      name: 'm365_read_onenote_page',
      description: 'Read the full text content of a specific OneNote page.',
      parameters: {
        type: 'object',
        properties: {
          page_id:    { type: 'string', description: 'Page ID (from m365_search_onenote results)' },
          page_title: { type: 'string', description: 'Page title to find by name (alternative to page_id)' }
        },
        required: []
      }
    }
  },
  m365_create_contact: {
    type: 'function',
    function: {
      name: 'm365_create_contact',
      description: 'Create a new contact in Outlook.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Full name' },
          email: { type: 'string', description: 'Email address (optional)' },
          phone: { type: 'string', description: 'Phone number (optional)' },
          company: { type: 'string', description: 'Company name (optional)' },
          title: { type: 'string', description: 'Job title (optional)' }
        },
        required: ['name']
      }
    }
  },
  onedrive_search: {
    type: 'function',
    function: {
      name: 'onedrive_search',
      description: 'Search for files and folders in OneDrive by keyword.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keyword or filename' },
          top: { type: 'integer', description: 'Max results to return (default: 10)' }
        },
        required: ['query']
      }
    }
  },
  onedrive_list_folder: {
    type: 'function',
    function: {
      name: 'onedrive_list_folder',
      description: 'List files and folders in a OneDrive folder.',
      parameters: {
        type: 'object',
        properties: {
          folder_path: { type: 'string', description: 'Folder path e.g. "/Documents" or "/" for root (default: root)' }
        },
        required: []
      }
    }
  },
  onedrive_get_link: {
    type: 'function',
    function: {
      name: 'onedrive_get_link',
      description: 'Get a shareable link for a OneDrive file or folder.',
      parameters: {
        type: 'object',
        properties: {
          item_id: { type: 'string', description: 'The OneDrive item ID (from search or list results)' },
          link_type: { type: 'string', description: 'Link type: "view" (default), "edit", or "embed"' }
        },
        required: ['item_id']
      }
    }
  },
  sharepoint_list_sites: {
    type: 'function',
    function: {
      name: 'sharepoint_list_sites',
      description: 'List available SharePoint sites. Use this first to find a site ID before searching or listing files.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Filter sites by name (optional, returns all if empty)' }
        },
        required: []
      }
    }
  },
  sharepoint_search: {
    type: 'function',
    function: {
      name: 'sharepoint_search',
      description: 'Search for files in SharePoint.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keyword or filename' },
          site_id: { type: 'string', description: 'SharePoint site ID to search within (optional, defaults to root site)' },
          top: { type: 'integer', description: 'Max results (default: 10)' }
        },
        required: ['query']
      }
    }
  },
  sharepoint_list_files: {
    type: 'function',
    function: {
      name: 'sharepoint_list_files',
      description: 'List files in a SharePoint site document library.',
      parameters: {
        type: 'object',
        properties: {
          site_id: { type: 'string', description: 'SharePoint site ID (use sharepoint_list_sites to find it)' },
          folder_path: { type: 'string', description: 'Folder path within the site (default: root)' }
        },
        required: ['site_id']
      }
    }
  },
  web_search: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the internet for current information — news, prices, weather, sports scores, recipes, anything. Use this when the answer is not in calendar/email/notes.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query, e.g. "weather Toronto tomorrow", "iPhone 16 price Canada"' },
          count: { type: 'integer', description: 'Number of results to return (default: 5)' }
        },
        required: ['query']
      }
    }
  },
  fetch_webpage: {
    type: 'function',
    function: {
      name: 'fetch_webpage',
      description: 'Read and summarize the content of a specific web page or URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full URL to fetch, e.g. "https://www.cbc.ca/news/..."' }
        },
        required: ['url']
      }
    }
  }
};

const AGENT_TOOLS = {
  business: [
    'get_current_time', 'get_current_date',
    'google_list_events', 'google_create_event', 'google_list_calendars',
    'm365_list_calendar_events', 'm365_create_calendar_event', 'm365_update_calendar_event', 'm365_delete_calendar_event', 'm365_find_meeting_times',
    'm365_get_out_of_office', 'm365_set_out_of_office',
    'm365_list_emails', 'm365_search_emails', 'm365_read_email', 'm365_send_email', 'm365_reply_to_email', 'm365_create_email_draft', 'm365_send_draft',
    'm365_list_todos', 'm365_create_todo', 'm365_complete_todo', 'm365_update_todo',
    'm365_list_contacts', 'm365_create_contact',
    'm365_search_onenote', 'm365_save_link', 'm365_list_onenote_structure', 'm365_set_onenote_section', 'm365_create_onenote_page', 'm365_read_onenote_page',
    'onedrive_search', 'onedrive_list_folder', 'onedrive_get_link',
    'sharepoint_list_sites', 'sharepoint_search', 'sharepoint_list_files',
    'memory_save', 'memory_recall', 'memory_search', 'memory_list', 'memory_delete', 'memory_status',
    'geocode_location',
    'google_create_doc', 'google_append_doc', 'google_read_doc', 'google_search_drive', 'google_update_doc',
    'web_search', 'fetch_webpage'
  ],
  family: [
    'get_current_time', 'get_current_date',
    'google_list_events', 'google_create_event', 'google_list_calendars',
    'google_list_tasks', 'google_create_task', 'google_complete_task',
    'google_create_doc', 'google_append_doc', 'google_read_doc', 'google_search_drive', 'google_update_doc',
    'family_save_memory', 'family_recall_memory', 'family_list_memory',
    'memory_save', 'memory_recall', 'memory_search', 'memory_list', 'memory_delete', 'memory_status',
    'send_whatsapp_message', 'geocode_location',
    'm365_list_todos', 'm365_create_todo',
    'm365_save_link', 'm365_set_onenote_section',
    'web_search', 'fetch_webpage'
  ]
};

function getToolDefinitions(agentType) {
  const allowed = AGENT_TOOLS[agentType] || AGENT_TOOLS.family;
  const googleOk = googleCalendar.isConfigured();
  const m365Ok = m365.isConfigured();

  return allowed
    .filter(name => {
      if (name.startsWith('google_') && !googleOk) return false;
      if ((name.startsWith('m365_') || name.startsWith('onedrive_') || name.startsWith('sharepoint_')) && !m365Ok) return false;
      return true;
    })
    .map(name => DEFINITIONS[name])
    .filter(Boolean);
}

async function executeTool(toolName, args, agentType = 'business') {
  // Normalize alternative tool names the model sometimes uses
  const ALIASES = {
    'search':         'web_search',
    'web_browse':     'fetch_webpage',
    'browser':        'fetch_webpage',
    'browse':         'fetch_webpage',
    'lookup':         'web_search',
    'internet_search':'web_search'
  };
  const resolvedName = ALIASES[toolName] || toolName;
  if (resolvedName !== toolName) {
    console.log(`[TOOL] alias "${toolName}" → "${resolvedName}"`);
  }

  const allowed = AGENT_TOOLS[agentType] || AGENT_TOOLS.family;
  if (!allowed.includes(resolvedName)) {
    console.warn(`[TOOL] blocked: "${toolName}" (resolved: "${resolvedName}") not in ${agentType} toolset`);
    return { error: `Tool ${toolName} is not available in this context.` };
  }
  console.log(`[TOOL] ${resolvedName}(${JSON.stringify(args)})`);
  try {
    switch (resolvedName) {
      // Redirect old family memory tools to Supabase (category=family) when configured
      case 'family_save_memory':
        return sbMemory.isConfigured()
          ? await sbMemory.saveMemory({ ...args, category: 'family' })
          : familyMemory.saveMemory(args);
      case 'family_recall_memory':
        return sbMemory.isConfigured()
          ? await sbMemory.recallMemory(args)
          : familyMemory.recallMemory(args);
      case 'family_list_memory':
        return sbMemory.isConfigured()
          ? await sbMemory.listMemory({ category: 'family' })
          : familyMemory.listMemory();
      case 'memory_save':                 return await sbMemory.saveMemory(args);
      case 'memory_recall':               return await sbMemory.recallMemory(args);
      case 'memory_search':               return await sbMemory.searchMemory(args);
      case 'memory_list':                 return await sbMemory.listMemory(args);
      case 'memory_delete':               return await sbMemory.deleteMemory(args);
      case 'memory_status':               return await sbMemory.memoryStatus();
      case 'geocode_location':            return await geocode.geocodeLocation(args);
      case 'send_whatsapp_message': {
        const { to_number, message: msgText } = args;
        if (!to_number || !msgText) return { error: 'to_number and message are required' };
        try {
          await whatsapp.sendProactiveMessage(to_number, msgText);
          return { success: true, to: to_number, message: msgText };
        } catch (err) {
          return { error: err.message };
        }
      }
      case 'get_current_time':            return datetime.get_current_time();
      case 'get_current_date':            return datetime.get_current_date();
      case 'google_list_events':          return await googleCalendar.listEvents(args);
      case 'google_create_event':         return await googleCalendar.createEvent(args);
      case 'google_list_calendars':       return await googleCalendar.listCalendars();
      case 'google_list_tasks':           return await googleTasks.listTasks(args);
      case 'google_create_task':          return await googleTasks.createTask(args);
      case 'google_complete_task':        return await googleTasks.completeTask(args);
      case 'google_create_doc':           return await googleDocs.createDoc(args);
      case 'google_append_doc':           return await googleDocs.appendToDoc(args);
      case 'google_read_doc':             return await googleDocs.readDoc(args);
      case 'google_search_drive':         return await googleDocs.searchDrive(args);
      case 'google_update_doc':           return await googleDocs.updateDoc(args);
      case 'm365_list_calendar_events':   return await m365.listCalendarEvents(args);
      case 'm365_create_calendar_event':  return await m365.createCalendarEvent(args);
      case 'm365_update_calendar_event':  return await m365.updateCalendarEvent(args);
      case 'm365_delete_calendar_event':  return await m365.deleteCalendarEvent(args);
      case 'm365_find_meeting_times':     return await m365.findMeetingTimes(args);
      case 'm365_get_out_of_office':      return await m365.getOutOfOfficeStatus();
      case 'm365_set_out_of_office':      return await m365.setOutOfOffice(args);
      case 'm365_list_emails':            return await m365.listEmails(args);
      case 'm365_search_emails':          return await m365.searchEmails(args);
      case 'm365_read_email':             return await m365.readEmail(args);
      case 'm365_send_email':             return await m365.sendEmail(args);
      case 'm365_reply_to_email':         return await m365.replyToEmail(args);
      case 'm365_create_email_draft':     return await m365.createEmailDraft(args);
      case 'm365_send_draft':             return await m365.sendDraft(args);
      case 'm365_list_todos':             return await m365.listTodos(args);
      case 'm365_create_todo':            return await m365.createTodo(args);
      case 'm365_complete_todo':          return await m365.completeTodo(args);
      case 'm365_update_todo':            return await m365.updateTodo(args);
      case 'm365_list_contacts':          return await m365.listContacts(args);
      case 'm365_create_contact':         return await m365.createContact(args);
      case 'm365_create_onenote_page':    return await m365.createOneNotePage(args);
      case 'm365_read_onenote_page':      return await m365.readOneNotePage(args);
      case 'm365_search_onenote':         return await m365.searchOneNote(args);
      case 'm365_save_link':                  return await m365.saveLink(args);
      case 'm365_list_onenote_structure':    return await m365.listOneNoteStructure();
      case 'm365_set_onenote_section':      return await m365.setOneNoteSection(args);

      case 'onedrive_search':                return await m365.searchOneDrive(args);
      case 'onedrive_list_folder':           return await m365.listOneDriveFolder(args);
      case 'onedrive_get_link':              return await m365.getOneDriveShareLink(args);
      case 'sharepoint_list_sites':          return await m365.listSharePointSites(args);
      case 'sharepoint_search':              return await m365.searchSharePoint(args);
      case 'sharepoint_list_files':          return await m365.listSharePointFiles(args);
      case 'web_search':                     return await web.webSearch(args);
      case 'fetch_webpage':                  return await web.fetchWebpage(args);
      default:                               return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[TOOL] ${toolName} error:`, err.message);
    return { error: err.message };
  }
}

module.exports = { getToolDefinitions, executeTool };
