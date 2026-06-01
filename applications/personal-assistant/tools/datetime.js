const TZ = 'America/Toronto';

function get_current_time() {
  const now = new Date();
  return {
    iso: now.toISOString(),
    local: now.toLocaleString('en-CA', { timeZone: TZ, dateStyle: 'full', timeStyle: 'medium' }),
    timezone: TZ
  };
}

function get_current_date() {
  const now = new Date();
  return {
    date: now.toLocaleDateString('en-CA', { timeZone: TZ }),
    dayOfWeek: now.toLocaleDateString('en-CA', { timeZone: TZ, weekday: 'long' }),
    month: now.toLocaleDateString('en-CA', { timeZone: TZ, month: 'long' }),
    year: now.toLocaleDateString('en-CA', { timeZone: TZ, year: 'numeric' }),
    timezone: TZ
  };
}

module.exports = { get_current_time, get_current_date };
