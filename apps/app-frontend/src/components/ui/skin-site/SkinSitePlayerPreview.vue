<script setup lang="ts">
import { RefreshCwIcon, SpinnerIcon, UserIcon } from '@modrinth/assets'
import { ButtonStyled, commonMessages, defineMessages, useVIntl } from '@modrinth/ui'
import SkinPreviewRenderer from '@modrinth/ui/src/components/skin/SkinPreviewRenderer.vue'
import type { Ref } from 'vue'
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import type AccountsCard from '@/components/ui/AccountsCard.vue'
import {
	requestSkinSitePlayers,
	selectedSkinSitePlayerId,
	skinSitePlayers,
	skinSitePlayersStatus,
	skinSiteStatus,
} from '@/composables/skin-site-session'
import { fetchImageAsDataUrl } from '@/helpers/skin-site-render'
import { get_normalized_skin_texture } from '@/helpers/skins'

import SkinSiteSelectionRail from './SkinSiteSelectionRail.vue'

const { formatMessage } = useVIntl()
const router = useRouter()
const accountsCard = inject<Ref<InstanceType<typeof AccountsCard> | undefined>>('accountsCard')
const pendingId = ref<string | null>(null)
const messages = defineMessages({
	players: { id: 'app.skin-site.home.preview.players', defaultMessage: 'Players' },
	empty: { id: 'app.skin-site.home.preview.empty', defaultMessage: 'No players yet' },
	emptyHint: {
		id: 'app.skin-site.home.preview.empty-hint',
		defaultMessage: 'Sign in or add a Minecraft account in the sidebar to see your skin here.',
	},
	unavailable: {
		id: 'app.skin-site.home.preview.unavailable',
		defaultMessage: 'This player has no skin to preview.',
	},
	loading: { id: 'app.skin-site.home.preview.loading', defaultMessage: 'Loading players…' },
	skinLoading: { id: 'app.skin-site.home.preview.skin-loading', defaultMessage: 'Loading skin…' },
	failed: {
		id: 'app.skin-site.home.preview.failed',
		defaultMessage: 'Could not load skin-site players.',
	},
	skinFailed: {
		id: 'app.skin-site.home.preview.skin-failed',
		defaultMessage: 'Could not load this skin.',
	},
	capeFailed: {
		id: 'app.skin-site.home.preview.cape-failed',
		defaultMessage: 'Could not load this cape.',
	},
	manage: { id: 'app.skin-site.home.preview.manage', defaultMessage: 'Manage skin' },
	choose: { id: 'app.skin-site.home.preview.choose', defaultMessage: 'Select a player' },
	chooseHint: {
		id: 'app.skin-site.home.preview.choose-hint',
		defaultMessage: 'Choose a player on the left to preview their skin.',
	},
})
const normalizeId = (id: string) => id.replaceAll('-', '').toLowerCase()
const players = computed(() =>
	(accountsCard?.value?.accounts ?? []).map((account) => {
		const sitePlayer =
			account.account_type === 'yggdrasil'
				? skinSitePlayers.value.find(
						(player) => normalizeId(player.uuid) === normalizeId(account.profile.id),
					)
				: undefined
		const skin = accountsCard?.value?.getAccountSkin(account)
		return {
			id: account.profile.id,
			label: account.profile.name,
			avatar: sitePlayer?.headDataUrl ?? accountsCard?.value?.getAccountAvatarUrl(account),
			texture: sitePlayer?.skinDataUrl ?? skin?.texture ?? '',
			cape:
				sitePlayer?.capeUrl ?? account.profile.capes?.find((cape) => cape.state === 'ACTIVE')?.url,
			skinState: sitePlayer?.skinState,
			variant: sitePlayer?.model
				? sitePlayer.model === 'slim'
					? ('SLIM' as const)
					: ('CLASSIC' as const)
				: (skin?.variant ?? 'CLASSIC'),
			account,
		}
	}),
)
const selectedId = computed(() => {
	const id = selectedSkinSitePlayerId.value ?? accountsCard?.value?.defaultUser
	return (
		players.value.find((player) => id && normalizeId(player.id) === normalizeId(id))?.id ?? null
	)
})
const selectedPlayer = computed(() =>
	players.value.find((player) => player.id === selectedId.value),
)
const loading = computed(
	() =>
		!players.value.length &&
		(skinSiteStatus.value === 'checking' ||
			skinSitePlayersStatus.value === 'checking' ||
			!accountsCard?.value),
)
const texture = ref('')
const textureLoading = ref(false)
const textureFailed = ref(false)
const textureRetrying = ref(false)
const capeTexture = ref('')
const capeFailed = ref(false)
const capeLoading = ref(false)
const previewFailed = computed(
	() =>
		textureFailed.value ||
		(!selectedPlayer.value?.texture && selectedPlayer.value?.skinState === 'error'),
)
const switching = computed(
	() => !!pendingId.value || !!accountsCard?.value?.accountSelectionPending,
)
let textureRevision = 0
let capeRevision = 0
let disposed = false

async function loadTexture() {
	if (disposed) return
	const player = selectedPlayer.value
	const revision = ++textureRevision
	texture.value = ''
	textureFailed.value = false
	textureLoading.value = !!player?.texture
	if (!player?.texture) return
	try {
		const normalized = await get_normalized_skin_texture({
			texture_key: `${player.id}:${player.texture}`,
			texture: player.texture,
			variant: player.variant,
			source: 'custom_external',
			is_equipped: true,
		})
		if (revision === textureRevision) texture.value = normalized
	} catch {
		if (revision !== textureRevision) return
		if (player.texture.startsWith('data:image/')) texture.value = player.texture
		else textureFailed.value = true
	} finally {
		if (revision === textureRevision) textureLoading.value = false
	}
}

async function retryTexture() {
	if (textureRetrying.value || textureLoading.value || switching.value) return
	const player = selectedPlayer.value
	if (!player) return
	textureRetrying.value = true
	const previousRevision = textureRevision
	try {
		if (player.skinState === 'error') await requestSkinSitePlayers()
		await nextTick()
		if (!disposed && selectedPlayer.value?.id === player.id && textureRevision === previousRevision)
			await loadTexture()
	} catch {
		if (!disposed && selectedPlayer.value?.id === player.id) textureFailed.value = true
	} finally {
		textureRetrying.value = false
	}
}

async function loadCapeTexture() {
	if (disposed) return
	const cape = selectedPlayer.value?.cape
	const revision = ++capeRevision
	capeTexture.value = ''
	capeFailed.value = false
	capeLoading.value = !!cape
	if (!cape) return
	try {
		const data = cape.startsWith('data:image/') ? cape : await fetchImageAsDataUrl(cape)
		if (revision === capeRevision) capeTexture.value = data
	} catch {
		if (revision === capeRevision) capeFailed.value = true
	} finally {
		if (revision === capeRevision) capeLoading.value = false
	}
}

watch(
	// Background account/head refreshes rebuild player objects without changing the skin.
	[
		() => selectedPlayer.value?.id,
		() => selectedPlayer.value?.texture,
		() => selectedPlayer.value?.variant,
	],
	loadTexture,
	{ immediate: true },
)
watch([() => selectedPlayer.value?.id, () => selectedPlayer.value?.cape], loadCapeTexture, {
	immediate: true,
})
onUnmounted(() => {
	disposed = true
	textureRevision++
	capeRevision++
})

async function select(id: string) {
	if (pendingId.value) return
	const player = players.value.find((player) => player.id === id)
	if (!player) return
	pendingId.value = id
	try {
		await accountsCard?.value?.setAccount(player.account)
	} finally {
		pendingId.value = null
	}
}
</script>

<template>
	<section
		class="player-preview"
		:class="{ 'has-players': players.length }"
		:aria-label="formatMessage(messages.players)"
	>
		<SkinSiteSelectionRail
			v-if="players.length"
			:items="players"
			:selected="selectedId"
			:label="formatMessage(messages.players)"
			vertical
			:disabled="switching"
			@select="select"
		/>
		<div
			class="preview-stage"
			:aria-busy="switching || loading || textureLoading || textureRetrying"
		>
			<SkinPreviewRenderer
				v-if="selectedPlayer && texture"
				:texture-src="texture"
				:cape-src="capeTexture || undefined"
				:variant="selectedPlayer.variant"
				:nametag="selectedPlayer.label"
				:initial-rotation="Math.PI / 8"
				fit
			/>
			<div v-else class="preview-empty" role="status">
				<SpinnerIcon
					v-if="loading || textureLoading || textureRetrying"
					class="size-7 animate-spin"
				/>
				<UserIcon v-else class="size-10 opacity-40" />
				<span v-if="loading || textureLoading || textureRetrying">{{
					formatMessage(loading ? messages.loading : messages.skinLoading)
				}}</span>
				<template v-else-if="selectedPlayer">
					<strong class="text-contrast">{{ selectedPlayer.label }}</strong>
					<span>{{
						formatMessage(previewFailed ? messages.skinFailed : messages.unavailable)
					}}</span>
					<ButtonStyled v-if="previewFailed"
						><button type="button" :disabled="textureRetrying || switching" @click="retryTexture">
							{{ formatMessage(commonMessages.retryButton) }}
						</button></ButtonStyled
					>
				</template>
				<template v-else>
					<strong class="text-contrast">{{
						formatMessage(players.length ? messages.choose : messages.empty)
					}}</strong>
					<span>{{
						formatMessage(players.length ? messages.chooseHint : messages.emptyHint)
					}}</span>
				</template>
			</div>
			<div v-if="pendingId" class="preview-switching">
				<SpinnerIcon class="size-4 animate-spin" />
			</div>
		</div>
		<div v-if="selectedPlayer" class="preview-actions">
			<ButtonStyled
				><button type="button" :disabled="switching" @click="router.push('/skins')">
					{{ formatMessage(messages.manage) }}
				</button></ButtonStyled
			>
		</div>
		<div v-if="capeFailed" class="preview-error">
			<span>{{ formatMessage(messages.capeFailed) }}</span>
			<button type="button" :disabled="capeLoading || switching" @click="loadCapeTexture">
				{{ formatMessage(commonMessages.retryButton) }}
			</button>
		</div>
		<div v-if="skinSitePlayersStatus === 'error'" class="preview-error">
			<span>{{ formatMessage(messages.failed) }}</span>
			<button type="button" @click="requestSkinSitePlayers().catch(() => {})">
				<RefreshCwIcon class="size-4" />{{ formatMessage(commonMessages.retryButton) }}
			</button>
		</div>
	</section>
</template>

<style scoped>
.player-preview {
	--player-preview-height: clamp(22rem, 57dvh, 38rem);
	position: relative;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr);
	grid-template-rows: var(--player-preview-height) auto;
	align-items: start;
	gap: 1.5rem;
	min-width: 0;
}
.player-preview:not(.has-players) {
	grid-template-columns: minmax(0, 1fr);
}
.preview-stage {
	position: relative;
	min-width: 0;
	grid-column: -2 / -1;
	height: 100%;
}
.preview-actions {
	grid-column: -2 / -1;
	display: flex;
	justify-content: center;
}
.preview-empty {
	display: flex;
	height: 100%;
	align-items: center;
	justify-content: center;
	flex-direction: column;
	gap: 0.75rem;
	padding: 1.5rem;
	text-align: center;
	color: var(--color-secondary);
	font-size: 0.875rem;
}
.preview-switching {
	position: absolute;
	top: 1rem;
	right: 1rem;
	color: var(--color-brand);
}
.preview-error {
	grid-column: 1 / -1;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.75rem;
	color: var(--color-secondary);
	font-size: 0.75rem;
}
.preview-error button {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	border: 0;
	background: transparent;
	color: var(--color-brand);
	cursor: pointer;
}
@media (max-width: 720px) {
	.player-preview {
		--player-preview-height: clamp(20rem, 48dvh, 28rem);
		gap: 0.75rem;
	}
}
</style>
