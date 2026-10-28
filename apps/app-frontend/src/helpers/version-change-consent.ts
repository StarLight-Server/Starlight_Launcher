import type { GameInstance, InstanceLoader } from './types'

export interface VersionEnvironment {
	gameVersion: string
	modLoader: InstanceLoader
	modLoaderVersion: string | null
}

export interface VersionChangePreview {
	source: VersionEnvironment
	target: VersionEnvironment
	linkedInstance: boolean
	requiresDowngradeConfirmation: boolean
}

export interface VersionChangeConfirmation {
	source: VersionEnvironment
	linkedInstance: boolean
	loaderDowngrade: boolean
}

export type VersionChangeOperation = 'linked_instance' | 'loader_downgrade'
export type VersionChangeDecision = { remember: boolean } | null
export type VersionChangeInstance = Pick<
	GameInstance,
	| 'id'
	| 'linked_launcher'
	| 'linked_dot_minecraft'
	| 'linked_version_id'
	| 'linked_version_json_path'
	| 'game_dir_override'
	| 'symlink_target'
>
type ConsentStorage = Pick<Storage, 'getItem' | 'setItem'>
const STORAGE_KEY = 'starlight:instance-version-consent:v1'

function loadGrants(storage: ConsentStorage): Set<string> {
	try {
		const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
		return new Set(Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [])
	} catch {
		return new Set()
	}
}

function grantKey(
	instance: VersionChangeInstance,
	loader: InstanceLoader,
	operation: VersionChangeOperation,
) {
	return JSON.stringify([
		instance.id,
		instance.linked_launcher ?? null,
		instance.linked_dot_minecraft ?? null,
		instance.linked_version_id ?? null,
		instance.linked_version_json_path ?? null,
		instance.game_dir_override ?? null,
		instance.symlink_target ?? null,
		loader,
		operation,
	])
}

function grantBelongsToInstance(key: string, instanceId: string): boolean {
	try {
		const scope: unknown = JSON.parse(key)
		return Array.isArray(scope) && scope[0] === instanceId
	} catch {
		return false
	}
}

export function hasVersionChangeConsent(instanceId: string, storage: ConsentStorage): boolean {
	return [...loadGrants(storage)].some((key) => grantBelongsToInstance(key, instanceId))
}

export function resetVersionChangeConsent(instanceId: string, storage: ConsentStorage): boolean {
	try {
		storage.setItem(
			STORAGE_KEY,
			JSON.stringify(
				[...loadGrants(storage)].filter((key) => !grantBelongsToInstance(key, instanceId)),
			),
		)
		return true
	} catch {
		return false
	}
}

export async function confirmVersionChange(
	instance: VersionChangeInstance,
	preview: VersionChangePreview,
	prompt: (operation: VersionChangeOperation) => Promise<VersionChangeDecision>,
	storage: ConsentStorage,
): Promise<VersionChangeConfirmation | null> {
	const grants = loadGrants(storage)
	const remembered: string[] = []
	const operations: VersionChangeOperation[] = []
	if (preview.linkedInstance) operations.push('linked_instance')
	if (preview.requiresDowngradeConfirmation) operations.push('loader_downgrade')
	for (const operation of operations) {
		const key = grantKey(instance, preview.target.modLoader, operation)
		if (grants.has(key)) continue
		const decision = await prompt(operation)
		if (!decision) return null
		if (decision.remember) remembered.push(key)
	}
	if (remembered.length) {
		const currentGrants = loadGrants(storage)
		for (const key of remembered) currentGrants.add(key)
		try {
			storage.setItem(STORAGE_KEY, JSON.stringify([...currentGrants]))
		} catch {
			// A failed preference write still permits the explicitly approved operation once.
		}
	}
	return {
		source: { ...preview.source },
		linkedInstance: preview.linkedInstance,
		loaderDowngrade: preview.requiresDowngradeConfirmation,
	}
}
