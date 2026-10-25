<script setup lang="ts">
import { SpinnerIcon } from '@modrinth/assets'
import { defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import {
	type SkinSiteChatAuditInfo,
	skinSiteChatAuditList,
	skinSiteChatManagerSet,
	type SkinSiteChatPrerequisiteMode,
	skinSiteChatRoomAvatarUpdate,
	skinSiteChatRoomCreate,
	skinSiteChatRoomDelete,
	type SkinSiteChatRoomInfo,
	skinSiteChatRoomList,
	skinSiteChatRoomUpdate,
	type SkinSiteChatRoomVisibility,
	skinSiteChatSettlementOwnerAssign,
	type SkinSiteChatUserInfo,
	skinSiteChatVoiceCapacityUpdate,
	skinSiteChatVoiceConfig,
	skinSiteChatVoiceConfigUpdate,
	type SkinSiteChatVoiceGlobalConfig,
	type SkinSiteChatVoiceLogEntry,
	skinSiteChatVoiceLogs,
	skinSiteChatVoiceRuntime,
	type SkinSiteChatVoiceRuntimeInfo,
	skinSiteChatVoiceRuntimeRetry,
} from '@/helpers/skin-site-api'

import ChatUserPicker from '../ChatUserPicker.vue'
import RoomAvatar from '../RoomAvatar.vue'
import RoomAvatarEditor from '../RoomAvatarEditor.vue'

const { formatMessage } = useVIntl()
const { handleError, addNotification } = injectNotificationManager()

const messages = defineMessages({
	title: { id: 'app.skin-site.chat.admin.title', defaultMessage: 'Chat rooms' },
	subtitle: {
		id: 'app.skin-site.chat.admin.subtitle',
		defaultMessage: 'Create public or private rooms and hand daily moderation to trusted members.',
	},
	createRoom: {
		id: 'app.skin-site.chat.admin.create-room',
		defaultMessage: 'Create room',
	},
	loading: { id: 'app.skin-site.chat.admin.loading', defaultMessage: 'Loading…' },
	failed: { id: 'app.skin-site.chat.admin.failed', defaultMessage: 'Could not load rooms.' },
	empty: { id: 'app.skin-site.chat.admin.empty', defaultMessage: 'No chat rooms yet.' },
	edit: { id: 'app.skin-site.chat.admin.edit', defaultMessage: 'Edit' },
	remove: { id: 'app.skin-site.chat.admin.remove', defaultMessage: 'Delete' },
	save: { id: 'app.skin-site.chat.admin.save', defaultMessage: 'Save' },
	cancel: { id: 'app.skin-site.chat.admin.cancel', defaultMessage: 'Cancel' },
	name: { id: 'app.skin-site.chat.admin.name', defaultMessage: 'Name' },
	description: {
		id: 'app.skin-site.chat.admin.description',
		defaultMessage: 'Description',
	},
	visibility: {
		id: 'app.skin-site.chat.admin.visibility',
		defaultMessage: 'Visibility',
	},
	visibilityPublic: {
		id: 'app.skin-site.chat.admin.visibility-public',
		defaultMessage: 'Public',
	},
	visibilityPrivate: {
		id: 'app.skin-site.chat.admin.visibility-private',
		defaultMessage: 'Private',
	},
	kind: { id: 'app.skin-site.chat.admin.kind', defaultMessage: 'Kind' },
	kindStandard: {
		id: 'app.skin-site.chat.admin.kind-standard',
		defaultMessage: 'Standard',
	},
	kindSettlement: {
		id: 'app.skin-site.chat.admin.kind-settlement',
		defaultMessage: 'Settlement',
	},
	prerequisiteMode: {
		id: 'app.skin-site.chat.admin.prerequisite-mode',
		defaultMessage: 'Prerequisite mode',
	},
	prerequisiteAny: {
		id: 'app.skin-site.chat.admin.prerequisite-any',
		defaultMessage: 'Any',
	},
	prerequisiteAll: {
		id: 'app.skin-site.chat.admin.prerequisite-all',
		defaultMessage: 'All',
	},
	prerequisitePermissions: {
		id: 'app.skin-site.chat.admin.prerequisite-permissions',
		defaultMessage: 'Required permissions',
	},
	prerequisiteHint: {
		id: 'app.skin-site.chat.admin.prerequisite-hint',
		defaultMessage: 'Comma separated. Leave empty for no restriction.',
	},
	created: { id: 'app.skin-site.chat.admin.created', defaultMessage: 'Room created.' },
	updated: { id: 'app.skin-site.chat.admin.updated', defaultMessage: 'Room updated.' },
	deleted: { id: 'app.skin-site.chat.admin.deleted', defaultMessage: 'Room deleted.' },
	confirmDelete: {
		id: 'app.skin-site.chat.admin.confirm-delete',
		defaultMessage: 'Permanently delete room “{name}” and all its messages?',
	},
	managerBadge: {
		id: 'app.skin-site.chat.admin.manager-badge',
		defaultMessage: 'Manager',
	},
	voiceBadge: {
		id: 'app.skin-site.chat.admin.voice-badge',
		defaultMessage: 'Voice',
	},
	managers: { id: 'app.skin-site.chat.admin.managers', defaultMessage: 'Managers' },
	managerTitle: {
		id: 'app.skin-site.chat.admin.manager-title',
		defaultMessage: 'Room manager',
	},
	managerHint: {
		id: 'app.skin-site.chat.admin.manager-hint',
		defaultMessage: 'Managers can moderate members, messages and files in this room.',
	},
	grant: { id: 'app.skin-site.chat.admin.grant', defaultMessage: 'Grant' },
	revoke: { id: 'app.skin-site.chat.admin.revoke', defaultMessage: 'Revoke' },
	managerGranted: {
		id: 'app.skin-site.chat.admin.manager-granted',
		defaultMessage: 'Manager granted.',
	},
	managerRevoked: {
		id: 'app.skin-site.chat.admin.manager-revoked',
		defaultMessage: 'Manager revoked.',
	},
	ownerTitle: {
		id: 'app.skin-site.chat.admin.owner-title',
		defaultMessage: 'Settlement owner',
	},
	ownerHint: {
		id: 'app.skin-site.chat.admin.owner-hint',
		defaultMessage: 'Assign the first settlement owner for this room.',
	},
	ownerAssigned: {
		id: 'app.skin-site.chat.admin.owner-assigned',
		defaultMessage: 'Settlement owner assigned.',
	},
	ownerCurrent: {
		id: 'app.skin-site.chat.admin.owner-current',
		defaultMessage: 'Current owner: {name}',
	},
	ownerNone: {
		id: 'app.skin-site.chat.admin.owner-none',
		defaultMessage: 'No settlement owner yet.',
	},
	audit: { id: 'app.skin-site.chat.admin.audit', defaultMessage: 'Audit' },
	auditTitle: {
		id: 'app.skin-site.chat.admin.audit-title',
		defaultMessage: 'Room audit',
	},
	auditEmpty: {
		id: 'app.skin-site.chat.admin.audit-empty',
		defaultMessage: 'No audit records yet.',
	},
	auditTarget: {
		id: 'app.skin-site.chat.admin.audit-target',
		defaultMessage: 'Target: {name}',
	},
	close: { id: 'app.skin-site.chat.admin.close', defaultMessage: 'Close' },
	voiceRuntimeTitle: {
		id: 'app.skin-site.chat.admin.voice-runtime-title',
		defaultMessage: 'Realtime voice runtime',
	},
	voiceLogs: {
		id: 'app.skin-site.chat.admin.voice-logs',
		defaultMessage: 'View logs',
	},
	voiceConfig: {
		id: 'app.skin-site.chat.admin.voice-config',
		defaultMessage: 'Configure runtime',
	},
	voiceRetry: {
		id: 'app.skin-site.chat.admin.voice-retry',
		defaultMessage: 'Retry deployment',
	},
	voiceConfigTitle: {
		id: 'app.skin-site.chat.admin.voice-config-title',
		defaultMessage: 'Voice runtime configuration',
	},
	voiceLogsTitle: {
		id: 'app.skin-site.chat.admin.voice-logs-title',
		defaultMessage: 'LiveKit logs',
	},
	voiceCapacityTitle: {
		id: 'app.skin-site.chat.admin.voice-capacity-title',
		defaultMessage: 'Voice capacity',
	},
	voiceCapacity: {
		id: 'app.skin-site.chat.admin.voice-capacity',
		defaultMessage: 'Voice capacity',
	},
	participantLimit: {
		id: 'app.skin-site.chat.admin.participant-limit',
		defaultMessage: 'Participant limit',
	},
	listenerLimit: {
		id: 'app.skin-site.chat.admin.listener-limit',
		defaultMessage: 'Listener limit',
	},
	voiceCapacityUpdated: {
		id: 'app.skin-site.chat.admin.voice-capacity-updated',
		defaultMessage: 'Voice capacity updated.',
	},
	voiceEnabled: {
		id: 'app.skin-site.chat.admin.voice-enabled',
		defaultMessage: 'Enable realtime voice',
	},
	voiceRuntimePath: {
		id: 'app.skin-site.chat.admin.voice-runtime-path',
		defaultMessage: 'Runtime directory',
	},
	voiceMirror: {
		id: 'app.skin-site.chat.admin.voice-mirror',
		defaultMessage: 'Mirror base URL',
	},
	voicePublicUrl: {
		id: 'app.skin-site.chat.admin.voice-public-url',
		defaultMessage: 'Public URL',
	},
	voiceBind: {
		id: 'app.skin-site.chat.admin.voice-bind',
		defaultMessage: 'Bind address',
	},
	voiceSignalPort: {
		id: 'app.skin-site.chat.admin.voice-signal-port',
		defaultMessage: 'Signal port',
	},
	voiceRtcTcpPort: {
		id: 'app.skin-site.chat.admin.voice-rtc-tcp-port',
		defaultMessage: 'Media TCP port',
	},
	voiceRtcUdpPort: {
		id: 'app.skin-site.chat.admin.voice-rtc-udp-port',
		defaultMessage: 'Media UDP port',
	},
	voiceStartupTimeout: {
		id: 'app.skin-site.chat.admin.voice-startup-timeout',
		defaultMessage: 'Startup timeout (s)',
	},
	voiceUseExternalIp: {
		id: 'app.skin-site.chat.admin.voice-use-external-ip',
		defaultMessage: 'Use external IP',
	},
	voiceNodeIp: {
		id: 'app.skin-site.chat.admin.voice-node-ip',
		defaultMessage: 'Node IP',
	},
	voiceSaved: {
		id: 'app.skin-site.chat.admin.voice-saved',
		defaultMessage: 'Voice configuration saved.',
	},
	voiceLogsAutoRefresh: {
		id: 'app.skin-site.chat.admin.voice-logs-auto-refresh',
		defaultMessage: 'Auto refresh',
	},
	voiceLogsRefresh: {
		id: 'app.skin-site.chat.admin.voice-logs-refresh',
		defaultMessage: 'Refresh',
	},
	voiceLogsEmpty: {
		id: 'app.skin-site.chat.admin.voice-logs-empty',
		defaultMessage: 'No logs yet.',
	},
})

type FormState = {
	name: string
	description: string
	visibility: SkinSiteChatRoomVisibility
	kind: 'STANDARD' | 'SETTLEMENT'
	prerequisiteMode: SkinSiteChatPrerequisiteMode
	prerequisitePermissions: string
}

function emptyForm(): FormState {
	return {
		name: '',
		description: '',
		visibility: 'PUBLIC',
		kind: 'STANDARD',
		prerequisiteMode: 'ANY',
		prerequisitePermissions: '',
	}
}

const rooms = ref<SkinSiteChatRoomInfo[]>([])
const loading = ref(true)
const failed = ref(false)

const editorOpen = ref(false)
const editingRoom = ref<SkinSiteChatRoomInfo | null>(null)
const form = ref<FormState>(emptyForm())
const saving = ref(false)

const avatarToken = ref<string | null>(null)
const avatarRemove = ref(false)
const avatarUploading = ref(false)

const deletingId = ref<number | null>(null)

const editorTitle = computed(() =>
	editingRoom.value
		? formatMessage(messages.edit)
		: formatMessage(messages.createRoom),
)

function permissionsToText(list: string[]): string {
	return list.join(', ')
}

function textToPermissions(text: string): string[] {
	return text
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
}

function resetAvatarDraft() {
	avatarToken.value = null
	avatarRemove.value = false
	avatarUploading.value = false
}

async function loadRooms() {
	loading.value = true
	failed.value = false
	try {
		const res = await skinSiteChatRoomList()
		if (!res.success) throw new Error(res.errorMessage)
		rooms.value = res.payload ?? []
	} catch (error) {
		failed.value = true
		handleError(error)
	} finally {
		loading.value = false
	}
}

function openCreate() {
	editingRoom.value = null
	form.value = emptyForm()
	resetAvatarDraft()
	editorOpen.value = true
}

function openEdit(room: SkinSiteChatRoomInfo) {
	editingRoom.value = room
	form.value = {
		name: room.name,
		description: room.description ?? '',
		visibility: room.visibility,
		kind: room.kind,
		prerequisiteMode: room.prerequisiteMode,
		prerequisitePermissions: permissionsToText(room.prerequisitePermissions ?? []),
	}
	resetAvatarDraft()
	editorOpen.value = true
}

function closeEditor() {
	editorOpen.value = false
	editingRoom.value = null
	resetAvatarDraft()
}

async function submit() {
	if (saving.value) return
	if (!form.value.name.trim()) return
	saving.value = true
	const creating = editingRoom.value === null
	try {
		const payload = {
			name: form.value.name.trim(),
			description: form.value.description.trim(),
			visibility: form.value.visibility,
			prerequisiteMode: form.value.prerequisiteMode,
			prerequisitePermissions: textToPermissions(form.value.prerequisitePermissions),
		}
		const res = creating
			? await skinSiteChatRoomCreate({ ...payload, kind: form.value.kind })
			: await skinSiteChatRoomUpdate(editingRoom.value!.id, payload)
		if (!res.success) throw new Error(res.errorMessage)

		if (avatarToken.value || avatarRemove.value) {
			const avatarRes = await skinSiteChatRoomAvatarUpdate(res.payload.id, {
				imageToken: avatarToken.value ?? undefined,
				removeImage: avatarRemove.value,
			})
			if (!avatarRes.success) {
				addNotification({ type: 'error', title: avatarRes.errorMessage })
				await loadRooms()
				return
			}
		}

		addNotification({
			type: 'success',
			title: formatMessage(creating ? messages.created : messages.updated),
		})
		closeEditor()
		await loadRooms()
	} catch (error) {
		handleError(error)
	} finally {
		saving.value = false
	}
}

async function removeRoom(room: SkinSiteChatRoomInfo) {
	if (deletingId.value !== null) return
	if (!window.confirm(formatMessage(messages.confirmDelete, { name: room.name }))) return
	deletingId.value = room.id
	try {
		const res = await skinSiteChatRoomDelete(room.id)
		if (!res.success) throw new Error(res.errorMessage)
		addNotification({ type: 'success', title: formatMessage(messages.deleted) })
		await loadRooms()
	} catch (error) {
		handleError(error)
	} finally {
		deletingId.value = null
	}
}

function formatDateTime(ts?: number | null): string {
	if (!ts) return '—'
	try {
		return new Date(ts).toLocaleString()
	} catch {
		return '—'
	}
}

const managerRoom = ref<SkinSiteChatRoomInfo | null>(null)
const managerUser = ref<SkinSiteChatUserInfo | null>(null)
const managerGranting = ref(false)

const ownerRoom = ref<SkinSiteChatRoomInfo | null>(null)
const ownerUser = ref<SkinSiteChatUserInfo | null>(null)
const ownerSaving = ref(false)

const auditRoom = ref<SkinSiteChatRoomInfo | null>(null)
const auditItems = ref<SkinSiteChatAuditInfo[]>([])
const auditLoading = ref(false)

const AUDIT_LABELS: Record<string, string> = {
	ROOM_CREATED: '创建房间',
	ROOM_UPDATED: '修改房间资料',
	ROOM_AVATAR_UPDATED: '更新房间头像',
	ROOM_AVATAR_CLEARED: '移除房间头像',
	MEMBER_JOINED: '成员加入房间',
	MEMBER_LEFT: '成员退出房间',
	MEMBER_INVITED: '邀请成员',
	MEMBER_REMOVED: '踢出成员',
	MEMBER_BANNED: '踢出并拉黑',
	MEMBER_UNBANNED: '解除成员封禁',
	MEMBER_MUTED: '禁言成员',
	MEMBER_UNMUTED: '解除成员禁言',
	MANAGER_ADDED: '任命房间管理',
	MANAGER_REMOVED: '撤销房间管理',
	BOT_ADDED: '添加机器人',
	BOT_REMOVED: '移除机器人',
	MESSAGE_DELETED: '撤回消息',
	MESSAGE_RECALLED: '撤回消息',
	MESSAGE_PINNED: '设为精华',
	MESSAGE_UNPINNED: '取消精华',
	ANNOUNCEMENT_UPDATED: '更新房间公告',
	ANNOUNCEMENT_CLEARED: '清空房间公告',
	FILE_DELETED: '删除房间文件',
	VOICE_ROOM_UPDATED: '修改房间语音设置',
	VOICE_CAPACITY_UPDATED: '修改房间语音容量',
	VOICE_MEMBER_KICKED: '断开成员语音',
	VOICE_MEMBER_BANNED: '临时封禁成员语音',
	VOICE_MEMBER_UNBANNED: '解除成员语音封禁',
	VOICE_SPEAKER_REVOKED: '关闭成员麦克风',
	VOICE_OBSERVER_JOINED: 'Web管理开始旁听语音',
	VOICE_OBSERVER_LEFT: 'Web管理结束旁听语音',
	SETTLEMENT_OWNER_ASSIGNED: '任命聚落主',
	SETTLEMENT_OWNER_TRANSFERRED: '转让聚落',
	SETTLEMENT_MANAGER_ADDED: '任命聚落管理',
	SETTLEMENT_MANAGER_REMOVED: '撤销聚落管理',
}

function auditLabel(action: string): string {
	return AUDIT_LABELS[action] ?? action
}

function auditActor(name?: string): string {
	return name?.trim() || '已删除用户'
}

function openManager(room: SkinSiteChatRoomInfo) {
	managerRoom.value = room
	managerUser.value = null
}

function closeManager() {
	managerRoom.value = null
	managerUser.value = null
}

async function grantManager(manager: boolean) {
	if (!managerRoom.value || !managerUser.value || managerGranting.value) return
	managerGranting.value = true
	try {
		const res = await skinSiteChatManagerSet(managerRoom.value.id, managerUser.value.uuid, manager)
		if (!res.success) throw new Error(res.errorMessage)
		addNotification({
			type: 'success',
			title: formatMessage(manager ? messages.managerGranted : messages.managerRevoked),
		})
		closeManager()
	} catch (error) {
		handleError(error)
	} finally {
		managerGranting.value = false
	}
}

function openOwner(room: SkinSiteChatRoomInfo) {
	ownerRoom.value = room
	ownerUser.value = null
}

function closeOwner() {
	ownerRoom.value = null
	ownerUser.value = null
}

async function assignOwner() {
	if (!ownerRoom.value || !ownerUser.value || ownerSaving.value) return
	ownerSaving.value = true
	try {
		const res = await skinSiteChatSettlementOwnerAssign(ownerRoom.value.id, ownerUser.value.uuid)
		if (!res.success) throw new Error(res.errorMessage)
		addNotification({ type: 'success', title: formatMessage(messages.ownerAssigned) })
		closeOwner()
		await loadRooms()
	} catch (error) {
		handleError(error)
	} finally {
		ownerSaving.value = false
	}
}

async function openAudit(room: SkinSiteChatRoomInfo) {
	auditRoom.value = room
	auditItems.value = []
	auditLoading.value = true
	try {
		const res = await skinSiteChatAuditList(room.id)
		if (!res.success) throw new Error(res.errorMessage)
		auditItems.value = res.payload ?? []
	} catch (error) {
		handleError(error)
	} finally {
		auditLoading.value = false
	}
}

function closeAudit() {
	auditRoom.value = null
	auditItems.value = []
}

// ---------- voice runtime ----------
const voiceRuntime = ref<SkinSiteChatVoiceRuntimeInfo | null>(null)
const runtimeRetrying = ref(false)
let runtimePollTimer: number | undefined

const VOICE_STATE_LABELS: Record<string, string> = {
	DISABLED: '全局未启用',
	NOT_INSTALLED: '等待部署',
	DOWNLOADING: '正在下载',
	VERIFYING: '正在校验',
	EXTRACTING: '正在解压',
	STARTING: '正在启动',
	READY: '运行正常',
	UNSUPPORTED_PLATFORM: '当前平台不受支持',
}

const voiceRuntimeLabel = computed(() => {
	const state = voiceRuntime.value?.state
	if (!state) return '状态未知'
	if (state === 'FAILED') return voiceRuntime.value?.message || '部署失败'
	return VOICE_STATE_LABELS[state] ?? '状态未知'
})

async function loadVoiceRuntime() {
	try {
		const res = await skinSiteChatVoiceRuntime()
		if (res.success) voiceRuntime.value = res.payload
	} catch (error) {
		handleError(error)
	}
}

async function retryVoiceRuntime() {
	if (runtimeRetrying.value) return
	runtimeRetrying.value = true
	try {
		const res = await skinSiteChatVoiceRuntimeRetry()
		if (!res.success) throw new Error(res.errorMessage)
		voiceRuntime.value = res.payload
		addNotification({ type: 'success', title: formatMessage(messages.voiceRetry) })
	} catch (error) {
		handleError(error)
	} finally {
		runtimeRetrying.value = false
	}
}

// ---------- voice config ----------
const voiceConfigOpen = ref(false)
const voiceConfigLoading = ref(false)
const voiceConfigSaving = ref(false)
const voiceConfigOriginal = ref<SkinSiteChatVoiceGlobalConfig | null>(null)
const voiceConfigForm = reactive<SkinSiteChatVoiceGlobalConfig>({
	enabled: true,
	runtimePath: './data/voice-runtime',
	mirrorBaseUrl: '',
	publicUrl: '',
	bindAddress: '127.0.0.1',
	signalPort: 7880,
	rtcTcpPort: 7881,
	rtcUdpPort: 7882,
	startupTimeoutSeconds: 120,
	useExternalIp: true,
	nodeIp: '',
})

async function openVoiceConfig() {
	voiceConfigLoading.value = true
	try {
		const res = await skinSiteChatVoiceConfig()
		if (!res.success) throw new Error(res.errorMessage)
		voiceConfigOriginal.value = { ...res.payload }
		Object.assign(voiceConfigForm, res.payload)
		voiceConfigOpen.value = true
	} catch (error) {
		handleError(error)
	} finally {
		voiceConfigLoading.value = false
	}
}

function closeVoiceConfig() {
	voiceConfigOpen.value = false
}

async function saveVoiceConfig() {
	if (voiceConfigSaving.value) return
	voiceConfigSaving.value = true
	try {
		const res = await skinSiteChatVoiceConfigUpdate({ ...voiceConfigForm })
		if (!res.success) throw new Error(res.errorMessage)
		voiceConfigOriginal.value = { ...res.payload.config }
		Object.assign(voiceConfigForm, res.payload.config)
		voiceRuntime.value = res.payload.runtime
		addNotification({ type: 'success', title: formatMessage(messages.voiceSaved) })
		closeVoiceConfig()
	} catch (error) {
		handleError(error)
	} finally {
		voiceConfigSaving.value = false
	}
}

// ---------- voice logs ----------
const voiceLogsOpen = ref(false)
const voiceLogs = ref<SkinSiteChatVoiceLogEntry[]>([])
const voiceLogLoading = ref(false)
const voiceLogError = ref('')
const voiceLogAutoRefresh = ref(true)
const voiceLogLatestId = ref(0)
let voiceLogPollTimer: number | undefined

async function openVoiceLogs() {
	voiceLogs.value = []
	voiceLogLatestId.value = 0
	voiceLogError.value = ''
	voiceLogsOpen.value = true
	await loadVoiceLogs(true)
	stopVoiceLogPolling()
	voiceLogPollTimer = window.setInterval(() => {
		if (voiceLogAutoRefresh.value && voiceLogsOpen.value) void loadVoiceLogs(false)
	}, 2000)
}

function closeVoiceLogs() {
	voiceLogsOpen.value = false
	stopVoiceLogPolling()
}

function stopVoiceLogPolling() {
	if (voiceLogPollTimer) {
		window.clearInterval(voiceLogPollTimer)
		voiceLogPollTimer = undefined
	}
}

async function loadVoiceLogs(manual: boolean) {
	if (voiceLogLoading.value) return
	voiceLogLoading.value = true
	try {
		const res = await skinSiteChatVoiceLogs(
			voiceLogs.value.length ? voiceLogLatestId.value : undefined,
			voiceLogs.value.length ? 500 : 300,
		)
		if (!res.success) throw new Error(res.errorMessage)
		voiceLogError.value = ''
		if (res.payload.entries.length) {
			voiceLogs.value.push(...res.payload.entries)
			if (voiceLogs.value.length > 2000) {
				voiceLogs.value.splice(0, voiceLogs.value.length - 2000)
			}
		}
		voiceLogLatestId.value = res.payload.latestId
	} catch (error) {
		voiceLogError.value = error instanceof Error ? error.message : String(error)
	} finally {
		voiceLogLoading.value = false
		void manual
	}
}

// ---------- voice capacity ----------
const capacityRoom = ref<SkinSiteChatRoomInfo | null>(null)
const capacitySaving = ref(false)
const capacityForm = reactive({ participantLimit: 0, listenerLimit: 0 })

function openCapacity(room: SkinSiteChatRoomInfo) {
	capacityRoom.value = room
	capacityForm.participantLimit = room.voiceParticipantLimit
	capacityForm.listenerLimit = room.voiceListenerLimit
}

function closeCapacity() {
	capacityRoom.value = null
}

async function saveCapacity() {
	if (!capacityRoom.value || capacitySaving.value) return
	capacitySaving.value = true
	try {
		const res = await skinSiteChatVoiceCapacityUpdate(capacityRoom.value.id, {
			participantLimit: capacityForm.participantLimit,
			listenerLimit: capacityForm.listenerLimit,
		})
		if (!res.success) throw new Error(res.errorMessage)
		addNotification({ type: 'success', title: formatMessage(messages.voiceCapacityUpdated) })
		closeCapacity()
		await loadRooms()
	} catch (error) {
		handleError(error)
	} finally {
		capacitySaving.value = false
	}
}

onMounted(() => {
	void loadRooms()
	void loadVoiceRuntime()
	runtimePollTimer = window.setInterval(() => {
		const state = voiceRuntime.value?.state
		if (state && !['READY', 'DISABLED', 'UNSUPPORTED_PLATFORM'].includes(state)) {
			void loadVoiceRuntime()
		}
	}, 5000)
})

onBeforeUnmount(() => {
	if (runtimePollTimer) window.clearInterval(runtimePollTimer)
	stopVoiceLogPolling()
})

</script>

<template>
	<div class="flex w-full flex-col gap-4">
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<h2 class="m-0 text-xl font-bold text-contrast">{{ formatMessage(messages.title) }}</h2>
				<p class="m-0 mt-1 max-w-xl text-sm text-secondary">
					{{ formatMessage(messages.subtitle) }}
				</p>
			</div>
			<button
				type="button"
				class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110"
				@click="openCreate"
			>
				{{ formatMessage(messages.createRoom) }}
			</button>
		</div>

		<div
			v-if="voiceRuntime"
			class="flex flex-wrap items-center gap-3 rounded-xl border border-solid border-surface-5 bg-bg-raised px-4 py-3"
		>
			<span
				class="size-2.5 shrink-0 rounded-full"
				:class="
					voiceRuntime.state === 'READY'
						? 'bg-green'
						: voiceRuntime.state === 'FAILED'
							? 'bg-red'
							: 'bg-yellow'
				"
			></span>
			<div class="min-w-0 flex-1">
				<p class="m-0 text-sm font-semibold text-contrast">
					{{ formatMessage(messages.voiceRuntimeTitle) }}
				</p>
				<p class="m-0 truncate text-xs text-secondary">
					{{ voiceRuntimeLabel }} · LiveKit {{ voiceRuntime.version }}
					<span v-if="voiceRuntime.progress != null"> · {{ voiceRuntime.progress }}%</span>
				</p>
			</div>
			<button
				type="button"
				class="rounded-lg bg-button-bg px-3 py-1.5 text-xs font-semibold text-contrast hover:brightness-110"
				@click="openVoiceLogs"
			>
				{{ formatMessage(messages.voiceLogs) }}
			</button>
			<button
				type="button"
				class="rounded-lg bg-button-bg px-3 py-1.5 text-xs font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
				:disabled="voiceConfigLoading"
				@click="openVoiceConfig"
			>
				{{ formatMessage(messages.voiceConfig) }}
			</button>
			<button
				v-if="voiceRuntime.state === 'FAILED' || voiceRuntime.state === 'UNSUPPORTED_PLATFORM'"
				type="button"
				class="rounded-lg bg-yellow/20 px-3 py-1.5 text-xs font-semibold text-yellow hover:brightness-110 disabled:opacity-50"
				:disabled="runtimeRetrying || voiceRuntime.state === 'UNSUPPORTED_PLATFORM'"
				@click="retryVoiceRuntime"
			>
				{{ formatMessage(messages.voiceRetry) }}
			</button>
		</div>

		<div
			v-if="loading"
			class="flex min-h-48 items-center justify-center gap-2 text-sm text-secondary"
		>
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
			v-else-if="!rooms.length"
			class="m-0 rounded-lg border border-solid border-surface-5 bg-bg-raised p-4 text-sm text-secondary"
		>
			{{ formatMessage(messages.empty) }}
		</p>
		<div v-else class="grid gap-3 lg:grid-cols-2">
			<article
				v-for="room in rooms"
				:key="room.id"
				class="flex flex-col gap-3 rounded-xl border border-solid border-surface-5 bg-bg-raised p-4"
			>
				<div class="flex items-start gap-3">
					<RoomAvatar
						:room-id="room.id"
						:avatar-attachment-id="room.avatarAttachmentId"
						:name="room.name"
						size="lg"
					/>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<h3 class="m-0 truncate text-base font-bold text-contrast">{{ room.name }}</h3>
							<span
								class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
								:class="
									room.visibility === 'PUBLIC'
										? 'bg-brand text-contrast'
										: 'bg-button-bg text-secondary'
								"
							>
								{{
									room.visibility === 'PUBLIC'
										? formatMessage(messages.visibilityPublic)
										: formatMessage(messages.visibilityPrivate)
								}}
							</span>
							<span
								v-if="room.kind === 'SETTLEMENT'"
								class="rounded-full bg-yellow/20 px-2 py-0.5 text-[10px] font-semibold text-yellow"
							>
								{{ formatMessage(messages.kindSettlement) }}
							</span>
							<span
								v-if="room.voiceEnabled"
								class="rounded-full bg-green/20 px-2 py-0.5 text-[10px] font-semibold text-green"
							>
								{{ formatMessage(messages.voiceBadge) }}
							</span>
						</div>
						<p
							v-if="room.description"
							class="m-0 mt-1 line-clamp-2 text-xs whitespace-pre-wrap text-secondary"
						>
							{{ room.description }}
						</p>
						<p class="m-0 mt-1 text-[11px] text-secondary">
							{{ formatDateTime(room.createdAt) }}
						</p>
					</div>
				</div>

				<div class="flex flex-wrap items-center gap-2">
					<span
						v-for="perm in room.prerequisitePermissions"
						:key="perm"
						class="rounded bg-bg px-2 py-0.5 font-mono text-[10px] text-secondary"
					>
						{{ perm }}
					</span>
					<button
						v-if="room.kind === 'SETTLEMENT'"
						type="button"
						class="rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110"
						@click="openOwner(room)"
					>
						{{ formatMessage(messages.ownerTitle) }}
					</button>
					<button
						type="button"
						class="rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110"
						@click="openManager(room)"
					>
						{{ formatMessage(messages.managers) }}
					</button>
					<button
						type="button"
						class="rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110"
						@click="openAudit(room)"
					>
						{{ formatMessage(messages.audit) }}
					</button>
					<button
						v-if="room.voiceEnabled"
						type="button"
						class="rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110"
						@click="openCapacity(room)"
					>
						{{ formatMessage(messages.voiceCapacity) }}
					</button>
					<button
						type="button"
						class="ml-auto rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110"
						@click="openEdit(room)"
					>
						{{ formatMessage(messages.edit) }}
					</button>
					<button
						type="button"
						class="rounded-lg bg-red/20 px-3 py-1 text-xs font-semibold text-red hover:brightness-110 disabled:opacity-50"
						:disabled="deletingId === room.id"
						@click="removeRoom(room)"
					>
						{{ formatMessage(messages.remove) }}
					</button>
				</div>
			</article>
		</div>

		<div
			v-if="editorOpen"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			@click.self="closeEditor"
		>
			<div
				class="flex max-h-[88vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl bg-bg p-6"
			>
				<h3 class="m-0 text-lg font-bold text-contrast">{{ editorTitle }}</h3>

				<label class="flex flex-col gap-1">
					<span class="text-xs font-semibold text-secondary">
						{{ formatMessage(messages.name) }}
					</span>
					<input
						v-model="form.name"
						type="text"
						maxlength="80"
						class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
					/>
				</label>

				<label class="flex flex-col gap-1">
					<span class="text-xs font-semibold text-secondary">
						{{ formatMessage(messages.description) }}
					</span>
					<textarea
						v-model="form.description"
						rows="3"
						maxlength="500"
						class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
					></textarea>
				</label>

				<div class="grid gap-3 sm:grid-cols-2">
					<label class="flex flex-col gap-1">
						<span class="text-xs font-semibold text-secondary">
							{{ formatMessage(messages.visibility) }}
						</span>
						<select
							v-model="form.visibility"
							class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
						>
							<option value="PUBLIC">{{ formatMessage(messages.visibilityPublic) }}</option>
							<option value="PRIVATE">{{ formatMessage(messages.visibilityPrivate) }}</option>
						</select>
					</label>
					<label v-if="!editingRoom" class="flex flex-col gap-1">
						<span class="text-xs font-semibold text-secondary">
							{{ formatMessage(messages.kind) }}
						</span>
						<select
							v-model="form.kind"
							class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
						>
							<option value="STANDARD">{{ formatMessage(messages.kindStandard) }}</option>
							<option value="SETTLEMENT">{{ formatMessage(messages.kindSettlement) }}</option>
						</select>
					</label>
				</div>

				<RoomAvatarEditor
					v-model:token="avatarToken"
					v-model:remove="avatarRemove"
					v-model:uploading="avatarUploading"
					:room-id="editingRoom?.id ?? 0"
					:avatar-attachment-id="editingRoom?.avatarAttachmentId ?? null"
					:name="form.name"
				/>

				<div class="flex flex-col gap-2 rounded-lg border border-solid border-surface-5 p-3">
					<div class="flex flex-wrap items-end gap-3">
						<label class="flex flex-col gap-1">
							<span class="text-xs font-semibold text-secondary">
								{{ formatMessage(messages.prerequisiteMode) }}
							</span>
							<select
								v-model="form.prerequisiteMode"
								class="rounded-lg border border-solid border-surface-5 bg-bg px-2 py-1 text-xs text-contrast outline-none focus:border-brand"
							>
								<option value="ANY">{{ formatMessage(messages.prerequisiteAny) }}</option>
								<option value="ALL">{{ formatMessage(messages.prerequisiteAll) }}</option>
							</select>
						</label>
						<label class="flex flex-1 flex-col gap-1">
							<span class="text-xs font-semibold text-secondary">
								{{ formatMessage(messages.prerequisitePermissions) }}
							</span>
							<input
								v-model="form.prerequisitePermissions"
								type="text"
								class="rounded-lg border border-solid border-surface-5 bg-bg px-2 py-1 text-xs text-contrast outline-none focus:border-brand"
							/>
						</label>
					</div>
					<p class="m-0 text-[11px] text-secondary">
						{{ formatMessage(messages.prerequisiteHint) }}
					</p>
				</div>

				<div class="flex justify-end gap-2 border-t border-solid border-surface-5 pt-3">
					<button
						type="button"
						class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110 disabled:opacity-50"
						:disabled="saving"
						@click="closeEditor"
					>
						{{ formatMessage(messages.cancel) }}
					</button>
					<button
						type="button"
						class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
						:disabled="saving || !form.name.trim() || avatarUploading"
						@click="submit"
					>
						{{ formatMessage(messages.save) }}
					</button>
				</div>
			</div>
		</div>

		<div
			v-if="managerRoom"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			@click.self="closeManager"
		>
			<div
				class="flex max-h-[88vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl bg-bg p-6"
			>
				<h3 class="m-0 text-lg font-bold text-contrast">
					{{ formatMessage(messages.managerTitle) }} · {{ managerRoom.name }}
				</h3>
				<p class="m-0 text-xs text-secondary">{{ formatMessage(messages.managerHint) }}</p>
				<ChatUserPicker
					v-model="managerUser"
					:room-id="managerRoom.id"
					:label="formatMessage(messages.managerTitle)"
				/>
				<div class="flex justify-end gap-2 border-t border-solid border-surface-5 pt-3">
					<button
						type="button"
						class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110"
						@click="closeManager"
					>
						{{ formatMessage(messages.cancel) }}
					</button>
					<button
						type="button"
						class="rounded-lg bg-red/20 px-4 py-2 text-sm font-semibold text-red hover:brightness-110 disabled:opacity-50"
						:disabled="!managerUser || managerGranting"
						@click="grantManager(false)"
					>
						{{ formatMessage(messages.revoke) }}
					</button>
					<button
						type="button"
						class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
						:disabled="!managerUser || managerGranting"
						@click="grantManager(true)"
					>
						{{ formatMessage(messages.grant) }}
					</button>
				</div>
			</div>
		</div>

		<div
			v-if="ownerRoom"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			@click.self="closeOwner"
		>
			<div
				class="flex max-h-[88vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl bg-bg p-6"
			>
				<h3 class="m-0 text-lg font-bold text-contrast">
					{{ formatMessage(messages.ownerTitle) }} · {{ ownerRoom.name }}
				</h3>
				<p class="m-0 text-xs text-secondary">{{ formatMessage(messages.ownerHint) }}</p>
				<p class="m-0 text-xs text-secondary">
					{{
						ownerRoom.settlementOwnerName
							? formatMessage(messages.ownerCurrent, { name: ownerRoom.settlementOwnerName })
							: formatMessage(messages.ownerNone)
					}}
				</p>
				<ChatUserPicker
					v-model="ownerUser"
					:room-id="ownerRoom.id"
					:label="formatMessage(messages.ownerTitle)"
				/>
				<div class="flex justify-end gap-2 border-t border-solid border-surface-5 pt-3">
					<button
						type="button"
						class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110"
						@click="closeOwner"
					>
						{{ formatMessage(messages.cancel) }}
					</button>
					<button
						type="button"
						class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
						:disabled="!ownerUser || ownerSaving"
						@click="assignOwner"
					>
						{{ formatMessage(messages.save) }}
					</button>
				</div>
			</div>
		</div>

		<div
			v-if="auditRoom"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			@click.self="closeAudit"
		>
			<div
				class="flex max-h-[88vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-xl bg-bg p-6"
			>
				<h3 class="m-0 text-lg font-bold text-contrast">
					{{ formatMessage(messages.auditTitle) }} · {{ auditRoom.name }}
				</h3>
				<div
					v-if="auditLoading"
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
				<div v-else class="flex flex-col gap-1.5">
					<div
						v-for="entry in auditItems"
						:key="entry.id"
						class="flex flex-wrap items-center gap-2 rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2"
					>
						<span class="text-xs font-semibold text-contrast">{{ auditLabel(entry.action) }}</span>
						<span class="text-[11px] text-secondary">{{ auditActor(entry.actorName) }}</span>
						<span
							v-if="entry.target"
							class="text-[11px] text-secondary"
						>
							{{ formatMessage(messages.auditTarget, { name: entry.target }) }}
						</span>
						<span class="ml-auto text-[10px] text-secondary">
							{{ formatDateTime(entry.createdAt) }}
						</span>
					</div>
				</div>
				<div class="flex justify-end border-t border-solid border-surface-5 pt-3">
					<button
						type="button"
						class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110"
						@click="closeAudit"
					>
						{{ formatMessage(messages.close) }}
					</button>
				</div>
			</div>
		</div>
	</div>
</template>
