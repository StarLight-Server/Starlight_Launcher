import assert from 'node:assert/strict'
import test from 'node:test'

import { mapBroadcastAnnouncements, parseAnnouncements } from './remote-announcements.ts'

test('a broadcast with a long subtitle remains readable through the announcement center', () => {
	const mapped = mapBroadcastAnnouncements([
		{
			id: 42,
			title: 'A long announcement',
			subtitle: '摘要'.repeat(200),
			content: 'The complete announcement body remains available.',
			updateAt: 1791640873710,
			star: false,
			importantLevel: 1,
		},
	])
	const [announcement] = parseAnnouncements(mapped) ?? []
	assert.equal(announcement?.id, '42')
	assert.equal(announcement?.content, 'The complete announcement body remains available.')
})

test('maps a broadcast entry into a remote announcement', () => {
	const result = mapBroadcastAnnouncements([
		{
			id: 1,
			title: '维护通知',
			subtitle: '今晚停机',
			content: '服务器将于今晚维护。',
			updateAt: 1791640873710,
			star: true,
			importantLevel: 9,
			source: 'SKIN',
		},
	])
	assert.equal(result?.length, 1)
	const item = result?.[0]
	assert.equal(item?.id, '1')
	assert.equal(item?.title, '维护通知')
	assert.equal(item?.summary, '今晚停机')
	assert.equal(item?.priority, 'critical')
	assert.equal(item?.pinned, true)
	assert.equal(item?.type, 'modal')
	assert.equal(item?.published_at, new Date(1791640873710).toISOString())
	assert.equal(item?.ends_at, null)
})

test('empty or blank subtitle becomes null summary', () => {
	const result = mapBroadcastAnnouncements([
		{ id: 2, title: '公告', subtitle: '  ', content: '内容', updateAt: 1000 },
	])
	assert.equal(result?.[0]?.summary, null)
})

test('skips entries missing required fields', () => {
	const result = mapBroadcastAnnouncements([
		{ id: 3, title: '有效', content: '内容', updateAt: 1000 },
		{ id: 4, title: '', content: '内容', updateAt: 1000 },
		{ title: '无 id', content: '内容', updateAt: 1000 },
		{ id: 5, title: '无时间', content: '内容' },
		null,
		'不是对象',
	])
	assert.equal(result?.length, 1)
	assert.equal(result?.[0]?.id, '3')
})

test('clamps importantLevel and maps priority boundaries', () => {
	const result = mapBroadcastAnnouncements([
		{ id: 6, title: 'a', content: 'x', updateAt: 1000, importantLevel: 0 },
		{ id: 7, title: 'b', content: 'x', updateAt: 1000, importantLevel: 3 },
		{ id: 8, title: 'c', content: 'x', updateAt: 1000, importantLevel: 6 },
		{ id: 9, title: 'd', content: 'x', updateAt: 1000, importantLevel: 999 },
	])
	const byId = new Map(result?.map((item) => [item.id, item.priority]))
	assert.equal(byId.get('6'), 'low')
	assert.equal(byId.get('7'), 'normal')
	assert.equal(byId.get('8'), 'high')
	assert.equal(byId.get('9'), 'critical')
})

test('returns null for non-array payloads', () => {
	assert.equal(mapBroadcastAnnouncements(null), null)
	assert.equal(mapBroadcastAnnouncements({ payload: [] }), null)
	assert.equal(mapBroadcastAnnouncements('nope'), null)
})

test('pinned announcements sort first', () => {
	const result = mapBroadcastAnnouncements([
		{ id: 10, title: '普通', content: 'x', updateAt: 2000, importantLevel: 9 },
		{ id: 11, title: '置顶', content: 'x', updateAt: 1000, star: true },
	])
	assert.equal(result?.[0]?.id, '11')
	assert.equal(result?.[1]?.id, '10')
})
