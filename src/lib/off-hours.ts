/** True when `now` falls inside the configured screen-off window (handles overnight wrap). */
export function isOffHours(now: Date, offHours?: { start: string; end: string }): boolean {
	if (!offHours) return false;
	const minutes = now.getHours() * 60 + now.getMinutes();
	const [sh, sm] = offHours.start.split(':').map(Number);
	const [eh, em] = offHours.end.split(':').map(Number);
	const start = sh * 60 + sm;
	const end = eh * 60 + em;
	if (start === end) return false;
	return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
