import { invoke } from '@tauri-apps/api/core'

import { reportHostedInstallFailure } from '../composables/hosted-install-errors.ts'
import {
	requestSkinSiteDownloadToken,
	requestSkinSitePlayers,
	skinSitePlayers,
	skinSiteStatus,
	skinSiteUser,
	waitForSkinSiteSession,
} from '../composables/skin-site-session.ts'
import { type HostedDownloadControl, runHostedDownloadControl } from './hosted-download-controls.ts'
import { authenticateInstancePlayer } from './instance-player.ts'

export const HOSTED_ACCOUNT_REQUIRED_MESSAGE = '您需要登录正版或皮肤站账号后才能操作'

let sessionUpdate: Promise<void> = Promise.resolve()
const attemptListeners = new Set<(instanceId: string) => void>()

export function onHostedPackAttemptStarted(listener: (instanceId: string) => void) {
	attemptListeners.add(listener)
	return () => {
		attemptListeners.delete(listener)
	}
}

function startHostedPackAttempt(instanceId: string) {
	for (const listener of attemptListeners) listener(instanceId)
}

export async function requireHostedGameAccount(): Promise<void> {
	if (await invokeHosted<boolean>('plugin:install|hosted_has_game_account')) return

	// No game credential yet, but a signed-in skin site already lists the
	// user's players. Authenticate the first one automatically so the user
	// does not have to pick a player manually before creating an instance.
	await waitForSkinSiteSession()
	if (skinSiteStatus.value === 'signed-in' && skinSiteUser.value) {
		if (skinSitePlayers.value.length === 0) {
			await requestSkinSitePlayers().catch(() => {})
		}
		const player =
			skinSitePlayers.value.find((candidate) => !candidate.isMojang) ?? skinSitePlayers.value[0]
		if (player) {
			try {
				await authenticateInstancePlayer({
					id: player.uuid,
					name: player.name,
					account_type: 'yggdrasil',
					skin_site_user: skinSiteUser.value.uuid,
				})
			} catch {
				// Fall through to the login-required error below.
			}
			if (await invokeHosted<boolean>('plugin:install|hosted_has_game_account')) {
				return
			}
		}
	}

	throw new Error(HOSTED_ACCOUNT_REQUIRED_MESSAGE)
}

export function clearHostedSession(): Promise<void> {
	const update = sessionUpdate
		.catch(() => {})
		.then(() => invokeHosted<void>('plugin:install|hosted_set_session', { token: null }))
	sessionUpdate = update
	return update
}

export async function prepareHostedSession(): Promise<void> {
	await waitForSkinSiteSession()
	const userId = skinSiteUser.value?.uuid
	const token = await requestSkinSiteDownloadToken()
	const update = sessionUpdate
		.catch(() => {})
		.then(async () => {
			if (skinSiteStatus.value !== 'signed-in' || skinSiteUser.value?.uuid !== userId) {
				throw new Error('StarLight 登录状态已变化，请重试。')
			}
			await invokeHosted<void>('plugin:install|hosted_set_session', { token })
		})
	sessionUpdate = update
	await update
}

async function invokeWithSession<T>(command: string, args?: Record<string, unknown>): Promise<T> {
	await prepareHostedSession()
	return invokeHosted<T>(command, args)
}

async function invokeHosted<T>(command: string, args?: Record<string, unknown>): Promise<T> {
	try {
		return await invoke<T>(command, args)
	} catch (cause) {
		if (
			!(cause instanceof Error) &&
			typeof cause === 'object' &&
			cause !== null &&
			'message' in cause &&
			typeof cause.message === 'string'
		) {
			throw new Error(cause.message, { cause })
		}
		throw cause
	}
}

export type InstanceMode = 'starlight' | 'local'
export const getInstanceMode = (instanceId: string) =>
	invokeHosted<InstanceMode>('plugin:install|hosted_instance_mode', { instanceId })
export const setInstanceMode = (instanceId: string, mode: InstanceMode) => {
	if (mode === 'starlight') startHostedPackAttempt(instanceId)
	return (mode === 'starlight' ? invokeWithSession<void> : invokeHosted<void>)(
		'plugin:install|hosted_set_instance_mode',
		{ instanceId, mode },
	)
}

export interface HostedPublication {
	packId: string
	releaseId: number
	manifest: {
		name: string
		version: string
		format: string
		runtime: { gameVersion: string; loader: string; loaderVersion: string | null }
		files: { path: string; size: number; sha256: string }[]
	}
}
export interface HostedBinding {
	publication: HostedPublication
}
export interface HostedSyncResult {
	version: string
	downloadedBytes: number
	changedFiles: number
	preservedFiles: string[]
}
export const hostedDefault = () =>
	invokeWithSession<HostedPublication>('plugin:install|hosted_default')
export const hostedCreate = async (gameDirRoot?: string | null) => {
	await requireHostedGameAccount()
	return invokeWithSession<string>('plugin:install|hosted_create', {
		gameDirRoot: gameDirRoot ?? null,
	})
}
export const hostedBinding = (instanceId: string) =>
	invokeHosted<HostedBinding | null>('plugin:install|hosted_binding', { instanceId })
export async function controlHostedDownload(action: HostedDownloadControl, instanceId: string) {
	try {
		await runHostedDownloadControl(action, instanceId, {
			prepareSession: prepareHostedSession,
			invoke: invokeHosted<void>,
		})
	} catch (error) {
		if (action !== 'resume') throw error
		throw reportHostedInstallFailure(error, {
			instanceId,
			retry: () => controlHostedDownload('resume', instanceId),
		})
	}
}
export const hostedSync = async (instanceId: string) => {
	await requireHostedGameAccount()
	startHostedPackAttempt(instanceId)
	return invokeWithSession<HostedSyncResult>('plugin:install|hosted_sync', { instanceId })
}
