export function getWeekStart(date) {
  const copy = new Date(date);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function toIsoDate(date) {
  return date.toISOString().split("T")[0];
}

// Empty issues and a same-week repair never move the catch-up boundary.
export function getCoverageStart(digests, currentWeek, now = new Date()) {
  const lastUseful = digests.filter((doc) => doc.weekStart !== currentWeek && doc.items?.length)
    .sort((a,b) => String(b.weekStart).localeCompare(String(a.weekStart)))[0];
  return lastUseful ? new Date(lastUseful.weekStart) : new Date(now.getTime()-30*86400000);
}
