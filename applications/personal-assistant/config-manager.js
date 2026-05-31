const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'auth_info', 'config.json');

const DEFAULT_CONFIG = {
  mainNumber: '',
  familyNumbers: [],
  businessAgent: {
    name: 'Business Assistant',
    systemPrompt:
      'You are a professional business assistant for Midas Tech Inc., an MSP and IT services company based in Canada. You help with business tasks, client management, IT support questions, invoicing, scheduling, and operational decisions. Be concise, professional, and practical. Format responses for WhatsApp (plain text, no markdown).'
  },
  familyAgent: {
    name: 'Family Assistant',
    systemPrompt:
      'You are a warm and helpful family assistant. You help with scheduling, reminders, grocery lists, household tasks, and everyday questions. Be friendly, supportive, and easy to understand. Format responses for WhatsApp (plain text, no markdown).'
  },
  llm: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o'
  }
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
