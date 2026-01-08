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
