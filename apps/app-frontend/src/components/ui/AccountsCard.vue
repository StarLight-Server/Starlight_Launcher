<template>
	<div v-if="skinSiteUser" class="flex items-center gap-3 mt-2 p-3 rounded-xl bg-button-bg">
		<Avatar :src="axolotlLogo" size="36px" />
		<div class="flex min-w-0 flex-col">
			<span class="truncate font-semibold text-contrast">{{ skinSiteUser.username }}</span>
			<span class="text-secondary text-xs">{{ formatMessage(messages.skinSiteSignedIn) }}</span>
		</div>
	</div>
	<p v-else-if="skinSiteStatus === 'checking'" class="text-sm text-secondary">
		{{ formatMessage(messages.skinSiteChecking) }}
	</p>
	<p v-else-if="skinSiteStatus === 'error'" class="text-sm text-secondary">
		{{ formatMessage(messages.skinSiteSyncError) }}
	</p>
	<div
		v-if="skinSiteUser"
		class="mt-2 overflow-hidden rounded-xl border border-solid border-surface-5 bg-button-bg"
	>
		<div class="flex items-center justify-between gap-3 px-3 py-2">
			<span class="font-semibold text-contrast">
				{{ formatMessage(messages.skinSitePlayers, { count: skinSitePlayers.length }) }}
			</span>
			<button
				v-if="skinSitePlayersStatus === 'error'"
				type="button"
				class="button-base flex cursor-pointer items-center gap-1 border-0 bg-transparent p-1 text-xs text-secondary hover:text-brand"
				@click="refreshSkinSitePlayers()"
			>
				<RefreshCwIcon class="h-4 w-4" />
				{{ formatMessage(messages.retrySkinSitePlayers) }}
			</button>
			<SpinnerIcon
				v-else-if="skinSitePlayersStatus === 'checking'"
				class="h-4 w-4 animate-spin text-secondary"
			/>
		</div>
		<div v-if="skinSitePlayers.length > 0" class="border-0 border-t border-solid border-surface-5">
			<button
				v-for="player in skinSitePlayers"
				:key="player.uuid"
				type="button"
				class="flex w-full cursor-pointer items-center gap-2 border-0 border-b border-solid border-surface-5 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-button-hover"
				:class="selectedSkinSitePlayerId === player.uuid ? 'bg-button-hover' : 'bg-transparent'"
				:aria-pressed="selectedSkinSitePlayerId === player.uuid"
				@click="setSkinSitePlayer(player.uuid)"
			>
				<Avatar
					v-if="player.skinState === 'ready' && player.headDataUrl"
					:src="player.headDataUrl"
					size="32px"
					pixelated
					:unframed-natural-width="36"
				/>
				<div
					v-else
					class="h-8 w-8 shrink-0 rounded-sm border-2 border-dashed border-secondary/45 bg-surface-5/50 text-secondary"
					style="
						background-image:
							linear-gradient(currentColor, currentColor),
							linear-gradient(currentColor, currentColor),
							linear-gradient(currentColor, currentColor);
						background-position:
							6px 8px,
							22px 8px,
							8px 20px;
						background-repeat: no-repeat;
						background-size:
							4px 4px,
							4px 4px,
							16px 2px;
					"
					aria-hidden="true"
				/>
				<span class="min-w-0 flex-1 truncate text-sm text-primary">{{ player.name }}</span>
			</button>
		</div>
		<p v-else-if="skinSitePlayersStatus === 'ready'" class="m-0 px-3 pb-3 text-sm text-secondary">
			{{ formatMessage(messages.noSkinSitePlayers) }}
		</p>
		<p v-else-if="skinSitePlayersStatus === 'error'" class="m-0 px-3 pb-3 text-sm text-secondary">
			{{ formatMessage(messages.skinSitePlayersError) }}
		</p>
	</div>
	<ButtonStyled v-if="accounts.length > 0 && !offline && !skinSiteUser" color="brand">
		<button class="mt-2 w-full" :disabled="loginDisabled" @click="goToSkinSiteLogin()">
			<LogInIcon />
			{{ formatMessage(messages.signInToStarlight) }}
		</button>
	</ButtonStyled>
	<div
		v-if="offline"
		class="flex flex-col gap-1 bg-highlight-orange border border-solid border-orange rounded-xl p-3 mt-2"
	>
		<span class="font-semibold text-contrast">{{ formatMessage(messages.offlineMode) }}</span>
		<span class="text-sm text-secondary">
			{{
				formatMessage(
					browserOffline
						? messages.offlineModeNoInternetDescription
						: messages.offlineModeServerUnavailableDescription,
				)
			}}
		</span>
		<ButtonStyled>
			<button class="mt-1" :disabled="refreshingNetwork" @click="refreshNetworkStatus()">
				<SpinnerIcon v-if="refreshingNetwork" class="animate-spin" />
				<RefreshCwIcon v-else />
				{{ formatMessage(messages.refreshNetworkStatus) }}
			</button>
		</ButtonStyled>
	</div>
	<div
		v-if="accounts.length === 0"
		class="flex flex-col gap-3 bg-button-bg border border-solid border-surface-5 rounded-xl p-3 mt-2"
	>
		<span v-if="skinSiteStatus === 'signed-out'">{{ formatMessage(messages.notSignedIn) }}</span>
		<ButtonStyled v-if="!offline && !skinSiteUser" color="brand">
			<button color="primary" :disabled="loginDisabled" @click="goToSkinSiteLogin()">
				<LogInIcon v-if="!loginDisabled" />
				<SpinnerIcon v-else class="animate-spin" />
				{{ formatMessage(messages.signInToStarlight) }}
			</button>
		</ButtonStyled>
		<ButtonStyled v-if="!offline">
			<button :disabled="loginDisabled" @click="login()">
				<PlusIcon />
				{{ formatMessage(messages.addMicrosoftAccount) }}
			</button>
		</ButtonStyled>
	</div>
	<Accordion
		v-else
		class="w-full mt-2 bg-button-bg border border-solid border-surface-5 rounded-xl overflow-clip"
		button-class="button-base w-full bg-transparent px-3 py-2 border-0 cursor-pointer"
		:open-by-default="false"
	>
		<template #title>
			<div class="flex gap-2 w-full min-w-0">
				<Avatar
					size="36px"
					:src="selectedAccount ? avatarUrl : axolotlLogo"
					:pixelated="Boolean(selectedAccount)"
					:unframed-natural-width="72"
				/>
				<div class="flex flex-col items-start w-full min-w-0">
					<span class="truncate w-full text-left">{{
						selectedAccount ? selectedAccount.profile.name : formatMessage(messages.selectAccount)
					}}</span>
					<span class="text-secondary text-xs">
						{{
							selectedAccount?.account_type === 'offline'
								? formatMessage(messages.offlineAccount)
								: selectedAccount?.account_type === 'yggdrasil'
									? selectedAccount.yggdrasil?.server_name ||
										formatMessage(messages.thirdPartyAccount)
									: formatMessage(messages.minecraftAccount)
						}}
					</span>
				</div>
			</div>
		</template>
		<div class="bg-button-bg pt-1 pb-2 border-0 border-t border-solid border-surface-5">
			<template v-if="accounts.length > 0">
				<div v-for="account in accounts" :key="account.profile.id" class="flex gap-1 items-center">
					<button
						class="flex items-center flex-shrink flex-grow overflow-clip gap-2 p-2 border-0 bg-transparent cursor-pointer button-base min-w-0"
						:disabled="accountSelectionPending"
						@click="setAccount(account)"
					>
						<RadioButtonCheckedIcon
							v-if="selectedAccount && selectedAccount.profile.id === account.profile.id"
							class="w-5 h-5 text-brand shrink-0"
						/>
						<RadioButtonIcon v-else class="w-5 h-5 text-secondary shrink-0" />
						<Avatar
							:src="getAccountAvatarUrl(account)"
							size="24px"
							pixelated
							:unframed-natural-width="72"
						/>
						<div class="flex flex-1 min-w-0 flex-col text-left">
							<p
								class="m-0 truncate text-left"
								:class="
									selectedAccount && selectedAccount.profile.id === account.profile.id
										? 'text-contrast font-semibold'
										: 'text-primary'
								"
							>
								{{ account.profile.name }}
							</p>
							<p
								v-if="duplicateAccountNames.has(account.profile.name)"
								class="m-0 truncate text-left text-xs text-secondary"
							>
								{{ account.profile.id }}
							</p>
						</div>
						<span v-if="account.account_type === 'offline'" class="text-secondary text-xs shrink-0">
							{{ formatMessage(messages.offlineBadge) }}
						</span>
						<span
							v-else-if="account.account_type === 'microsoft'"
							class="text-secondary text-xs shrink-0"
						>
							{{ formatMessage(messages.officialBadge) }}
						</span>
						<span
							v-else-if="account.account_type === 'yggdrasil'"
							class="text-secondary text-xs shrink-0"
						>
							{{ account.yggdrasil?.server_name || formatMessage(messages.thirdPartyBadge) }}
						</span>
					</button>
					<div class="flex shrink-0 items-center">
						<button
							v-tooltip="formatMessage(messages.copyUuid)"
							type="button"
							class="button-base border-0 bg-transparent p-1.5 cursor-pointer text-secondary hover:text-brand"
							@click="copyAccountUuid(account)"
						>
							<CopyIcon />
						</button>
						<button
							v-if="!account.skin_site_user"
							v-tooltip="formatMessage(messages.removeAccount)"
							type="button"
							class="button-base border-0 bg-transparent p-1.5 cursor-pointer text-secondary hover:text-red"
							@click="logout(account)"
						>
							<TrashIcon />
						</button>
					</div>
				</div>
			</template>
			<div class="flex flex-col gap-2 px-2 pt-2">
				<ButtonStyled v-if="accounts.length > 0 && !offline" class="w-full">
					<button :disabled="loginDisabled" @click="login()">
						<PlusIcon />
						{{ formatMessage(messages.addMicrosoftAccount) }}
					</button>
				</ButtonStyled>
			</div>
		</div>
	</Accordion>
	<MinecraftLoginModal ref="minecraftLoginModal" @complete="onMicrosoftLogin" />
	<SkinSiteLoginModal ref="skinSiteLoginModal" @signed-in="onSkinSiteSignedIn" />
</template>

<script setup lang="ts">
import {
	CopyIcon,
	LogInIcon,
	PlusIcon,
	RadioButtonCheckedIcon,
	RadioButtonIcon,
	RefreshCwIcon,
	SpinnerIcon,
	TrashIcon,
} from '@modrinth/assets'
import {
	Accordion,
	Avatar,
	ButtonStyled,
	defineMessages,
	injectNotificationManager,
	useVIntl,
} from '@modrinth/ui'
import { useQueryClient } from '@tanstack/vue-query'
import { listen } from '@tauri-apps/api/event'
import type { Ref } from 'vue'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import axolotlLogo from '@/assets/netherstar.png'
import MinecraftLoginModal from '@/components/ui/MinecraftLoginModal.vue'
import SkinSiteLoginModal from '@/components/ui/skin-site/SkinSiteLoginModal.vue'
import {
	requestSkinSitePlayers,
	selectedSkinSitePlayerId,
	selectSkinSitePlayer,
	skinSitePlayers,
	skinSitePlayersStatus,
	skinSiteStatus,
	skinSiteUser,
} from '@/composables/skin-site-session'
import { useNetworkStatus } from '@/composables/useNetworkStatus'
import { compareMinecraftAccounts } from '@/helpers/accounts'
import {
	get_default_user,
	login as loginToMinecraft,
	remove_user,
	set_default_user,
	users,
} from '@/helpers/auth'
import { process_listener } from '@/helpers/events'
import { authenticateInstancePlayer } from '@/helpers/instance-player'
import { minecraftLoginMessages } from '@/helpers/minecraft-login-messages'
import { getPlayerHeadUrl } from '@/helpers/rendering/batch-skin-renderer.ts'
import type { Skin } from '@/helpers/skins'
import { get_available_skins } from '@/helpers/skins'
import { handleSevereError } from '@/store/error.js'

const { formatMessage } = useVIntl()
const { handleError } = injectNotificationManager()
const { browserOffline, offline, refreshBrowserOffline } = useNetworkStatus()
const queryClient = useQueryClient()
const route = useRoute()
const skinSiteLoginModal = ref<InstanceType<typeof SkinSiteLoginModal>>()

async function goToSkinSiteLogin() {
	skinSiteLoginModal.value?.show()
}

function onSkinSiteSignedIn() {
	void requestSkinSitePlayers().catch(() => {})
}
const refreshingNetwork = ref(false)

/**
 * Re-checks session server reachability on demand so users can leave offline
 * mode without restarting the launcher. Goes through the shared
 * `authServerReachability` query so the reachability state and the auth
 * warning banner stay consistent.
 */
async function refreshNetworkStatus() {
	if (refreshingNetwork.value) return
	refreshingNetwork.value = true
	try {
		refreshBrowserOffline()
		await nextTick()
		await queryClient.refetchQueries({ queryKey: ['authServerReachability'] })
	} finally {
		refreshingNetwork.value = false
	}
}

const emit = defineEmits<{
	change: []
}>()

type MinecraftCredential = {
	account_type: 'microsoft' | 'offline' | 'yggdrasil'
	profile: {
		id: string
		name: string
		skins?: Array<{
			state: string
			url: string
			variant: Skin['variant']
			textureKey?: string
		}>
	}
	yggdrasil?: {
		api_root: string
		server_name: string
		login: string
	}
	skin_site_user?: string
	head?: string
}

const STARLIGHT_YGGDRASIL_API_ROOT = 'https://skin.starlight.cool/yggdrasil'

const storedAccounts: Ref<MinecraftCredential[]> = ref([])
const accounts = computed(() => {
	// A site's player list is already authoritative for available choices.
	// Game credentials are created only when the user selects a player.
	const byId = new Map(
		storedAccounts.value.map((account) => [
			account.profile.id.replaceAll('-', '').toLowerCase(),
			account,
		]),
	)
	if (skinSiteStatus.value === 'signed-in' && skinSiteUser.value) {
		for (const player of skinSitePlayers.value) {
			const id = player.uuid.replaceAll('-', '').toLowerCase()
			const stored = byId.get(id)
			if (stored && stored.account_type !== 'yggdrasil') continue
			byId.set(id, {
				...stored,
				account_type: 'yggdrasil',
				profile: { ...stored?.profile, id: stored?.profile.id ?? player.uuid, name: player.name },
				yggdrasil: {
					api_root: STARLIGHT_YGGDRASIL_API_ROOT,
					server_name: 'StarLight',
					login: skinSiteUser.value.uuid,
				},
				skin_site_user: skinSiteUser.value.uuid,
				head: player.headDataUrl,
			})
		}
	}
	return [...byId.values()].sort(compareMinecraftAccounts)
})
const accountSelectionPending = ref(false)
const loginDisabled = ref(false)
const defaultUser = ref<string | undefined>()
const equippedSkin = ref<Skin | null>(null)
const accountChangeRevision = ref(0)
const headUrlCache = ref(new Map<string, string>())
const accountHeadUrlCache = ref(new Map<string, string>())
const accountHeadTextureKeyCache = ref(new Map<string, string>())
let refreshGeneration = 0
let headRefreshTimer: ReturnType<typeof setTimeout> | undefined
let defaultUserUpdateQueue = Promise.resolve()
const minecraftLoginModal = ref<InstanceType<typeof MinecraftLoginModal> | null>(null)
async function refreshSkinSitePlayers() {
	await requestSkinSitePlayers().catch(() => {})
}

async function setSkinSitePlayer(playerId: string) {
	const normalizedId = playerId.replaceAll('-', '').toLowerCase()
	const account = accounts.value.find(
		(candidate) => candidate.profile.id.replaceAll('-', '').toLowerCase() === normalizedId,
	)
	if (account) await setAccount(account)
}

const HEAD_REFRESH_RETRY_DELAYS = [1500, 5000, 15000, 30000] as const
const HEAD_REFRESH_CONTINUOUS_DELAY = 60_000

function hasResolvedAccountHead(account: MinecraftCredential) {
	const skin = getAccountSkin(account)
	return Boolean(
		skin &&
		accountHeadUrlCache.value.has(account.profile.id) &&
		accountHeadTextureKeyCache.value.get(account.profile.id) === skin.texture_key,
	)
}

function hasMissingAccountHeads() {
	return storedAccounts.value.some(
		(account) => account.account_type !== 'offline' && !hasResolvedAccountHead(account),
	)
}

function clearHeadRefreshRetry() {
	if (headRefreshTimer !== undefined) {
		clearTimeout(headRefreshTimer)
		headRefreshTimer = undefined
	}
}

function scheduleHeadRefreshRetry(generation: number, attempt: number) {
	if (offline.value || generation !== refreshGeneration) return
	const delay = HEAD_REFRESH_RETRY_DELAYS[attempt] ?? HEAD_REFRESH_CONTINUOUS_DELAY

	clearHeadRefreshRetry()
	headRefreshTimer = setTimeout(() => {
		headRefreshTimer = undefined
		if (generation !== refreshGeneration) return
		void refreshValues(Math.min(attempt + 1, HEAD_REFRESH_RETRY_DELAYS.length)).catch((error) => {
			console.warn('Failed to refresh account heads:', error)
		})
	}, delay)
}

async function refreshValues(headRefreshAttempt = 0) {
	clearHeadRefreshRetry()
	const generation = ++refreshGeneration
	const selectedUser = await get_default_user(offline.value).catch(handleError)
	if (generation !== refreshGeneration) return

	defaultUser.value = selectedUser
	if (offline.value && selectedUser) {
		await persistDefaultUser(selectedUser).catch(handleError)
		if (generation !== refreshGeneration) return
	}
	const userList = await users(offline.value).catch(handleError)
	if (generation !== refreshGeneration) return
	// The Rust backend returns a plain array that structurally matches
	// MinecraftCredential but the TS types from the Tauri IPC bridge do not
	// carry this refinement. The double cast is deliberate — the shape is
	// correct and verified at runtime by the backend.
	storedAccounts.value = Array.isArray(userList)
		? [...(userList as unknown as MinecraftCredential[])].filter(
				(account) =>
					account.account_type === 'microsoft' ||
					(account.account_type === 'yggdrasil' &&
						account.yggdrasil?.api_root.replace(/\/+$/, '') === STARLIGHT_YGGDRASIL_API_ROOT),
			)
		: []
	await renderAccountHeads(storedAccounts.value, generation)
	if (generation !== refreshGeneration) return
	try {
		const skins = await get_available_skins()
		if (generation !== refreshGeneration) return
		equippedSkin.value = skins.find((skin) => skin.is_equipped) ?? null

		if (equippedSkin.value) {
			try {
				const headUrl = await getPlayerHeadUrl(equippedSkin.value)
				if (generation !== refreshGeneration) return
				headUrlCache.value = new Map(headUrlCache.value).set(
					equippedSkin.value.texture_key,
					headUrl,
				)
				if (selectedUser) {
					const selectedAccountSkin = getAccountSkin(
						accounts.value.find((account) => account.profile.id === selectedUser),
					)
					cacheAccountHead(selectedUser, selectedAccountSkin ?? equippedSkin.value, headUrl)
				}
			} catch (error) {
				console.warn('Failed to get head render for equipped skin:', error)
			}
		}
	} catch {
		equippedSkin.value = null
	}

	if (hasMissingAccountHeads()) {
		scheduleHeadRefreshRetry(generation, headRefreshAttempt)
	}
}

async function setEquippedSkin(skin: Skin) {
	const selectedUser = defaultUser.value
	equippedSkin.value = skin

	try {
		const headUrl = await getPlayerHeadUrl(skin)
		headUrlCache.value = new Map(headUrlCache.value).set(skin.texture_key, headUrl)
		if (selectedUser) {
			cacheAccountHead(selectedUser, skin, headUrl)
		}
	} catch (error) {
		console.warn('Failed to get head render for equipped skin:', error)
	}
}

function setLoginDisabled(value: boolean) {
	loginDisabled.value = value
}

defineExpose({
	accounts,
	defaultUser,
	accountSelectionPending,
	setAccount,
	getAccountSkin,
	getAccountAvatarUrl,
	accountChangeRevision,
	login,
	refreshValues,
	setEquippedSkin,
	setLoginDisabled,
	loginDisabled,
})

await refreshValues()

watch(offline, async () => {
	await refreshValues()
	notifyAccountChange()
})

const selectedAccount = computed(() =>
	accounts.value.find((account) => account.profile.id === defaultUser.value),
)

function notifyAccountChange() {
	accountChangeRevision.value += 1
	emit('change')
}

const duplicateAccountNames = computed(() => {
	const counts = new Map<string, number>()
	for (const account of accounts.value) {
		counts.set(account.profile.name, (counts.get(account.profile.name) ?? 0) + 1)
	}
	return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name))
})

watch(
	() => route.fullPath,
	() => {
		if (!hasMissingAccountHeads()) return
		void refreshValues().catch((error) => {
			console.warn('Failed to refresh account heads after navigation:', error)
		})
	},
)

function getAccountSkin(account: MinecraftCredential | undefined): Skin | undefined {
	if (!account || account.account_type === 'offline') return undefined
	const skin =
		account.profile.skins?.find((skin) => skin.state === 'ACTIVE') ?? account.profile.skins?.[0]
	if (!skin?.url) return undefined

	return {
		texture_key: skin.textureKey ?? `${account.profile.id}:${skin.url}`,
		variant: skin.variant ?? 'UNKNOWN',
		texture: skin.url,
		source: 'custom_external',
		is_equipped: true,
	}
}

function cacheAccountHead(accountId: string, skin: Skin, headUrl: string) {
	accountHeadUrlCache.value = new Map(accountHeadUrlCache.value).set(accountId, headUrl)
	accountHeadTextureKeyCache.value = new Map(accountHeadTextureKeyCache.value).set(
		accountId,
		skin.texture_key,
	)
}

async function renderAccountHeads(accountList: MinecraftCredential[], generation: number) {
	await Promise.all(
		accountList.map(async (account) => {
			const skin = getAccountSkin(account)
			if (!skin) return

			try {
				const headUrl = await getPlayerHeadUrl(skin)
				if (generation !== refreshGeneration) return
				cacheAccountHead(account.profile.id, skin, headUrl)
			} catch (error) {
				console.warn(`Failed to render head for account ${account.profile.id}:`, error)
			}
		}),
	)
}

const avatarUrl = computed(() => {
	if (selectedAccount.value) {
		if (selectedAccount.value.head) return selectedAccount.value.head
		const cachedHeadUrl = accountHeadUrlCache.value.get(selectedAccount.value.profile.id)
		if (cachedHeadUrl) return cachedHeadUrl
	}
	if (equippedSkin.value?.texture_key) {
		const cachedUrl = headUrlCache.value.get(equippedSkin.value.texture_key)
		if (cachedUrl) {
			return cachedUrl
		}
	}
	return selectedAccount.value ? undefined : axolotlLogo
})

function getAccountAvatarUrl(account: MinecraftCredential) {
	if (account.head) return account.head
	const cachedHeadUrl = accountHeadUrlCache.value.get(account.profile.id)
	if (cachedHeadUrl) {
		return cachedHeadUrl
	}
	if (
		account.profile.id === selectedAccount.value?.profile?.id &&
		equippedSkin.value?.texture_key
	) {
		const cachedUrl = headUrlCache.value.get(equippedSkin.value.texture_key)
		if (cachedUrl) {
			return cachedUrl
		}
	}
	return undefined
}

function persistDefaultUser(userId: string) {
	const update = defaultUserUpdateQueue.then(async () => {
		await set_default_user(userId)
	})
	defaultUserUpdateQueue = update.catch(() => {})
	return update
}

async function setAccount(account: MinecraftCredential) {
	if (accountSelectionPending.value) return
	accountSelectionPending.value = true
	const userId = account.profile.id
	refreshGeneration += 1
	try {
		if (account.skin_site_user) {
			await authenticateInstancePlayer({
				id: userId,
				name: account.profile.name,
				account_type: account.account_type,
				skin_site_user: account.skin_site_user,
			})
		}
		await persistDefaultUser(userId)
		const sitePlayer =
			account.account_type === 'yggdrasil'
				? skinSitePlayers.value.find(
						(player) =>
							player.uuid.replaceAll('-', '').toLowerCase() ===
							userId.replaceAll('-', '').toLowerCase(),
					)
				: undefined
		selectSkinSitePlayer(sitePlayer?.uuid ?? null)
		defaultUser.value = userId
		equippedSkin.value = null
		notifyAccountChange()
		await refreshValues()
	} catch (error) {
		handleError(error as Error)
	} finally {
		accountSelectionPending.value = false
	}
}

watch(
	[skinSitePlayers, defaultUser, skinSiteUser, accounts],
	([availablePlayers, selectedLocalUser]) => {
		if (selectedLocalUser) {
			const account = accounts.value.find((candidate) => candidate.profile.id === selectedLocalUser)
			const match =
				account?.account_type === 'yggdrasil'
					? availablePlayers.find(
							(player) =>
								player.uuid.replaceAll('-', '').toLowerCase() ===
								selectedLocalUser.replaceAll('-', '').toLowerCase(),
						)
					: undefined
			selectSkinSitePlayer(match?.uuid ?? null)
		} else if (!selectedSkinSitePlayerId.value && availablePlayers.length > 0) {
			selectSkinSitePlayer(availablePlayers[0].uuid)
		}
	},
	{ immediate: true },
)

async function login() {
	if (offline.value) return
	loginDisabled.value = true
	try {
		const account = await loginToMinecraft({
			trouble: formatMessage(minecraftLoginMessages.trouble),
			browserLogin: formatMessage(minecraftLoginMessages.browserLogin),
			deviceCode: formatMessage(minecraftLoginMessages.deviceCode),
		})
		if (account) await onMicrosoftLogin(account)
	} catch (error) {
		handleSevereError(error)
	} finally {
		loginDisabled.value = false
	}
}

async function onMicrosoftLogin(account: MinecraftCredential) {
	loginDisabled.value = true
	try {
		await setAccount(account)
	} catch (error) {
		handleSevereError(error)
	} finally {
		loginDisabled.value = false
	}
}

async function logout(account: MinecraftCredential) {
	await remove_user(account.profile.id).catch(handleError)
	await refreshValues()
	if (!selectedAccount.value && accounts.value.length > 0) {
		await setAccount(accounts.value[0])
	} else {
		notifyAccountChange()
	}
}

async function copyAccountUuid(account: MinecraftCredential) {
	try {
		await navigator.clipboard.writeText(account.profile.id)
	} catch (error) {
		handleError(error as Error)
	}
}

const unlisten = await process_listener(async (e: { event: string }) => {
	if (e.event === 'launched') {
		await refreshValues()
	}
})
const unlistenDeviceLogin = await listen('minecraft-device-login-requested', () => {
	minecraftLoginModal.value?.showDeviceLogin()
})

onUnmounted(() => {
	clearHeadRefreshRetry()
	unlisten()
	unlistenDeviceLogin()
})

const messages = defineMessages({
	skinSiteSignedIn: {
		id: 'minecraft-account.skin-site.signed-in',
		defaultMessage: 'Signed in to StarLight Skin Site',
	},
	skinSiteChecking: {
		id: 'minecraft-account.skin-site.checking',
		defaultMessage: 'Checking skin site session…',
	},
	skinSiteSyncError: {
		id: 'minecraft-account.skin-site.sync-error',
		defaultMessage: 'Could not verify the skin site session. Retrying automatically.',
	},
	skinSitePlayers: {
		id: 'minecraft-account.skin-site.players',
		defaultMessage: 'Skin site players ({count})',
	},
	retrySkinSitePlayers: {
		id: 'minecraft-account.skin-site.players.retry',
		defaultMessage: 'Retry',
	},
	noSkinSitePlayers: {
		id: 'minecraft-account.skin-site.players.empty',
		defaultMessage: 'No player profiles are attached to this skin site account.',
	},
	skinSitePlayersError: {
		id: 'minecraft-account.skin-site.players.error',
		defaultMessage: 'Could not refresh the player list. Previously loaded players are kept.',
	},
	offlineMode: {
		id: 'minecraft-account.offline-mode',
		defaultMessage: 'Offline mode',
	},
	offlineModeNoInternetDescription: {
		id: 'minecraft-account.offline-mode.description.no-internet',
		defaultMessage:
			'It looks like this device may not be connected to the internet. You can currently only launch fully downloaded instances and will most likely be unable to connect to StarLight servers. Check your network connection. If you are using a proxy, try disabling or enabling it, then refresh the connection status below.',
	},
	offlineModeServerUnavailableDescription: {
		id: 'minecraft-account.offline-mode.description.server-unavailable',
		defaultMessage:
			"Your internet connection is working, but StarLight's authentication server cannot be reached. The StarLight server may be undergoing maintenance, or your proxy may be misconfigured. If you are using a proxy, try disabling or enabling it, then refresh the connection status below. If that does not help, contact a server administrator in the StarLight community group to confirm the maintenance status.",
	},
	refreshNetworkStatus: {
		id: 'minecraft-account.offline-mode.refresh',
		defaultMessage: 'Refresh connection status',
	},
	notSignedIn: {
		id: 'minecraft-account.not-signed-in',
		defaultMessage: 'Not signed in',
	},
	addMicrosoftAccount: {
		id: 'minecraft-account.add-microsoft-account',
		defaultMessage: 'Add your own Minecraft account',
	},
	signInToStarlight: {
		id: 'minecraft-account.sign-in-starlight',
		defaultMessage: 'Sign in to StarLight Skin Site',
	},
	thirdPartyAccount: {
		id: 'minecraft-account.third-party-account',
		defaultMessage: 'StarLight skin account',
	},
	thirdPartyBadge: {
		id: 'minecraft-account.third-party-badge',
		defaultMessage: 'StarLight skin',
	},
	offlineAccount: {
		id: 'minecraft-account.offline-account',
		defaultMessage: 'Offline Minecraft account',
	},
	offlineBadge: {
		id: 'minecraft-account.offline-badge',
		defaultMessage: 'Offline',
	},
	officialBadge: {
		id: 'minecraft-account.official-badge',
		defaultMessage: 'Official',
	},
	offlineModalTitle: {
		id: 'minecraft-account.offline-modal.title',
		defaultMessage: 'Add offline account',
	},
	offlineModalDescription: {
		id: 'minecraft-account.offline-modal.description',
		defaultMessage:
			'Choose the username used in offline games. This account can only join servers that allow offline players.',
	},
	usernameLabel: {
		id: 'minecraft-account.offline-modal.username-label',
		defaultMessage: 'Minecraft username',
	},
	usernamePlaceholder: {
		id: 'minecraft-account.offline-modal.username-placeholder',
		defaultMessage: 'Enter a username',
	},
	usernameValidation: {
		id: 'minecraft-account.offline-modal.username-validation',
		defaultMessage: 'Use 1–16 letters, numbers, or underscores, including Chinese characters.',
	},
	chineseUsernameWarning: {
		id: 'minecraft-account.offline-modal.chinese-username-warning',
		defaultMessage:
			'Minecraft 1.18 and newer may reject Chinese usernames when entering singleplayer worlds or servers. Use this account with an older version, or choose an English username for newer versions.',
	},
	customUuidLabel: {
		id: 'minecraft-account.offline-modal.custom-uuid',
		defaultMessage: 'Custom UUID',
	},
	customUuidDuplicate: {
		id: 'minecraft-account.offline-modal.custom-uuid-duplicate',
		defaultMessage: 'An account with this UUID already exists. Please use a different UUID.',
	},
	customUuidWarning: {
		id: 'minecraft-account.offline-modal.custom-uuid-warning',
		defaultMessage: "If you don't understand what this is, do not enable this feature.",
	},
	customUuidInputLabel: {
		id: 'minecraft-account.offline-modal.custom-uuid-input-label',
		defaultMessage: 'UUID',
	},
	customUuidPlaceholder: {
		id: 'minecraft-account.offline-modal.custom-uuid-placeholder',
		defaultMessage: '00000000-0000-0000-0000-000000000000',
	},
	customUuidValidation: {
		id: 'minecraft-account.offline-modal.custom-uuid-validation',
		defaultMessage: 'Use 32 hexadecimal characters. Hyphens are optional.',
	},
	createOfflineAccount: {
		id: 'minecraft-account.offline-modal.create',
		defaultMessage: 'Create account',
	},
	copyUuid: {
		id: 'minecraft-account.copy-uuid',
		defaultMessage: 'Copy UUID',
	},
	removeAccount: {
		id: 'minecraft-account.remove-account',
		defaultMessage: 'Remove account',
	},
	selectAccount: {
		id: 'minecraft-account.select-account',
		defaultMessage: 'Select account',
	},
	minecraftAccount: {
		id: 'minecraft-account.label',
		defaultMessage: 'Minecraft account',
	},
})
</script>
