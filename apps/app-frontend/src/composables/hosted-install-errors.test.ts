import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const platform = globalThis as unknown as {
	hostedTestCreate: (root?: string | null) => Promise<string>
	hostedTestSync: (id: string) => Promise<unknown>
}
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.endsWith('/helpers/hosted-packs.ts')) {
			return {
				url: 'data:text/javascript,export const hostedCreate=(root)=>globalThis.hostedTestCreate(root);export const hostedSync=(id)=>globalThis.hostedTestSync(id)',
				shortCircuit: true,
			}
		}
		if (specifier === '@tauri-apps/api/core') {
			return {
				url: 'data:text/javascript,export const invoke=async()=>({id:"existing"})',
				shortCircuit: true,
			}
		}
		return nextResolve(specifier, context)
	},
})
const { useHostedCreation, forgetHostedCreation } = await import('./useHostedCreation.ts')
const { runHostedSync } = await import('./useHostedSync.ts')
const { hostedInstallFailures, dismissHostedInstallFailure, isHostedInstallErrorHandled } =
	await import('./hosted-install-errors.ts')
hooks.deregister()

const completedSync = { version: '1', downloadedBytes: 0, changedFiles: 0, preservedFiles: [] }
test.beforeEach(() => {
	const { createdInstance } = useHostedCreation()
	if (createdInstance.value) forgetHostedCreation(createdInstance.value)
	for (const failure of hostedInstallFailures.value) dismissHostedInstallFailure(failure.id)
	platform.hostedTestSync = async () => completedSync
})

test('concurrent sync callers share one final error and one dialog', async () => {
	let reject!: (error: Error) => void
	platform.hostedTestSync = () =>
		new Promise((_, fail) => {
			reject = fail
		})
	const first = runHostedSync('shared')
	const second = runHostedSync('shared')
	assert.equal(first, second)
	reject(new Error('HTTP 404 for GET component.jar'))
	const results = await Promise.allSettled([first, second])
	assert.equal(hostedInstallFailures.value.length, 1)
	assert.equal(hostedInstallFailures.value[0]!.instanceId, 'shared')
	assert.ok(
		results.every(
			(result) => result.status === 'rejected' && isHostedInstallErrorHandled(result.reason),
		),
	)
})

test('creation retry remembers the selected directory before an instance exists', async () => {
	const roots: Array<string | null | undefined> = []
	platform.hostedTestCreate = async (root) => {
		roots.push(root)
		if (roots.length === 1) throw new Error('connection failed')
		return 'new-instance'
	}
	const creation = useHostedCreation()
	assert.equal(await creation.install('D:/My Games'), undefined)
	const failure = hostedInstallFailures.value[0]!
	assert.equal(failure.instanceId, undefined)
	dismissHostedInstallFailure(failure.id)
	assert.equal(await failure.retry!(), 'new-instance')
	assert.deepEqual(roots, ['D:/My Games', 'D:/My Games'])
	assert.equal(creation.completed.value, true)
	assert.equal(hostedInstallFailures.value.length, 0)
})

test('retry after native download failure reuses the created instance and completes creation', async () => {
	let created = 0
	const synced: string[] = []
	platform.hostedTestCreate = async () => {
		created++
		return 'partially-installed'
	}
	platform.hostedTestSync = async (id) => {
		synced.push(id)
		if (synced.length === 1) throw new Error('Minecraft 游戏组件安装失败：HTTP 404')
		return completedSync
	}
	const creation = useHostedCreation()
	await creation.install('D:/Games')
	assert.equal(hostedInstallFailures.value.length, 1)
	assert.equal(creation.completed.value, false)
	const failure = hostedInstallFailures.value[0]!
	dismissHostedInstallFailure(failure.id)
	assert.equal(await failure.retry!(), 'partially-installed')
	assert.equal(created, 1)
	assert.deepEqual(synced, ['partially-installed', 'partially-installed'])
	assert.equal(creation.completed.value, true)
	assert.equal(creation.installError.value, '')
})

test('canceling creation leaves a retryable inline result without any failure dialog', async () => {
	platform.hostedTestCreate = async () => 'canceled-instance'
	platform.hostedTestSync = async () => {
		throw new Error('已停止整合包下载；已下载的缓存会保留，可重试继续')
	}
	const creation = useHostedCreation()
	await creation.install()
	assert.equal(hostedInstallFailures.value.length, 0)
	assert.equal(creation.completed.value, false)
	assert.equal(creation.createdInstance.value, 'canceled-instance')
	assert.match(creation.installError.value, /已停止整合包下载/)
})

test('deleting an in-flight created instance does not open a stale error dialog', async () => {
	platform.hostedTestCreate = async () => 'deleted-instance'
	let reject!: (error: Error) => void
	let started!: () => void
	const ready = new Promise<void>((resolve) => {
		started = resolve
	})
	platform.hostedTestSync = () =>
		new Promise((_, fail) => {
			reject = fail
			started()
		})
	const pending = useHostedCreation().install()
	await ready
	forgetHostedCreation('deleted-instance')
	reject(new Error('Unknown instance'))
	await pending
	assert.equal(hostedInstallFailures.value.length, 0)
})
