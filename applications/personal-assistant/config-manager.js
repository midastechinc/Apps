const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'auth_info', 'config.json');

const DEFAULT_CONFIG = {
  mainNumber: '',
  familyNumbers: [],
  familyMembers: [],
  googleFamilyCalendarId: '',
  businessAgent: {
    name: 'Claudia',
    systemPrompt: ''
  },
  familyAgent: {
    name: 'Claudia',
    systemPrompt: ''
  },
  llm: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o'
  },
  integrations: {
    google: {
      enabled: false
    },
    m365: {
      enabled: false,
      clientId: '',
      clientSecret: '',
      tenantId: '',
      accessToken: '',
      refreshToken: '',
      tokenExpiry: 0
    },
    brave: {
      apiKey: ''
    }
  },
  schedule: {
    morningBriefingEnabled: false,
    morningBriefingTime: '08:00',
    leadHuntEnabled: false,
    leadHuntTime: '09:00',
    timezone: 'America/Toronto'
  },
  familyMemory: {}
};

function getConfig() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return structuredClone(DEFAULT_CONFIG);
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return { ...structuredClone(DEFAULT_CONFIG), ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function updateConfig(patch) {
  const current = getConfig();
  const merged = deepMerge(current, patch);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

function deepMerge(target, source) {
  const output = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    if (sourceVal !== null && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
      output[key] = deepMerge(target[key] ?? {}, sourceVal);
    } else {
      output[key] = sourceVal;
    }
  }
  return output;
}

module.exports = { getConfig, updateConfig };
