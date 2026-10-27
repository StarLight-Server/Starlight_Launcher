<script setup lang="ts">
import { SpinnerIcon } from '@modrinth/assets'
import { defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { computed, onMounted, ref } from 'vue'

import {
	skinSiteAdminBotInfo,
	skinSiteAdminDeleteUser,
	skinSiteAdminInvalidateBotToken,
	skinSiteAdminInviteUser,
	type SkinSiteAdminPlayer,
	skinSiteAdminRenameBot,
	skinSiteAdminSetBotCreationBanned,
	skinSiteAdminUpdateUser,
	skinSiteAdminUpdateUserFrequencyLimit,
	type SkinSiteAdminUser,
	skinSiteAdminUserAudit,
	skinSiteAdminUserCount,
	skinSiteAdminUserFrequencyLimit,
	skinSiteAdminUserList,
	skinSiteAdminUserPlayers,
	type SkinSiteBotInfo,
	type SkinSiteUserAdminAuditInfo,
	type SkinSiteUserFrequencyLimit,
} from '@/helpers/skin-site-api'

const { formatMessage } = useVIntl()
const { handleError, addNotification } = injectNotificationManager()

const messages = defineMessages({
	title: { id: 'app.skin-site.admin.users.title', defaultMessage: 'Users' },
	loading: { id: 'app.skin-site.admin.users.loading', defaultMessage: 'Loading…' },
	failed: { id: 'app.skin-site.admin.users.failed', defaultMessage: 'Could not load users.' },
	empty: { id: 'app.skin-site.admin.users.empty', defaultMessage: 'No users found.' },
	search: { id: 'app.skin-site.admin.users.search', defaultMessage: 'Search' },
	searchName: { id: 'app.skin-site.admin.users.search-name', defaultMessage: 'Username' },
	searchEmail: { id: 'app.skin-site.admin.users.search-email', defaultMessage: 'Email' },
	searchUuid: { id: 'app.skin-site.admin.users.search-uuid', defaultMessage: 'UUID' },
	total: { id: 'app.skin-site.admin.users.total', defaultMessage: '{count} users' },
	prev: { id: 'app.skin-site.admin.users.prev', defaultMessage: 'Previous' },
	next: { id: 'app.skin-site.admin.users.next', defaultMessage: 'Next' },
	page: { id: 'app.skin-site.admin.users.page', defaultMessage: 'Page {page}' },
	edit: { id: 'app.skin-site.admin.users.edit', defaultMessage: 'Edit' },
	save: { id: 'app.skin-site.admin.users.save', defaultMessage: 'Save' },
	cancel: { id: 'app.skin-site.admin.users.cancel', defaultMessage: 'Cancel' },
	remove: { id: 'app.skin-site.admin.users.remove', defaultMessage: 'Delete' },
	players: { id: 'app.skin-site.admin.users.players', defaultMessage: 'Players' },
	updated: { id: 'app.skin-site.admin.users.updated', defaultMessage: 'User updated.' },
	deleted: { id: 'app.skin-site.admin.users.deleted', defaultMessage: 'User deleted.' },
	username: { id: 'app.skin-site.admin.users.username', defaultMessage: 'Username' },
	email: { id: 'app.skin-site.admin.users.email', defaultMessage: 'Email' },
	qq: { id: 'app.skin-site.admin.users.qq', defaultMessage: 'QQ' },
	password: { id: 'app.skin-site.admin.users.password', defaultMessage: 'New password' },
	passwordHint: {
		id: 'app.skin-site.admin.users.password-hint',
		defaultMessage: 'Leave empty to keep the current password.',
	},
	banned: { id: 'app.skin-site.admin.users.banned', defaultMessage: 'Banned' },
	permissions: { id: 'app.skin-site.admin.users.permissions', defaultMessage: 'Permissions' },
	permissionGroups: {
		id: 'app.skin-site.admin.users.permission-groups',
		defaultMessage: 'Groups',
	},
	permissionsHint: {
		id: 'app.skin-site.admin.users.permissions-hint',
		defaultMessage: 'Comma separated, e.g. WEB_ADMIN, SERVER_ADMIN.',
	},
	noPlayers: { id: 'app.skin-site.admin.users.no-players', defaultMessage: 'No linked players.' },
	registered: { id: 'app.skin-site.admin.users.registered', defaultMessage: 'Registered' },
	bot: { id: 'app.skin-site.admin.users.bot', defaultMessage: 'Bot' },
	botTitle: { id: 'app.skin-site.admin.users.bot-title', defaultMessage: 'Bot management' },
	botExists: { id: 'app.skin-site.admin.users.bot-exists', defaultMessage: 'Bot created' },
	botNotExists: { id: 'app.skin-site.admin.users.bot-not-exists', defaultMessage: 'No bot yet' },
	botActive: { id: 'app.skin-site.admin.users.bot-active', defaultMessage: 'Token valid' },
	botInactive: {
		id: 'app.skin-site.admin.users.bot-inactive',
		defaultMessage: 'Token invalidated',
	},
	botCreationBanned: {
		id: 'app.skin-site.admin.users.bot-creation-banned',
		defaultMessage: 'Token creation banned',
	},
	botUsername: {
		id: 'app.skin-site.admin.users.bot-username',
		defaultMessage: 'Bot username',
	},
	botSaveUsername: {
		id: 'app.skin-site.admin.users.bot-save-username',
		defaultMessage: 'Save bot username',
	},
	botTokenHint: {
		id: 'app.skin-site.admin.users.bot-token-hint',
		defaultMessage: 'Token hint',
	},
	botInvalidate: {
		id: 'app.skin-site.admin.users.bot-invalidate',
		defaultMessage: 'Invalidate token',
	},
	botBan: { id: 'app.skin-site.admin.users.bot-ban', defaultMessage: 'Ban bot creation' },
	botUnban: { id: 'app.skin-site.admin.users.bot-unban', defaultMessage: 'Unban bot creation' },
	frequency: { id: 'app.skin-site.admin.users.frequency', defaultMessage: 'Rate limit' },
	frequencyTitle: {
		id: 'app.skin-site.admin.users.frequency-title',
		defaultMessage: 'Rate limit',
	},
	frequencyHint: {
		id: 'app.skin-site.admin.users.frequency-hint',
		defaultMessage: 'Packets from this user will be dropped at the given rate.',
	},
	frequencyNone: {
		id: 'app.skin-site.admin.users.frequency-none',
		defaultMessage: 'Not enabled',
	},
	frequencyCurrent: {
		id: 'app.skin-site.admin.users.frequency-current',
		defaultMessage: 'Currently {percent}%',
	},
	frequencyRange: {
		id: 'app.skin-site.admin.users.frequency-range',
		defaultMessage: 'Only integer values from 10% to 100% are allowed.',
	},
	frequencySave: {
		id: 'app.skin-site.admin.users.frequency-save',
		defaultMessage: 'Save limit',
	},
	frequencyClear: {
		id: 'app.skin-site.admin.users.frequency-clear',
		defaultMessage: 'Clear limit',
	},
	audit: { id: 'app.skin-site.admin.users.audit', defaultMessage: 'Audit' },
	auditTitle: {
		id: 'app.skin-site.admin.users.audit-title',
		defaultMessage: 'User management audit',
	},
	auditEmpty: {
		id: 'app.skin-site.admin.users.audit-empty',
		defaultMessage: 'No audit records yet.',
	},
	auditMore: { id: 'app.skin-site.admin.users.audit-more', defaultMessage: 'Load earlier' },
	invite: { id: 'app.skin-site.admin.users.invite', defaultMessage: 'Invite user' },
	inviteTitle: { id: 'app.skin-site.admin.users.invite-title', defaultMessage: 'Invite user' },
	inviteEmail: { id: 'app.skin-site.admin.users.invite-email', defaultMessage: 'Email' },
	inviteGenerate: {
		id: 'app.skin-site.admin.users.invite-generate',
		defaultMessage: 'Generate invite code',
	},
	inviteCopy: { id: 'app.skin-site.admin.users.invite-copy', defaultMessage: 'Copy' },
	inviteCopied: {
		id: 'app.skin-site.admin.users.invite-copied',
		defaultMessage: 'Invite code copied.',
	},
	inviteEmailInvalid: {
		id: 'app.skin-site.admin.users.invite-email-invalid',
		defaultMessage: 'Enter a valid email address.',
	},
	boundPlayersTitle: {
		id: 'app.skin-site.admin.users.bound-players-title',
		defaultMessage: 'Linked players',
	},
	legacyAdapted: {
		id: 'app.skin-site.admin.users.legacy-adapted',
		defaultMessage: 'Legacy internal adapted',
	},
	registeredAt: {
		id: 'app.skin-site.admin.users.registered-at',
		defaultMessage: 'Registered at',
	},
	status: { id: 'app.skin-site.admin.users.status', defaultMessage: 'Status' },
	statusNormal: { id: 'app.skin-site.admin.users.status-normal', defaultMessage: 'Normal' },
	statusBanned: { id: 'app.skin-site.admin.users.status-banned', defaultMessage: 'Banned' },
	actions: { id: 'app.skin-site.admin.users.actions', defaultMessage: 'Actions' },
})

const PAGE_SIZE = 20

const items = ref<SkinSiteAdminUser[]>([])
const total = ref(0)
const offset = ref(0)
const loading = ref(true)
const failed = ref(false)

const keyword = ref('')
const searchField = ref<'username' | 'email' | 'uuid'>('username')

const editingUuid = ref<string | null>(null)
const editForm = ref({
	username: '',
	email: '',
	qq: '',
	password: '',
	banned: false,
	permissions: '',
})
const saving = ref(false)
const deletingUuid = ref<string | null>(null)

const playersFor = ref<SkinSiteAdminPlayer[] | null>(null)
const playersLoading = ref(false)
const playersTarget = ref<SkinSiteAdminUser | null>(null)

const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const hasPrev = computed(() => offset.value > 0)
const hasNext = computed(() => offset.value + PAGE_SIZE < total.value)

// ---------- bot ----------
const botTarget = ref<SkinSiteAdminUser | null>(null)
const botInfo = ref<SkinSiteBotInfo | null>(null)
const botLoading = ref(false)
const botBusy = ref(false)
const botUsername = ref('')
const validBotUsername = computed(() => {
	const name = botUsername.value.trim()
	return name.length >= 2 && name.length <= 32
})

function openBot(user: SkinSiteAdminUser) {
	botTarget.value = user
	botInfo.value = null
	botUsername.value = ''
	botLoading.value = true
	skinSiteAdminBotInfo(user.uuid)
		.then((res) => {
			if (!res.success) throw new Error(res.errorMessage)
			botInfo.value = res.payload
			botUsername.value = res.payload.username ?? ''
		})
		.catch(handleError)
		.finally(() => {
			botLoading.value = false
		})
}

function closeBot() {
	botTarget.value = null
	botInfo.value = null
}

async function saveBotUsername() {
	if (!botTarget.value || !validBotUsername.value) return
	botBusy.value = true
	try {
		const res = await skinSiteAdminRenameBot(botTarget.value.uuid, botUsername.value.trim())
		if (!res.success) throw new Error(res.errorMessage)
		botInfo.value = res.payload
		botUsername.value = res.payload.username ?? ''
	} catch (error) {
		handleError(error)
	} finally {
		botBusy.value = false
	}
}

async function invalidateBot() {
	if (!botTarget.value) return
	botBusy.value = true
	try {
		const res = await skinSiteAdminInvalidateBotToken(botTarget.value.uuid)
		if (!res.success) throw new Error(res.errorMessage)
		botInfo.value = res.payload
	} catch (error) {
		handleError(error)
	} finally {
		botBusy.value = false
	}
}

async function toggleBotCreationBan() {
	if (!botTarget.value || !botInfo.value) return
	botBusy.value = true
	try {
		const res = await skinSiteAdminSetBotCreationBanned(
			botTarget.value.uuid,
			!botInfo.value.creationBanned,
		)
		if (!res.success) throw new Error(res.errorMessage)
		botInfo.value = res.payload
	} catch (error) {
		handleError(error)
	} finally {
		botBusy.value = false
	}
}

// ---------- frequency ----------
const frequencyTarget = ref<SkinSiteAdminUser | null>(null)
const frequencyLoading = ref(false)
const frequencyBusy = ref(false)
const frequencyCurrent = ref<SkinSiteUserFrequencyLimit | null>(null)
const frequencyPercent = ref(50)

const validFrequency = computed(
	() =>
		Number.isInteger(frequencyPercent.value) &&
		frequencyPercent.value >= 10 &&
		frequencyPercent.value <= 100,
)
const currentFrequencyLimit = computed(() => frequencyCurrent.value?.dropPercent ?? null)

function openFrequency(user: SkinSiteAdminUser) {
	frequencyTarget.value = user
	frequencyCurrent.value = null
	frequencyPercent.value = 50
	frequencyLoading.value = true
	skinSiteAdminUserFrequencyLimit(user.uuid)
		.then((res) => {
			if (!res.success) throw new Error(res.errorMessage)
			frequencyCurrent.value = res.payload
			frequencyPercent.value = res.payload.dropPercent ?? 50
		})
		.catch(handleError)
		.finally(() => {
			frequencyLoading.value = false
		})
}

function closeFrequency() {
	frequencyTarget.value = null
	frequencyCurrent.value = null
}

async function saveFrequency() {
	if (!frequencyTarget.value || !validFrequency.value) return
	frequencyBusy.value = true
	try {
		const res = await skinSiteAdminUpdateUserFrequencyLimit(
			frequencyTarget.value.uuid,
			frequencyPercent.value,
		)
		if (!res.success) throw new Error(res.errorMessage)
		frequencyCurrent.value = res.payload
	} catch (error) {
		handleError(error)
	} finally {
		frequencyBusy.value = false
	}
}

async function clearFrequency() {
	if (!frequencyTarget.value) return
	frequencyBusy.value = true
	try {
		const res = await skinSiteAdminUpdateUserFrequencyLimit(frequencyTarget.value.uuid, null)
		if (!res.success) throw new Error(res.errorMessage)
		frequencyCurrent.value = res.payload
	} catch (error) {
		handleError(error)
	} finally {
		frequencyBusy.value = false
	}
}

// ---------- audit ----------
const auditTarget = ref<SkinSiteAdminUser | null>(null)
const auditItems = ref<SkinSiteUserAdminAuditInfo[]>([])
const auditLoading = ref(false)
const auditNextCursor = ref<number | null>(null)

const AUDIT_ACTION_LABELS: Record<string, string> = {
	USER_UPDATED: 'user-updated',
	USER_DELETED: 'user-deleted',
	RATE_LIMIT_UPDATED: 'rate-limit-updated',
	BOT_USERNAME_UPDATED: 'bot-username-updated',
	BOT_TOKEN_INVALIDATED: 'bot-token-invalidated',
	BOT_CREATION_BANNED: 'bot-creation-banned',
	BOT_CREATION_UNBANNED: 'bot-creation-unbanned',
}

function auditActionLabel(action: string) {
	return formatMessage({
		id: 'app.skin-site.admin.users.audit-action.' + (AUDIT_ACTION_LABELS[action] ?? 'unknown'),
		defaultMessage: action,
	})
}

function auditFieldLabel(field: string) {
	return formatMessage({
		id: 'app.skin-site.admin.users.audit-field.' + field,
		defaultMessage: field,
	})
}

function auditValue(value?: string | null) {
	if (value === null || value === undefined || value === '') return '—'
	return value
}

async function loadAudit(reset = false) {
	auditLoading.value = true
	if (reset) {
		auditItems.value = []
		auditNextCursor.value = null
	}
	try {
		const res = await skinSiteAdminUserAudit({
			targetUuid: auditTarget.value?.uuid,
			before: auditNextCursor.value ?? undefined,
		})
		if (!res.success) throw new Error(res.errorMessage)
		auditItems.value = reset ? res.payload.items : [...auditItems.value, ...res.payload.items]
		auditNextCursor.value = res.payload.nextCursor ?? null
	} catch (error) {
		handleError(error)
	} finally {
		auditLoading.value = false
	}
}

function openAudit(user?: SkinSiteAdminUser) {
	auditTarget.value = user ?? null
	void loadAudit(true)
}

function closeAudit() {
	auditTarget.value = null
	auditItems.value = []
	auditNextCursor.value = null
}

function loadMoreAudit() {
	if (auditLoading.value) return
	void loadAudit(false)
}

// ---------- invite ----------
const inviteOpen = ref(false)
const inviteEmail = ref('')
const inviteCode = ref('')
const inviteBusy = ref(false)
const inviteEmailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.value))

function openInvite() {
	inviteOpen.value = true
	inviteEmail.value = ''
	inviteCode.value = ''
}

function closeInvite() {
	inviteOpen.value = false
}

async function generateInvite() {
	if (!inviteEmailValid.value) {
		addNotification({ type: 'error', title: formatMessage(messages.inviteEmailInvalid) })
		return
	}
	inviteBusy.value = true
	try {
		const res = await skinSiteAdminInviteUser(inviteEmail.value.trim())
		if (!res.success) throw new Error(res.errorMessage)
		inviteCode.value = res.payload.code
	} catch (error) {
		handleError(error)
	} finally {
		inviteBusy.value = false
	}
}

async function copyInvite() {
	if (!inviteCode.value) return
	try {
		await navigator.clipboard.writeText(inviteCode.value)
		addNotification({ type: 'success', title: formatMessage(messages.inviteCopied) })
	} catch (error) {
		handleError(error)
	}
}

// ---------- list ----------
function formatDateTime(ts?: number | null): string {
	if (!ts) return '—'
	try {
		return new Date(ts).toLocaleString()
	} catch {
		return '—'
	}
}

async function load(reset = false) {
	if (reset) offset.value = 0
	loading.value = true
	failed.value = false
	try {
		const listRes = await skinSiteAdminUserList({
			keyword: keyword.value.trim() || undefined,
			searchField: searchField.value,
			limit: PAGE_SIZE,
			offset: offset.value,
		})
		if (!listRes.success) throw new Error(listRes.errorMessage)
		items.value = listRes.payload ?? []
		const countRes = await skinSiteAdminUserCount({
			keyword: keyword.value.trim() || undefined,
			searchField: searchField.value,
		})
		if (countRes.success && typeof countRes.payload === 'number') total.value = countRes.payload
	} catch (error) {
		failed.value = true
		handleError(error)
	} finally {
		loading.value = false
	}
}

function search() {
	void load(true)
}

async function prevPage() {
	if (!hasPrev.value) return
	offset.value = Math.max(0, offset.value - PAGE_SIZE)
	await load()
}

async function nextPage() {
	if (!hasNext.value) return
	offset.value += PAGE_SIZE
	await load()
}

const PERMISSION_META: Record<string, { label: string; color: string }> = {
	GUEST: { label: '游客', color: 'bg-button-bg text-secondary' },
	EXTERNAL_MEMBER: { label: 'Mod服玩家', color: 'bg-blue text-contrast' },
	INTERNAL_MEMBER: { label: '原版服玩家', color: 'bg-orange text-contrast' },
	SENIOR_MEMBER: { label: '老资历', color: 'bg-purple text-contrast' },
	SPONSOR: { label: '捐赠者', color: 'bg-yellow text-contrast' },
	SERVER_ADMIN: { label: '服务器管理', color: 'bg-green text-contrast' },
	WEB_ADMIN: { label: 'Web 管理', color: 'bg-brand text-contrast' },
	DEVELOPER: { label: '开发者', color: 'bg-red text-contrast' },
}

function permissionMeta(perm: string) {
	return PERMISSION_META[perm] ?? { label: perm, color: 'bg-button-bg text-secondary' }
}

function startEdit(user: SkinSiteAdminUser) {
	editingUuid.value = user.uuid
	editForm.value = {
		username: user.username,
		email: user.email,
		qq: user.qq !== null && user.qq !== undefined ? String(user.qq) : '',
		password: '',
		banned: user.banned,
		permissions: (user.permissions ?? []).join(', '),
	}
}

function cancelEdit() {
	editingUuid.value = null
}

async function saveEdit() {
	if (!editingUuid.value || saving.value) return
	saving.value = true
	try {
		const target = items.value.find((u) => u.uuid === editingUuid.value)
		if (!target) throw new Error('user not found')
		const res = await skinSiteAdminUpdateUser({
			uuid: target.uuid,
			username: editForm.value.username.trim(),
			email: editForm.value.email.trim(),
			password: editForm.value.password.trim() || undefined,
			qq: editForm.value.qq.trim() ? Number(editForm.value.qq.trim()) : undefined,
			banned: editForm.value.banned,
			permissions: editForm.value.permissions
				.split(',')
				.map((p) => p.trim())
				.filter(Boolean),
		})
		if (!res.success) throw new Error(res.errorMessage)
		addNotification({ type: 'success', title: formatMessage(messages.updated) })
		editingUuid.value = null
		await load()
	} catch (error) {
		handleError(error)
	} finally {
		saving.value = false
	}
}

async function removeUser(user: SkinSiteAdminUser) {
	if (deletingUuid.value) return
	if (!window.confirm(formatMessage(messages.confirmDelete, { name: user.username }))) return
	deletingUuid.value = user.uuid
	try {
		const res = await skinSiteAdminDeleteUser(user.uuid)
		if (!res.success) throw new Error(res.errorMessage)
		addNotification({ type: 'success', title: formatMessage(messages.deleted) })
		await load()
	} catch (error) {
		handleError(error)
	} finally {
		deletingUuid.value = null
	}
}

async function openPlayers(user: SkinSiteAdminUser) {
	playersTarget.value = user
	playersFor.value = null
	playersLoading.value = true
	try {
		const res = await skinSiteAdminUserPlayers(user.uuid)
		if (!res.success) throw new Error(res.errorMessage)
		playersFor.value = res.payload ?? []
	} catch (error) {
		handleError(error)
	} finally {
		playersLoading.value = false
	}
}

function closePlayers() {
	playersTarget.value = null
	playersFor.value = null
}

onMounted(() => void load())
</script>

<template>
	<div class="flex w-full flex-col gap-4">
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<h2 class="m-0 text-xl font-bold text-contrast">{{ formatMessage(messages.title) }}</h2>
				<p class="m-0 mt-1 text-sm text-secondary">
					{{ formatMessage(messages.total, { count: total }) }}
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					class="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-contrast hover:brightness-110"
					@click="openInvite"
				>
					{{ formatMessage(messages.invite) }}
				</button>
				<button
					type="button"
					class="rounded-lg bg-button-bg px-3 py-1.5 text-xs font-semibold text-contrast hover:brightness-110"
					@click="openAudit()"
				>
					{{ formatMessage(messages.audit) }}
				</button>
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<select
				v-model="searchField"
				class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-2 py-1.5 text-xs text-contrast outline-none focus:border-brand"
			>
				<option value="username">{{ formatMessage(messages.searchName) }}</option>
				<option value="email">{{ formatMessage(messages.searchEmail) }}</option>
				<option value="uuid">{{ formatMessage(messages.searchUuid) }}</option>
			</select>
			<input
				v-model="keyword"
				type="text"
				:placeholder="formatMessage(messages.search)"
				class="min-w-48 flex-1 rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-1.5 text-xs text-contrast outline-none focus:border-brand"
				@keyup.enter="search"
			/>
			<button
				type="button"
				class="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-contrast hover:brightness-110"
				@click="search"
			>
				{{ formatMessage(messages.search) }}
			</button>
		</div>

		<div v-if="loading" class="flex min-h-48 items-center justify-center gap-2 text-sm text-secondary">
			<SpinnerIcon class="size-4 animate-spin" />
			{{ formatMessage(messages.loading) }}
		</div>
		<p
			v-else-if="failed"
			class="m-0 rounded-lg border border-solid border-surface-5 bg-bg-raised p-4 text-sm text-secondary"
		>
			{{ formatMessage(messages.failed) }}
		</p>
		<p
			v-else-if="!items.length"
			class="m-0 rounded-lg border border-solid border-surface-5 bg-bg-raised p-4 text-sm text-secondary"
		>
			{{ formatMessage(messages.empty) }}
		</p>

		<template v-else>
			<div class="overflow-hidden rounded-lg border border-solid border-surface-5">
				<table class="w-full border-collapse text-left text-sm">
					<thead class="bg-bg-raised">
						<tr class="text-xs text-secondary">
							<th class="px-3 py-2 font-semibold">{{ formatMessage(messages.username) }}</th>
							<th class="px-3 py-2 font-semibold">{{ formatMessage(messages.email) }}</th>
							<th class="px-3 py-2 font-semibold">{{ formatMessage(messages.qq) }}</th>
							<th class="px-3 py-2 font-semibold">{{ formatMessage(messages.status) }}</th>
							<th class="px-3 py-2 font-semibold">
								{{ formatMessage(messages.permissionGroups) }}
							</th>
							<th class="px-3 py-2 font-semibold">{{ formatMessage(messages.registeredAt) }}</th>
							<th class="px-3 py-2 font-semibold">{{ formatMessage(messages.actions) }}</th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="user in items"
							:key="user.uuid"
							class="border-t border-solid border-surface-5 hover:bg-bg-raised"
						>
							<td class="px-3 py-2">
								<div class="font-semibold text-contrast">{{ user.username }}</div>
								<div class="text-[10px] break-all text-secondary">{{ user.uuid }}</div>
							</td>
							<td class="px-3 py-2 text-xs break-all text-secondary">{{ user.email }}</td>
							<td class="px-3 py-2 text-xs text-secondary">{{ user.qq ?? '—' }}</td>
							<td class="px-3 py-2">
								<span
									class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
									:class="user.banned ? 'bg-red text-contrast' : 'bg-green text-contrast'"
								>
									{{
										user.banned
											? formatMessage(messages.statusBanned)
											: formatMessage(messages.statusNormal)
									}}
								</span>
							</td>
							<td class="px-3 py-2">
								<div class="flex flex-wrap gap-1">
									<span
										v-for="perm in user.permissions ?? []"
										:key="perm"
										class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
										:class="permissionMeta(perm).color"
									>
										{{ permissionMeta(perm).label }}
									</span>
									<span
										v-if="!user.permissions?.length"
										class="text-[11px] text-secondary"
									>
										—
									</span>
								</div>
							</td>
							<td class="px-3 py-2 text-xs text-secondary">
								{{ formatDateTime(user.registerTime) }}
							</td>
							<td class="px-3 py-2">
								<div class="flex flex-wrap gap-1">
									<button
										type="button"
										class="rounded bg-button-bg px-2 py-0.5 text-[11px] font-semibold text-contrast hover:brightness-110"
										@click="openPlayers(user)"
									>
										{{ formatMessage(messages.players) }}
									</button>
									<button
										type="button"
										class="rounded bg-button-bg px-2 py-0.5 text-[11px] font-semibold text-contrast hover:brightness-110"
										@click="openBot(user)"
									>
										{{ formatMessage(messages.bot) }}
									</button>
									<button
										type="button"
										class="rounded bg-button-bg px-2 py-0.5 text-[11px] font-semibold text-contrast hover:brightness-110"
										@click="openFrequency(user)"
									>
										{{ formatMessage(messages.frequency) }}
									</button>
									<button
										type="button"
										class="rounded bg-button-bg px-2 py-0.5 text-[11px] font-semibold text-contrast hover:brightness-110"
										@click="openAudit(user)"
									>
										{{ formatMessage(messages.audit) }}
									</button>
									<button
										type="button"
										class="rounded bg-brand px-2 py-0.5 text-[11px] font-semibold text-contrast hover:brightness-110"
										@click="startEdit(user)"
									>
										{{ formatMessage(messages.edit) }}
									</button>
									<button
										type="button"
										class="rounded bg-red/20 px-2 py-0.5 text-[11px] font-semibold text-red hover:brightness-110 disabled:opacity-50"
										:disabled="deletingUuid === user.uuid"
										@click="removeUser(user)"
									>
										{{ formatMessage(messages.remove) }}
									</button>
								</div>
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<div class="flex items-center justify-center gap-3 pt-1">
				<button
					type="button"
					class="rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
					:disabled="!hasPrev"
					@click="prevPage"
				>
					{{ formatMessage(messages.prev) }}
				</button>
				<span class="text-xs text-secondary">
					{{ formatMessage(messages.page, { page }) }} / {{ pageCount }}
				</span>
				<button
					type="button"
					class="rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
					:disabled="!hasNext"
					@click="nextPage"
				>
					{{ formatMessage(messages.next) }}
				</button>
			</div>
		</template>

		<!-- 编辑 -->
		<div
			v-if="editingUuid"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			@click.self="cancelEdit"
		>
			<div
				class="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl bg-bg p-6"
			>
				<h3 class="m-0 text-lg font-bold text-contrast">{{ formatMessage(messages.edit) }}</h3>
				<label class="flex flex-col gap-1">
					<span class="text-xs font-semibold text-secondary">
						{{ formatMessage(messages.username) }}
					</span>
					<input
						v-model="editForm.username"
						type="text"
						class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-xs font-semibold text-secondary">
						{{ formatMessage(messages.email) }}
					</span>
					<input
						v-model="editForm.email"
						type="email"
						class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-xs font-semibold text-secondary">{{ formatMessage(messages.qq) }}</span>
					<input
						v-model="editForm.qq"
						type="text"
						class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-xs font-semibold text-secondary">
						{{ formatMessage(messages.password) }}
					</span>
					<input
						v-model="editForm.password"
						type="password"
						class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
					/>
					<span class="text-[11px] text-secondary">{{ formatMessage(messages.passwordHint) }}</span>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-xs font-semibold text-secondary">
						{{ formatMessage(messages.permissions) }}
					</span>
					<input
						v-model="editForm.permissions"
						type="text"
						class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
					/>
					<span class="text-[11px] text-secondary">
						{{ formatMessage(messages.permissionsHint) }}
					</span>
				</label>
				<label class="flex cursor-pointer items-center gap-2 text-sm text-contrast">
					<input v-model="editForm.banned" type="checkbox" class="size-4" />
					{{ formatMessage(messages.banned) }}
				</label>
				<div class="flex justify-end gap-2 pt-2">
					<button
						type="button"
						class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110"
						@click="cancelEdit"
					>
						{{ formatMessage(messages.cancel) }}
					</button>
					<button
						type="button"
						class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
						:disabled="saving"
						@click="saveEdit"
					>
						{{ formatMessage(messages.save) }}
					</button>
				</div>
			</div>
		</div>

		<!-- 绑定玩家 -->
		<div
			v-if="playersTarget"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			@click.self="closePlayers"
		>
			<div
				class="flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-xl bg-bg p-6"
			>
				<h3 class="m-0 text-lg font-bold text-contrast">
					{{ formatMessage(messages.boundPlayersTitle) }} · {{ playersTarget.username }}
				</h3>
				<div
					v-if="playersLoading"
					class="flex min-h-32 items-center justify-center gap-2 text-sm text-secondary"
				>
					<SpinnerIcon class="size-4 animate-spin" />
					{{ formatMessage(messages.loading) }}
				</div>
				<p
					v-else-if="!playersFor || !playersFor.length"
					class="m-0 rounded-lg bg-bg-raised p-3 text-xs text-secondary"
				>
					{{ formatMessage(messages.noPlayers) }}
				</p>
				<div v-else class="flex flex-col gap-2">
					<div
						v-for="player in playersFor"
						:key="player.uuid"
						class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2"
					>
						<div class="flex items-center justify-between gap-2">
							<span class="font-semibold text-contrast">{{ player.name }}</span>
							<span
								class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
								:class="player.isMojang ? 'bg-yellow text-contrast' : 'bg-brand text-contrast'"
							>
								{{ player.isMojang ? 'Mojang' : 'StarLight' }}
							</span>
						</div>
						<p class="m-0 mt-1 text-[10px] break-all text-secondary">{{ player.uuid }}</p>
						<p v-if="player.legacyInternalAdapted" class="m-0 mt-1 text-[10px] text-red">
							{{ formatMessage(messages.legacyAdapted) }}
						</p>
					</div>
				</div>
				<div class="flex justify-end pt-2">
					<button
						type="button"
						class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110"
						@click="closePlayers"
					>
						{{ formatMessage(messages.cancel) }}
					</button>
				</div>
			</div>
		</div>

		<!-- Bot 管理 -->
		<div
			v-if="botTarget"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			@click.self="closeBot"
		>
			<div
				class="flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-xl bg-bg p-6"
			>
				<h3 class="m-0 text-lg font-bold text-contrast">
					{{ formatMessage(messages.botTitle) }} · {{ botTarget.username }}
				</h3>
				<div class="rounded-lg bg-bg-raised px-3 py-2 text-xs text-secondary">
					<p class="m-0 font-semibold text-contrast">{{ botTarget.username }}</p>
					<p class="m-0 mt-1 break-all">{{ botTarget.uuid }}</p>
				</div>
				<div
					v-if="botLoading"
					class="flex min-h-32 items-center justify-center gap-2 text-sm text-secondary"
				>
					<SpinnerIcon class="size-4 animate-spin" />
					{{ formatMessage(messages.loading) }}
				</div>
				<template v-else-if="botInfo">
					<div class="flex flex-wrap gap-2">
						<span
							class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
							:class="botInfo.exists ? 'bg-brand text-contrast' : 'bg-button-bg text-secondary'"
						>
							{{
								botInfo.exists
									? formatMessage(messages.botExists)
									: formatMessage(messages.botNotExists)
							}}
						</span>
						<span
							v-if="botInfo.exists"
							class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
							:class="botInfo.active ? 'bg-green text-contrast' : 'bg-yellow text-contrast'"
						>
							{{
								botInfo.active
									? formatMessage(messages.botActive)
									: formatMessage(messages.botInactive)
							}}
						</span>
						<span
							v-if="botInfo.creationBanned"
							class="rounded-full bg-red px-2 py-0.5 text-[10px] font-semibold text-contrast"
						>
							{{ formatMessage(messages.botCreationBanned) }}
						</span>
					</div>

					<form
						v-if="botInfo.exists"
						class="flex flex-col gap-2"
						@submit.prevent="saveBotUsername"
					>
						<label class="flex flex-col gap-1">
							<span class="text-xs font-semibold text-secondary">
								{{ formatMessage(messages.botUsername) }}
							</span>
							<input
								v-model="botUsername"
								type="text"
								minlength="2"
								maxlength="32"
								:disabled="botBusy"
								class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand disabled:opacity-50"
							/>
						</label>
						<p class="m-0 text-[11px] text-secondary">
							{{ formatMessage(messages.botTokenHint) }}:
							{{ botInfo.tokenHint ? '••••••••' + botInfo.tokenHint : '—' }}
						</p>
						<button
							type="submit"
							class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
							:disabled="botBusy || !validBotUsername || botUsername === botInfo.username"
						>
							{{ formatMessage(messages.botSaveUsername) }}
						</button>
					</form>

					<div class="grid gap-2 sm:grid-cols-2">
						<button
							type="button"
							class="rounded-lg bg-yellow/20 px-3 py-2 text-xs font-semibold text-yellow hover:brightness-110 disabled:opacity-50"
							:disabled="botBusy || !botInfo.active"
							@click="invalidateBot"
						>
							{{ formatMessage(messages.botInvalidate) }}
						</button>
						<button
							type="button"
							class="rounded-lg px-3 py-2 text-xs font-semibold hover:brightness-110 disabled:opacity-50"
							:class="
								botInfo.creationBanned
									? 'bg-green/20 text-green'
									: 'bg-red/20 text-red'
							"
							:disabled="botBusy"
							@click="toggleBotCreationBan"
						>
							{{
								botInfo.creationBanned
									? formatMessage(messages.botUnban)
									: formatMessage(messages.botBan)
							}}
						</button>
					</div>
				</template>
				<div class="flex justify-end pt-2">
					<button
						type="button"
						class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110"
						@click="closeBot"
					>
						{{ formatMessage(messages.cancel) }}
					</button>
				</div>
			</div>
		</div>

		<!-- 频率限制 -->
		<div
			v-if="frequencyTarget"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			@click.self="closeFrequency"
		>
			<div
				class="flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-xl bg-bg p-6"
			>
				<h3 class="m-0 text-lg font-bold text-contrast">
					{{ formatMessage(messages.frequencyTitle) }} · {{ frequencyTarget.username }}
				</h3>
				<div class="rounded-lg bg-bg-raised px-3 py-2 text-xs text-secondary">
					<p class="m-0 font-semibold text-contrast">{{ frequencyTarget.username }}</p>
					<p class="m-0 mt-1 break-all">{{ frequencyTarget.uuid }}</p>
				</div>
				<p class="m-0 text-xs text-secondary">{{ formatMessage(messages.frequencyHint) }}</p>
				<div
					v-if="frequencyLoading"
					class="flex min-h-32 items-center justify-center gap-2 text-sm text-secondary"
				>
					<SpinnerIcon class="size-4 animate-spin" />
					{{ formatMessage(messages.loading) }}
				</div>
				<template v-else>
					<div class="flex items-center justify-between">
						<span class="text-sm font-semibold text-contrast">
							{{ formatMessage(messages.frequency) }}
						</span>
						<span
							class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
							:class="
								currentFrequencyLimit === null
									? 'bg-button-bg text-secondary'
									: 'bg-yellow text-contrast'
							"
						>
							{{
								currentFrequencyLimit === null
									? formatMessage(messages.frequencyNone)
									: formatMessage(messages.frequencyCurrent, { percent: currentFrequencyLimit })
							}}
						</span>
					</div>
					<input
						v-model.number="frequencyPercent"
						type="range"
						min="10"
						max="100"
						step="1"
						:disabled="frequencyBusy"
						class="w-full accent-yellow"
					/>
					<input
						v-model.number="frequencyPercent"
						type="number"
						min="10"
						max="100"
						step="1"
						:disabled="frequencyBusy"
						class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand disabled:opacity-50"
					/>
					<p class="m-0 text-[11px] text-secondary">
						{{ formatMessage(messages.frequencyRange) }}
					</p>
					<div class="grid gap-2 sm:grid-cols-2">
						<button
							type="button"
							class="rounded-lg bg-yellow/20 px-3 py-2 text-xs font-semibold text-yellow hover:brightness-110 disabled:opacity-50"
							:disabled="frequencyBusy || !validFrequency"
							@click="saveFrequency"
						>
							{{ formatMessage(messages.frequencySave) }}
						</button>
						<button
							type="button"
							class="rounded-lg bg-button-bg px-3 py-2 text-xs font-semibold text-secondary hover:brightness-110 disabled:opacity-50"
							:disabled="frequencyBusy || currentFrequencyLimit === null"
							@click="clearFrequency"
						>
							{{ formatMessage(messages.frequencyClear) }}
						</button>
					</div>
				</template>
				<div class="flex justify-end pt-2">
					<button
						type="button"
						class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110"
						@click="closeFrequency"
					>
						{{ formatMessage(messages.cancel) }}
					</button>
				</div>
			</div>
		</div>

		<!-- 审计 -->
		<div
			v-if="auditTarget !== null || auditItems.length || auditLoading"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			@click.self="closeAudit"
		>
			<div
				class="flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-xl bg-bg p-6"
			>
				<h3 class="m-0 text-lg font-bold text-contrast">
					{{ formatMessage(messages.auditTitle) }}
					<span v-if="auditTarget" class="text-sm font-normal text-secondary">
						· {{ auditTarget.username }}
					</span>
				</h3>
				<div
					v-if="auditLoading && !auditItems.length"
					class="flex min-h-32 items-center justify-center gap-2 text-sm text-secondary"
				>
					<SpinnerIcon class="size-4 animate-spin" />
					{{ formatMessage(messages.loading) }}
				</div>
				<p
					v-else-if="!auditItems.length"
					class="m-0 rounded-lg bg-bg-raised p-3 text-xs text-secondary"
				>
					{{ formatMessage(messages.auditEmpty) }}
				</p>
				<div v-else class="flex flex-col gap-2">
					<article
						v-for="entry in auditItems"
						:key="entry.id"
						class="rounded-lg border border-solid border-surface-5 bg-bg-raised p-3"
					>
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div>
								<p class="m-0 text-sm font-semibold text-contrast">
									{{ auditActionLabel(entry.action) }}
								</p>
								<p class="m-0 mt-1 text-xs text-secondary">
									{{ entry.actorName }} → {{ entry.targetName }}
								</p>
							</div>
							<span class="text-[10px] text-secondary">
								{{ formatDateTime(entry.createdAt) }}
							</span>
						</div>
						<div v-if="entry.changes.length" class="mt-2 flex flex-col gap-1">
							<div
								v-for="(change, i) in entry.changes"
								:key="entry.id + '-' + change.field + '-' + i"
								class="grid gap-1 rounded bg-bg px-2 py-1 text-[11px] sm:grid-cols-[8rem_1fr]"
							>
								<span class="font-semibold text-contrast">{{ auditFieldLabel(change.field) }}</span>
								<span class="break-all text-secondary">
									{{ auditValue(change.before) }}
									<span class="px-1">→</span>
									{{ auditValue(change.after) }}
								</span>
							</div>
						</div>
					</article>
					<button
						v-if="auditNextCursor"
						type="button"
						class="rounded-lg bg-button-bg px-4 py-2 text-xs font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
						:disabled="auditLoading"
						@click="loadMoreAudit"
					>
						{{ formatMessage(messages.auditMore) }}
					</button>
				</div>
				<div class="flex justify-end pt-2">
					<button
						type="button"
						class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110"
						@click="closeAudit"
					>
						{{ formatMessage(messages.cancel) }}
					</button>
				</div>
			</div>
		</div>
		<!-- 邀请码 -->
		<div
			v-if="inviteOpen"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			@click.self="closeInvite"
		>
			<div class="flex w-full max-w-md flex-col gap-3 rounded-xl bg-bg p-6">
				<h3 class="m-0 text-lg font-bold text-contrast">
					{{ formatMessage(messages.inviteTitle) }}
				</h3>
				<label class="flex flex-col gap-1">
					<span class="text-xs font-semibold text-secondary">
						{{ formatMessage(messages.inviteEmail) }}
					</span>
					<input
						v-model="inviteEmail"
						type="email"
						placeholder="example@domain.com"
						class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
						@keyup.enter="generateInvite"
					/>
				</label>
				<div class="flex gap-2">
					<input
						:value="inviteCode"
						type="text"
						readonly
						class="flex-1 rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 font-mono text-sm text-contrast outline-none"
					/>
					<button
						type="button"
						class="rounded-lg bg-button-bg px-3 py-2 text-xs font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
						:disabled="!inviteCode"
						@click="copyInvite"
					>
						{{ formatMessage(messages.inviteCopy) }}
					</button>
				</div>
				<div class="flex justify-end gap-2 pt-2">
					<button
						type="button"
						class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110"
						@click="closeInvite"
					>
						{{ formatMessage(messages.cancel) }}
					</button>
					<button
						type="button"
						class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
						:disabled="inviteBusy || !inviteEmailValid"
						@click="generateInvite"
					>
						{{ formatMessage(messages.inviteGenerate) }}
					</button>
				</div>
			</div>
		</div>
	</div>
</template>
