<script setup lang="ts">
import { SpinnerIcon } from '@modrinth/assets'
import { defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { computed, onMounted, ref } from 'vue'

import {
	skinSiteWikiDiff,
	type SkinSiteWikiDiffLine,
	skinSiteWikiHistory,
	type SkinSiteWikiNode,
	skinSiteWikiPage,
	type SkinSiteWikiPageDetail,
	skinSiteWikiRevert,
	skinSiteWikiRevision,
	type SkinSiteWikiRevisionInfo,
} from '@/helpers/skin-site-api'

import WikiBrowser from './wiki/WikiBrowser.vue'
import WikiNodeRenderer from './wiki/WikiNodeRenderer.vue'

const { formatMessage } = useVIntl()
const { handleError, addNotification } = injectNotificationManager()

const props = withDefaults(defineProps<{ initialTitle?: string }>(), {
	initialTitle: '',
})

const messages = defineMessages({
	title: { id: 'app.skin-site.wiki.title', defaultMessage: 'StarLight Wiki' },
	searchPlaceholder: {
		id: 'app.skin-site.wiki.search-placeholder',
		defaultMessage: 'Enter a page title',
	},
	open: { id: 'app.skin-site.wiki.open', defaultMessage: 'Open' },
	loading: { id: 'app.skin-site.wiki.loading', defaultMessage: 'Loading…' },
	notFound: {
		id: 'app.skin-site.wiki.not-found',
		defaultMessage: 'Page not found.',
	},
	empty: {
		id: 'app.skin-site.wiki.empty',
		defaultMessage: 'Enter a page title above to start reading.',
	},
	updatedAt: {
		id: 'app.skin-site.wiki.updated-at',
		defaultMessage: 'Last edited {date} by {author}',
	},
	revision: { id: 'app.skin-site.wiki.revision', defaultMessage: 'Revision #{id}' },
	categories: { id: 'app.skin-site.wiki.categories', defaultMessage: 'Categories' },
	back: { id: 'app.skin-site.wiki.back', defaultMessage: 'Back' },
	history: { id: 'app.skin-site.wiki.history', defaultMessage: 'History' },
	read: { id: 'app.skin-site.wiki.read', defaultMessage: 'Read' },
	historyEmpty: {
		id: 'app.skin-site.wiki.history-empty',
		defaultMessage: 'No revisions yet.',
	},
	noSummary: {
		id: 'app.skin-site.wiki.no-summary',
		defaultMessage: 'No edit summary',
	},
	minor: { id: 'app.skin-site.wiki.minor', defaultMessage: 'Minor' },
	viewRevision: { id: 'app.skin-site.wiki.view-revision', defaultMessage: 'View' },
	revertTo: {
		id: 'app.skin-site.wiki.revert-to',
		defaultMessage: 'Revert to this',
	},
	confirmRevert: {
		id: 'app.skin-site.wiki.confirm-revert',
		defaultMessage: 'Confirm revert',
	},
	revertDone: {
		id: 'app.skin-site.wiki.revert-done',
		defaultMessage: 'Page reverted to the selected revision.',
	},
	revisionPreview: {
		id: 'app.skin-site.wiki.revision-preview',
		defaultMessage: 'Preview of revision #{id}',
	},
	closePreview: {
		id: 'app.skin-site.wiki.close-preview',
		defaultMessage: 'Close preview',
	},
	diffTitle: {
		id: 'app.skin-site.wiki.diff-title',
		defaultMessage: 'Line diff against the current revision',
	},
	cancel: { id: 'app.skin-site.wiki.cancel', defaultMessage: 'Cancel' },
})

const titleInput = ref(props.initialTitle)
const page = ref<SkinSiteWikiPageDetail | null>(null)
const loading = ref(false)
const notFound = ref(false)
const navStack = ref<string[]>([])

const currentTitle = computed(() => page.value?.title ?? '')

async function openPage(title: string) {
	const trimmed = title.trim()
	if (!trimmed) return
	titleInput.value = trimmed
	loading.value = true
	notFound.value = false
	try {
		const res = await skinSiteWikiPage(trimmed)
		if (!res.success) {
			notFound.value = true
			page.value = null
			return
		}
		page.value = res.payload
		if (currentTitle.value && navStack.value[navStack.value.length - 1] !== currentTitle.value) {
			navStack.value.push(currentTitle.value)
		}
	} catch (error) {
		handleError(error)
		notFound.value = true
		page.value = null
	} finally {
		loading.value = false
	}
}

function goBack() {
	const prev = navStack.value.pop()
	if (prev) void openPage(prev)
}

function formatDate(ts: number): string {
	try {
		return new Date(ts).toLocaleString()
	} catch {
		return '—'
	}
}

const mode = ref<'read' | 'history'>('read')
const history = ref<SkinSiteWikiRevisionInfo[]>([])
const historyLoading = ref(false)

const selectedRevisionId = ref<number | null>(null)
const selectedRevisionNodes = ref<SkinSiteWikiNode[] | null>(null)
const diffLines = ref<SkinSiteWikiDiffLine[]>([])
const pendingRevertId = ref<number | null>(null)
const reverting = ref(false)

async function showHistory() {
	if (!page.value) return
	mode.value = 'history'
	historyLoading.value = true
	try {
		const res = await skinSiteWikiHistory(page.value.title)
		if (!res.success) throw new Error(res.errorMessage)
		history.value = res.payload.items ?? []
	} catch (error) {
		handleError(error)
		history.value = []
	} finally {
		historyLoading.value = false
	}
}

function backToRead() {
	mode.value = 'read'
	selectedRevisionNodes.value = null
	diffLines.value = []
	pendingRevertId.value = null
}

async function viewRevision(revisionId: number) {
	if (!page.value) return
	try {
		const res = await skinSiteWikiRevision(page.value.title, revisionId)
		if (!res.success) throw new Error(res.errorMessage)
		selectedRevisionId.value = revisionId
		selectedRevisionNodes.value = res.payload.nodes ?? []
		diffLines.value = []
		if (revisionId !== page.value.revisionId) {
			const diff = await skinSiteWikiDiff(page.value.title, revisionId, page.value.revisionId)
			if (diff.success) diffLines.value = diff.payload ?? []
		}
	} catch (error) {
		handleError(error)
	}
}

async function revertToRevision(revisionId: number) {
	if (!page.value || reverting.value) return
	reverting.value = true
	try {
		const res = await skinSiteWikiRevert({
			title: page.value.title,
			revisionId,
			baseRevisionId: page.value.revisionId,
		})
		if (!res.success) throw new Error(res.errorMessage)
		page.value = res.payload
		pendingRevertId.value = null
		backToRead()
		addNotification({ type: 'success', title: formatMessage(messages.revertDone) })
	} catch (error) {
		handleError(error)
	} finally {
		reverting.value = false
	}
}

function onNavigate(title: string) {
	if (title) void openPage(title)
}

onMounted(() => {
	if (props.initialTitle) void openPage(props.initialTitle)
})
</script>

<template>
	<div class="flex w-full flex-col gap-4">
		<div class="flex flex-wrap items-center gap-2">
			<button
				v-if="navStack.length"
				type="button"
				class="rounded-lg bg-button-bg px-3 py-1.5 text-xs font-semibold text-contrast hover:brightness-110"
				@click="goBack"
			>
				← {{ formatMessage(messages.back) }}
			</button>
			<h2 class="m-0 text-lg font-bold text-contrast">{{ formatMessage(messages.title) }}</h2>
			<input
				v-model="titleInput"
				type="text"
				:placeholder="formatMessage(messages.searchPlaceholder)"
				class="min-w-0 flex-1 rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-1.5 text-xs text-contrast outline-none focus:border-brand"
				@keyup.enter="openPage(titleInput)"
			/>
			<button
				type="button"
				class="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-contrast hover:brightness-110"
				@click="openPage(titleInput)"
			>
				{{ formatMessage(messages.open) }}
			</button>
			<template v-if="page">
				<button
					type="button"
					class="rounded-lg px-3 py-1.5 text-xs font-semibold"
					:class="mode === 'read' ? 'bg-brand text-contrast' : 'bg-button-bg text-secondary'"
					@click="backToRead"
				>
					{{ formatMessage(messages.read) }}
				</button>
				<button
					type="button"
					class="rounded-lg px-3 py-1.5 text-xs font-semibold"
					:class="mode === 'history' ? 'bg-brand text-contrast' : 'bg-button-bg text-secondary'"
					@click="showHistory"
				>
					{{ formatMessage(messages.history) }}
				</button>
			</template>
		</div>

		<WikiBrowser @navigate="onNavigate" />

		<div v-if="loading" class="flex min-h-48 items-center justify-center gap-2 text-sm text-secondary">
			<SpinnerIcon class="size-4 animate-spin" />
			{{ formatMessage(messages.loading) }}
		</div>
		<p
			v-else-if="notFound"
			class="m-0 rounded-lg border border-solid border-surface-5 bg-bg-raised p-4 text-sm text-secondary"
		>
			{{ formatMessage(messages.notFound) }}
		</p>
		<p
			v-else-if="!page"
			class="m-0 rounded-lg border border-solid border-surface-5 bg-bg-raised p-4 text-sm text-secondary"
		>
			{{ formatMessage(messages.empty) }}
		</p>
		<template v-else-if="mode === 'read'">
			<div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-solid border-surface-5 pb-2">
				<h1 class="m-0 text-2xl font-bold text-contrast">{{ page.title }}</h1>
				<div class="flex flex-wrap items-center gap-1.5">
					<span class="text-[11px] text-secondary">
						{{ formatMessage(messages.revision, { id: page.revisionId }) }}
					</span>
					<button
						type="button"
						class="rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
						:class="watching ? 'bg-brand text-contrast' : 'bg-button-bg text-secondary'"
						:disabled="watchBusy"
						@click="toggleWatch"
					>
						{{ formatMessage(watching ? messages.unwatch : messages.watch) }}
					</button>
					<button
						v-if="page.canEdit"
						type="button"
						class="rounded-lg bg-button-bg px-2.5 py-1 text-xs font-semibold text-secondary hover:brightness-110"
						@click="openMove"
					>
						{{ formatMessage(messages.move) }}
					</button>
				</div>
			</div>

			<div
				v-if="moving"
				class="flex flex-wrap items-center gap-2 rounded-lg border border-solid border-surface-5 bg-bg-raised p-2"
			>
				<input
					v-model="moveTarget"
					type="text"
					:placeholder="formatMessage(messages.moveTarget)"
					class="min-w-0 flex-1 rounded-lg border border-solid border-surface-5 bg-bg px-2 py-1 text-xs text-contrast outline-none focus:border-brand"
					@keyup.enter="confirmMove"
				/>
				<button
					type="button"
					class="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-contrast disabled:opacity-50"
					:disabled="moveBusy"
					@click="confirmMove"
				>
					{{ formatMessage(messages.moveConfirm) }}
				</button>
				<button
					type="button"
					class="rounded-lg bg-button-bg px-2.5 py-1 text-xs font-semibold text-secondary"
					@click="moving = false"
				>
					{{ formatMessage(messages.cancel) }}
				</button>
			</div>

			<p class="m-0 text-[11px] text-secondary">
				{{
					formatMessage(messages.updatedAt, {
						date: formatDate(page.updatedAt),
						author: page.authorName,
					})
				}}
			</p>

			<div
				v-if="page.redirectTarget"
				class="rounded-lg border border-solid border-yellow/40 bg-yellow/10 p-3 text-xs text-yellow"
			>
				重定向到
				<button
					type="button"
					class="font-semibold underline underline-offset-2"
					@click="openPage(page.redirectTarget ?? '')"
				>
					{{ page.redirectTarget }}
				</button>
			</div>

			<article class="min-w-0 text-sm leading-7 text-contrast">
				<WikiNodeRenderer :nodes="page.nodes" @navigate="onNavigate" />
			</article>

			<div v-if="page.categories.length" class="flex flex-wrap items-center gap-2 pt-2">
				<span class="text-[11px] text-secondary">{{ formatMessage(messages.categories) }}:</span>
				<span
					v-for="category in page.categories"
					:key="category"
					class="rounded bg-bg-raised px-2 py-0.5 text-[11px] text-secondary"
				>
					{{ category }}
				</span>
			</div>
		</template>

		<template v-else>
			<div v-if="historyLoading" class="flex min-h-32 items-center justify-center gap-2 text-sm text-secondary">
				<SpinnerIcon class="size-4 animate-spin" />
				{{ formatMessage(messages.loading) }}
			</div>
			<template v-else>
				<div
					v-if="selectedRevisionNodes"
					class="flex flex-col gap-3 rounded-xl border border-solid border-surface-5 bg-bg-raised p-4"
				>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span class="text-sm font-semibold text-contrast">
							{{ formatMessage(messages.revisionPreview, { id: selectedRevisionId }) }}
						</span>
						<button
							type="button"
							class="rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-secondary hover:brightness-110"
							@click="selectedRevisionNodes = null; diffLines = []"
						>
							{{ formatMessage(messages.closePreview) }}
						</button>
					</div>
					<article class="min-w-0 text-sm leading-7 text-contrast">
						<WikiNodeRenderer :nodes="selectedRevisionNodes" @navigate="onNavigate" />
					</article>
					<details v-if="diffLines.length" class="rounded-lg border border-solid border-surface-5 p-3">
						<summary class="cursor-pointer text-xs font-semibold text-contrast">
							{{ formatMessage(messages.diffTitle) }}
						</summary>
						<div class="mt-2 max-h-96 overflow-auto font-mono text-[11px]">
							<div
								v-for="(line, idx) in diffLines"
								:key="idx"
								class="px-2 py-0.5 whitespace-pre-wrap"
								:class="
									line.type === 'ADDED'
										? 'bg-green/15 text-green'
										: line.type === 'REMOVED'
											? 'bg-red/15 text-red'
											: 'text-secondary'
								"
							>
								{{ line.type === 'ADDED' ? '+' : line.type === 'REMOVED' ? '-' : ' ' }}{{ line.text }}
							</div>
						</div>
					</details>
				</div>

				<p
					v-if="!history.length"
					class="m-0 rounded-lg border border-solid border-surface-5 bg-bg-raised p-4 text-sm text-secondary"
				>
					{{ formatMessage(messages.historyEmpty) }}
				</p>
				<div v-else class="flex flex-col divide-y divide-surface-5">
					<div
						v-for="revision in history"
						:key="revision.id"
						class="flex flex-wrap items-start justify-between gap-3 py-3"
					>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-sm font-semibold text-contrast">{{ revision.authorName }}</span>
								<span
									v-if="revision.minor"
									class="rounded bg-button-bg px-2 py-0.5 text-[10px] text-secondary"
								>
									{{ formatMessage(messages.minor) }}
								</span>
								<span class="text-[10px] text-secondary">#{{ revision.id }}</span>
							</div>
							<p class="m-0 mt-1 text-xs text-secondary">
								{{ revision.summary || formatMessage(messages.noSummary) }}
							</p>
							<p class="m-0 mt-0.5 text-[10px] text-secondary">{{ formatDate(revision.createdAt) }}</p>
						</div>
						<div class="flex flex-wrap gap-1.5">
							<button
								type="button"
								class="rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110"
								@click="viewRevision(revision.id)"
							>
								{{ formatMessage(messages.viewRevision) }}
							</button>
							<template v-if="page && revision.id !== page.revisionId">
								<button
									v-if="pendingRevertId !== revision.id"
									type="button"
									class="rounded-lg bg-yellow/20 px-3 py-1 text-xs font-semibold text-yellow hover:brightness-110 disabled:opacity-50"
									:disabled="reverting"
									@click="pendingRevertId = revision.id"
								>
									{{ formatMessage(messages.revertTo) }}
								</button>
								<template v-else>
									<button
										type="button"
										class="rounded-lg bg-yellow px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
										:disabled="reverting"
										@click="revertToRevision(revision.id)"
									>
										{{ formatMessage(messages.confirmRevert) }}
									</button>
									<button
										type="button"
										class="rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-secondary"
										@click="pendingRevertId = null"
									>
										{{ formatMessage(messages.cancel) }}
									</button>
								</template>
							</template>
						</div>
					</div>
				</div>
			</template>
		</template>
	</div>
</template>
