import { readonly, ref } from 'vue'

import {
	clearSkinSiteToken,
	getSkinSiteToken,
	setSkinSiteToken,
	skinSiteCurrentUser,
	skinSiteLogin,
	skinSiteLuck,
	skinSitePlayerList,
	type SkinSitePlayerSkin,
	skinSitePlayerSkin,
	skinSiteRefresh,
	type SkinSiteResponse,
	skinSiteUploadTexture,
	type SkinSiteUser as ApiSkinSiteUser,
} from '@/helpers/skin-site-api'
import { fetchImageAsDataUrl, renderSkinHead } from '@/helpers/skin-site-render'

export const SKIN_SITE_ORIGIN = 'https://skin.starlight.cool'

export type SkinSiteUser = { uuid: string; username: string; permissions: string[] }
export type SkinSiteStatus = 'checking' | 'signed-out' | 'signed-in' | 'error'
export type SkinSitePlayer = {
	uuid: string
	name: string
	isMojang: boolean
	skinState: 'ready' | 'empty' | 'error'
	headDataUrl?: string
	skinDataUrl?: string
	capeUrl?: string
	model?: 'default' | 'slim'
}
export type SkinSitePlayersStatus = 'idle' | 'checking' | 'ready' | 'error'

const user = ref<SkinSiteUser | null>(null)
const status = ref<SkinSiteStatus>('checking')
const players = ref<SkinSitePlayer[]>([])
const playersStatus = ref<SkinSitePlayersStatus>('idle')
const selectedPlayerId = ref<string | null>(null)
let playersRequest: Promise<SkinSitePlayer[]> | null = null

export const skinSiteUser = readonly(user)
export const skinSiteStatus = readonly(status)
export const skinSitePlayers = readonly(players)
export const skinSitePlayersStatus = readonly(playersStatus)
export const selectedSkinSitePlayerId = readonly(selectedPlayerId)

function toUser(raw: ApiSkinSiteUser): SkinSiteUser {
	return {
		uuid: raw.uuid,
		username: raw.username,
		permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
	}
}

function clearSessionState() {
	user.value = null
	players.value = []
	playersStatus.value = 'idle'
	selectedPlayerId.value = null
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

let initialized: Promise<void> | null = null
let sessionRevision = 0
let loginRevision = 0
let refreshRequest: { token: string; revision: number; promise: Promise<boolean> } | null = null

/** Share renewals and discard results from a session that has since changed. */
function renewSkinSiteToken(): Promise<boolean> {
	const token = getSkinSiteToken()
	if (!token) return Promise.resolve(false)
	const revision = sessionRevision
	if (refreshRequest?.token === token && refreshRequest.revision === revision) {
		return refreshRequest.promise
	}
	const request = {
		token,
		revision,
		promise: (async () => {
			let result: SkinSiteResponse<{ username: string; jwt: string }>
			try {
				result = await skinSiteRefresh()
			} catch {
				return false
			}
			if (revision !== sessionRevision || getSkinSiteToken() !== token) return false
			if (result.success) {
				if (typeof result.payload?.jwt !== 'string' || !result.payload.jwt.trim()) return false
				setSkinSiteToken(result.payload.jwt)
				return true
			}
			if (result.errorCode === 401 || result.errorCode === 403) invalidateSkinSiteSession()
			return false
		})(),
	}
	refreshRequest = request
	const clearRequest = () => {
		if (refreshRequest === request) refreshRequest = null
	}
	void request.promise.then(clearRequest, clearRequest)
	return request.promise
}

/**
 * Renew the saved JWT on each launcher startup before loading the user.
 * Safe to call repeatedly;
 * the first call performs the actual work and later ones reuse it.
 */
export function initSkinSiteSession(): Promise<void> {
	if (initialized) return initialized
	const revision = sessionRevision
	initialized = (async () => {
		const token = getSkinSiteToken()
		if (!token) {
			status.value = 'signed-out'
			return
		}
		status.value = 'checking'
		if (!(await renewSkinSiteToken())) {
			if (revision === sessionRevision) status.value = 'error'
			return
		}
		if (revision !== sessionRevision) return
		const result = await skinSiteCurrentUser()
		if (revision !== sessionRevision) return
		if (result.success) {
			user.value = toUser(result.payload)
			status.value = 'signed-in'
			void requestSkinSitePlayers().catch(() => {})
		} else if (result.errorCode === 401 || result.errorCode === 403) {
			clearSkinSiteToken()
			clearSessionState()
			status.value = 'signed-out'
		} else {
			status.value = 'error'
		}
	})()
		.catch(() => {
			if (revision === sessionRevision) status.value = 'error'
		})
		.finally(() => {
			if (revision === sessionRevision && status.value === 'error') initialized = null
		})
	return initialized
}

/** Force a re-check (e.g. after the user signs in from another view). */
export function reloadSkinSiteSession(): Promise<void> {
	sessionRevision++
	initialized = null
	return initSkinSiteSession()
}

export async function signInSkinSite(payload: {
	username: string
	password: string
	clientId: string
}): Promise<SkinSiteResponse<{ username: string; jwt: string }>> {
	const attemptRevision = ++loginRevision
	const result = await skinSiteLogin(payload)
	if (result.success && attemptRevision === loginRevision) {
		const revision = ++sessionRevision
		initialized = null
		setSkinSiteToken(result.payload.jwt)
		const current = await skinSiteCurrentUser()
		if (revision !== sessionRevision) return result
		if (current.success) {
			user.value = toUser(current.payload)
			status.value = 'signed-in'
			void requestSkinSitePlayers().catch(() => {})
		} else {
			user.value = { uuid: '', username: result.payload.username, permissions: [] }
			status.value = 'signed-in'
		}
	}
	return result
}

/** Reject an old credential without cancelling a newer explicit login attempt. */
function invalidateSkinSiteSession() {
	sessionRevision++
	refreshRequest = null
	clearSkinSiteToken()
	clearSessionState()
	status.value = 'signed-out'
	initialized = null
}

export function signOutSkinSite() {
	loginRevision++
	invalidateSkinSiteSession()
}

/** Refresh the JWT; returns true when a new token was stored. */
export async function refreshSkinSiteSession(): Promise<boolean> {
	if (status.value !== 'signed-in') return false
	return renewSkinSiteToken()
}

// ---------------------------------------------------------------------------
// Compatibility shims for the old iframe-based API
// ---------------------------------------------------------------------------

/** @deprecated The session is no longer driven by an iframe. No-op. */
export function setSkinSiteFrame(_frame: Window | null) {}

/** @deprecated The session is no longer driven by an iframe. No-op. */
export function receiveSkinSiteMessage(_event: MessageEvent, _frame: Window | null): boolean {
	return false
}

/** @deprecated Use the in-app login view instead. No-op. */
export function openSkinSiteLogin() {}

export function resetSkinSiteSession() {
	loginRevision++
	sessionRevision++
	refreshRequest = null
	clearSessionState()
	status.value = getSkinSiteToken() ? 'checking' : 'signed-out'
	initialized = null
}

/** Resolves once the initial session check has settled. */
export async function waitForSkinSiteSession(): Promise<void> {
	await initSkinSiteSession()
}

// ---------------------------------------------------------------------------
// Download token (the launcher's hosted pack downloader)
// ---------------------------------------------------------------------------

/**
 * The hosted pack downloader authenticates with the skin site JWT. We hold it
 * locally now, so this simply surfaces it (refreshing once if it is missing).
 */
export async function requestSkinSiteDownloadToken(): Promise<string> {
	if (status.value !== 'signed-in') {
		await initSkinSiteSession()
	}
	if (status.value !== 'signed-in') {
		throw new Error('请先在启动器中登录 StarLight 皮肤站，再下载整合包。')
	}
	let token = getSkinSiteToken()
	if (!token) {
		if (await refreshSkinSiteSession()) token = getSkinSiteToken()
	}
	if (!token) throw new Error('StarLight 登录凭据不可用，请重新登录。')
	return token
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

async function buildPlayer(entry: {
	uuid: string
	name: string
	isMojang: boolean
}): Promise<SkinSitePlayer> {
	const base: SkinSitePlayer = {
		uuid: entry.uuid,
		name: entry.name,
		isMojang: entry.isMojang,
		skinState: 'empty',
	}
	const skinResult = await skinSitePlayerSkin(entry.uuid)
	if (!skinResult.success) return { ...base, skinState: 'error' }

	const texture: SkinSitePlayerSkin = skinResult.payload ?? {}
	base.capeUrl = texture.cape
	if (!texture.skin) return base

	try {
		const skinDataUrl = await fetchImageAsDataUrl(texture.skin)
		const headDataUrl = await renderSkinHead(skinDataUrl)
		return {
			...base,
			skinState: 'ready',
			headDataUrl,
			skinDataUrl,
			model: texture.model === 'slim' ? 'slim' : 'default',
		}
	} catch {
		return { ...base, skinState: 'error' }
	}
}

export function requestSkinSitePlayers(): Promise<SkinSitePlayer[]> {
	if (playersRequest) return playersRequest
	if (status.value !== 'signed-in' || !user.value) {
		// Keep the status meaningful so the UI does not spin forever: an
		// unauthenticated request means "not loaded yet", not "loading".
		playersStatus.value = 'idle'
		return Promise.reject(new Error('请先登录 StarLight 皮肤站。'))
	}

	playersStatus.value = 'checking'
	playersRequest = (async () => {
		try {
			const list = await skinSitePlayerList()
			if (!list.success) throw new Error(list.errorMessage)
			const built = await Promise.all(list.payload.map(buildPlayer))
			players.value = built
			if (selectedPlayerId.value && !built.some((p) => p.uuid === selectedPlayerId.value)) {
				selectedPlayerId.value = null
			}
			playersStatus.value = 'ready'
			return players.value
		} catch (error) {
			playersStatus.value = 'error'
			throw error
		} finally {
			playersRequest = null
		}
	})()
	return playersRequest
}

/**
 * Drop any in-flight or cached player request and fetch again. Used by views
 * that need to recover after a failed load (e.g. signing in from the skin
 * page while the first attempt raced the session check).
 */
export function reloadSkinSitePlayers(): Promise<SkinSitePlayer[]> {
	playersRequest = null
	return requestSkinSitePlayers()
}

export function selectSkinSitePlayer(playerId: string | null) {
	if (playerId === null) {
		selectedPlayerId.value = null
		return
	}
	if (players.value.some((player) => player.uuid === playerId)) selectedPlayerId.value = playerId
}

// ---------------------------------------------------------------------------
// Luck
// ---------------------------------------------------------------------------

export async function requestSkinSiteLuck(): Promise<number> {
	if (status.value !== 'signed-in') throw new Error('请先登录 StarLight 皮肤站。')
	const result = await skinSiteLuck()
	if (!result.success) throw new Error(result.errorMessage)
	return result.payload.luck
}
// ---------------------------------------------------------------------------
// Legacy compatibility
// ---------------------------------------------------------------------------

/**
 * Replace a player's skin texture.
 *
 * The caller hands us a base64 PNG (what the in-app editor produces); we turn
 * it back into a File and upload it through the skin site's texture endpoint.
 */
export async function requestSkinSiteSkinUpdate(
	playerId: string,
	textureDataUrl: string,
	model: 'default' | 'slim',
): Promise<void> {
	if (status.value !== 'signed-in' || !user.value) {
		throw new Error('请先登录 StarLight 皮肤站。')
	}
	const player = players.value.find((candidate) => candidate.uuid === playerId)
	if (!player || player.isMojang) {
		throw new Error('该玩家无法修改皮肤。')
	}
	if (!/^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i.test(textureDataUrl)) {
		throw new Error('皮肤图片无效或过大。')
	}

	const file = await dataUrlToFile(textureDataUrl, `${player.name}.png`)
	const result = await skinSiteUploadTexture(playerId, file, 'SKIN', { model })
	if (!result.success) throw new Error(result.errorMessage)

	const refreshed = await skinSitePlayerSkin(playerId)
	if (refreshed.success && refreshed.payload?.skin) {
		const updated = await buildPlayer({
			uuid: player.uuid,
			name: player.name,
			isMojang: player.isMojang,
		})
		players.value = players.value.map((entry) => (entry.uuid === playerId ? updated : entry))
	}
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
	const response = await fetch(dataUrl)
	const blob = await response.blob()
	return new File([blob], filename, { type: 'image/png' })
}
