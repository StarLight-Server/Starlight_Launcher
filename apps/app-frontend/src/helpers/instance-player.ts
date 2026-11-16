import { invoke } from '@tauri-apps/api/core'

import {
	requestSkinSiteDownloadToken,
	skinSiteStatus,
	skinSiteUser,
	waitForSkinSiteSession,
} from '../composables/skin-site-session.ts'
import { isOfflineMode } from '../composables/useNetworkStatus.ts'
import { users } from './auth.js'
export { waitForSkinSiteSession } from '../composables/skin-site-session.ts'

export type InstancePlayer = {
	id: string
	name: string
	account_type: 'microsoft' | 'yggdrasil' | 'offline'
	skin_site_user?: string | null
}
export type PlayerChoice = InstancePlayer & { head?: string }

/**
 * Thrown when the player picker is dismissed because the user navigated to the
 * skin-site login page. Callers should treat this as a silent launch abort
 * (the user will pick a player next time), not as a real failure.
 */
export class PlayerSelectionNavigatedAwayError extends Error {
	constructor() {
		super('已跳转至皮肤站登录，请登录后重新启动。')
		this.name = 'PlayerSelectionNavigatedAwayError'
	}
}
type Picker = (instanceId: string, locked: InstancePlayer | null) => Promise<InstancePlayer>
let picker: Picker | undefined
const preparing = new Map<string, Promise<void>>()
const listeners = new Set<(instanceId: string, player: InstancePlayer) => void>()

export function onInstancePlayerChanged(
	listener: (instanceId: string, player: InstancePlayer) => void,
) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function registerInstancePlayerPicker(value: Picker) {
	picker = value
	return () => {
		if (picker === value) picker = undefined
	}
}
export const getInstancePlayer = (instanceId: string) =>
	invoke<InstancePlayer | null>('plugin:auth|get_instance_player', { instanceId })

export async function authenticateInstancePlayer(player: InstancePlayer) {
	if (!player.skin_site_user) return
	if (skinSiteStatus.value !== 'signed-in' || skinSiteUser.value?.uuid !== player.skin_site_user) {
		throw new Error(`请登录实例玩家 ${player.name} 所属的皮肤站账号。`)
	}
	const token = await requestSkinSiteDownloadToken()
	await invoke('plugin:auth|login_skin_site_player', {
		token,
		playerId: player.id,
		userId: player.skin_site_user,
	})
	if (skinSiteUser.value?.uuid !== player.skin_site_user || skinSiteStatus.value !== 'signed-in') {
		throw new Error('皮肤站账号已变化，请重试。')
	}
}

export async function saveInstancePlayer(instanceId: string, player: InstancePlayer) {
	await authenticateInstancePlayer(player)
	await invoke('plugin:auth|set_instance_player', { instanceId, player })
	for (const listener of listeners) listener(instanceId, player)
}

export async function chooseInstancePlayer(
	instanceId: string,
	locked: InstancePlayer | null = null,
) {
	if (!picker) throw new Error('玩家选择界面尚未就绪，请稍后重试。')
	return picker(instanceId, locked)
}

export function prepareInstancePlayer(_instanceId: string): Promise<void> {
	// 已修改：按照侧边栏（全局）的账号选择为准，不再在实例启动前拦截校验实例特定的玩家。
	return Promise.resolve()
}
