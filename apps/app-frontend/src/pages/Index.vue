<script setup lang="ts">
import { LayoutTemplateIcon, MinimizeIcon } from '@modrinth/assets'
import { defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { computed, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { getActivePlayerName } from '@/components/home/home-utils'
import HomeAnnouncementEntry from '@/components/home/HomeAnnouncementEntry.vue'
import HomeInstancePickerModal from '@/components/home/HomeInstancePickerModal.vue'
import HomeLaunchProgress from '@/components/home/HomeLaunchProgress.vue'
import HomeMinecraftNews from '@/components/home/HomeMinecraftNews.vue'
import HomeMinimal from '@/components/home/HomeMinimal.vue'
import HomePlayInsights from '@/components/home/HomePlayInsights.vue'
import SkinSiteHome from '@/components/ui/skin-site/SkinSiteHome.vue'
import { useNetworkStatus } from '@/composables/useNetworkStatus'
import { get_default_user, users } from '@/helpers/auth'
import { DIRECT_LINKS_SYNCED_EVENT } from '@/helpers/direct-link-sync'
import { instance_listener } from '@/helpers/events'
import { list } from '@/helpers/instance'
import { get as getSettings, set as setSettings } from '@/helpers/settings'
import type { GameInstance } from '@/helpers/types'
import { useBreadcrumbs } from '@/store/breadcrumbs'
import { useTheming } from '@/store/state'
import type { HomeLayout } from '@/store/theme'

const { handleError } = injectNotificationManager()
const route = useRoute()
const router = useRouter()
const breadcrumbs = useBreadcrumbs()
const { formatMessage } = useVIntl()
const { offline } = useNetworkStatus()
const themeStore = useTheming()

const messages = defineMessages({
	home: { id: 'app.home.breadcrumb', defaultMessage: 'Home' },
	switchToMinimal: {
		id: 'app.home.layout.switch-to-minimal',
		defaultMessage: 'Switch to Minimal Home',
	},
	switchToInformation: {
		id: 'app.home.layout.switch-to-information',
		defaultMessage: 'Switch to Information Home',
	},
	homeLayoutToggle: {
		id: 'app.home.layout.toggle',
		defaultMessage: 'Minimal Home',
	},
})

breadcrumbs.setRootContext({ name: formatMessage(messages.home), link: route.path })

const instances = ref<GameInstance[]>([])
const playerName = ref<string | null>(null)
const instancePicker = ref<InstanceType<typeof HomeInstancePickerModal>>()
const isMinimal = computed(() => themeStore.homeLayout === 'minimal')
const switchingLayout = ref(false)

const animateSidebarShow = ref(false)
setTimeout(() => {
	animateSidebarShow.value = true
}, 200)

async function clearMissingMinimalInstance() {
	const selectedId = themeStore.minimalHomeInstanceId
	if (!selectedId || instances.value.some((instance) => instance.id === selectedId)) return

	themeStore.minimalHomeInstanceId = null
	try {
		const settings = await getSettings()
		if (settings.minimal_home_instance_id === null) return
		settings.minimal_home_instance_id = null
		await setSettings(settings)
	} catch (error) {
		handleError(error)
	}
}

async function fetchInstances() {
	try {
		instances.value = await list()
		await clearMissingMinimalInstance()
		return true
	} catch (error) {
		handleError(error)
		return false
	}
}

async function fetchPlayerName() {
	const selectedUser = await get_default_user(offline.value).catch(() => undefined)
	if (!selectedUser) return

	const accounts = await users(offline.value).catch(() => [])
	playerName.value = getActivePlayerName(selectedUser, accounts)
}

async function selectMinimalInstance(instance: GameInstance) {
	try {
		const settings = await getSettings()
		settings.minimal_home_instance_id = instance.id
		await setSettings(settings)
		themeStore.minimalHomeInstanceId = instance.id
	} catch (error) {
		handleError(error)
	}
}

function createInstance() {
	void router.push('/create')
}

async function toggleHomeLayout() {
	if (switchingLayout.value) return

	const previousLayout = themeStore.homeLayout
	const nextLayout: HomeLayout = previousLayout === 'minimal' ? 'standard' : 'minimal'
	switchingLayout.value = true
	themeStore.homeLayout = nextLayout

	try {
		const settings = await getSettings()
		settings.home_layout = nextLayout
		await setSettings(settings)
	} catch (error) {
		themeStore.homeLayout = previousLayout
		handleError(error)
	} finally {
		switchingLayout.value = false
	}
}

const instancesLoaded = await fetchInstances()
if (!instancesLoaded || instances.value.length > 0) void fetchPlayerName()

window.addEventListener(DIRECT_LINKS_SYNCED_EVENT, fetchInstances)

const unlistenInstance = await instance_listener(async () => {
	await fetchInstances()
})

onUnmounted(() => {
	unlistenInstance()
	window.removeEventListener(DIRECT_LINKS_SYNCED_EVENT, fetchInstances)
})
</script>

<template>
	<HomeInstancePickerModal
		ref="instancePicker"
		:instances="instances"
		:selected-instance-id="themeStore.minimalHomeInstanceId"
		@select="selectMinimalInstance"
	/>
	<div class="home-content" :class="{ 'is-minimal': isMinimal }">
		<SkinSiteHome v-if="!isMinimal" />

		<HomeMinimal
			v-else
			:instances="instances"
			:player-name="playerName"
			:selected-instance-id="themeStore.minimalHomeInstanceId"
			@choose="instancePicker?.show()"
			@create="createInstance"
		/>
	</div>
	<Teleport v-if="route.path === '/'" to="#home-layout-switch-target">
		<button
			v-tooltip="formatMessage(isMinimal ? messages.switchToInformation : messages.switchToMinimal)"
			data-onboarding-id="home-layout-switch"
			type="button"
			data-tauri-drag-region-exclude
			role="switch"
			class="home-layout-switch"
			:class="{ 'is-minimal': isMinimal }"
			:disabled="switchingLayout"
			:aria-checked="isMinimal"
			:aria-label="formatMessage(messages.homeLayoutToggle)"
			@click="toggleHomeLayout"
		>
			<span class="home-layout-switch-option home-layout-switch-information" aria-hidden="true">
				<LayoutTemplateIcon />
			</span>
			<span class="home-layout-switch-thumb" aria-hidden="true" />
			<span class="home-layout-switch-option home-layout-switch-minimal" aria-hidden="true">
				<MinimizeIcon />
			</span>
		</button>
	</Teleport>
	<Teleport v-if="!isMinimal" to="#sidebar-default-teleport-target">
		<div
			class="flex min-w-0 flex-col slide-enter-active"
			:class="{ 'slide-enter-from': !animateSidebarShow }"
		>
			<HomeLaunchProgress />
			<HomePlayInsights />
			<HomeAnnouncementEntry />
			<HomeMinecraftNews />
		</div>
	</Teleport>
</template>

<style scoped>
.home-content {
	/* The embedded site owns scrolling within the launcher viewport. */
	height: calc(100dvh - var(--top-bar-height));
	min-width: 0;
}

.home-content.is-minimal {
	height: auto;
	min-height: calc(100dvh - var(--top-bar-height));
}

.home-layout-switch:focus-visible {
	outline: none;
	box-shadow: 0 0 0 4px var(--color-brand-shadow);
}

.home-layout-switch {
	position: relative;
	display: grid;
	grid-template-columns: repeat(2, 2rem);
	align-items: center;
	/* width: 4.25rem; */ /* closes #210 */
	height: 2rem;
	margin: 0 0.75rem 0 0;
	padding: 0;
	border: 0;
	border-radius: 9999px;
	background: var(--color-button-bg);
	cursor: pointer;
	isolation: isolate;
	transition:
		filter 150ms ease,
		transform 150ms ease;
}

.home-layout-switch:hover:not(:disabled) {
	filter: brightness(var(--hover-brightness));
}

.home-layout-switch:active:not(:disabled) {
	transform: scale(0.97);
}

.home-layout-switch:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.home-layout-switch-thumb {
	position: absolute;
	top: 0.125rem;
	left: 0.125rem;
	z-index: 0;
	width: 1.75rem;
	height: 1.75rem;
	border-radius: 9999px;
	background: var(--color-brand);
	transition: transform 180ms ease;
}

.home-layout-switch.is-minimal .home-layout-switch-thumb {
	transform: translateX(2rem);
}

.home-layout-switch-option {
	position: relative;
	z-index: 1;
	display: flex;
	width: 2rem;
	height: 1.75rem;
	align-items: center;
	justify-content: center;
	color: var(--color-secondary);
	transition: color 180ms ease;
}

.home-layout-switch-option :deep(svg) {
	width: 1rem;
	height: 1rem;
}

.home-layout-switch:not(.is-minimal) .home-layout-switch-information,
.home-layout-switch.is-minimal .home-layout-switch-minimal {
	color: var(--color-accent-contrast);
}
</style>
