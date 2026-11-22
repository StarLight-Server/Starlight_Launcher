import assert from 'node:assert/strict'
import test from 'node:test'

import { createHostedInstallErrorQueue } from './hosted-install-error-queue.ts'

test('creation failures without an instance stay visible until dismissed', () => {
	const queue = createHostedInstallErrorQueue()
	queue.report({ message: '请先在启动器中登录 StarLight 皮肤站，再下载整合包。' })
	assert.equal(queue.values()[0]?.kind, 'login')
	assert.equal(queue.values()[0]?.instanceId, undefined)
	assert.match(queue.values()[0]?.details ?? '', /登录/)
	queue.dismiss(queue.values()[0]!.id)
	assert.equal(queue.values().length, 0)
})

test('nested catches and a dismissed error do not report the same operation twice', () => {
	const queue = createHostedInstallErrorQueue()
	const error = queue.report(new Error('HTTP 404 for GET component.jar'), { instanceId: 'one' })
	assert.equal(queue.handled(error), true)
	queue.report(error, { instanceId: 'one' })
	assert.equal(queue.values().length, 1)
	queue.dismiss(queue.values()[0]!.id)
	queue.report(error, { instanceId: 'one' })
	assert.equal(queue.values().length, 0)
})

test('cancellation suppresses both the dialog and the caller error toast', () => {
	const queue = createHostedInstallErrorQueue()
	const error = queue.report('已停止整合包下载；已下载的缓存会保留，可重试继续')
	assert.equal(queue.values().length, 0)
	assert.equal(queue.handled(error), true)
})

test('independent instance failures queue in order and retry clears only its instance', () => {
	const queue = createHostedInstallErrorQueue()
	queue.report('HTTP 500', { instanceId: 'one' })
	queue.report('HTTP 404', { instanceId: 'two' })
	assert.deepEqual(
		queue.values().map((failure) => failure.instanceId),
		['one', 'two'],
	)
	queue.clear('one')
	assert.deepEqual(
		queue.values().map((failure) => failure.instanceId),
		['two'],
	)
	queue.report('HTTP 500', { instanceId: 'one' })
	assert.deepEqual(
		queue.values().map((failure) => failure.instanceId),
		['two', 'one'],
	)
})

test('retry preserves the original destination and reports a new failure once', async () => {
	const queue = createHostedInstallErrorQueue()
	const destinations: string[] = []
	queue.report('HTTP 500', {
		instanceId: 'one',
		retry: async () => {
			destinations.push('original-game-directory')
			throw queue.report('HTTP 404', { instanceId: 'one' })
		},
	})
	const first = queue.values()[0]!
	queue.dismiss(first.id)
	await assert.rejects(first.retry!)
	assert.deepEqual(destinations, ['original-game-directory'])
	assert.equal(queue.values().length, 1)
	assert.notEqual(queue.values()[0]!.id, first.id)
	assert.equal(queue.values()[0]!.instanceId, 'one')
})

test('retry also reports unwrapped failures and returns a successful created instance', async () => {
	const queue = createHostedInstallErrorQueue()
	let attempt = 0
	queue.report('connection failed', {
		retry: async () => {
			if (++attempt === 1) throw new Error('connection failed')
			return 'created-instance'
		},
	})
	const first = queue.values()[0]!
	queue.dismiss(first.id)
	await assert.rejects(first.retry!)
	const second = queue.values()[0]!
	queue.dismiss(second.id)
	assert.equal(await second.retry!(), 'created-instance')
	assert.equal(queue.values().length, 0)
})
