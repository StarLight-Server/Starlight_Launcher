<script setup lang="ts">
import { SpinnerIcon } from '@modrinth/assets'
import { defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
	type SkinSiteBugComment,
	skinSiteBugComments,
	skinSiteBugImageFetch,
	type SkinSiteBugIssue,
	skinSiteBugIssue,
	type SkinSiteBugIssueType,
	type SkinSiteBugPriority,
	type SkinSiteBugResolution,
	type SkinSiteBugStatus,
	skinSiteCreateBugComment,
	skinSiteDeleteBugComment,
} from '@/helpers/skin-site-api'

const props = defineProps<{ issueId: number }>()
const emit = defineEmits<{ (e: 'back'): void }>()

const { formatMessage } = useVIntl()
const { handleError, addNotification } = injectNotificationManager()

const messages = defineMessages({
	back: { id: 'app.skin-site.bug-detail.back', defaultMessage: 'Back to list' },
	loading: { id: 'app.skin-site.bug-detail.loading', defaultMessage: 'Loading…' },
	failed: { id: 'app.skin-site.bug-detail.failed', defaultMessage: 'Could not load this issue.' },
	issueNo: { id: 'app.skin-site.bug-detail.issue-no', defaultMessage: 'Issue #{id}' },
	by: { id: 'app.skin-site.bug-detail.by', defaultMessage: 'by {name}' },
	assignee: { id: 'app.skin-site.bug-detail.assignee', defaultMessage: 'Assignee: {name}' },
	unassigned: { id: 'app.skin-site.bug-detail.unassigned', defaultMessage: 'Unassigned' },
	descriptionEmpty: {
		id: 'app.skin-site.bug-detail.description-empty',
		defaultMessage: 'No description provided.',
	},
	resolution: { id: 'app.skin-site.bug-detail.resolution', defaultMessage: 'Resolution: {name}' },
	commentsTitle: { id: 'app.skin-site.bug-detail.comments-title', defaultMessage: 'Comments' },
	commentsEmpty: {
		id: 'app.skin-site.bug-detail.comments-empty',
		defaultMessage: 'No comments yet. Be the first to reply.',
	},
	commentsLoading: {
		id: 'app.skin-site.bug-detail.comments-loading',
		defaultMessage: 'Loading comments…',
	},
	commentPlaceholder: {
		id: 'app.skin-site.bug-detail.comment-placeholder',
		defaultMessage: 'Write a comment…',
	},
	commentSubmit: { id: 'app.skin-site.bug-detail.comment-submit', defaultMessage: 'Comment' },
	commentSending: { id: 'app.skin-site.bug-detail.comment-sending', defaultMessage: 'Sending…' },
	commentEmptyError: {
		id: 'app.skin-site.bug-detail.comment-empty-error',
		defaultMessage: 'Comment cannot be empty.',
	},
	commentPosted: {
		id: 'app.skin-site.bug-detail.comment-posted',
		defaultMessage: 'Comment posted.',
	},
	commentDeleted: {
		id: 'app.skin-site.bug-detail.comment-deleted',
		defaultMessage: 'Comment deleted.',
	},
	delete: { id: 'app.skin-site.bug-detail.delete', defaultMessage: 'Delete' },
	deleting: { id: 'app.skin-site.bug-detail.deleting', defaultMessage: 'Deleting…' },
	system: { id: 'app.skin-site.bug-detail.system', defaultMessage: 'System' },
	typeBug: { id: 'app.skin-site.bugs.type.bug', defaultMessage: 'Bug' },
	typeFeature: { id: 'app.skin-site.bugs.type.feature', defaultMessage: 'Feature' },
	typeImprovement: { id: 'app.skin-site.bugs.type.improvement', defaultMessage: 'Improvement' },
	statusPending: { id: 'app.skin-site.bugs.status.pending', defaultMessage: 'Pending' },
	statusConfirmed: { id: 'app.skin-site.bugs.status.confirmed', defaultMessage: 'Confirmed' },
	statusNeedsInfo: { id: 'app.skin-site.bugs.status.needs-info', defaultMessage: 'Needs info' },
	statusInProgress: { id: 'app.skin-site.bugs.status.in-progress', defaultMessage: 'In progress' },
	statusVerifying: { id: 'app.skin-site.bugs.status.verifying', defaultMessage: 'Verifying' },
	statusClosed: { id: 'app.skin-site.bugs.status.closed', defaultMessage: 'Closed' },
	priorityCritical: { id: 'app.skin-site.bugs.priority.critical', defaultMessage: 'Critical' },
	priorityHigh: { id: 'app.skin-site.bugs.priority.high', defaultMessage: 'High' },
	priorityNormal: { id: 'app.skin-site.bugs.priority.normal', defaultMessage: 'Normal' },
	priorityLow: { id: 'app.skin-site.bugs.priority.low', defaultMessage: 'Low' },
	resFixed: { id: 'app.skin-site.bugs.resolution.fixed', defaultMessage: 'Fixed' },
	resWontFix: { id: 'app.skin-site.bugs.resolution.wont-fix', defaultMessage: 'Won’t fix' },
	resByDesign: { id: 'app.skin-site.bugs.resolution.by-design', defaultMessage: 'By design' },
	resDuplicate: { id: 'app.skin-site.bugs.resolution.duplicate', defaultMessage: 'Duplicate' },
	resCannotReproduce: {
		id: 'app.skin-site.bugs.resolution.cannot-reproduce',
		defaultMessage: 'Cannot reproduce',
	},
	resInvalid: { id: 'app.skin-site.bugs.resolution.invalid', defaultMessage: 'Invalid' },
})

const issue = ref<SkinSiteBugIssue | null>(null)
const loading = ref(true)
const failed = ref(false)

const comments = ref<SkinSiteBugComment[]>([])
const commentsLoading = ref(true)
const commentsHasMore = ref(false)
const commentsLoadingMore = ref(false)
const commentDraft = ref('')
const commentSending = ref(false)
const deletingId = ref<number | null>(null)

function typeLabel(type: SkinSiteBugIssueType): string {
	switch (type) {
		case 'FEATURE':
			return formatMessage(messages.typeFeature)
		case 'IMPROVEMENT':
			return formatMessage(messages.typeImprovement)
		default:
			return formatMessage(messages.typeBug)
	}
}

function statusLabel(status: SkinSiteBugStatus): string {
	switch (status) {
		case 'CONFIRMED':
			return formatMessage(messages.statusConfirmed)
		case 'NEEDS_INFO':
			return formatMessage(messages.statusNeedsInfo)
		case 'IN_PROGRESS':
			return formatMessage(messages.statusInProgress)
		case 'VERIFYING':
			return formatMessage(messages.statusVerifying)
		case 'CLOSED':
			return formatMessage(messages.statusClosed)
		default:
			return formatMessage(messages.statusPending)
	}
}

function priorityLabel(priority: SkinSiteBugPriority): string {
	switch (priority) {
		case 'CRITICAL':
			return formatMessage(messages.priorityCritical)
		case 'HIGH':
			return formatMessage(messages.priorityHigh)
		case 'LOW':
			return formatMessage(messages.priorityLow)
		default:
			return formatMessage(messages.priorityNormal)
	}
}

function resolutionLabel(resolution: SkinSiteBugResolution): string {
	switch (resolution) {
		case 'WONT_FIX':
			return formatMessage(messages.resWontFix)
		case 'BY_DESIGN':
			return formatMessage(messages.resByDesign)
		case 'DUPLICATE':
			return formatMessage(messages.resDuplicate)
		case 'CANNOT_REPRODUCE':
			return formatMessage(messages.resCannotReproduce)
		case 'INVALID':
			return formatMessage(messages.resInvalid)
		default:
			return formatMessage(messages.resFixed)
	}
}

function formatDateTime(ts: number): string {
	try {
		return new Date(ts).toLocaleString()
	} catch {
		return ''
	}
}

const canSubmit = computed(() => !commentSending.value && commentDraft.value.trim().length > 0)

const imageUrls = ref<Record<string, string>>({})

function revokeImageUrls() {
	for (const url of Object.values(imageUrls.value)) URL.revokeObjectURL(url)
	imageUrls.value = {}
}

async function loadIssueImages(issue: SkinSiteBugIssue) {
	revokeImageUrls()
	const entries = await Promise.all(
		(issue.images ?? []).map(async (image) => {
			const blob = await skinSiteBugImageFetch(image.hash)
			return blob ? [image.hash, URL.createObjectURL(blob)] : null
		}),
	)
	const map: Record<string, string> = {}
	for (const entry of entries) if (entry) map[entry[0]] = entry[1]
	imageUrls.value = map
}

async function loadIssue() {
	loading.value = true
	failed.value = false
	try {
		const result = await skinSiteBugIssue(props.issueId)
		if (!result.success) throw new Error(result.errorMessage)
		issue.value = result.payload
		void loadIssueImages(result.payload)
	} catch (error) {
		failed.value = true
		handleError(error)
	} finally {
		loading.value = false
	}
}

async function loadComments(reset = true) {
	if (reset) {
		commentsLoading.value = true
		comments.value = []
	} else {
		commentsLoadingMore.value = true
	}
	try {
		const result = await skinSiteBugComments(props.issueId, reset ? 0 : comments.value.length, 50)
		if (!result.success) throw new Error(result.errorMessage)
		const page = result.payload
		comments.value = reset ? page.items : [...comments.value, ...page.items]
		commentsHasMore.value = page.hasMore
	} catch (error) {
		handleError(error)
	} finally {
		commentsLoading.value = false
		commentsLoadingMore.value = false
	}
}

async function submitComment() {
	const content = commentDraft.value.trim()
	if (!content || commentSending.value) return
	commentSending.value = true
	try {
		const result = await skinSiteCreateBugComment(props.issueId, content)
		if (!result.success) throw new Error(result.errorMessage)
		comments.value = [...comments.value, result.payload]
		commentDraft.value = ''
		addNotification({ type: 'success', title: formatMessage(messages.commentPosted) })
	} catch (error) {
		handleError(error)
	} finally {
		commentSending.value = false
	}
}

async function deleteComment(comment: SkinSiteBugComment) {
	if (deletingId.value !== null) return
	deletingId.value = comment.id
	try {
		const result = await skinSiteDeleteBugComment(comment.id)
		if (!result.success) throw new Error(result.errorMessage)
		comments.value = comments.value.filter((c) => c.id !== comment.id)
		addNotification({ type: 'success', title: formatMessage(messages.commentDeleted) })
	} catch (error) {
		handleError(error)
	} finally {
		deletingId.value = null
	}
}

onMounted(() => {
	void loadIssue()
	void loadComments(true)
})

onUnmounted(revokeImageUrls)
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

		<div v-if="loading" class="flex items-center gap-2 text-sm text-secondary">
			<SpinnerIcon class="size-4 animate-spin" />
			{{ formatMessage(messages.loading) }}
		</div>
		<p v-else-if="failed" class="m-0 text-sm text-secondary">
			{{ formatMessage(messages.failed) }}
		</p>

		<template v-else-if="issue">
			<header
				class="flex flex-col gap-2 rounded-xl border border-solid border-surface-5 bg-bg-raised p-4"
			>
				<div class="flex flex-wrap items-center gap-2">
					<span
						class="shrink-0 rounded-full bg-button-bg px-2 py-0.5 text-[10px] font-semibold text-secondary"
					>
						{{ typeLabel(issue.type) }}
					</span>
					<span
						class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
						:class="{
							'bg-green text-contrast':
								issue.status === 'CONFIRMED' || issue.status === 'VERIFYING',
							'bg-yellow text-contrast':
								issue.status === 'NEEDS_INFO' || issue.status === 'IN_PROGRESS',
							'bg-button-bg text-secondary': issue.status === 'PENDING',
							'bg-surface-5 text-secondary': issue.status === 'CLOSED',
						}"
					>
						{{ statusLabel(issue.status) }}
					</span>
					<span
						class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
						:class="{
							'bg-red text-contrast': issue.priority === 'CRITICAL',
							'bg-orange text-contrast': issue.priority === 'HIGH',
							'bg-button-bg text-secondary':
								issue.priority === 'NORMAL' || issue.priority === 'LOW',
						}"
					>
						{{ priorityLabel(issue.priority) }}
					</span>
					<span v-if="issue.private" class="shrink-0 text-[10px] font-semibold text-secondary">
						🔒
					</span>
					<span class="min-w-0 flex-1 truncate text-xs text-secondary">
						{{ formatMessage(messages.issueNo, { id: issue.id }) }}
					</span>
				</div>

				<h1 class="m-0 text-xl font-bold text-contrast">{{ issue.title }}</h1>

				<div class="flex flex-wrap items-center gap-3 text-xs text-secondary">
					<span>{{ formatMessage(messages.by, { name: issue.authorName }) }}</span>
					<span>{{ formatDateTime(issue.createdAt) }}</span>
					<span v-if="issue.assigneeName">
						{{ formatMessage(messages.assignee, { name: issue.assigneeName }) }}
					</span>
					<span v-else>{{ formatMessage(messages.unassigned) }}</span>
				</div>
				<span v-if="issue.resolution" class="text-xs font-semibold text-secondary">
					{{ formatMessage(messages.resolution, { name: resolutionLabel(issue.resolution) }) }}
				</span>
			</header>

			<div class="rounded-xl border border-solid border-surface-5 bg-bg-raised p-4">
				<p
					v-if="issue.description"
					class="m-0 whitespace-pre-wrap break-words text-sm text-contrast"
				>
					{{ issue.description }}
				</p>
				<p v-else class="m-0 text-sm text-secondary">
					{{ formatMessage(messages.descriptionEmpty) }}
				</p>
				<div v-if="issue.images.length" class="mt-3 flex flex-wrap gap-2">
					<a
						v-for="image in issue.images"
						:key="image.hash"
						:href="imageUrls[image.hash]"
						target="_blank"
						rel="noopener noreferrer"
						class="block overflow-hidden rounded-lg border border-solid border-surface-5"
					>
						<img
							v-if="imageUrls[image.hash]"
							:src="imageUrls[image.hash]"
							alt="attachment"
							class="max-h-48 max-w-full object-contain"
						/>
						<span
							v-else
							class="block bg-surface-5 px-2 py-1 text-[10px] font-mono text-secondary"
						>
							{{ image.hash }}
						</span>
					</a>
				</div>
			</div>

			<section class="flex flex-col gap-3">
				<h2 class="m-0 text-base font-bold text-contrast">
					{{ formatMessage(messages.commentsTitle) }}
				</h2>

				<div class="flex flex-col gap-2">
					<div v-if="commentsLoading" class="flex items-center gap-2 text-sm text-secondary">
						<SpinnerIcon class="size-4 animate-spin" />
						{{ formatMessage(messages.commentsLoading) }}
					</div>
					<p
						v-else-if="!comments.length"
						class="m-0 rounded-xl border border-solid border-surface-5 bg-bg-raised p-4 text-sm text-secondary"
					>
						{{ formatMessage(messages.commentsEmpty) }}
					</p>
					<div
						v-for="comment in comments"
						v-else
						:key="comment.id"
						class="flex flex-col gap-1.5 rounded-xl border border-solid border-surface-5 bg-bg-raised p-3"
					>
						<div class="flex flex-wrap items-center gap-2 text-xs text-secondary">
							<span class="font-semibold text-contrast">{{ comment.authorName }}</span>
							<span
								v-if="comment.system"
								class="rounded-full bg-button-bg px-2 py-0.5 text-[10px] font-semibold"
							>
								{{ formatMessage(messages.system) }}
							</span>
							<span>{{ formatDateTime(comment.createdAt) }}</span>
							<span v-if="comment.editedAt">(edited)</span>
							<button
								v-if="comment.canDelete"
								type="button"
								class="ml-auto rounded-full bg-button-bg px-2 py-0.5 text-[10px] font-semibold text-secondary hover:brightness-110 disabled:opacity-50"
								:disabled="deletingId !== null"
								@click="deleteComment(comment)"
							>
								{{
									deletingId === comment.id
										? formatMessage(messages.deleting)
										: formatMessage(messages.delete)
								}}
							</button>
						</div>
						<p class="m-0 whitespace-pre-wrap break-words text-sm text-contrast">
							{{ comment.content }}
						</p>
					</div>
				</div>

				<button
					v-if="commentsHasMore"
					type="button"
					class="w-fit self-center rounded-full bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
					:disabled="commentsLoadingMore"
					@click="loadComments(false)"
				>
					{{ formatMessage(messages.commentsTitle) }}
				</button>

				<form class="flex flex-col gap-2" @submit.prevent="submitComment">
					<textarea
						v-model="commentDraft"
						rows="3"
						class="w-full resize-y rounded-xl border border-solid border-surface-5 bg-bg-raised p-3 text-sm text-contrast outline-none focus:border-brand"
						:placeholder="formatMessage(messages.commentPlaceholder)"
					/>
					<button
						type="submit"
						class="w-fit self-end rounded-full bg-brand px-4 py-2 text-sm font-semibold text-contrast disabled:opacity-50"
						:disabled="!canSubmit"
					>
						{{
							commentSending
								? formatMessage(messages.commentSending)
								: formatMessage(messages.commentSubmit)
						}}
					</button>
				</form>
			</section>
		</template>
	</div>
</template>
