export type RemoteAnnouncement = {
	id: string
	title: string
	summary: string | null
	content: string
	type: 'modal' | 'notification'
	priority: 'low' | 'normal' | 'high' | 'critical'
	pinned?: boolean
	starts_at: string
	ends_at: string | null
	published_at: string
	action_url: string | null
	action_label: string | null
}

export function safeAnnouncementUrl(value: unknown): string | null {
	if (typeof value !== 'string') return null
	try {
		const url = new URL(value)
		return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
			? url.href
			: null
	} catch {
		return null
	}
}

export function parseAnnouncements(value: unknown): RemoteAnnouncement[] | null {
	if (!Array.isArray(value) || value.length > 200) return null
	const items: RemoteAnnouncement[] = []
	const ids = new Set<string>()
	for (const entry of value) {
		if (!entry || typeof entry !== 'object') continue
		const item = entry as Record<string, unknown>
		if (
			typeof item.id !== 'string' ||
			item.id.length > 100 ||
			ids.has(item.id) ||
			typeof item.title !== 'string' ||
			!item.title.trim() ||
			item.title.length > 120 ||
			typeof item.content !== 'string' ||
			item.content.length > 20000 ||
			(item.summary != null && (typeof item.summary !== 'string' || item.summary.length > 300)) ||
			!['modal', 'notification'].includes(String(item.type)) ||
			!['low', 'normal', 'high', 'critical'].includes(String(item.priority)) ||
			typeof item.starts_at !== 'string' ||
			!Number.isFinite(Date.parse(item.starts_at)) ||
			typeof item.published_at !== 'string' ||
			!Number.isFinite(Date.parse(item.published_at)) ||
			(item.ends_at != null &&
				(typeof item.ends_at !== 'string' || !Number.isFinite(Date.parse(item.ends_at)))) ||
			(item.action_label != null &&
				(typeof item.action_label !== 'string' || item.action_label.length > 80)) ||
			(item.action_url != null && !safeAnnouncementUrl(item.action_url))
		)
			continue
		ids.add(item.id)
		items.push({
			...item,
			summary: item.summary ?? null,
			ends_at: item.ends_at ?? null,
			action_label: item.action_label ?? null,
			action_url: item.action_url ?? null,
		} as RemoteAnnouncement)
	}
	const rank = { low: 0, normal: 1, high: 2, critical: 3 }
	return items.sort(
		(first, second) =>
			Number(second.pinned ?? false) - Number(first.pinned ?? false) ||
			rank[second.priority] - rank[first.priority] ||
			Date.parse(second.published_at) - Date.parse(first.published_at),
	)
}

export function isAnnouncementActive(item: RemoteAnnouncement, now = Date.now()) {
	return Date.parse(item.starts_at) <= now && (!item.ends_at || Date.parse(item.ends_at) > now)
}

export function announcementKey(item: RemoteAnnouncement) {
	return item.id + ':' + item.published_at
}

export const REMOTE_ANNOUNCEMENTS_UPDATED_EVENT = 'starlight:remote-announcements-updated'
export const OPEN_REMOTE_ANNOUNCEMENT_CENTER_EVENT = 'starlight:open-remote-announcement-center'
type BroadcastAnnouncementEntry = {
	title?: unknown
	subtitle?: unknown
	content?: unknown
	updateAt?: unknown
	star?: unknown
	importantLevel?: unknown
	id?: unknown
}

function broadcastPriority(level: number): RemoteAnnouncement['priority'] {
	if (level >= 9) return 'critical'
	if (level >= 6) return 'high'
	if (level >= 3) return 'normal'
	return 'low'
}

export function mapBroadcastAnnouncements(payload: unknown): RemoteAnnouncement[] | null {
	if (!Array.isArray(payload) || payload.length > 200) return null
	const items: RemoteAnnouncement[] = []
	const seen = new Set<string>()
	for (const entry of payload) {
		if (!entry || typeof entry !== 'object') continue
		const item = entry as BroadcastAnnouncementEntry
		if (
			typeof item.id !== 'number' ||
			!Number.isFinite(item.id) ||
			typeof item.title !== 'string' ||
			!item.title.trim() ||
			item.title.length > 120 ||
			typeof item.content !== 'string' ||
			item.content.length > 20000 ||
			typeof item.updateAt !== 'number' ||
			!Number.isFinite(item.updateAt) ||
			(item.subtitle != null && typeof item.subtitle !== 'string')
		)
			continue
		const id = String(item.id)
		if (seen.has(id)) continue
		seen.add(id)
		const level =
			typeof item.importantLevel === 'number' && Number.isFinite(item.importantLevel)
				? Math.max(0, Math.min(10, Math.floor(item.importantLevel)))
				: 0
		const starred = item.star === true
		const published = new Date(item.updateAt).toISOString()
		const summary =
			typeof item.subtitle === 'string' && item.subtitle.trim() ? item.subtitle.slice(0, 300) : null
		items.push({
			id,
			title: item.title,
			summary,
			content: item.content,
			type: starred || level >= 8 ? 'modal' : 'notification',
			priority: broadcastPriority(level),
			pinned: starred,
			starts_at: published,
			ends_at: null,
			published_at: published,
			action_url: null,
			action_label: null,
		})
	}
	const rank = { low: 0, normal: 1, high: 2, critical: 3 }
	return items.sort(
		(first, second) =>
			Number(second.pinned ?? false) - Number(first.pinned ?? false) ||
			rank[second.priority] - rank[first.priority] ||
			Date.parse(second.published_at) - Date.parse(first.published_at),
	)
}
