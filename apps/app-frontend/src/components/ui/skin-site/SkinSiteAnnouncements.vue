<script setup lang="ts">
import { NewspaperIcon, SpinnerIcon, StarIcon } from '@modrinth/assets'
import { commonMessages, defineMessages, useVIntl } from '@modrinth/ui'
import { computed, onUnmounted, ref, watch } from 'vue'

import {
	reloadSkinSiteSession,
	skinSiteStatus,
	skinSiteUser,
} from '@/composables/skin-site-session'
import {
	mapBroadcastAnnouncements,
	OPEN_REMOTE_ANNOUNCEMENT_CENTER_EVENT,
} from '@/helpers/remote-announcements'
import { type SkinSiteAnnouncement, skinSiteAnnouncements } from '@/helpers/skin-site-api'

const { formatMessage } = useVIntl()

const messages = defineMessages({
	title: { id: 'app.skin-site.home.announcements.title', defaultMessage: 'Announcements' },
	empty: {
		id: 'app.skin-site.home.announcements.empty',
		defaultMessage: 'No announcements right now.',
	},
	loading: { id: 'app.skin-site.home.announcements.loading', defaultMessage: 'Loading…' },
	failed: {
		id: 'app.skin-site.home.announcements.failed',
		defaultMessage: 'Could not load announcements.',
	},
	signedOut: {
		id: 'app.skin-site.home.announcements.signed-out',
		defaultMessage: 'Sign in to view announcements.',
	},
	viewAll: { id: 'app.skin-site.home.announcements.view-all', defaultMessage: 'View all' },
})

const announcements = ref<SkinSiteAnnouncement[]>([])
const visibleAnnouncements = computed(() => announcements.value.slice(0, 5))
const loading = ref(true)
const failed = ref(false)
let requestId = 0

function openAnnouncement(item?: SkinSiteAnnouncement) {
	const announcement = item ? mapBroadcastAnnouncements([item])?.[0] : undefined
	window.dispatchEvent(
		new CustomEvent(OPEN_REMOTE_ANNOUNCEMENT_CENTER_EVENT, { detail: { announcement } }),
	)
}

function formatDate(ts: number): string {
	try {
		return new Date(ts).toLocaleDateString()
	} catch {
		return ''
	}
}

async function load() {
	const currentRequest = ++requestId
	announcements.value = []
	failed.value = skinSiteStatus.value === 'error'
	loading.value = skinSiteStatus.value === 'checking'
	if (skinSiteStatus.value !== 'signed-in') return
	loading.value = true
	try {
		const result = await skinSiteAnnouncements()
		if (currentRequest !== requestId) return
		if (result.success) {
			announcements.value = [...(result.payload ?? [])].sort((a, b) => {
				if (a.star !== b.star) return a.star ? -1 : 1
				return b.updateAt - a.updateAt
			})
		} else {
			failed.value = true
		}
	} catch {
		if (currentRequest === requestId) failed.value = true
	} finally {
		if (currentRequest === requestId) loading.value = false
	}
}

async function retry() {
	if (skinSiteStatus.value === 'error') await reloadSkinSiteSession()
	else await load()
}

watch([skinSiteStatus, () => skinSiteUser.value?.uuid], load, { immediate: true })
onUnmounted(() => {
	requestId++
})
</script>

<template>
	<section class="announcements">
		<header class="flex items-center gap-2 border-0 border-b border-solid border-surface-5 pb-4">
			<NewspaperIcon class="size-5 text-brand" />
			<h2 class="m-0 text-base font-semibold text-contrast">{{ formatMessage(messages.title) }}</h2>
			<button
				v-if="announcements.length"
				type="button"
				class="ml-auto cursor-pointer text-xs font-semibold text-brand hover:underline"
				@click="openAnnouncement()"
			>
				{{ formatMessage(messages.viewAll) }}
			</button>
		</header>

		<div v-if="loading" class="announcement-feedback" role="status">
			<SpinnerIcon class="size-4 animate-spin" />
			{{ formatMessage(messages.loading) }}
		</div>
		<div v-else-if="failed" class="announcement-feedback">
			<p class="m-0">{{ formatMessage(messages.failed) }}</p>
			<button type="button" class="text-brand hover:underline" @click="retry">
				{{ formatMessage(commonMessages.retryButton) }}
			</button>
		</div>
		<p v-else-if="skinSiteStatus === 'signed-out'" class="announcement-feedback">
			{{ formatMessage(messages.signedOut) }}
		</p>
		<p v-else-if="!announcements.length" class="announcement-feedback">
			{{ formatMessage(messages.empty) }}
		</p>
		<div v-else class="flex flex-col">
			<button
				v-for="item in visibleAnnouncements"
				:key="item.id"
				type="button"
				class="announcement-entry"
				@click="openAnnouncement(item)"
			>
				<div class="flex items-start gap-2">
					<StarIcon v-if="item.star" class="mt-0.5 size-4 shrink-0 text-brand" />
					<span class="min-w-0 flex-1 truncate text-sm font-semibold text-contrast">
						{{ item.title }}
					</span>
					<span class="shrink-0 text-xs text-secondary">{{ formatDate(item.updateAt) }}</span>
				</div>
				<p v-if="item.subtitle" class="m-0 line-clamp-2 text-sm leading-relaxed text-secondary">
					{{ item.subtitle }}
				</p>
			</button>
		</div>
	</section>
</template>

<style scoped>
.announcements {
	display: flex;
	min-width: 0;
	flex-direction: column;
	gap: 0.5rem;
	padding: 1.5rem;
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-xl);
	background: var(--color-raised-bg);
}
.announcement-entry {
	display: flex;
	flex-direction: column;
	gap: 0.625rem;
	padding: 1.25rem 0;
	border: 0;
	border-bottom: 1px solid var(--color-divider);
	background: transparent;
	text-align: left;
	font: inherit;
	cursor: pointer;
	transition:
		background 180ms,
		transform 180ms;
}
.announcement-entry:hover {
	background: var(--color-button-bg);
}
.announcement-entry:active {
	transform: scale(0.99);
}
.announcement-entry:last-child {
	border-bottom: 0;
	padding-bottom: 0.25rem;
}
.announcement-feedback {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.625rem;
	margin: 0;
	padding: 1.5rem 0 0.5rem;
	color: var(--color-secondary);
	font-size: 0.875rem;
}
</style>
