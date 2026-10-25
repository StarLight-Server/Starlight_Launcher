<script setup lang="ts">
import { SpinnerIcon } from '@modrinth/assets'
import { defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { computed, onMounted, ref, watch } from 'vue'

import {
	skinSiteWikiCategory,
	type SkinSiteWikiPageSummary,
	skinSiteWikiRecent,
	skinSiteWikiSearch,
	type SkinSiteWikiSearchPage,
} from '@/helpers/skin-site-api'

const emit = defineEmits<{ navigate: [title: string] }>()

const { formatMessage } = useVIntl()
const { handleError } = injectNotificationManager()

const messages = defineMessages({
	searchPlaceholder: {
		id: 'app.skin-site.wiki.browser.search-placeholder',
		defaultMessage: 'Search wiki pages…',
	},
	tabSearch: { id: 'app.skin-site.wiki.browser.tab-search', defaultMessage: 'Search' },
	tabRecent: { id: 'app.skin-site.wiki.browser.tab-recent', defaultMessage: 'Recent' },
	tabCategory: { id: 'app.skin-site.wiki.browser.tab-category', defaultMessage: 'Category' },
	categoryPlaceholder: {
		id: 'app.skin-site.wiki.browser.category-placeholder',
		defaultMessage: 'Category name',
	},
	loadMore: { id: 'app.skin-site.wiki.browser.load-more', defaultMessage: 'Load more' },
	emptySearch: {
		id: 'app.skin-site.wiki.browser.empty-search',
		defaultMessage: 'No pages match your search.',
	},
	emptyList: {
		id: 'app.skin-site.wiki.browser.empty-list',
		defaultMessage: 'Nothing here yet.',
	},
	hintSearch: {
		id: 'app.skin-site.wiki.browser.hint-search',
		defaultMessage: 'Type a keyword to search.',
	},
	hintCategory: {
		id: 'app.skin-site.wiki.browser.hint-category',
		defaultMessage: 'Enter a category name to browse.',
	},
	byAuthor: {
		id: 'app.skin-site.wiki.browser.by-author',
		defaultMessage: 'by {author}',
	},
})

type Tab = 'search' | 'recent' | 'category'
const tab = ref<Tab>('recent')

const keyword = ref('')
const categoryName = ref('')

const items = ref<SkinSiteWikiPageSummary[]>([])
const nextCursor = ref<number | null>(null)
const loading = ref(false)
const loaded = ref(false)

const canLoadMore = computed(() => nextCursor.value != null)

function formatDate(ts: number): string {
	try {
		return new Date(ts).toLocaleDateString()
	} catch {
		return '—'
	}
}

function resetState() {
	items.value = []
	nextCursor.value = null
	loaded.value = false
}

async function runSearch() {
	const q = keyword.value.trim()
	if (!q) {
		resetState()
		return
	}
	loading.value = true
	try {
		const res = await skinSiteWikiSearch(q)
		if (!res.success) throw new Error(res.errorMessage)
		items.value = res.payload ?? []
		nextCursor.value = null
		loaded.value = true
	} catch (error) {
		handleError(error)
		resetState()
	} finally {
		loading.value = false
	}
}

async function fetchPage(mode: 'recent' | 'category', append: boolean) {
	if (mode === 'category' && !categoryName.value.trim()) {
		resetState()
		return
	}
	loading.value = true
	try {
		const before = append ? (nextCursor.value ?? undefined) : undefined
		const res: { success: boolean; payload?: SkinSiteWikiSearchPage; errorMessage?: string } =
			mode === 'recent'
				? await skinSiteWikiRecent(before)
				: await skinSiteWikiCategory(categoryName.value.trim(), before)
		if (!res.success || !res.payload) throw new Error(res.errorMessage ?? 'request failed')
		const page = res.payload
		items.value = append ? [...items.value, ...page.items] : page.items
		nextCursor.value = page.nextCursor ?? null
		loaded.value = true
	} catch (error) {
		handleError(error)
		if (!append) resetState()
	} finally {
		loading.value = false
	}
}

function switchTab(next: Tab) {
	if (tab.value === next) return
	tab.value = next
	resetState()
	if (next === 'recent') void fetchPage('recent', false)
}

function loadMore() {
	if (tab.value === 'recent') void fetchPage('recent', true)
	else if (tab.value === 'category') void fetchPage('category', true)
}

watch(categoryName, () => {
	if (tab.value === 'category') {
		resetState()
	}
})

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(keyword, () => {
	if (tab.value !== 'search') return
	if (searchTimer) clearTimeout(searchTimer)
	searchTimer = setTimeout(() => {
		void runSearch()
	}, 300)
})

onMounted(() => {
	void fetchPage('recent', false)
})
</script>

<template>
	<div class="flex flex-col gap-3 rounded-xl border border-solid border-surface-5 bg-bg-raised p-3">
		<div class="flex flex-wrap items-center gap-2">
			<button
				v-for="t in (['search', 'recent', 'category'] as Tab[])"
				:key="t"
				type="button"
				class="rounded-lg px-3 py-1 text-xs font-semibold"
				:class="tab === t ? 'bg-brand text-contrast' : 'bg-button-bg text-secondary'"
				@click="switchTab(t)"
			>
				{{
					formatMessage(
						t === 'search'
							? messages.tabSearch
							: t === 'recent'
								? messages.tabRecent
								: messages.tabCategory,
					)
				}}
			</button>
		</div>

		<input
			v-if="tab === 'search'"
			v-model="keyword"
			type="text"
			:placeholder="formatMessage(messages.searchPlaceholder)"
			class="w-full rounded-lg border border-solid border-surface-5 bg-bg px-3 py-1.5 text-xs text-contrast outline-none focus:border-brand"
			@keyup.enter="runSearch"
		/>
		<input
			v-else-if="tab === 'category'"
			v-model="categoryName"
			type="text"
			:placeholder="formatMessage(messages.categoryPlaceholder)"
			class="w-full rounded-lg border border-solid border-surface-5 bg-bg px-3 py-1.5 text-xs text-contrast outline-none focus:border-brand"
			@keyup.enter="fetchPage('category', false)"
		/>

		<div v-if="loading && !items.length" class="flex min-h-16 items-center justify-center gap-2 text-xs text-secondary">
			<SpinnerIcon class="size-4 animate-spin" />
		</div>

		<p v-else-if="tab === 'search' && !keyword.trim()" class="m-0 text-xs text-secondary">
			{{ formatMessage(messages.hintSearch) }}
		</p>
		<p v-else-if="tab === 'category' && !categoryName.trim()" class="m-0 text-xs text-secondary">
			{{ formatMessage(messages.hintCategory) }}
		</p>
		<p v-else-if="loaded && !items.length" class="m-0 text-xs text-secondary">
			{{ formatMessage(tab === 'search' ? messages.emptySearch : messages.emptyList) }}
		</p>

		<div v-else class="flex flex-col divide-y divide-surface-5">
			<button
				v-for="item in items"
				:key="item.title"
				type="button"
				class="flex flex-col items-start gap-0.5 py-2 text-left hover:brightness-110"
				@click="emit('navigate', item.title)"
			>
				<span class="text-sm font-semibold text-contrast">{{ item.title }}</span>
				<span class="text-[10px] text-secondary">
					{{ formatMessage(messages.byAuthor, { author: item.authorName }) }} ·
					{{ formatDate(item.updatedAt) }}
				</span>
			</button>
		</div>

		<button
			v-if="canLoadMore && !loading"
			type="button"
			class="self-start rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-secondary hover:brightness-110"
			@click="loadMore"
		>
			{{ formatMessage(messages.loadMore) }}
		</button>
	</div>
</template>