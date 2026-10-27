import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
export const SKIN_SITE_ORIGIN = 'https://skin.starlight.cool'

/** Where the skin site stores the JWT for this launcher. Kept separate from
 * the web site's own `loginToken` so the two sessions never clash. */
const TOKEN_STORAGE_KEY = 'starlight-skin-site-token'

export type SkinSiteResponse<T> =
	| { readonly success: true; readonly payload: T; readonly timestamp: number }
	| {
			readonly success: false
			readonly timestamp: number
			readonly errorType?: string
			readonly errorCode: number
			readonly errorMessage: string
	  }

type RequestType = 'starlight' | 'skin' | 'mod'

const REQUEST_TYPE_PATH: Record<RequestType, string> = {
	starlight: '/starlight',
	skin: '/starlight/skin',
	mod: '/starlight/mod',
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

export function getSkinSiteToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_STORAGE_KEY)
	} catch {
		return null
	}
}

export function setSkinSiteToken(token: string | null): void {
	try {
		if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token)
		else localStorage.removeItem(TOKEN_STORAGE_KEY)
	} catch {
		// Storage may be unavailable in some environments; ignore.
	}
}

export function clearSkinSiteToken(): void {
	setSkinSiteToken(null)
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

function createException(
	errorCode: number,
	errorMessage: string,
	timestamp?: number,
	errorType?: string,
): SkinSiteResponse<never> {
	return {
		success: false,
		timestamp: timestamp ?? Date.now(),
		errorMessage,
		errorType,
		errorCode,
	}
}

function handleException(status: number): SkinSiteResponse<never> {
	switch (status) {
		case 0:
			return createException(0, '连接中断，请检查网络或代理后重试', undefined, 'NetworkError')
		case 400:
			return createException(status, '请求参数有误')
		case 401:
			return createException(status, '该功能需要登录后才能使用')
		case 403:
			return createException(status, '权限不足')
		case 404:
			return createException(status, '资源不存在')
		case 413:
			return createException(status, '文件超过服务器上传大小限制')
		case 429:
			return createException(status, '请求过于频繁，请稍后再试')
		case 502:
		case 503:
			return createException(status, '服务器暂时不可用，请稍后重试')
		case 504:
			return createException(status, '网关等待服务器处理超时')
		default:
			return createException(status, `请求失败（HTTP ${status}）`)
	}
}

async function processResponse<T>(response: Response): Promise<SkinSiteResponse<T>> {
	const text = await response.text()

	if (!response.ok && text.length === 0) {
		return handleException(response.status)
	}

	let data: Record<string, unknown> | null = null
	try {
		data = text.length !== 0 ? JSON.parse(text) : null
	} catch {
		return response.ok
			? createException(response.status, '服务器返回了无法识别的响应', undefined, 'InvalidResponse')
			: handleException(response.status)
	}

	if (response.ok) {
		return {
			success: true,
			payload: data?.payload as T,
			timestamp: typeof data?.timestamp === 'number' ? data.timestamp : Date.now(),
		}
	}

	const errorMessage = data?.errorMessage
	if (typeof errorMessage === 'string' && errorMessage) {
		return createException(
			response.status,
			errorMessage,
			typeof data?.timestamp === 'number' ? data.timestamp : undefined,
			typeof data?.error === 'string' ? data.error : undefined,
		)
	}
	return handleException(response.status)
}

interface SendOptions {
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
	type?: RequestType
	body?: unknown
	/** Send a multipart form body (e.g. issue creation with images). */
	form?: FormData
	/** Set to false to skip the Authorization header (e.g. login). */
	auth?: boolean
}

export async function skinSiteRequest<T>(
	path: string,
	options: SendOptions = {},
): Promise<SkinSiteResponse<T>> {
	const { method = 'GET', type = 'starlight', body, form, auth = true } = options
	const url = `${SKIN_SITE_ORIGIN}${REQUEST_TYPE_PATH[type]}/${path.replace(/^\/+/, '')}`

	const headers: Record<string, string> = {
		Accept: 'application/json',
	}
	if (body !== undefined) headers['Content-Type'] = 'application/json'
	// FormData sets its own multipart boundary; never set Content-Type for it.
	if (auth) {
		const token = getSkinSiteToken()
		if (token) headers['Authorization'] = `Bearer ${token}`
	}

	let response: Response
	try {
		response = await tauriFetch(url, {
			method,
			headers,
			body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
		})
	} catch {
		return handleException(0)
	}

	return processResponse<T>(response)
}

// ---------------------------------------------------------------------------
// Auth types (mirrors the skin site's packet shapes)
// ---------------------------------------------------------------------------

export interface SkinSiteUser {
	uuid: string
	username: string
	email?: string
	qq?: number | null
	banned?: boolean
	id?: number
	permissions?: string[]
	registerTime?: number
	avatar?: string | null
}

export interface SkinSiteLoginResult {
	username: string
	jwt: string
}

export interface SkinSiteCaptchaRequire {
	clientId: string
	image?: string
	[extra: string]: unknown
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

/** Ask the server for a captcha challenge. */
export function requestCaptcha(): Promise<SkinSiteResponse<SkinSiteCaptchaRequire>> {
	return skinSiteRequest<SkinSiteCaptchaRequire>('captcha', { auth: false })
}

/** Submit the captcha rotation angle; resolves to the clientId used for login/register. */
export function verifyCaptcha(payload: {
	clientId: string
	degree: number
}): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('verifyCaptcha', { method: 'POST', body: payload, auth: false })
}

export function skinSiteLogin(payload: {
	username: string
	password: string
	clientId: string
}): Promise<SkinSiteResponse<SkinSiteLoginResult>> {
	return skinSiteRequest<SkinSiteLoginResult>('login', {
		method: 'POST',
		body: payload,
		auth: false,
	})
}

export function skinSiteRefresh(): Promise<SkinSiteResponse<SkinSiteLoginResult>> {
	return skinSiteRequest<SkinSiteLoginResult>('user/refresh')
}

export function skinSiteCurrentUser(): Promise<SkinSiteResponse<SkinSiteUser>> {
	return skinSiteRequest<SkinSiteUser>('user')
}

export function skinSiteLuck(): Promise<SkinSiteResponse<{ luck: number }>> {
	return skinSiteRequest<{ luck: number }>('luck')
}

export function skinSiteRegisterCondition(): Promise<
	SkinSiteResponse<{ registerAllowed: boolean; inviteCodeRequired: boolean }>
> {
	return skinSiteRequest('register/condition', { auth: false })
}
// ---------------------------------------------------------------------------
// Players & skins (RequestType.SKIN)
// ---------------------------------------------------------------------------

export interface SkinSitePlayerInfo {
	uuid: string
	name: string
	isMojang: boolean
	ownerUsername?: string
	legacyInternalAdapted?: boolean
}

export interface SkinSitePlayerSkin {
	skin?: string
	cape?: string
	elytra?: string
	model?: 'default' | 'slim'
}

/** List the players owned by the signed-in account. */
export function skinSitePlayerList(): Promise<SkinSiteResponse<SkinSitePlayerInfo[]>> {
	return skinSiteRequest<SkinSitePlayerInfo[]>('player', { type: 'skin' })
}

/** Fetch the skin/cape/elytra textures for a single player. */
export function skinSitePlayerSkin(uuid: string): Promise<SkinSiteResponse<SkinSitePlayerSkin>> {
	return skinSiteRequest<SkinSitePlayerSkin>(`player/skin/${encodeURIComponent(uuid)}`, {
		type: 'skin',
	})
}

export type SkinTextureType = 'SKIN' | 'CAPE' | 'ELYTRA'

/** Upload (or replace) a texture for a player. */
export async function skinSiteUploadTexture(
	uuid: string,
	file: File,
	type: SkinTextureType,
	metadata: Record<string, string> = {},
): Promise<SkinSiteResponse<string>> {
	const form = new FormData()
	form.append('file', file)
	for (const [key, value] of Object.entries(metadata)) form.append(key, value)

	const url = `${SKIN_SITE_ORIGIN}/starlight/skin/player/skin/${encodeURIComponent(uuid)}/${type}`
	const headers: Record<string, string> = {}
	const token = getSkinSiteToken()
	if (token) headers['Authorization'] = `Bearer ${token}`

	let response: Response
	try {
		response = await tauriFetch(url, { method: 'PUT', headers, body: form })
	} catch {
		return handleException(0)
	}
	return processResponse<string>(response)
}

/** Remove a texture from a player. */
export function skinSiteDeleteTexture(
	uuid: string,
	type: SkinTextureType,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>(`player/skin/${encodeURIComponent(uuid)}/${type}`, {
		method: 'DELETE',
		type: 'skin',
	})
}

/** Add a player by name to the signed-in account. */
export function skinSiteAddPlayer(playerName: string): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>(`player/add/${encodeURIComponent(playerName)}`, {
		method: 'POST',
		type: 'skin',
	})
}

export function skinSiteDeletePlayer(uuid: string): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>(`player/${encodeURIComponent(uuid)}`, {
		method: 'DELETE',
		type: 'skin',
	})
}

export function skinSiteRenamePlayer(
	uuid: string,
	newName: string,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>(
		`player/${encodeURIComponent(uuid)}/rename/${encodeURIComponent(newName)}`,
		{ method: 'POST', type: 'skin' },
	)
}

/** Mark a player as the account default (used by launcher login). */
export function skinSiteSetDefaultPlayer(uuid: string): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>(`player/default/set?uuid=${encodeURIComponent(uuid)}`, {
		method: 'POST',
		type: 'skin',
	})
}

/** Clear the account default player. */
export function skinSiteClearDefaultPlayer(): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('player/default', { method: 'DELETE', type: 'skin' })
}

/** Fetch the account default player, if one is set. */
export function skinSiteDefaultPlayer(): Promise<SkinSiteResponse<SkinSitePlayerInfo | null>> {
	return skinSiteRequest<SkinSitePlayerInfo | null>('player/default', { type: 'skin' })
}

/** Toggle the Mojang (official) status of a player and resync its profile. */
export function skinSiteSwitchMojang(uuid: string): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>(`player/${encodeURIComponent(uuid)}/switchMojang`, {
		method: 'GET',
		type: 'skin',
	})
}

/** Convert a legacy internal player so it can log in through the modern flow. */
export function skinSiteAdaptLegacyInternal(uuid: string): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>(`player/${encodeURIComponent(uuid)}/adaptLegacyInternal`, {
		method: 'POST',
		type: 'skin',
	})
}
// ---------------------------------------------------------------------------
// Registration & password reset
// ---------------------------------------------------------------------------

/** Send the email verification code used during registration. */
export function skinSiteRegisterEmailVerify(email: string): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('register/emailVerify', {
		method: 'POST',
		body: { email },
		auth: false,
	})
}

export function skinSiteRegister(payload: {
	qq?: number
	email: string
	emailVerifyCode: string
	password: string
	inviteCode?: string
	clientId: string
}): Promise<SkinSiteResponse<SkinSiteLoginResult>> {
	return skinSiteRequest<SkinSiteLoginResult>('register', {
		method: 'POST',
		body: payload,
		auth: false,
	})
}

/** Ask the server to email a reset code. Always answers success to avoid probing. */
export function skinSitePasswordResetEmailVerify(email: string): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('password/emailVerify', {
		method: 'POST',
		body: { email },
		auth: false,
	})
}

export function skinSitePasswordReset(payload: {
	clientId: string
	email: string
	emailVerifyCode: string
	newPassword: string
}): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('password/reset', {
		method: 'POST',
		body: payload,
		auth: false,
	})
}
// ---------------------------------------------------------------------------
// Donations & announcements
// ---------------------------------------------------------------------------

export interface SkinSitePublicDonationSummary {
	totalAmount: string
	donorCount: number
}

export interface SkinSitePublicDonationEntry {
	id: number
	rank: number
	username: string
	avatar: string | null
	amount: string
}

export interface SkinSitePublicDonationPage {
	items: SkinSitePublicDonationEntry[]
	summary: SkinSitePublicDonationSummary
	hasMore: boolean
}

export function skinSitePublicDonationSummary(): Promise<
	SkinSiteResponse<SkinSitePublicDonationSummary>
> {
	return skinSiteRequest<SkinSitePublicDonationSummary>('donation/summary', { auth: false })
}

export function skinSiteDonationList(offset = 0): Promise<SkinSiteResponse<SkinSiteDonationPage>> {
	return skinSiteRequest<SkinSiteDonationPage>(`donation/list?limit=20&offset=${offset}`, {
		auth: false,
	})
}

export interface SkinSiteAnnouncement {
	id: number
	title: string
	subtitle: string
	imageName?: string
	content: string
	updateAt: number
	star: boolean
	importantLevel: number
	source: string
}

/** Public announcements shown on the skin site. Requires the JWT when signed in. */
export function skinSiteAnnouncements(): Promise<SkinSiteResponse<SkinSiteAnnouncement[]>> {
	return skinSiteRequest<SkinSiteAnnouncement[]>('broadcast/all', { type: 'skin' })
}
// ---------------------------------------------------------------------------
// Account updates (requires the JWT)
// ---------------------------------------------------------------------------

export function skinSiteChangeUsername(newUsername: string): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('update/username', {
		method: 'POST',
		body: { newUsername },
	})
}

export function skinSiteChangePassword(
	oldPassword: string,
	newPassword: string,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('update/password', {
		method: 'POST',
		body: { oldPassword, newPassword },
	})
}

/** Pass null to reset the Minecraft password back to the website password. */
export function skinSiteChangeYggdrasilPassword(
	newPassword: string | null,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('update/yggdrasilPassword', {
		method: 'POST',
		body: { newPassword },
	})
}

/** Upload a new avatar image (multipart). */
export async function skinSiteUploadAvatar(blob: Blob): Promise<SkinSiteResponse<string>> {
	const form = new FormData()
	form.append('avatar', blob)

	const url = `${SKIN_SITE_ORIGIN}/starlight/update/avatar`
	const headers: Record<string, string> = {}
	const token = getSkinSiteToken()
	if (token) headers['Authorization'] = `Bearer ${token}`

	let response: Response
	try {
		response = await tauriFetch(url, { method: 'POST', headers, body: form })
	} catch {
		return handleException(0)
	}
	return processResponse<string>(response)
}
// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

export type SkinSitePublicDownloadStatus = 'OK' | 'NEW' | 'LEGACY' | 'OUTDATED' | 'REMOVAL'

export interface SkinSitePublicDownloadRoute {
	name?: string | null
	url: string
}

export interface SkinSitePublicDownloadItem {
	id: number
	uploader: string
	url: string
	routes: SkinSitePublicDownloadRoute[]
	filename: string
	description: string
	status: SkinSitePublicDownloadStatus[]
	category: string[]
}

export interface SkinSitePublicDownloadCategory {
	id: number
	name: string
}

export function skinSitePublicDownloadList(options?: {
	limit?: number
	offset?: number
	category?: string
}): Promise<SkinSiteResponse<SkinSitePublicDownloadItem[]>> {
	const query = new URLSearchParams({
		limit: String(options?.limit ?? 200),
		offset: String(options?.offset ?? 0),
	})
	if (options?.category) query.set('category', options.category)
	return skinSiteRequest<SkinSitePublicDownloadItem[]>(`download/list?${query.toString()}`)
}

export function skinSitePublicDownloadCount(category?: string): Promise<SkinSiteResponse<number>> {
	const suffix = category ? `?category=${encodeURIComponent(category)}` : ''
	return skinSiteRequest<number>(`download/count${suffix}`)
}

export function skinSitePublicDownloadCategories(): Promise<
	SkinSiteResponse<SkinSitePublicDownloadCategory[]>
> {
	return skinSiteRequest<SkinSitePublicDownloadCategory[]>('download/category/list')
}
// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

export interface SkinSitePublicMapEntry {
	name: string
	url: string
}

export interface SkinSitePublicMapServer {
	name: string
	internal: boolean
	maps: SkinSitePublicMapEntry[]
}

export function skinSitePublicMapServers(): Promise<SkinSiteResponse<SkinSitePublicMapServer[]>> {
	return skinSiteRequest<SkinSitePublicMapServer[]>('maps', { auth: false })
}
// ---------------------------------------------------------------------------
// Player review (public side)
// ---------------------------------------------------------------------------

export type SkinSiteReviewQuestionType = 'SINGLE' | 'MULTIPLE' | 'TRUE_FALSE' | 'FILL' | 'ESSAY'
export type SkinSiteReviewResult = 'PENDING' | 'PASSED' | 'REJECTED'

export interface SkinSiteReviewPublicOption {
	id: string
	description: string
	correct?: boolean
	defaultSelected?: boolean
}

export interface SkinSiteReviewPublicQuestion {
	id: string
	type: SkinSiteReviewPublicQuestionType
	title: string
	annotation?: string | null
	score?: number
	optional?: boolean
	fatal?: boolean
	options?: SkinSiteReviewPublicOption[]
	answer?: string | null
	maxLength?: number | null
	informationQuestion?: boolean
}

export interface SkinSiteReviewPublicPaper {
	id: string
	title: string
	description?: string
	questions: SkinSiteReviewPublicQuestion[]
	[key: string]: unknown
}

export interface SkinSiteReviewCatalog {
	papers: SkinSiteReviewPaper[]
	[key: string]: unknown
}

export interface SkinSiteReviewReceipt {
	id?: number
	accessToken?: string
	result?: SkinSiteReviewResult
	title?: string
	[key: string]: unknown
}

export function skinSiteReviewCatalog(): Promise<SkinSiteResponse<SkinSiteReviewCatalog>> {
	return skinSiteRequest<SkinSiteReviewCatalog>('review/public', { auth: false })
}

export function skinSiteReviewPaper(
	paperId: string,
): Promise<SkinSiteResponse<SkinSiteReviewPaper>> {
	return skinSiteRequest<SkinSiteReviewPaper>(`review/public/${encodeURIComponent(paperId)}`, {
		auth: false,
	})
}

export interface SkinSiteReviewSubmitData {
	paperId: string
	email: string
	answers: Record<string, unknown>
	inviteCode?: string
	[key: string]: unknown
}

export function skinSiteSubmitReview(
	data: SkinSiteReviewSubmitData,
): Promise<SkinSiteResponse<SkinSiteReviewReceipt>> {
	return skinSiteRequest<SkinSiteReviewReceipt>('review/submit', {
		method: 'POST',
		body: data,
		auth: false,
	})
}
// ---------------------------------------------------------------------------
// Bug tracker
// ---------------------------------------------------------------------------

export type SkinSiteBugIssueType = 'BUG' | 'FEATURE' | 'IMPROVEMENT'
export type SkinSiteBugStatus =
	| 'PENDING'
	| 'CONFIRMED'
	| 'NEEDS_INFO'
	| 'IN_PROGRESS'
	| 'VERIFYING'
	| 'CLOSED'
export type SkinSiteBugPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW'
export type SkinSiteBugSearchType = 'CONTENT' | 'SUBMITTER'
export type SkinSiteBugResolution =
	| 'FIXED'
	| 'WONT_FIX'
	| 'BY_DESIGN'
	| 'DUPLICATE'
	| 'CANNOT_REPRODUCE'
	| 'INVALID'

export interface SkinSiteBugImage {
	hash: string
	[key: string]: unknown
}

/** Download a bug attachment image. The endpoint requires auth, so the image
 * must be fetched as a blob and rendered through an object URL. */
export async function skinSiteBugImageFetch(hash: string): Promise<Blob | null> {
	const url = `${SKIN_SITE_ORIGIN}${REQUEST_TYPE_PATH.starlight}/bug/images/${encodeURIComponent(hash)}`
	const headers: Record<string, string> = { Accept: 'image/*' }
	const token = getSkinSiteToken()
	if (token) headers['Authorization'] = `Bearer ${token}`
	try {
		const response = await tauriFetch(url, { method: 'GET', headers })
		if (!response.ok) return null
		const type = response.headers.get('content-type') ?? ''
		if (type.includes('application/json') || type.includes('text/')) return null
		return await response.blob()
	} catch {
		return null
	}
}

export interface SkinSiteBugIssue {
	id: number
	type: SkinSiteBugIssueType
	title: string
	description: string
	private: boolean
	authorUuid: string
	authorName: string
	authorAvatar: string | null
	status: SkinSiteBugStatus
	priority: SkinSiteBugPriority
	resolution: SkinSiteBugResolution | null
	assigneeUuid: string | null
	assigneeName: string | null
	commentCount: number
	images: SkinSiteBugImage[]
	createdAt: number
	updatedAt: number
	closedAt: number | null
	canEdit: boolean
	canManage: boolean
}

export interface SkinSiteBugIssuePage {
	items: SkinSiteBugIssue[]
	hasMore: boolean
}

export function skinSiteBugIssues(params: {
	offset?: number
	limit?: number
	type?: SkinSiteBugIssueType | ''
	status?: SkinSiteBugStatus | ''
	priority?: SkinSiteBugPriority | ''
	assigned?: boolean
	openOnly?: boolean
	pendingFirst?: boolean
	searchType?: SkinSiteBugSearchType
	keyword?: string
}): Promise<SkinSiteResponse<SkinSiteBugIssuePage>> {
	const query = new URLSearchParams({
		offset: String(params.offset ?? 0),
		limit: String(params.limit ?? 20),
	})
	if (params.type) query.set('type', params.type)
	if (params.status) query.set('status', params.status)
	if (params.priority) query.set('priority', params.priority)
	if (params.assigned) query.set('assigned', 'true')
	if (params.searchType && params.keyword) {
		query.set('searchType', params.searchType)
		query.set('keyword', params.keyword)
	}
	query.set('openOnly', String(params.openOnly ?? true))
	query.set('pendingFirst', String(params.pendingFirst ?? true))
	return skinSiteRequest<SkinSiteBugIssuePage>(`bug?${query.toString()}`)
}

export function skinSiteBugIssue(id: number): Promise<SkinSiteResponse<SkinSiteBugIssue>> {
	return skinSiteRequest<SkinSiteBugIssue>(`bug/${id}`)
}

export interface SkinSiteBugComment {
	id: number
	issueId: number
	authorUuid: string
	authorName: string
	authorAvatar: string | null
	content: string
	system: boolean
	images: SkinSiteBugImage[]
	createdAt: number
	editedAt: number | null
	deletedAt: number | null
	canEdit: boolean
	canDelete: boolean
}

export interface SkinSiteBugCommentPage {
	items: SkinSiteBugComment[]
	hasMore: boolean
}

export function skinSiteBugComments(
	issueId: number,
	offset = 0,
	limit = 50,
): Promise<SkinSiteResponse<SkinSiteBugCommentPage>> {
	return skinSiteRequest<SkinSiteBugCommentPage>(
		`bug/${issueId}/comments?offset=${offset}&limit=${limit}`,
	)
}

export function skinSiteCreateBugComment(
	issueId: number,
	content: string,
	images: File[] = [],
): Promise<SkinSiteResponse<SkinSiteBugComment>> {
	const form = new FormData()
	form.append('payload', JSON.stringify({ content }))
	for (const image of images) form.append('images', image)
	return skinSiteRequest<SkinSiteBugComment>(`bug/${issueId}/comments`, {
		method: 'POST',
		form,
	})
}

export function skinSiteDeleteBugComment(id: number): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>(`bug/comments/${id}`, { method: 'DELETE' })
}

export function skinSiteBugUnreadCount(): Promise<SkinSiteResponse<number>> {
	return skinSiteRequest<number>('bug/notifications/count')
}

export function skinSiteMarkBugNotificationsRead(): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('bug/notifications/read', { method: 'POST' })
}

export interface SkinSiteBugCreateRequest {
	type: SkinSiteBugIssueType
	title: string
	description: string
	private?: boolean
}

export function skinSiteCreateBugIssue(
	request: SkinSiteBugCreateRequest,
	images: File[] = [],
): Promise<SkinSiteResponse<SkinSiteBugIssue>> {
	const form = new FormData()
	form.append('payload', JSON.stringify(request))
	for (const image of images) form.append('images', image)
	return skinSiteRequest<SkinSiteBugIssue>('bug', { method: 'POST', form })
}

export interface SkinSiteBugNotification {
	id: number
	issueId: number
	actorName: string
	createdAt: number
}

export function skinSiteBugNotifications(): Promise<SkinSiteResponse<SkinSiteBugNotification[]>> {
	return skinSiteRequest<SkinSiteBugNotification[]>('bug/notifications')
}

export function skinSiteMarkBugNotificationRead(
	issueId?: number,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('bug/notifications/read', {
		method: 'POST',
		body: issueId === undefined ? {} : { issueId },
	})
}

// ---------------------------------------------------------------------------
// Admin console
// ---------------------------------------------------------------------------

export interface SkinSiteAdminStatus {
	bootTime: number
	memoryUsage: number
	userCount: number
	playerCount: number
}

export function skinSiteAdminStatus(): Promise<SkinSiteResponse<SkinSiteAdminStatus>> {
	return skinSiteRequest<SkinSiteAdminStatus>('admin/status')
}

export interface SkinSiteBroadcast {
	id: number
	title: string
	subtitle: string
	imageName?: string
	content: string
	updateAt: number
	star: boolean
	importantLevel: number
	source: string
	expireAt: number
	uploader: string
}

export interface SkinSiteBroadcastInput {
	title: string
	subtitle: string
	content: string
	expireAt: number
	star: boolean
	importantLevel: number
	imageFile?: File | null
	removeImage?: boolean
}

export function skinSiteBroadcasts(): Promise<SkinSiteResponse<SkinSiteBroadcast[]>> {
	return skinSiteRequest<SkinSiteBroadcast[]>('broadcast/all/complex', { type: 'skin' })
}

export function skinSiteCreateBroadcast(
	input: SkinSiteBroadcastInput,
): Promise<SkinSiteResponse<string>> {
	const form = new FormData()
	form.append(
		'payload',
		JSON.stringify({
			title: input.title,
			subtitle: input.subtitle,
			content: input.content,
			expireAt: input.expireAt,
			star: input.star,
			importantLevel: input.importantLevel,
		}),
	)
	if (input.imageFile) form.append('image', input.imageFile)
	return skinSiteRequest<string>('broadcast', { method: 'PUT', type: 'skin', form })
}

export function skinSiteUpdateBroadcast(
	id: number,
	input: SkinSiteBroadcastInput,
): Promise<SkinSiteResponse<string>> {
	const form = new FormData()
	form.append(
		'payload',
		JSON.stringify({
			title: input.title,
			subtitle: input.subtitle,
			content: input.content,
			expireAt: input.expireAt,
			star: input.star,
			importantLevel: input.importantLevel,
			removeImage: input.removeImage ?? false,
		}),
	)
	if (input.imageFile) form.append('image', input.imageFile)
	return skinSiteRequest<string>('broadcast/update/' + id, {
		method: 'PUT',
		type: 'skin',
		form,
	})
}

export function skinSiteDeleteBroadcast(id: number): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('broadcast/' + id, { method: 'DELETE', type: 'skin' })
}

export interface SkinSiteAdminPlayer {
	uuid: string
	name: string
	isMojang: boolean
	ownerUsername: string
	legacyInternalAdapted: boolean
}

export interface SkinSiteAdminPlayerQuery {
	limit: number
	offset: number
	searchField?: string
	keyword?: string
}

export function skinSiteAdminPlayerCount(params?: {
	searchField?: string
	keyword?: string
}): Promise<SkinSiteResponse<number>> {
	const query = new URLSearchParams()
	if (params?.searchField?.trim()) query.set('searchField', params.searchField!.trim())
	if (params?.keyword?.trim()) query.set('keyword', params.keyword!.trim())
	const suffix = query.toString() ? '?' + query.toString() : ''
	return skinSiteRequest<number>('admin/players/number' + suffix, { type: 'skin' })
}

export function skinSiteAdminPlayerList(
	query: SkinSiteAdminPlayerQuery,
): Promise<SkinSiteResponse<SkinSiteAdminPlayer[]>> {
	return skinSiteRequest<SkinSiteAdminPlayer[]>('admin/players/list', {
		method: 'POST',
		type: 'skin',
		body: query,
	})
}

export function skinSiteAdminUpdatePlayer(input: {
	uuid: string
	name: string
	isMojang: boolean
}): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('admin/update', {
		method: 'POST',
		type: 'skin',
		body: input,
	})
}

export function skinSiteAdminDeletePlayer(uuid: string): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('admin/delete/' + encodeURIComponent(uuid), {
		method: 'POST',
		type: 'skin',
	})
}

export interface SkinSiteAdminUser {
	uuid: string
	username: string
	email: string
	qq?: number
	banned: boolean
	id: number
	permissions: string[]
	avatar?: string
	registerTime: number
}

export function skinSiteAdminUserCount(params?: {
	searchField?: string
	keyword?: string
}): Promise<SkinSiteResponse<number>> {
	const query = new URLSearchParams()
	if (params?.searchField?.trim()) query.set('searchField', params.searchField!.trim())
	if (params?.keyword?.trim()) query.set('keyword', params.keyword!.trim())
	const suffix = query.toString() ? '?' + query.toString() : ''
	return skinSiteRequest<number>('admin/users/number' + suffix)
}

export function skinSiteAdminUserList(query: {
	limit: number
	offset: number
	searchField?: string
	keyword?: string
}): Promise<SkinSiteResponse<SkinSiteAdminUser[]>> {
	return skinSiteRequest<SkinSiteAdminUser[]>('admin/users/list', {
		method: 'POST',
		body: query,
	})
}

export function skinSiteAdminUpdateUser(input: {
	uuid: string
	username: string
	password?: string
	email: string
	qq?: number
	banned: boolean
	permissions: string[]
}): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('admin/update', { method: 'POST', body: input })
}

export function skinSiteAdminDeleteUser(uuid: string): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('admin/delete/' + encodeURIComponent(uuid), {
		method: 'POST',
	})
}

export function skinSiteAdminUserPlayers(
	uuid: string,
): Promise<SkinSiteResponse<SkinSiteAdminPlayer[]>> {
	return skinSiteRequest<SkinSiteAdminPlayer[]>(
		'admin/users/' + encodeURIComponent(uuid) + '/players',
	)
}

export interface SkinSiteFrequencyLimit {
	dropPercent?: number | null
}

export function skinSiteAdminUserFrequencyLimit(
	uuid: string,
): Promise<SkinSiteResponse<SkinSiteFrequencyLimit>> {
	return skinSiteRequest<SkinSiteFrequencyLimit>(
		'admin/users/' + encodeURIComponent(uuid) + '/frequency-limit',
	)
}

export type SkinSiteReviewMode = 'AUTO' | 'MANUAL'

export type SkinSiteReviewQuestionType = 'SINGLE' | 'MULTIPLE' | 'TRUE_FALSE' | 'FILL' | 'ESSAY'

export interface SkinSiteReviewOption {
	id: string
	description: string
	correct: boolean
	defaultSelected: boolean
	score: number
}

export interface SkinSiteReviewQuestion {
	id: string
	type: SkinSiteReviewQuestionType
	title: string
	annotation?: string | null
	score: number
	optional: boolean
	fatal: boolean
	autoReview: boolean
	options: SkinSiteReviewOption[]
	answer?: string | null
	maxLength?: number | null
	informationQuestion?: boolean
	informationAlias?: string | null
}

export interface SkinSiteReviewPaper {
	id: string
	title: string
	annotation?: string | null
	mode: SkinSiteReviewMode
	passScore: number
	version: number
	questions: SkinSiteReviewQuestion[]
}

export interface SkinSiteReviewAnswer {
	id: string
	questionId?: string
	values?: string[]
	text?: string
	score?: number | null
	[key: string]: unknown
}

export interface SkinSiteReviewSubmission {
	id: number
	reviewVersion: number
	revision: number
	applicantName: string
	username?: string | null
	qq?: string | null
	userUuid?: string | null
	registeredAt?: number | null
	mode: SkinSiteReviewMode
	result: SkinSiteReviewResult
	score?: number | null
	targetPermissions: string[]
	automaticResults: Record<string, boolean>
	inviteCode?: string | null
	inviteUsed: boolean
	reviewerUuid?: string | null
	reviewerName?: string | null
	createdAt: number
	reviewedAt?: number | null
	answers: SkinSiteReviewAnswer[]
	paper: SkinSiteReviewPaper
	decisionHistory?: Array<{
		previousResult: SkinSiteReviewResult
		result: SkinSiteReviewResult
		reviewer: string
		reason: string
		at: number
		permissionNote: string
	}>
	context?: {
		ip: string | null
		ipSource: string
		userAgent: string
		activity?: {
			durationMs: number
			hiddenMs: number
			screenSwitches: number
		} | null
	} | null
}

export function skinSiteReviewSubmissions(params?: {
	result?: SkinSiteReviewResult | 'COMPLETED'
	limit?: number
	offset?: number
	paperId?: string
}): Promise<SkinSiteResponse<SkinSiteReviewSubmission[]>> {
	const query = new URLSearchParams({
		limit: String(params?.limit ?? 20),
		offset: String(params?.offset ?? 0),
	})
	if (params?.result) query.set('result', params.result)
	if (params?.paperId) query.set('paperId', params.paperId)
	return skinSiteRequest<SkinSiteReviewSubmission[]>('review/admin/submissions?' + query.toString())
}

export function skinSiteReviewSubmissionCount(params?: {
	result?: SkinSiteReviewResult | 'COMPLETED'
	paperId?: string
}): Promise<SkinSiteResponse<number>> {
	const query = new URLSearchParams()
	if (params?.result) query.set('result', params.result)
	if (params?.paperId) query.set('paperId', params.paperId)
	const suffix = query.toString() ? '?' + query.toString() : ''
	return skinSiteRequest<number>('review/admin/submissions/count' + suffix)
}

export function skinSiteDecideReviewSubmission(
	id: number,
	accepted: boolean,
	manualScores: Record<string, number> = {},
	expectedRevision?: number,
	reason = '',
): Promise<SkinSiteResponse<SkinSiteReviewSubmission>> {
	const body: Record<string, unknown> = { accepted, manualScores, reason }
	if (expectedRevision !== undefined) body.expectedRevision = expectedRevision
	return skinSiteRequest<SkinSiteReviewSubmission>('review/admin/submissions/' + id + '/decision', {
		method: 'POST',
		body,
	})
}

export interface SkinSiteReviewInviteDelivery {
	email: string
	inviteCode: string
	emailSent: boolean
	emailAttempted: boolean
}

export function skinSiteRegenerateReviewInvite(
	id: number,
): Promise<SkinSiteResponse<SkinSiteReviewInviteDelivery>> {
	return skinSiteRequest<SkinSiteReviewInviteDelivery>(
		'review/admin/submissions/' + id + '/invite/regenerate',
		{ method: 'POST' },
	)
}

export interface SkinSiteLauncherRelease {
	id: number
	version: string
	channel: 'release' | 'beta'
	notes: string
	forceUpdate: boolean
	uploadedBy: string
	uploadedAt: number
	publishedAt: number | null
	active: boolean
}

export interface SkinSiteLauncherAdminState {
	latestUrl: string
	releases: SkinSiteLauncherRelease[]
}

export function skinSiteLauncherAdminState(): Promise<
	SkinSiteResponse<SkinSiteLauncherAdminState>
> {
	return skinSiteRequest<SkinSiteLauncherAdminState>('launcher/admin')
}

export function skinSiteActivateLauncherRelease(
	id: number,
): Promise<SkinSiteResponse<SkinSiteLauncherRelease>> {
	return skinSiteRequest<SkinSiteLauncherRelease>('launcher/admin/' + id + '/activate', {
		method: 'POST',
	})
}

export function skinSiteDeleteLauncherRelease(id: number): Promise<SkinSiteResponse<boolean>> {
	return skinSiteRequest<boolean>('launcher/admin/' + id, { method: 'DELETE' })
}
export interface SkinSiteLauncherUploadStatus {
	id: string
	chunkSize: number
	size: number
	received: number
	receivedChunks: number[]
	uploadConcurrency: number
	state: 'uploading' | 'processing' | 'ready' | 'failed' | 'cancelled'
	release?: SkinSiteLauncherRelease | null
	errorMessage?: string | null
}

const LAUNCHER_MAX_UPLOAD_BYTES = 4 * 1024 ** 3
const LAUNCHER_MAX_CONCURRENCY = 6

function launcherUploadError(message: string, code = 0): SkinSiteResponse<never> {
	return { success: false, timestamp: Date.now(), errorCode: code, errorMessage: message }
}

export async function skinSiteUploadLauncherRelease(
	file: File,
	forceUpdate: boolean,
	onProgress?: (percent: number) => void,
): Promise<SkinSiteResponse<SkinSiteLauncherRelease>> {
	if (!file.name.toLowerCase().endsWith('.zip')) {
		return launcherUploadError('请选择 ZIP 格式的发布包。')
	}
	if (file.size < 1 || file.size > LAUNCHER_MAX_UPLOAD_BYTES) {
		return launcherUploadError('请选择不超过 4 GiB 的完整发布 ZIP。')
	}

	const uploadId = crypto.randomUUID()
	let result = await skinSiteRequest<SkinSiteLauncherUploadStatus>('launcher/admin/uploads', {
		method: 'POST',
		body: {
			uploadId,
			filename: file.name,
			size: file.size,
			forceUpdate,
		},
	})

	const requestStatus = (path: string, method: 'GET' | 'POST' = 'GET') =>
		skinSiteRequest<SkinSiteLauncherUploadStatus>(path, { method })

	const chunkOnce = async (path: string, part: Blob) => {
		const form = new FormData()
		form.append('file', part, 'chunk.bin')
		return skinSiteRequest<SkinSiteLauncherUploadStatus>(path, { method: 'POST', form })
	}

	let guard = 0
	while (guard++ < 200) {
		if (!result.success) return result
		const status = result.payload
		onProgress?.((status.received / file.size) * 100)

		if (status.state === 'ready') {
			return {
				success: true,
				timestamp: result.timestamp,
				payload: status.release as SkinSiteLauncherRelease,
			}
		}
		if (status.state === 'failed' || status.state === 'cancelled') {
			return launcherUploadError(status.errorMessage || '发布包处理失败。')
		}

		if (status.state === 'uploading' && status.received < file.size) {
			const received = new Set(status.receivedChunks)
			const missing: number[] = []
			for (let i = 0; i < Math.ceil(file.size / status.chunkSize); i++) {
				if (!received.has(i)) missing.push(i)
			}

			let cursor = 0
			let uploadError: SkinSiteResponse<never> | null = null
			const worker = async () => {
				while (!uploadError && cursor < missing.length) {
					const index = missing[cursor++]
					const start = index * status.chunkSize
					const part = file.slice(start, Math.min(start + status.chunkSize, file.size))
					let ack = await chunkOnce('launcher/admin/uploads/' + uploadId + '/chunks/' + index, part)
					for (let retry = 0; retry < 2 && !ack.success; retry++) {
						await new Promise((r) => setTimeout(r, 400 * (retry + 1)))
						ack = await chunkOnce('launcher/admin/uploads/' + uploadId + '/chunks/' + index, part)
					}
					if (!ack.success) {
						uploadError = ack
						return
					}
				}
			}
			await Promise.all(
				Array.from(
					{
						length: Math.min(
							status.uploadConcurrency || 1,
							LAUNCHER_MAX_CONCURRENCY,
							missing.length || 1,
						),
					},
					worker,
				),
			)
			if (uploadError) return uploadError
			result = await requestStatus('launcher/admin/uploads/' + uploadId)
		} else if (status.state === 'uploading') {
			result = await requestStatus('launcher/admin/uploads/' + uploadId + '/complete', 'POST')
		} else {
			await new Promise((r) => setTimeout(r, 800))
			result = await requestStatus('launcher/admin/uploads/' + uploadId)
		}
	}
	return launcherUploadError('上传超时，请刷新版本列表确认结果。')
}

export type SkinSiteDownloadStatus = 'OK' | 'NEW' | 'LEGACY' | 'OUTDATED' | 'REMOVAL'

export interface SkinSiteDownloadRoute {
	name?: string | null
	url: string
}

export interface SkinSiteDownloadItem {
	id: number
	uploader: string
	url: string
	routes: SkinSiteDownloadRoute[]
	filename: string
	description: string
	status: SkinSiteDownloadStatus[]
	category: string[]
}

export interface SkinSiteDownloadCategory {
	id: number
	name: string
}

export interface SkinSiteDownloadItemInput {
	routes: SkinSiteDownloadRoute[]
	filename: string
	description: string
	status: SkinSiteDownloadStatus[]
}

export function skinSiteDownloadItems(params?: {
	limit?: number
	offset?: number
	category?: string
}): Promise<SkinSiteResponse<SkinSiteDownloadItem[]>> {
	const query = new URLSearchParams({
		limit: String(params?.limit ?? 200),
		offset: String(params?.offset ?? 0),
	})
	if (params?.category?.trim()) query.set('category', params.category.trim())
	return skinSiteRequest<SkinSiteDownloadItem[]>('download/list?' + query.toString())
}

export function skinSiteDownloadItemCount(category?: string): Promise<SkinSiteResponse<number>> {
	const query = new URLSearchParams()
	if (category?.trim()) query.set('category', category.trim())
	const suffix = query.toString() ? '?' + query.toString() : ''
	return skinSiteRequest<number>('download/count' + suffix)
}

export function skinSiteAddDownloadItem(
	data: SkinSiteDownloadItemInput,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('download/add', { method: 'POST', body: data })
}

export function skinSiteUpdateDownloadItem(
	id: number,
	data: SkinSiteDownloadItemInput,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('download/update/' + id, { method: 'POST', body: data })
}

export function skinSiteDeleteDownloadItem(id: number): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('download/' + id, { method: 'DELETE' })
}

export function skinSiteDownloadCategories(): Promise<
	SkinSiteResponse<SkinSiteDownloadCategory[]>
> {
	return skinSiteRequest<SkinSiteDownloadCategory[]>('download/category/list')
}

export function skinSiteAddDownloadCategory(name: string): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('download/category/add/' + encodeURIComponent(name), {
		method: 'POST',
	})
}

export function skinSiteDeleteDownloadCategory(id: number): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('download/category/' + id, { method: 'DELETE' })
}

export function skinSiteBindDownloadCategory(
	infoId: number,
	categoryId: number,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('download/category/bind/' + infoId + '/' + categoryId, {
		method: 'POST',
	})
}

export function skinSiteUnbindDownloadCategory(
	infoId: number,
	categoryId: number,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('download/category/unbind/' + infoId + '/' + categoryId, {
		method: 'POST',
	})
}

export interface SkinSiteMapServer {
	name: string
	internal: boolean
	maps: Array<{ name: string; url: string }>
}

export function skinSiteMapServers(): Promise<SkinSiteResponse<SkinSiteMapServer[]>> {
	return skinSiteRequest<SkinSiteMapServer[]>('maps')
}

export function skinSiteSaveMapServers(
	servers: SkinSiteMapServer[],
): Promise<SkinSiteResponse<SkinSiteMapServer[]>> {
	return skinSiteRequest<SkinSiteMapServer[]>('maps', { method: 'PUT', body: servers })
}

export interface SkinSiteAccessAuditEntry {
	id: number
	subject: string
	action: string
	sourceIp: string
	proxy: boolean
	reportedPlayerIp: string | null
	internalServer: boolean
	count: number
	firstAt: number
	lastAt: number
}

export interface SkinSiteAccessAuditPage {
	items: SkinSiteAccessAuditEntry[]
	nextCursor: number | null
	retentionDays: number
	recordLimit: number
}

export function skinSiteAccessAudit(params?: {
	before?: number
	subject?: string
	ip?: string
	action?: string
}): Promise<SkinSiteResponse<SkinSiteAccessAuditPage>> {
	const query = new URLSearchParams()
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== '') query.set(key, String(value))
		}
	}
	const suffix = query.toString() ? '?' + query.toString() : ''
	return skinSiteRequest<SkinSiteAccessAuditPage>('admin/access-audit' + suffix)
}

export function skinSiteUpdateAccessAuditSettings(
	retentionDays: number,
): Promise<SkinSiteResponse<{ retentionDays: number }>> {
	return skinSiteRequest<{ retentionDays: number }>('admin/access-audit/settings', {
		method: 'PUT',
		body: { retentionDays },
	})
}

export interface SkinSiteDonationEntry {
	id: number
	rank: number
	username: string
	avatar: string | null
	amount: string
}

export interface SkinSiteDonationSummary {
	totalAmount: string
	donorCount: number
}

export interface SkinSiteDonationAdminEntry {
	donor: SkinSiteDonationEntry
	userUuid: string | null
	qq: string | null
	external: boolean
	version: number
	updatedAt: number
}

export interface SkinSiteDonationAdminPage {
	items: SkinSiteDonationAdminEntry[]
	summary: SkinSiteDonationSummary
	hasMore: boolean
}

export function skinSiteAdminDonations(
	offset = 0,
): Promise<SkinSiteResponse<SkinSiteDonationAdminPage>> {
	return skinSiteRequest<SkinSiteDonationAdminPage>('donation/admin/list?limit=20&offset=' + offset)
}

export function skinSiteFindAdminDonations(identity: {
	userUuid?: string
	qq?: string
}): Promise<SkinSiteResponse<SkinSiteDonationAdminEntry[]>> {
	const query = new URLSearchParams()
	if (identity.userUuid) query.set('userUuid', identity.userUuid)
	if (identity.qq) query.set('qq', identity.qq)
	return skinSiteRequest<SkinSiteDonationAdminEntry[]>('donation/admin/find?' + query.toString())
}

export interface SkinSiteDonationCreate {
	amount: string
	userUuid?: string
	qq?: string
	displayName?: string
}

export function skinSiteCreateDonation(
	data: SkinSiteDonationCreate,
): Promise<SkinSiteResponse<number>> {
	return skinSiteRequest<number>('donation/admin', { method: 'POST', body: data })
}

export interface SkinSiteDonationUpdate {
	amount: string
	version: number
	displayName?: string
	mode?: 'REPLACE' | 'APPEND'
}

export function skinSiteUpdateDonation(
	id: number,
	data: SkinSiteDonationUpdate,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('donation/admin/' + id, { method: 'PUT', body: data })
}

export function skinSiteDeleteDonation(
	id: number,
	version: number,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('donation/admin/' + id + '?version=' + version, {
		method: 'DELETE',
	})
}

export type SkinSiteModLoaderType = 'FABRIC' | 'FORGE'

export interface SkinSiteModMetadata {
	modId?: string
	name?: string
	version?: string
	iconBytes?: string
	loaderType: SkinSiteModLoaderType[]
}

export interface SkinSiteModInfo {
	domainRules: string[]
	hash: string
	name: string
	size: number
	metadata: SkinSiteModMetadata
}

export interface SkinSiteModRuleTag {
	id: number
	name: string
	rules: string[]
}

export function skinSiteModCount(params?: {
	serverAddr?: string
	ruleTagId?: number | null
}): Promise<SkinSiteResponse<number>> {
	const query = new URLSearchParams()
	const addr = params?.serverAddr?.trim()
	if (addr) query.set('server_addr', addr)
	if (params?.ruleTagId != null) query.set('rule_tag_id', String(params.ruleTagId))
	const suffix = query.toString() ? '?' + query.toString() : ''
	return skinSiteRequest<number>('query/mod/number' + suffix, { type: 'mod' })
}

export function skinSiteModList(params: {
	limit: number
	offset: number
	serverAddr?: string
	ruleTagId?: number | null
}): Promise<SkinSiteResponse<SkinSiteModInfo[]>> {
	return skinSiteRequest<SkinSiteModInfo[]>('query/mod/list', {
		method: 'POST',
		type: 'mod',
		body: {
			offset: params.offset || 0,
			limit: params.limit || 0,
			serverAddr: params.serverAddr?.trim() || undefined,
			ruleTagId: params.ruleTagId ?? undefined,
		},
	})
}

export function skinSiteModSearch(
	name: string,
	ruleTagId?: number | null,
): Promise<SkinSiteResponse<SkinSiteModInfo[]>> {
	const query = new URLSearchParams()
	if (ruleTagId != null) query.set('rule_tag_id', String(ruleTagId))
	const suffix = query.toString() ? '?' + query.toString() : ''
	return skinSiteRequest<SkinSiteModInfo[]>(
		'query/mod/search/' + encodeURIComponent(name) + suffix,
		{ type: 'mod' },
	)
}

export function skinSiteUpdateModInfo(info: SkinSiteModInfo): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('update/info', { method: 'POST', type: 'mod', body: info })
}

export function skinSiteDeleteModFile(hash: string): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>(hash, { method: 'DELETE', type: 'mod' })
}

export function skinSiteDeleteMultiModFile(hashes: string[]): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('delete/multimod', {
		method: 'POST',
		type: 'mod',
		body: { modHashes: hashes },
	})
}

export function skinSiteModRuleTags(): Promise<SkinSiteResponse<SkinSiteModRuleTag[]>> {
	return skinSiteRequest<SkinSiteModRuleTag[]>('rule-tags', { type: 'mod' })
}

export function skinSiteCreateModRuleTag(
	name: string,
	rules: string[],
): Promise<SkinSiteResponse<SkinSiteModRuleTag>> {
	return skinSiteRequest<SkinSiteModRuleTag>('rule-tags', {
		method: 'POST',
		type: 'mod',
		body: { name, rules },
	})
}

export function skinSiteUpdateModRuleTag(
	id: number,
	name: string,
	rules: string[],
): Promise<SkinSiteResponse<SkinSiteModRuleTag>> {
	return skinSiteRequest<SkinSiteModRuleTag>('rule-tags/' + id, {
		method: 'POST',
		type: 'mod',
		body: { name, rules },
	})
}

export function skinSiteDeleteModRuleTag(id: number): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('rule-tags/' + id, { method: 'DELETE', type: 'mod' })
}

export interface SkinSiteModRuntimeRelease {
	id: number
	version: string
	fileName: string
	sha256: string
	fileSize: number
	uploadedBy: string
	uploadedAt: number
	publishedAt: number | null
	active: boolean
	available: boolean
	downloadUrl: string
}

export interface SkinSiteModRuntimeAdminState {
	manifestUrl: string
	releases: SkinSiteModRuntimeRelease[]
}

export function skinSiteModRuntimeReleases(): Promise<
	SkinSiteResponse<SkinSiteModRuntimeAdminState>
> {
	return skinSiteRequest<SkinSiteModRuntimeAdminState>('runtime/admin', { type: 'mod' })
}

export function skinSiteUploadModRuntime(
	version: string,
	file: File,
): Promise<SkinSiteResponse<SkinSiteModRuntimeRelease>> {
	const form = new FormData()
	form.append('runtime', file, file.name)
	return skinSiteRequest<SkinSiteModRuntimeRelease>(
		'runtime/admin/upload?version=' + encodeURIComponent(version),
		{ method: 'POST', type: 'mod', form },
	)
}

export function skinSiteActivateModRuntime(
	id: number,
): Promise<SkinSiteResponse<SkinSiteModRuntimeRelease>> {
	return skinSiteRequest<SkinSiteModRuntimeRelease>('runtime/admin/' + id + '/activate', {
		method: 'POST',
		type: 'mod',
	})
}

export function skinSiteDeleteModRuntime(id: number): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('runtime/admin/' + id, { method: 'DELETE', type: 'mod' })
}

export type SkinSiteWikiReadPolicy = 'PUBLIC' | 'MEMBER'
export type SkinSiteWikiEditPolicy = 'MEMBER' | 'WEB_ADMIN'

export interface SkinSiteWikiNode {
	type: string
	color?: string | null
	align?: 'left' | 'center' | 'right' | 'justify' | null
	start?: number | null
	colspan?: number | null
	rowspan?: number | null
	variant?: string | null
	iconFamily?: string | null
	iconName?: string | null
	iconVersion?: number | null
	linkTitle?: string | null
	linkLabel?: string | null
	tooltip?: string | null
	exists?: boolean | null
	text?: string | null
	level?: number | null
	href?: string | null
	title?: string | null
	children: SkinSiteWikiNode[]
	rows: SkinSiteWikiNode[][][]
}

export interface SkinSiteWikiAttachmentInfo {
	id: number
	versionId: number
	name: string
	mime: string
	size: number
	image: boolean
	uploaderName: string
	createdAt: number
}

export interface SkinSiteWikiPageDetail {
	title: string
	revisionId: number
	source: string
	nodes: SkinSiteWikiNode[]
	categories: string[]
	updatedAt: number
	authorName: string
	summary: string
	readPolicy: SkinSiteWikiReadPolicy
	editPolicy: SkinSiteWikiEditPolicy
	redirectTarget?: string | null
	canEdit: boolean
	watched: boolean
}

export interface SkinSiteWikiSettings {
	domains: string[]
	homePage: string
	defaultSkin: string
	maxPageUtf8Bytes: number
	maxAttachmentBytes: number
}

export interface SkinSiteWikiAuditInfo {
	id: number
	actorName: string
	action: string
	target?: string | null
	detail?: string | null
	createdAt: number
}

export interface SkinSiteWikiAuditPage {
	items: SkinSiteWikiAuditInfo[]
	nextCursor?: number | null
}

export function skinSiteWikiPage(path: string): Promise<SkinSiteResponse<SkinSiteWikiPageDetail>> {
	return skinSiteRequest<SkinSiteWikiPageDetail>('wiki/page?path=' + encodeURIComponent(path))
}

export function skinSiteWikiProtectPage(
	path: string,
	readPolicy: SkinSiteWikiReadPolicy,
	editPolicy: SkinSiteWikiEditPolicy,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('wiki/admin/protect', {
		method: 'POST',
		body: { path, readPolicy, editPolicy },
	})
}

export function skinSiteWikiSetHomePage(path: string): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('wiki/admin/homepage', { method: 'POST', body: { path } })
}

export function skinSiteWikiSetPageDeleted(
	path: string,
	deleted: boolean,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('wiki/admin/delete', {
		method: 'POST',
		body: { path, deleted },
	})
}

export function skinSiteWikiAudit(
	before?: number,
): Promise<SkinSiteResponse<SkinSiteWikiAuditPage>> {
	const suffix = before ? '?before=' + before : ''
	return skinSiteRequest<SkinSiteWikiAuditPage>('wiki/admin/audit' + suffix)
}

export function skinSiteWikiSettings(): Promise<SkinSiteResponse<SkinSiteWikiSettings>> {
	return skinSiteRequest<SkinSiteWikiSettings>('wiki/settings')
}

export function skinSiteWikiUpdateSettings(
	settings: Partial<SkinSiteWikiSettings>,
): Promise<SkinSiteResponse<SkinSiteWikiSettings>> {
	return skinSiteRequest<SkinSiteWikiSettings>('wiki/admin/settings', {
		method: 'POST',
		body: settings,
	})
}

export interface SkinSiteReviewPaperSummary {
	id: string
	enabled: boolean
	title: string
	annotation?: string | null
	mode: SkinSiteReviewMode
	passScore: number
	targetPermissions: string[]
	version: number
	questionCount: number
	totalScore: number
	updatedAt: number
	prerequisiteMode: 'ANY' | 'ALL'
	prerequisitePermissions: string[]
	eligible: boolean
}

export interface SkinSiteReviewMailConfig {
	enabled: boolean
	subject: string
	message: string
	includeInviteCode: boolean
	extraText: string
}

export interface SkinSiteReviewConfigData {
	preventDuplicate?: boolean
	mail?: SkinSiteReviewMailConfig
	id: string
	enabled: boolean
	title: string
	annotation?: string | null
	mode: SkinSiteReviewMode
	passScore: number
	targetPermissions: string[]
	version: number
	questions: SkinSiteReviewQuestion[]
	updatedAt: number
	prerequisiteMode: 'ANY' | 'ALL'
	prerequisitePermissions: string[]
}

export function skinSiteReviewPaperList(): Promise<SkinSiteResponse<SkinSiteReviewPaperSummary[]>> {
	return skinSiteRequest<SkinSiteReviewPaperSummary[]>('review/admin/papers')
}

export function skinSiteReviewPaperAdmin(
	paperId: string,
): Promise<SkinSiteResponse<SkinSiteReviewConfigData>> {
	return skinSiteRequest<SkinSiteReviewConfigData>(
		'review/admin/papers/' + encodeURIComponent(paperId),
	)
}

export function skinSiteCreateReviewPaperAdmin(
	data: SkinSiteReviewConfigData,
): Promise<SkinSiteResponse<SkinSiteReviewConfigData>> {
	return skinSiteRequest<SkinSiteReviewConfigData>('review/admin/papers', {
		method: 'POST',
		body: data,
	})
}

export function skinSiteUpdateReviewPaperAdmin(
	paperId: string,
	data: SkinSiteReviewConfigData,
): Promise<SkinSiteResponse<SkinSiteReviewConfigData>> {
	return skinSiteRequest<SkinSiteReviewConfigData>(
		'review/admin/papers/' + encodeURIComponent(paperId),
		{ method: 'PUT', body: data },
	)
}

export interface SkinSiteBotInfo {
	exists: boolean
	username?: string | null
	active: boolean
	creationBanned: boolean
	tokenHint?: string | null
	createdAt?: number | null
	updatedAt?: number | null
}

export interface SkinSiteUserFrequencyLimit {
	dropPercent?: number | null
}

export type SkinSiteUserAdminAuditAction =
	| 'USER_UPDATED'
	| 'USER_DELETED'
	| 'RATE_LIMIT_UPDATED'
	| 'BOT_USERNAME_UPDATED'
	| 'BOT_TOKEN_INVALIDATED'
	| 'BOT_CREATION_BANNED'
	| 'BOT_CREATION_UNBANNED'

export interface SkinSiteUserAdminAuditChange {
	field: string
	before?: string | null
	after?: string | null
}

export interface SkinSiteUserAdminAuditInfo {
	id: number
	actorUuid: string
	actorName: string
	targetUuid: string
	targetName: string
	action: SkinSiteUserAdminAuditAction
	changes: SkinSiteUserAdminAuditChange[]
	createdAt: number
}

export interface SkinSiteUserAdminAuditPage {
	items: SkinSiteUserAdminAuditInfo[]
	nextCursor?: number | null
}

export interface SkinSiteInviteCode {
	email: string
	code: string
}

export function skinSiteAdminBotInfo(userUuid: string): Promise<SkinSiteResponse<SkinSiteBotInfo>> {
	return skinSiteRequest<SkinSiteBotInfo>('admin/users/' + encodeURIComponent(userUuid) + '/bot')
}

export function skinSiteAdminRenameBot(
	userUuid: string,
	username: string,
): Promise<SkinSiteResponse<SkinSiteBotInfo>> {
	return skinSiteRequest<SkinSiteBotInfo>(
		'admin/users/' + encodeURIComponent(userUuid) + '/bot/username',
		{ method: 'POST', body: { username } },
	)
}

export function skinSiteAdminInvalidateBotToken(
	userUuid: string,
): Promise<SkinSiteResponse<SkinSiteBotInfo>> {
	return skinSiteRequest<SkinSiteBotInfo>(
		'admin/users/' + encodeURIComponent(userUuid) + '/bot/invalidate',
		{ method: 'POST' },
	)
}

export function skinSiteAdminSetBotCreationBanned(
	userUuid: string,
	banned: boolean,
): Promise<SkinSiteResponse<SkinSiteBotInfo>> {
	return skinSiteRequest<SkinSiteBotInfo>(
		'admin/users/' + encodeURIComponent(userUuid) + '/bot/ban',
		{ method: 'POST', body: { banned } },
	)
}

export function skinSiteAdminUpdateUserFrequencyLimit(
	userUuid: string,
	dropPercent: number | null,
): Promise<SkinSiteResponse<SkinSiteUserFrequencyLimit>> {
	return skinSiteRequest<SkinSiteUserFrequencyLimit>(
		'admin/users/' + encodeURIComponent(userUuid) + '/frequency-limit',
		{ method: 'POST', body: { dropPercent } },
	)
}

export function skinSiteAdminUserAudit(params?: {
	targetUuid?: string
	before?: number
}): Promise<SkinSiteResponse<SkinSiteUserAdminAuditPage>> {
	const query = new URLSearchParams()
	if (params?.targetUuid) query.set('targetUuid', params.targetUuid)
	if (params?.before) query.set('before', String(params.before))
	const suffix = query.size > 0 ? '?' + query.toString() : ''
	return skinSiteRequest<SkinSiteUserAdminAuditPage>('admin/users/audit' + suffix)
}

export function skinSiteAdminInviteUser(
	email: string,
): Promise<SkinSiteResponse<SkinSiteInviteCode>> {
	return skinSiteRequest<SkinSiteInviteCode>('admin/inviteCode', {
		method: 'POST',
		body: { email },
	})
}

export function skinSiteModHashFromFile(file: File): Promise<string> {
	return import('xxhash-wasm').then(async ({ default: xxhash }) => {
		const { create64 } = await xxhash()
		const hasher = create64()
		const reader = file.stream().getReader()
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			hasher.update(value)
		}
		const raw: bigint = hasher.digest()
		const mask = (1n << 64n) - 1n
		const v = raw & mask
		const signed = v >= 1n << 63n ? v - (1n << 64n) : v
		return signed.toString()
	})
}

export function skinSiteModExistsByHash(hash: string): Promise<SkinSiteResponse<unknown>> {
	return skinSiteRequest<unknown>('query/hash/' + encodeURIComponent(hash), { type: 'mod' })
}

export function skinSiteModExistsByName(modName: string): Promise<SkinSiteResponse<unknown>> {
	const q = new URLSearchParams({ mod_name: modName })
	return skinSiteRequest<unknown>('query/name?' + q.toString(), { type: 'mod' })
}

export async function skinSiteUploadMod(
	file: File,
	ruleTagIds: number[] = [],
	overwrite = false,
): Promise<SkinSiteResponse<string>> {
	const hash = await skinSiteModHashFromFile(file)
	const form = new FormData()
	form.append('mods', file, file.name)
	const query = new URLSearchParams()
	if (ruleTagIds.length) query.set('rule_tag_ids', ruleTagIds.join(','))
	if (overwrite) query.set('overwrite', 'true')
	const suffix = query.size ? '?' + query.toString() : ''
	return skinSiteRequest<string>('upload/' + hash + suffix, {
		method: 'POST',
		type: 'mod',
		form,
	})
}

export function skinSiteUpdateMultiModInfo(
	mods: SkinSiteModInfo[],
): Promise<SkinSiteResponse<SkinSiteModInfo[]>> {
	return skinSiteRequest<SkinSiteModInfo[]>('update/info/multi', {
		method: 'POST',
		type: 'mod',
		body: mods,
	})
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type SkinSiteChatRoomVisibility = 'PUBLIC' | 'PRIVATE'
export type SkinSiteChatRoomKind = 'STANDARD' | 'SETTLEMENT'
export type SkinSiteChatPrerequisiteMode = 'ANY' | 'ALL'

export interface SkinSiteChatRoomInfo {
	id: number
	name: string
	description: string
	visibility: SkinSiteChatRoomVisibility
	joined: boolean
	invited: boolean
	manager: boolean
	createdAt: number
	kind: SkinSiteChatRoomKind
	avatarAttachmentId?: number | null
	voiceEnabled: boolean
	voiceAvailable: boolean
	voiceParticipantCount: number
	voicePublisherCount: number
	voicePublisherLimit: number
	voiceParticipantLimit: number
	voiceListenerLimit: number
	prerequisiteMode: SkinSiteChatPrerequisiteMode
	prerequisitePermissions: string[]
	prerequisiteEligible: boolean
}

export interface SkinSiteChatUploadInfo {
	token: string
	attachment: {
		id: number
		kind: 'IMAGE' | 'FILE'
		name: string
		size: number
	}
}

export interface SkinSiteChatRoomCreateInput {
	name: string
	description: string
	visibility: SkinSiteChatRoomVisibility
	kind?: SkinSiteChatRoomKind
	prerequisiteMode: SkinSiteChatPrerequisiteMode
	prerequisitePermissions: string[]
}

export interface SkinSiteChatRoomUpdateInput {
	name: string
	description: string
	visibility: SkinSiteChatRoomVisibility
	prerequisiteMode: SkinSiteChatPrerequisiteMode
	prerequisitePermissions: string[]
}

export function skinSiteChatRoomList(): Promise<SkinSiteResponse<SkinSiteChatRoomInfo[]>> {
	return skinSiteRequest<SkinSiteChatRoomInfo[]>('chat/admin/rooms')
}

export function skinSiteChatRoomCreate(
	data: SkinSiteChatRoomCreateInput,
): Promise<SkinSiteResponse<SkinSiteChatRoomInfo>> {
	return skinSiteRequest<SkinSiteChatRoomInfo>('chat/admin/rooms', {
		method: 'POST',
		body: data,
	})
}

export function skinSiteChatRoomUpdate(
	id: number,
	data: SkinSiteChatRoomUpdateInput,
): Promise<SkinSiteResponse<SkinSiteChatRoomInfo>> {
	return skinSiteRequest<SkinSiteChatRoomInfo>('chat/rooms/' + id, {
		method: 'PUT',
		body: data,
	})
}

export function skinSiteChatRoomDelete(id: number): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('chat/admin/rooms/' + id, { method: 'DELETE' })
}

export function skinSiteChatRoomAvatarUpdate(
	roomId: number,
	data: { imageToken?: string; removeImage?: boolean },
): Promise<SkinSiteResponse<SkinSiteChatRoomInfo>> {
	return skinSiteRequest<SkinSiteChatRoomInfo>('chat/rooms/' + roomId + '/avatar', {
		method: 'PUT',
		body: data,
	})
}

export function skinSiteChatAttachmentUpload(
	file: File,
): Promise<SkinSiteResponse<SkinSiteChatUploadInfo>> {
	const form = new FormData()
	form.append('file', file, file.name)
	return skinSiteRequest<SkinSiteChatUploadInfo>('chat/attachments', {
		method: 'POST',
		form,
	})
}

export async function skinSiteChatRoomAvatarFetch(roomId: number): Promise<Blob | null> {
	const url = `${SKIN_SITE_ORIGIN}${REQUEST_TYPE_PATH.starlight}/chat/rooms/${roomId}/avatar`
	const headers: Record<string, string> = { Accept: 'image/*' }
	const token = getSkinSiteToken()
	if (token) headers['Authorization'] = `Bearer ${token}`
	try {
		const response = await tauriFetch(url, { method: 'GET', headers })
		if (!response.ok) return null
		const type = response.headers.get('content-type') ?? ''
		if (type.includes('application/json') || type.includes('text/')) return null
		return await response.blob()
	} catch {
		return null
	}
}

export interface SkinSiteChatUserInfo {
	uuid: string
	id: number
	username: string
	avatar?: string | null
	email: string
	qq?: number | null
	permissions: string[]
	banned: boolean
	registerTime: number
}

export interface SkinSiteChatAuditInfo {
	id: number
	actorUuid: string
	actorName?: string
	action: string
	target?: string | null
	createdAt: number
}

export function skinSiteChatUserSearch(
	keyword: string,
	roomId?: number,
	searchBy: 'user' | 'player' = 'user',
): Promise<SkinSiteResponse<SkinSiteChatUserInfo[]>> {
	const query = new URLSearchParams({ keyword })
	if (roomId !== undefined) query.set('room_id', String(roomId))
	if (searchBy === 'player') query.set('search_by', 'player')
	return skinSiteRequest<SkinSiteChatUserInfo[]>('chat/users/search?' + query.toString())
}

export function skinSiteChatManagerSet(
	roomId: number,
	userUuid: string,
	manager: boolean,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('chat/admin/rooms/' + roomId + '/manager', {
		method: 'POST',
		body: { userUuid, manager },
	})
}

export function skinSiteChatSettlementOwnerAssign(
	roomId: number,
	userUuid: string,
): Promise<SkinSiteResponse<string>> {
	return skinSiteRequest<string>('chat/settlements/' + roomId + '/owner', {
		method: 'POST',
		body: { userUuid },
	})
}

export function skinSiteChatAuditList(
	roomId: number,
): Promise<SkinSiteResponse<SkinSiteChatAuditInfo[]>> {
	return skinSiteRequest<SkinSiteChatAuditInfo[]>('chat/rooms/' + roomId + '/audit')
}

export type SkinSiteChatVoiceRuntimeState =
	| 'DISABLED'
	| 'NOT_INSTALLED'
	| 'DOWNLOADING'
	| 'VERIFYING'
	| 'EXTRACTING'
	| 'STARTING'
	| 'READY'
	| 'FAILED'
	| 'UNSUPPORTED_PLATFORM'

export interface SkinSiteChatVoiceRuntimeInfo {
	state: SkinSiteChatVoiceRuntimeState
	version: string
	progress?: number | null
	message?: string | null
	retryCount: number
	publicUrl?: string | null
}

export interface SkinSiteChatVoiceGlobalConfig {
	enabled: boolean
	runtimePath: string
	mirrorBaseUrl: string
	publicUrl: string
	bindAddress: string
	signalPort: number
	rtcTcpPort: number
	rtcUdpPort: number
	startupTimeoutSeconds: number
	useExternalIp: boolean
	nodeIp: string
}

export interface SkinSiteChatVoiceGlobalConfigUpdateResult {
	config: SkinSiteChatVoiceGlobalConfig
	runtime: SkinSiteChatVoiceRuntimeInfo
	restarted: boolean
}

export interface SkinSiteChatVoiceLogEntry {
	id: number
	timestamp: number
	message: string
}

export interface SkinSiteChatVoiceLogPage {
	entries: SkinSiteChatVoiceLogEntry[]
	latestId: number
}

export interface SkinSiteChatVoiceRoomInfo {
	roomId: number
	enabled: boolean
	available: boolean
	publisherLimit: number
	participantLimit: number
	listenerLimit: number
	participantCount: number
	publisherCount: number
	listenerCount: number
	joined: boolean
	observer: boolean
	muted: boolean
	bannedUntil?: number | null
}

export function skinSiteChatVoiceRuntime(): Promise<
	SkinSiteResponse<SkinSiteChatVoiceRuntimeInfo>
> {
	return skinSiteRequest<SkinSiteChatVoiceRuntimeInfo>('chat/voice/admin/runtime')
}

export function skinSiteChatVoiceRuntimeRetry(): Promise<
	SkinSiteResponse<SkinSiteChatVoiceRuntimeInfo>
> {
	return skinSiteRequest<SkinSiteChatVoiceRuntimeInfo>('chat/voice/admin/runtime/retry', {
		method: 'POST',
	})
}

export function skinSiteChatVoiceConfig(): Promise<
	SkinSiteResponse<SkinSiteChatVoiceGlobalConfig>
> {
	return skinSiteRequest<SkinSiteChatVoiceGlobalConfig>('chat/voice/admin/config')
}

export function skinSiteChatVoiceConfigUpdate(
	data: SkinSiteChatVoiceGlobalConfig,
): Promise<SkinSiteResponse<SkinSiteChatVoiceGlobalConfigUpdateResult>> {
	return skinSiteRequest<SkinSiteChatVoiceGlobalConfigUpdateResult>('chat/voice/admin/config', {
		method: 'PUT',
		body: data,
	})
}

export function skinSiteChatVoiceLogs(
	after?: number,
	limit = 300,
): Promise<SkinSiteResponse<SkinSiteChatVoiceLogPage>> {
	const query = new URLSearchParams({ limit: String(limit) })
	if (after !== undefined) query.set('after', String(after))
	return skinSiteRequest<SkinSiteChatVoiceLogPage>('chat/voice/admin/logs?' + query.toString())
}

export function skinSiteChatVoiceCapacityUpdate(
	roomId: number,
	data: { participantLimit: number; listenerLimit: number },
): Promise<SkinSiteResponse<SkinSiteChatVoiceRoomInfo>> {
	return skinSiteRequest<SkinSiteChatVoiceRoomInfo>(
		'chat/admin/rooms/' + roomId + '/voice/capacity',
		{ method: 'PUT', body: data },
	)
}

// ---------------------------------------------------------------------------
// Wiki migration
// ---------------------------------------------------------------------------

export type SkinSiteWikiMigrationState =
	| 'IMPORTING'
	| 'REVIEW'
	| 'PUBLISHING'
	| 'PUBLISHED'
	| 'FAILED'
	| 'ROLLED_BACK'

export type SkinSiteWikiMigrationDecision = 'PENDING' | 'IMPORT' | 'EXCLUDE'

export interface SkinSiteWikiMigrationJobInfo {
	id: number
	source: string
	state: SkinSiteWikiMigrationState
	total: number
	reviewed: number
	imported: number
	excluded: number
	error?: string | null
	missingAttachmentCount?: number
}

export interface SkinSiteWikiMigrationCandidate {
	id: number
	title: string
	lastUpdatedAt: number
	maintainerCount: number
	suspiciousReasons: string[]
	decision: SkinSiteWikiMigrationDecision
	conflict: boolean
}

export interface SkinSiteWikiMigrationPage {
	items: SkinSiteWikiMigrationCandidate[]
	nextCursor?: number | null
}

export interface SkinSiteWikiMigrationPublishResult {
	imported: number
	overwritten: number
}

export interface SkinSiteWikiAutomaticMigrationInput {
	apiUrl: string
	username?: string | null
	password?: string | null
	allowPrivateAddress: boolean
	rules: {
		staleDays: number
		maintainerWindowDays: number
		maximumMaintainers: number
		staleMarkers: string[]
	}
}

export function skinSiteWikiMigrationJobs(): Promise<
	SkinSiteResponse<SkinSiteWikiMigrationJobInfo[]>
> {
	return skinSiteRequest<SkinSiteWikiMigrationJobInfo[]>('wiki/admin/migration')
}

export function skinSiteWikiMigrationStartAutomatic(
	data: SkinSiteWikiAutomaticMigrationInput,
): Promise<SkinSiteResponse<SkinSiteWikiMigrationJobInfo>> {
	return skinSiteRequest<SkinSiteWikiMigrationJobInfo>('wiki/admin/migration/automatic', {
		method: 'POST',
		body: data,
	})
}

export function skinSiteWikiMigrationStartXml(
	file: File,
): Promise<SkinSiteResponse<SkinSiteWikiMigrationJobInfo>> {
	const form = new FormData()
	form.append('xml', file, file.name)
	return skinSiteRequest<SkinSiteWikiMigrationJobInfo>('wiki/admin/migration/xml', {
		method: 'POST',
		form,
	})
}

export function skinSiteWikiMigrationCandidates(
	jobId: number,
	after?: number,
): Promise<SkinSiteResponse<SkinSiteWikiMigrationPage>> {
	const suffix = after ? '?after=' + after : ''
	return skinSiteRequest<SkinSiteWikiMigrationPage>(
		'wiki/admin/migration/' + jobId + '/candidates' + suffix,
	)
}

export function skinSiteWikiMigrationDecide(
	candidateId: number,
	data: {
		decision: SkinSiteWikiMigrationDecision
		targetTitle?: string | null
		overwrite?: boolean
	},
): Promise<SkinSiteResponse<void>> {
	return skinSiteRequest<void>('wiki/admin/migration/candidates/' + candidateId, {
		method: 'POST',
		body: data,
	})
}

export function skinSiteWikiMigrationPublish(
	jobId: number,
): Promise<SkinSiteResponse<SkinSiteWikiMigrationPublishResult>> {
	return skinSiteRequest<SkinSiteWikiMigrationPublishResult>(
		'wiki/admin/migration/' + jobId + '/publish',
		{ method: 'POST' },
	)
}

export function skinSiteWikiMigrationRollback(jobId: number): Promise<SkinSiteResponse<void>> {
	return skinSiteRequest<void>('wiki/admin/migration/' + jobId + '/rollback', {
		method: 'POST',
	})
}

export function skinSiteWikiMigrationDelete(jobId: number): Promise<SkinSiteResponse<void>> {
	return skinSiteRequest<void>('wiki/admin/migration/' + jobId, { method: 'DELETE' })
}

export function skinSiteWikiAttachment(
	name: string,
): Promise<SkinSiteResponse<SkinSiteWikiAttachmentInfo>> {
	return skinSiteRequest<SkinSiteWikiAttachmentInfo>(
		'wiki/attachment?name=' + encodeURIComponent(name),
	)
}

export function skinSiteWikiAttachmentUrl(id: number): string {
	return `${SKIN_SITE_ORIGIN}${REQUEST_TYPE_PATH.starlight}/wiki/attachment/${id}/content`
}

export interface SkinSiteWikiRevisionInfo {
	id: number
	authorName: string
	summary: string
	minor: boolean
	createdAt: number
	sourceWiki?: string | null
	sourceRevisionId?: number | null
}

export interface SkinSiteWikiRevisionPage {
	items: SkinSiteWikiRevisionInfo[]
	nextCursor?: number | null
}

export interface SkinSiteWikiRevisionDetail {
	revision: SkinSiteWikiRevisionInfo
	source: string
	nodes: SkinSiteWikiNode[]
}

export interface SkinSiteWikiDiffLine {
	type: 'UNCHANGED' | 'REMOVED' | 'ADDED'
	oldLine?: number | null
	newLine?: number | null
	text: string
}

export function skinSiteWikiHistory(
	title: string,
	before?: number,
): Promise<SkinSiteResponse<SkinSiteWikiRevisionPage>> {
	const query = new URLSearchParams({ title })
	if (before) query.set('before', String(before))
	return skinSiteRequest<SkinSiteWikiRevisionPage>('wiki/history?' + query.toString())
}

export function skinSiteWikiRevision(
	title: string,
	revisionId: number,
): Promise<SkinSiteResponse<SkinSiteWikiRevisionDetail>> {
	return skinSiteRequest<SkinSiteWikiRevisionDetail>(
		'wiki/revision/' + revisionId + '?title=' + encodeURIComponent(title),
	)
}

export function skinSiteWikiDiff(
	title: string,
	older: number,
	newer: number,
): Promise<SkinSiteResponse<SkinSiteWikiDiffLine[]>> {
	const query = new URLSearchParams({ title, older: String(older), newer: String(newer) })
	return skinSiteRequest<SkinSiteWikiDiffLine[]>('wiki/diff?' + query.toString())
}

export function skinSiteWikiRevert(data: {
	title: string
	revisionId: number
	baseRevisionId: number
}): Promise<SkinSiteResponse<SkinSiteWikiPageDetail>> {
	return skinSiteRequest<SkinSiteWikiPageDetail>('wiki/revert', {
		method: 'POST',
		body: data,
	})
}
// ─── Wiki: 搜索 / 列表 / 最近 / 分类 ───────────────────────────────────────

export interface SkinSiteWikiPageSummary {
	title: string
	updatedAt: number
	authorName: string
	readPolicy: SkinSiteWikiReadPolicy
	editPolicy: SkinSiteWikiEditPolicy
	redirectTarget?: string | null
}

export interface SkinSiteWikiPageListItem {
	id: number
	title: string
	namespace: string
	revisionId: number
	updatedAt: number
	authorName: string
	readPolicy: SkinSiteWikiReadPolicy
	editPolicy: SkinSiteWikiEditPolicy
	redirectTarget?: string | null
}

export interface SkinSiteWikiPageList {
	items: SkinSiteWikiPageListItem[]
	nextCursor?: string | null
}

export interface SkinSiteWikiSearchPage {
	items: SkinSiteWikiPageSummary[]
	nextCursor?: number | null
}

export function skinSiteWikiSearch(
	query: string,
): Promise<SkinSiteResponse<SkinSiteWikiPageSummary[]>> {
	const q = query.trim()
	if (!q) {
		return Promise.resolve({
			success: true,
			payload: [],
			timestamp: Date.now(),
		} as SkinSiteResponse<SkinSiteWikiPageSummary[]>)
	}
	return skinSiteRequest<SkinSiteWikiPageSummary[]>('wiki/search?q=' + encodeURIComponent(q))
}

export function skinSiteWikiPages(
	params: {
		prefix?: string
		namespace?: string
		limit?: number
		cursor?: string
	} = {},
): Promise<SkinSiteResponse<SkinSiteWikiPageList>> {
	const query = new URLSearchParams()
	if (params.prefix) query.set('prefix', params.prefix)
	if (params.namespace != null) query.set('namespace', params.namespace)
	if (params.limit != null) query.set('limit', String(params.limit))
	if (params.cursor) query.set('cursor', params.cursor)
	return skinSiteRequest<SkinSiteWikiPageList>('wiki/pages?' + query.toString())
}

export function skinSiteWikiRecent(
	before?: number,
): Promise<SkinSiteResponse<SkinSiteWikiSearchPage>> {
	const query = new URLSearchParams()
	if (before != null) query.set('before', String(before))
	return skinSiteRequest<SkinSiteWikiSearchPage>('wiki/recent?' + query.toString())
}

export function skinSiteWikiCategory(
	name: string,
	before?: number,
): Promise<SkinSiteResponse<SkinSiteWikiSearchPage>> {
	const query = new URLSearchParams({ name })
	if (before != null) query.set('before', String(before))
	return skinSiteRequest<SkinSiteWikiSearchPage>('wiki/category?' + query.toString())
}
// ─── Wiki: 移动 / 关注 / 设首页 ─────────────────────────────────────────

export function skinSiteWikiMove(data: {
	title: string
	targetTitle: string
	leaveRedirect?: boolean
}): Promise<SkinSiteResponse<SkinSiteWikiPageDetail>> {
	return skinSiteRequest<SkinSiteWikiPageDetail>('wiki/move', {
		method: 'POST',
		body: data,
	})
}

export function skinSiteWikiWatch(
	title: string,
	watched: boolean,
): Promise<SkinSiteResponse<boolean>> {
	return skinSiteRequest<boolean>('wiki/watch', {
		method: 'POST',
		body: { title, watched },
	})
}
