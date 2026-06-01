const { getConfig, updateConfig } = require('../config-manager');

function getMemory() {
  return getConfig().familyMemory || {};
}

function saveMemory({ key, value }) {
  if (!key || !value) return { error: 'key and value are required' };
  const normalizedKey = String(key).trim().toLowerCase();
  updateConfig({ familyMemory: { [normalizedKey]: String(value).trim() } });
  console.log(`[MEMORY] Saved: "${normalizedKey}" = "${value}"`);
  return { success: true, key: normalizedKey, value };
}

function recallMemory({ key }) {
  if (!key) return { error: 'key required' };
  const memory = getMemory();
  const normalizedKey = String(key).trim().toLowerCase();
  const value = memory[normalizedKey] || null;
  if (!value) {
    // Try partial match
    const match = Object.entries(memory).find(([k]) => k.includes(normalizedKey) || normalizedKey.includes(k));
    if (match) return { key: match[0], value: match[1] };
    return { found: false, key: normalizedKey };
  }
  return { key: normalizedKey, value };
}

function listMemory() {
  const memory = getMemory();
  const entries = Object.entries(memory);
  if (entries.length === 0) return { count: 0, facts: [] };
  return {
    count: entries.length,
    facts: entries.map(([key, value]) => ({ key, value }))
  };
}

module.exports = { saveMemory, recallMemory, listMemory, getMemory };
