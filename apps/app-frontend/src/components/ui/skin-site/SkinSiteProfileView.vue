<script setup lang="ts">
import { SpinnerIcon, TrashIcon, UploadIcon } from '@modrinth/assets'
import { Avatar, defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import SkinPreviewRenderer from '@modrinth/ui/src/components/skin/SkinPreviewRenderer.vue'
import { computed, onMounted, ref, watch } from 'vue'

import {
	requestSkinSitePlayers,
	skinSitePlayers,
	skinSitePlayersStatus,
	skinSiteStatus,
	skinSiteUser,
} from '@/composables/skin-site-session'
import {
	skinSiteAddPlayer,
	skinSiteClearDefaultPlayer,
	skinSiteDefaultPlayer,
	skinSiteDeletePlayer,
	skinSiteDeleteTexture,
	type SkinSitePlayerSkin,
	skinSitePlayerSkin,
	skinSiteRenamePlayer,
	skinSiteSetDefaultPlayer,
	skinSiteSwitchMojang,
	skinSiteUploadTexture,
	type SkinTextureType,
} from '@/helpers/skin-site-api'

const { formatMessage } = useVIntl()
const { handleError, addNotification } = injectNotificationManager()

const emit = defineEmits<{ (e: 'back'): void }>()

const messages = defineMessages({
	title: { id: 'app.skin-site.profile-view.title', defaultMessage: 'Your players' },
	signedOut: {
		id: 'app.skin-site.profile-view.signed-out',
		defaultMessage: 'Sign in to manage your players.',
	},
	loading: { id: 'app.skin-site.profile-view.loading', defaultMessage: 'Loading players…' },
	noPlayers: {
		id: 'app.skin-site.profile-view.no-players',
		defaultMessage: 'No players yet.',
	},
	selectHint: {
		id: 'app.skin-site.profile-view.select-hint',
		defaultMessage: 'Select a player to preview and edit its textures.',
	},
	skin: { id: 'app.skin-site.profile-view.skin', defaultMessage: 'Skin' },
	cape: { id: 'app.skin-site.profile-view.cape', defaultMessage: 'Cape' },
	elytra: { id: 'app.skin-site.profile-view.elytra', defaultMessage: 'Elytra' },
	upload: { id: 'app.skin-site.profile-view.upload', defaultMessage: 'Upload' },
	remove: { id: 'app.skin-site.profile-view.remove', defaultMessage: 'Remove' },
	readonly: {
		id: 'app.skin-site.profile-view.readonly',
		defaultMessage: 'Mojang accounts are managed by Mojang; textures cannot be edited here.',
	},
	uploaded: { id: 'app.skin-site.profile-view.uploaded', defaultMessage: 'Texture updated.' },
	removed: { id: 'app.skin-site.profile-view.removed', defaultMessage: 'Texture removed.' },
	back: { id: 'app.skin-site.profile-view.back', defaultMessage: 'Back to home' },
	addPlayer: { id: 'app.skin-site.profile-view.add-player', defaultMessage: 'New player' },
	playerNamePlaceholder: {
		id: 'app.skin-site.profile-view.player-name-placeholder',
		defaultMessage: 'Player name',
	},
	confirm: { id: 'app.skin-site.profile-view.confirm', defaultMessage: 'Confirm' },
	cancel: { id: 'app.skin-site.profile-view.cancel', defaultMessage: 'Cancel' },
	rename: { id: 'app.skin-site.profile-view.rename', defaultMessage: 'Rename' },
	delete: { id: 'app.skin-site.profile-view.delete', defaultMessage: 'Delete' },
	setDefault: { id: 'app.skin-site.profile-view.set-default', defaultMessage: 'Set as default' },
	clearDefault: {
		id: 'app.skin-site.profile-view.clear-default',
		defaultMessage: 'Clear default',
	},
	toggleMojang: {
		id: 'app.skin-site.profile-view.toggle-mojang',
		defaultMessage: 'Toggle Mojang',
	},
	isDefault: { id: 'app.skin-site.profile-view.is-default', defaultMessage: 'Default' },
	added: { id: 'app.skin-site.profile-view.added', defaultMessage: 'Player added.' },
	renamed: { id: 'app.skin-site.profile-view.renamed', defaultMessage: 'Player renamed.' },
	deleted: { id: 'app.skin-site.profile-view.deleted', defaultMessage: 'Player deleted.' },
	defaultSet: {
		id: 'app.skin-site.profile-view.default-set',
		defaultMessage: 'Default player updated.',
	},
	mojangToggled: {
		id: 'app.skin-site.profile-view.mojang-toggled',
		defaultMessage: 'Mojang status updated.',
	},
	deleteConfirm: {
		id: 'app.skin-site.profile-view.delete-confirm',
		defaultMessage: 'Delete this player? This cannot be undone.',
	},
	mojangConfirm: {
		id: 'app.skin-site.profile-view.mojang-confirm',
		defaultMessage: 'Toggle Mojang status for this player?',
	},
	renameConfirm: {
		id: 'app.skin-site.profile-view.rename-confirm',
		defaultMessage: 'Rename this player?',
	},
})
const selectedId = ref<string | null>(null)
const texture = ref<SkinSitePlayerSkin>({})
const loadingTexture = ref(false)
const uploading = ref<SkinTextureType | null>(null)

const signedIn = computed(() => skinSiteStatus.value === 'signed-in' && !!skinSiteUser.value)
const players = computed(() => skinSitePlayers.value)
const playersLoading = computed(
	() => skinSitePlayersStatus.value === 'checking' || skinSitePlayersStatus.value === 'idle',
)
const selectedPlayer = computed(
	() => players.value.find((p) => p.uuid === selectedId.value) ?? null,
)
const editable = computed(() => !!selectedPlayer.value && !selectedPlayer.value.isMojang)

const skinVariant = computed<'CLASSIC' | 'SLIM'>(() =>
	texture.value.model === 'slim' ? 'SLIM' : 'CLASSIC',
)

function selectPlayer(id: string) {
	selectedId.value = id
}

async function loadTexture(uuid: string) {
	loadingTexture.value = true
	texture.value = {}
	try {
		const result = await skinSitePlayerSkin(uuid)
		if (result.success && result.payload) texture.value = result.payload
	} catch (error) {
		handleError(error)
	} finally {
		loadingTexture.value = false
	}
}

watch(selectedId, (id) => {
	if (id) void loadTexture(id)
	else texture.value = {}
})

// --- Player management ---
const defaultUuid = ref<string | null>(null)
const busy = ref<string | null>(null)

async function loadDefaultPlayer() {
	if (!signedIn.value) {
		defaultUuid.value = null
		return
	}
	try {
		const res = await skinSiteDefaultPlayer()
		defaultUuid.value = res.success ? (res.payload?.uuid ?? null) : null
	} catch {
		defaultUuid.value = null
	}
}

const showAdd = ref(false)
const newName = ref('')
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const confirmingRename = ref(false)
const confirmingDeleteId = ref<string | null>(null)
const confirmingMojangId = ref<string | null>(null)

function resetDialogs() {
	showAdd.value = false
	newName.value = ''
	renamingId.value = null
	renameValue.value = ''
	confirmingRename.value = false
	confirmingDeleteId.value = null
	confirmingMojangId.value = null
}

async function submitAdd() {
	const name = newName.value.trim()
	if (!name || busy.value) return
	busy.value = 'add'
	try {
		const res = await skinSiteAddPlayer(name)
		if (!res.success) throw new Error(res.errorMessage)
		addNotification({ type: 'success', title: formatMessage(messages.added) })
		resetDialogs()
		await requestSkinSitePlayers()
		await loadDefaultPlayer()
	} catch (error) {
		handleError(error)
	} finally {
		busy.value = null
	}
}

function startRename(player: { uuid: string; name: string }) {
	renamingId.value = player.uuid
	renameValue.value = player.name
	confirmingRename.value = false
}

function requestRename() {
	const name = renameValue.value.trim()
	if (!renamingId.value || !name) return
	confirmingRename.value = true
}

async function submitRename() {
	const name = renameValue.value.trim()
	if (!renamingId.value || !name || busy.value) return
	if (!confirmingRename.value) {
		confirmingRename.value = true
		return
	}
	busy.value = 'rename'
	try {
		const res = await skinSiteRenamePlayer(renamingId.value, name)
		if (!res.success) throw new Error(res.errorMessage)
		addNotification({ type: 'success', title: formatMessage(messages.renamed) })
		resetDialogs()
		await requestSkinSitePlayers()
	} catch (error) {
		handleError(error)
	} finally {
		busy.value = null
	}
}

function requestDelete(uuid: string) {
	if (busy.value) return
	confirmingDeleteId.value = uuid
}

async function submitDelete(uuid: string) {
	if (busy.value) return
	if (confirmingDeleteId.value !== uuid) {
		confirmingDeleteId.value = uuid
		return
	}
	busy.value = 'delete'
	try {
		const res = await skinSiteDeletePlayer(uuid)
		if (!res.success) throw new Error(res.errorMessage)
		addNotification({ type: 'success', title: formatMessage(messages.deleted) })
		resetDialogs()
		if (selectedId.value === uuid) selectedId.value = null
		await requestSkinSitePlayers()
		await loadDefaultPlayer()
	} catch (error) {
		handleError(error)
	} finally {
		busy.value = null
	}
}

async function setDefaultPlayer(uuid: string) {
	if (busy.value) return
	busy.value = 'default'
	try {
		const res = await skinSiteSetDefaultPlayer(uuid)
		if (!res.success) throw new Error(res.errorMessage)
		addNotification({ type: 'success', title: formatMessage(messages.defaultSet) })
		await loadDefaultPlayer()
	} catch (error) {
		handleError(error)
	} finally {
		busy.value = null
	}
}

async function clearDefaultPlayer() {
	if (busy.value) return
	busy.value = 'default'
	try {
		const res = await skinSiteClearDefaultPlayer()
		if (!res.success) throw new Error(res.errorMessage)
		addNotification({ type: 'success', title: formatMessage(messages.defaultSet) })
		await loadDefaultPlayer()
	} catch (error) {
		handleError(error)
	} finally {
		busy.value = null
	}
}

function requestToggleMojang(uuid: string) {
	if (busy.value) return
	confirmingMojangId.value = uuid
}

async function toggleMojang(uuid: string) {
	if (busy.value) return
	if (confirmingMojangId.value !== uuid) {
		confirmingMojangId.value = uuid
		return
	}
	busy.value = 'mojang'
	try {
		const res = await skinSiteSwitchMojang(uuid)
		if (!res.success) throw new Error(res.errorMessage)
		addNotification({ type: 'success', title: formatMessage(messages.mojangToggled) })
		await requestSkinSitePlayers()
		await loadDefaultPlayer()
	} catch (error) {
		handleError(error)
	} finally {
		busy.value = null
	}
}

async function onUpload(type: SkinTextureType, event: Event) {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (!file || !selectedId.value) return
	uploading.value = type
	try {
		const metadata: Record<string, string> = {}
		if (type === 'SKIN') metadata.model = texture.value.model ?? 'default'
		const result = await skinSiteUploadTexture(selectedId.value, file, type, metadata)
		if (!result.success) {
			handleError(new Error(result.errorMessage))
			return
		}
		addNotification({ type: 'success', title: formatMessage(messages.uploaded) })
		await loadTexture(selectedId.value)
	} catch (error) {
		handleError(error)
	} finally {
		uploading.value = null
	}
}

async function removeTexture(type: SkinTextureType) {
	if (!selectedId.value) return
	uploading.value = type
	try {
		const result = await skinSiteDeleteTexture(selectedId.value, type)
		if (!result.success) {
			handleError(new Error(result.errorMessage))
			return
		}
		addNotification({ type: 'success', title: formatMessage(messages.removed) })
		await loadTexture(selectedId.value)
	} catch (error) {
		handleError(error)
	} finally {
		uploading.value = null
	}
}

onMounted(() => {
	if (signedIn.value) {
		void requestSkinSitePlayers().catch(() => {})
		void loadDefaultPlayer()
	}
})

watch(signedIn, (value) => {
	if (value) void requestSkinSitePlayers().catch(() => {})
})
</script>
<template>
	<div class="flex flex-col gap-4">
		<button
			type="button"
			class="flex w-fit items-center gap-1 rounded-full bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110"
			@click="emit('back')"
		>
			← {{ formatMessage(messages.back) }}
		</button>

		<div v-if="!signedIn" class="rounded-2xl border border-solid border-surface-5 bg-bg-raised p-4">
			<p class="m-0 text-sm text-secondary">{{ formatMessage(messages.signedOut) }}</p>
		</div>

		<div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
			<!-- Player list -->
			<div
				class="flex flex-col gap-2 rounded-2xl border border-solid border-surface-5 bg-bg-raised p-3"
			>
				<div class="flex items-center justify-between gap-2">
					<h3 class="m-0 text-base font-semibold text-contrast">
						{{ formatMessage(messages.title) }}
					</h3>
					<button
						v-if="!showAdd"
						type="button"
						class="shrink-0 rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-contrast hover:brightness-110"
						@click="showAdd = true"
					>
						+ {{ formatMessage(messages.addPlayer) }}
					</button>
				</div>

				<div v-if="showAdd" class="flex flex-col gap-1.5 rounded-xl bg-button-bg p-2">
					<input
						v-model="newName"
						type="text"
						:placeholder="formatMessage(messages.playerNamePlaceholder)"
						class="w-full rounded-lg border border-solid border-surface-5 bg-bg px-2 py-1 text-xs text-contrast outline-none focus:border-brand"
						@keyup.enter="submitAdd"
					/>
					<div class="flex gap-1.5">
						<button
							type="button"
							class="flex-1 rounded-lg bg-brand px-2 py-1 text-xs font-semibold text-contrast disabled:opacity-50"
							:disabled="busy === 'add' || !newName.trim()"
							@click="submitAdd"
						>
							{{ formatMessage(messages.confirm) }}
						</button>
						<button
							type="button"
							class="rounded-lg bg-bg-raised px-2 py-1 text-xs font-semibold text-secondary"
							@click="resetDialogs"
						>
							{{ formatMessage(messages.cancel) }}
						</button>
					</div>
				</div>

				<div
					v-if="renamingId"
					class="flex flex-col gap-1.5 rounded-xl bg-button-bg p-2"
				>
					<input
						v-model="renameValue"
						type="text"
						:placeholder="formatMessage(messages.playerNamePlaceholder)"
						class="w-full rounded-lg border border-solid border-surface-5 bg-bg px-2 py-1 text-xs text-contrast outline-none focus:border-brand"
						@keyup.enter="submitRename"
					/>
					<p v-if="confirmingRename" class="m-0 text-[11px] text-secondary">
						{{ formatMessage(messages.renameConfirm) }}
					</p>
					<div class="flex gap-1.5">
						<button
							type="button"
							class="flex-1 rounded-lg bg-brand px-2 py-1 text-xs font-semibold text-contrast disabled:opacity-50"
							:disabled="busy === 'rename' || !renameValue.trim()"
							@click="submitRename"
						>
							{{ formatMessage(confirmingRename ? messages.confirm : messages.rename) }}
						</button>
						<button
							type="button"
							class="rounded-lg bg-bg-raised px-2 py-1 text-xs font-semibold text-secondary"
							@click="resetDialogs"
						>
							{{ formatMessage(messages.cancel) }}
						</button>
					</div>
				</div>

				<div v-if="playersLoading" class="flex items-center gap-2 text-sm text-secondary">
					<SpinnerIcon class="size-4 animate-spin" />
					{{ formatMessage(messages.loading) }}
				</div>
				<p v-else-if="!players.length" class="m-0 text-sm text-secondary">
					{{ formatMessage(messages.noPlayers) }}
				</p>
<div
	v-for="player in players"
	:key="player.uuid"
	class="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors"
	:class="
		player.uuid === selectedId
			? 'bg-brand-highlight text-contrast'
			: 'bg-button-bg hover:brightness-110'
	"
	@click="selectPlayer(player.uuid)"
>
					<Avatar
						:src="player.headDataUrl"
						:alt="player.name"
						size="1.75rem"
						pixelated
						class="!rounded-md"
					/>
					<span class="min-w-0 flex-1 truncate text-sm font-medium">{{ player.name }}</span>
					<span
						v-if="defaultUuid === player.uuid"
						class="shrink-0 rounded bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-contrast"
					>
						{{ formatMessage(messages.isDefault) }}
					</span>
					<span v-if="player.isMojang" class="shrink-0 text-[10px] uppercase text-secondary"
						>Mojang</span
					>
					<div class="flex shrink-0 items-center gap-1">
						<button
							v-if="defaultUuid === player.uuid"
							type="button"
							class="rounded px-1.5 py-0.5 text-[10px] font-semibold text-brand"
							:disabled="busy !== null"
							@click.stop="clearDefaultPlayer"
						>
							{{ formatMessage(messages.clearDefault) }}
						</button>
						<button
							v-else
							type="button"
							class="rounded px-1.5 py-0.5 text-[10px] font-semibold text-secondary hover:bg-bg"
							:disabled="busy !== null"
							@click.stop="setDefaultPlayer(player.uuid)"
						>
							{{ formatMessage(messages.setDefault) }}
						</button>
						<button
							type="button"
							class="rounded px-1.5 py-0.5 text-[10px] font-semibold text-secondary hover:bg-bg"
							:disabled="busy !== null"
							@click.stop="startRename(player)"
						>
							{{ formatMessage(messages.rename) }}
						</button>
						<button
							type="button"
							class="rounded px-1.5 py-0.5 text-[10px] font-semibold text-secondary hover:bg-bg"
							:disabled="busy !== null"
							@click.stop="requestToggleMojang(player.uuid)"
						>
							{{ formatMessage(messages.toggleMojang) }}
						</button>
						<button
							v-if="confirmingDeleteId === player.uuid"
							type="button"
							class="rounded bg-red px-1.5 py-0.5 text-[10px] font-semibold text-contrast"
							:disabled="busy !== null"
							@click.stop="submitDelete(player.uuid)"
						>
							{{ formatMessage(messages.confirm) }}
						</button>
						<button
							v-else
							type="button"
							class="rounded px-1.5 py-0.5 text-[10px] font-semibold text-red hover:bg-bg"
							:disabled="busy !== null"
							@click.stop="requestDelete(player.uuid)"
						>
							{{ formatMessage(messages.delete) }}
						</button>
						<button
							v-if="confirmingDeleteId === player.uuid || confirmingMojangId === player.uuid"
							type="button"
							class="rounded px-1.5 py-0.5 text-[10px] font-semibold text-secondary hover:bg-bg"
							@click.stop="resetDialogs"
						>
							{{ formatMessage(messages.cancel) }}
						</button>
					</div>
				</div>
				<div
					v-if="confirmingDeleteId === player.uuid"
					class="rounded-lg bg-button-bg px-2 py-1 text-[11px] text-red"
				>
					{{ formatMessage(messages.deleteConfirm) }}
				</div>
				<div
					v-if="confirmingMojangId === player.uuid"
					class="rounded-lg bg-button-bg px-2 py-1 text-[11px] text-secondary"
				>
					{{ formatMessage(messages.mojangConfirm) }}
					<button
						type="button"
						class="ml-1 rounded bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-contrast"
						:disabled="busy !== null"
						@click.stop="toggleMojang(player.uuid)"
					>
						{{ formatMessage(messages.confirm) }}
					</button>
				</div>
			</div>

			<!-- Preview + texture actions -->
			<div
				class="flex flex-col gap-4 rounded-2xl border border-solid border-surface-5 bg-bg-raised p-4"
			>
				<p v-if="!selectedPlayer" class="m-0 text-sm text-secondary">
					{{ formatMessage(messages.selectHint) }}
				</p>

				<template v-else>
					<div class="flex flex-wrap items-center gap-2">
						<h3 class="m-0 text-base font-semibold text-contrast">{{ selectedPlayer.name }}</h3>
						<span
							v-if="defaultUuid === selectedPlayer.uuid"
							class="rounded bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-contrast"
						>
							{{ formatMessage(messages.isDefault) }}
						</span>
						<span v-if="selectedPlayer.isMojang" class="text-xs text-secondary">Mojang</span>
						<button
							v-if="confirmingMojangId === selectedPlayer.uuid"
							type="button"
							class="rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-contrast"
							:disabled="busy !== null"
							@click="toggleMojang(selectedPlayer.uuid)"
						>
							{{ formatMessage(messages.confirm) }}
						</button>
						<button
							v-else
							type="button"
							class="rounded-full bg-button-bg px-2.5 py-1 text-xs font-semibold text-secondary hover:brightness-110"
							:disabled="busy !== null"
							@click="requestToggleMojang(selectedPlayer.uuid)"
						>
							{{ formatMessage(messages.toggleMojang) }}
						</button>
					</div>
					<p v-if="confirmingMojangId === selectedPlayer.uuid" class="m-0 text-xs text-secondary">
						{{ formatMessage(messages.mojangConfirm) }}
					</p>

					<div class="relative h-80 w-full overflow-hidden rounded-xl bg-button-bg">
						<div v-if="loadingTexture" class="absolute inset-0 flex items-center justify-center">
							<SpinnerIcon class="size-6 animate-spin text-secondary" />
						</div>
						<SkinPreviewRenderer
							v-else
							:key="selectedId ?? ''"
							:texture-src="texture.skin ?? ''"
							:cape-src="texture.cape"
							:variant="skinVariant"
							:nametag="selectedPlayer.name"
							:initial-rotation="Math.PI / 8"
							class="size-full"
						/>
					</div>

					<p v-if="!editable" class="m-0 text-xs text-secondary">
						{{ formatMessage(messages.readonly) }}
					</p>

					<div v-else class="flex flex-col gap-2">
						<div
							v-for="entry in [
								{ type: 'SKIN' as SkinTextureType, label: messages.skin, value: texture.skin },
								{ type: 'CAPE' as SkinTextureType, label: messages.cape, value: texture.cape },
								{
									type: 'ELYTRA' as SkinTextureType,
									label: messages.elytra,
									value: texture.elytra,
								},
							]"
							:key="entry.type"
							class="flex items-center gap-2 rounded-xl bg-button-bg px-3 py-2"
						>
							<span class="min-w-0 flex-1 text-sm font-medium text-contrast">
								{{ formatMessage(entry.label) }}
							</span>
							<span class="shrink-0 text-xs text-secondary">
								{{ entry.value ? '✓' : '—' }}
							</span>
							<label
								class="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-contrast"
							>
								<UploadIcon class="size-3" />
								{{ formatMessage(messages.upload) }}
								<input
									type="file"
									accept="image/png"
									class="hidden"
									:disabled="uploading !== null"
									@change="(e) => onUpload(entry.type, e)"
								/>
							</label>
							<button
								v-if="entry.value"
								type="button"
								class="flex shrink-0 items-center gap-1 rounded-full bg-button-bg px-3 py-1 text-xs font-semibold text-red"
								:disabled="uploading !== null"
								@click="removeTexture(entry.type)"
							>
								<TrashIcon class="size-3" />
								{{ formatMessage(messages.remove) }}
							</button>
						</div>
					</div>
				</template>
			</div>
		</div>
	</div>
</template>
