import assert from 'node:assert/strict'
import test from 'node:test'

import {
	confirmVersionChange,
	hasVersionChangeConsent,
	resetVersionChangeConsent,
	type VersionChangePreview,
} from './version-change-consent.ts'

function storage() {
	const values = new Map<string, string>()
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
	}
}

const instance = { id: 'local:a', linked_version_json_path: 'C:/PCL/versions/fabric/fabric.json' }
const preview: VersionChangePreview = {
	source: { gameVersion: '26.1.2', modLoader: 'fabric', modLoaderVersion: '0.19.5' },
	target: { gameVersion: '26.1.2', modLoader: 'fabric', modLoaderVersion: '0.19.4' },
	linkedInstance: true,
	requiresDowngradeConfirmation: true,
}

test('one-time consent asks separately for linked modification and downgrade on every submission', async () => {
	const store = storage()
	const asked: string[] = []
	const prompt = async (operation: string) => {
		asked.push(operation)
		return { remember: false }
	}
	for (let index = 0; index < 2; index++) {
		assert.deepEqual(await confirmVersionChange(instance, preview, prompt, store), {
			source: preview.source,
			linkedInstance: true,
			loaderDowngrade: true,
		})
	}
	assert.deepEqual(asked, [
		'linked_instance',
		'loader_downgrade',
		'linked_instance',
		'loader_downgrade',
	])
})

test('remembered consent is scoped to operation, instance, installation path and loader', async () => {
	const store = storage()
	const upgrade = { ...preview, requiresDowngradeConfirmation: false }
	await confirmVersionChange(instance, upgrade, async () => ({ remember: true }), store)
	const asked: string[] = []
	const prompt = async (operation: string) => {
		asked.push(operation)
		return { remember: false }
	}
	await confirmVersionChange(instance, preview, prompt, store)
	assert.deepEqual(asked, ['loader_downgrade'])
	asked.length = 0
	for (const different of [
		{ ...instance, id: 'local:b' },
		{ ...instance, linked_version_json_path: 'C:/other/profile.json' },
		{ ...instance, game_dir_override: 'C:/other/.minecraft' },
	])
		await confirmVersionChange(different, upgrade, prompt, store)
	await confirmVersionChange(
		instance,
		{
			...upgrade,
			target: { ...upgrade.target, modLoader: 'quilt' },
		},
		prompt,
		store,
	)
	assert.deepEqual(asked, [
		'linked_instance',
		'linked_instance',
		'linked_instance',
		'linked_instance',
	])
})

test('canceling a warning stops authorization and does not remember earlier checkbox choices', async () => {
	const store = storage()
	const canceled = await confirmVersionChange(
		instance,
		preview,
		async (operation) => (operation === 'linked_instance' ? { remember: true } : null),
		store,
	)
	assert.equal(canceled, null)
	const asked: string[] = []
	await confirmVersionChange(
		instance,
		preview,
		async (operation) => {
			asked.push(operation)
			return null
		},
		store,
	)
	assert.deepEqual(asked, ['linked_instance'])
})

test('remembering both operations skips only those warnings on later submissions', async () => {
	const store = storage()
	await confirmVersionChange(instance, preview, async () => ({ remember: true }), store)
	const result = await confirmVersionChange(
		instance,
		preview,
		async () => {
			assert.fail('remembered consent should not ask again')
		},
		store,
	)
	assert.equal(result?.loaderDowngrade, true)
})

test('unavailable or malformed storage never grants permission and does not break one-time approval', async () => {
	for (const store of [
		{ getItem: () => '{broken', setItem: () => {} },
		{ getItem: () => 'true', setItem: () => {} },
		{
			getItem: () => {
				throw new Error('unavailable')
			},
			setItem: () => {
				throw new Error('full')
			},
		},
	]) {
		let count = 0
		const result = await confirmVersionChange(
			instance,
			preview,
			async () => {
				count++
				return { remember: true }
			},
			store,
		)
		assert.equal(count, 2)
		assert.equal(result?.linkedInstance, true)
	}
})

test('ordinary upgrades need neither risk authorization', async () => {
	const result = await confirmVersionChange(
		instance,
		{
			...preview,
			linkedInstance: false,
			requiresDowngradeConfirmation: false,
		},
		async () => assert.fail('no risk prompt expected'),
		storage(),
	)
	assert.deepEqual(result, {
		source: preview.source,
		linkedInstance: false,
		loaderDowngrade: false,
	})
})

test('resetting an instance restores both warnings without revoking another instance', async () => {
	const store = storage()
	for (const id of ['local:a', 'local:b']) {
		await confirmVersionChange(
			{ ...instance, id },
			preview,
			async () => ({ remember: true }),
			store,
		)
	}
	assert.equal(hasVersionChangeConsent(instance.id, store), true)
	assert.equal(resetVersionChangeConsent(instance.id, store), true)
	assert.equal(hasVersionChangeConsent(instance.id, store), false)
	assert.equal(hasVersionChangeConsent('local:b', store), true)
	const asked: string[] = []
	await confirmVersionChange(
		instance,
		preview,
		async (kind) => {
			asked.push(kind)
			return { remember: false }
		},
		store,
	)
	assert.deepEqual(asked, ['linked_instance', 'loader_downgrade'])
})
