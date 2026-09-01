// Adds `n` business days to `date`, skipping Saturdays and Sundays. Holidays
// are not considered. Weekend detection uses the UTC day-of-week; a few-hour
// timezone skew is immaterial for a 2-day escalation SLA. Returns a new Date.
export function addBusinessDays(date: Date, n: number): Date {
  const result = new Date(date.getTime());
  let added = 0;
  while (added < n) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}
