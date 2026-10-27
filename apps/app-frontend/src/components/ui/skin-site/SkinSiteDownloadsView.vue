<script setup lang="ts">
import { DownloadIcon, SpinnerIcon } from '@modrinth/assets'
import { defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { computed, onMounted, ref } from 'vue'

import { skinSiteStatus, skinSiteUser } from '@/composables/skin-site-session'
import {
	skinSitePublicDownloadCategories,
	type SkinSitePublicDownloadCategory,
	type SkinSitePublicDownloadItem,
	skinSitePublicDownloadList,
	type SkinSitePublicDownloadStatus,
} from '@/helpers/skin-site-api'

const { formatMessage } = useVIntl()
const { handleError } = injectNotificationManager()

const messages = defineMessages({
	title: { id: 'app.skin-site.downloads.title', defaultMessage: 'Downloads' },
	subtitle: {
		id: 'app.skin-site.downloads.subtitle',
		defaultMessage: 'Files shared by the server. Pick a category to narrow the list.',
	},
	back: { id: 'app.skin-site.downloads.back', defaultMessage: 'Back to home' },
	all: { id: 'app.skin-site.downloads.all', defaultMessage: 'All' },
	empty: { id: 'app.skin-site.downloads.empty', defaultMessage: 'Nothing to download yet.' },
	loading: { id: 'app.skin-site.downloads.loading', defaultMessage: 'Loading…' },
	failed: { id: 'app.skin-site.downloads.failed', defaultMessage: 'Could not load downloads.' },
	goDownload: { id: 'app.skin-site.downloads.go', defaultMessage: 'Download' },
	uploader: { id: 'app.skin-site.downloads.uploader', defaultMessage: 'by {name}' },
	statusOk: { id: 'app.skin-site.downloads.status.ok', defaultMessage: 'OK' },
	statusNew: { id: 'app.skin-site.downloads.status.new', defaultMessage: 'New' },
	statusLegacy: { id: 'app.skin-site.downloads.status.legacy', defaultMessage: 'Legacy' },
	statusOutdated: { id: 'app.skin-site.downloads.status.outdated', defaultMessage: 'Outdated' },
	statusRemoval: { id: 'app.skin-site.downloads.status.removal', defaultMessage: 'Removal' },
	signedOut: {
		id: 'app.skin-site.downloads.signed-out',
		defaultMessage: 'Sign in to browse downloads.',
	},
})

const emit = defineEmits<{ (e: 'back'): void }>()

const items = ref<SkinSitePublicDownloadItem[]>([])
const categories = ref<SkinSitePublicDownloadCategory[]>([])
const selectedCategory = ref<string | null>(null)
const loading = ref(true)
const failed = ref(false)

const signedIn = computed(() => skinSiteStatus.value === 'signed-in' && !!skinSiteUser.value)

const filtered = computed(() =>
	selectedCategory.value
		? items.value.filter((item) => item.category.includes(selectedCategory.value!))
		: items.value,
)

function statusLabel(status: SkinSitePublicDownloadStatus): string {
	switch (status) {
		case 'NEW':
			return formatMessage(messages.statusNew)
		case 'LEGACY':
			return formatMessage(messages.statusLegacy)
		case 'OUTDATED':
			return formatMessage(messages.statusOutdated)
		case 'REMOVAL':
			return formatMessage(messages.statusRemoval)
		default:
			return formatMessage(messages.statusOk)
	}
}

async function openUrl(url: string) {
	const { openUrl: open } = await import('@tauri-apps/plugin-opener')
	await open(url)
}

function download(item: SkinSitePublicDownloadItem) {
	const route = item.routes?.[0]
	void openUrl(route?.url ?? item.url)
}

async function load() {
	loading.value = true
	failed.value = false
	if (!signedIn.value) {
		loading.value = false
		return
	}
	try {
		const [listResult, categoryResult] = await Promise.all([
			skinSitePublicDownloadList(),
			skinSitePublicDownloadCategories(),
		])
		if (!listResult.success) throw new Error(listResult.errorMessage)
		items.value = listResult.payload ?? []
		if (categoryResult.success) categories.value = categoryResult.payload ?? []
	} catch (error) {
		failed.value = true
		handleError(error)
	} finally {
		loading.value = false
	}
}

onMounted(load)
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

		<header class="flex flex-col gap-1">
			<h1 class="m-0 text-xl font-bold text-contrast">{{ formatMessage(messages.title) }}</h1>
			<p class="m-0 text-sm text-secondary">{{ formatMessage(messages.subtitle) }}</p>
		</header>

		<div v-if="categories.length" class="flex flex-wrap gap-2">
			<button
				type="button"
				class="rounded-full px-3 py-1 text-xs font-semibold transition-colors"
				:class="
					selectedCategory === null
						? 'bg-brand text-contrast'
						: 'bg-button-bg text-secondary hover:brightness-110'
				"
				@click="selectedCategory = null"
			>
				{{ formatMessage(messages.all) }}
			</button>
			<button
				v-for="category in categories"
				:key="category.id"
				type="button"
				class="rounded-full px-3 py-1 text-xs font-semibold transition-colors"
				:class="
					selectedCategory === category.name
						? 'bg-brand text-contrast'
						: 'bg-button-bg text-secondary hover:brightness-110'
				"
				@click="selectedCategory = category.name"
			>
				{{ category.name }}
			</button>
		</div>

		<p v-if="!signedIn" class="m-0 text-sm text-secondary">
			{{ formatMessage(messages.signedOut) }}
		</p>
		<div v-else-if="loading" class="flex items-center gap-2 text-sm text-secondary">
			<SpinnerIcon class="size-4 animate-spin" />
			{{ formatMessage(messages.loading) }}
		</div>
		<p v-else-if="failed" class="m-0 text-sm text-secondary">
			{{ formatMessage(messages.failed) }}
		</p>
		<p v-else-if="!filtered.length" class="m-0 text-sm text-secondary">
			{{ formatMessage(messages.empty) }}
		</p>
		<div v-else class="flex flex-col gap-2">
			<div
				v-for="item in filtered"
				:key="item.id"
				class="flex flex-wrap items-center gap-3 rounded-xl border border-solid border-surface-5 bg-bg-raised p-3"
			>
				<div class="flex min-w-0 flex-1 flex-col gap-1">
					<div class="flex flex-wrap items-center gap-2">
						<span class="min-w-0 truncate text-sm font-semibold text-contrast">
							{{ item.filename }}
						</span>
						<span
							v-for="status in item.status"
							:key="status"
							class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
							:class="{
								'bg-green text-contrast': status === 'NEW',
								'bg-yellow text-contrast': status === 'LEGACY',
								'bg-red text-contrast': status === 'OUTDATED' || status === 'REMOVAL',
								'bg-button-bg text-secondary':
									status !== 'NEW' &&
									status !== 'LEGACY' &&
									status !== 'OUTDATED' &&
									status !== 'REMOVAL',
							}"
						>
							{{ statusLabel(status) }}
						</span>
					</div>
					<span v-if="item.description" class="truncate text-xs text-secondary">
						{{ item.description }}
					</span>
					<span v-if="item.uploader" class="text-xs text-secondary">
						{{ formatMessage(messages.uploader, { name: item.uploader }) }}
					</span>
				</div>
				<button
					type="button"
					class="flex shrink-0 items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-contrast hover:brightness-110"
					@click="download(item)"
				>
					<DownloadIcon class="size-3.5" />
					{{ formatMessage(messages.goDownload) }}
				</button>
			</div>
		</div>
	</div>
</template>
