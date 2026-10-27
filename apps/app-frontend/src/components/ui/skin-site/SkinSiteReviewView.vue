<script setup lang="ts">
import { CheckCircleIcon, SpinnerIcon } from '@modrinth/assets'
import { defineMessages, injectNotificationManager, StyledInput, useVIntl } from '@modrinth/ui'
import { computed, onMounted, ref } from 'vue'

import {
	skinSiteReviewCatalog,
	type SkinSiteReviewPublicPaper,
	type SkinSiteReviewPublicQuestion,
	type SkinSiteReviewReceipt,
	skinSiteSubmitReview,
} from '@/helpers/skin-site-api'

const { formatMessage } = useVIntl()
const { handleError, addNotification } = injectNotificationManager()

const messages = defineMessages({
	title: { id: 'app.skin-site.review.title', defaultMessage: 'Player review' },
	back: { id: 'app.skin-site.review.back', defaultMessage: 'Back to home' },
	subtitle: {
		id: 'app.skin-site.review.subtitle',
		defaultMessage: 'Pick an application form and answer its questions.',
	},
	loading: { id: 'app.skin-site.review.loading', defaultMessage: 'Loading…' },
	failed: { id: 'app.skin-site.review.failed', defaultMessage: 'Could not load the review forms.' },
	empty: {
		id: 'app.skin-site.review.empty',
		defaultMessage: 'No application forms are available right now.',
	},
	email: { id: 'app.skin-site.review.email', defaultMessage: 'Your email' },
	emailHint: {
		id: 'app.skin-site.review.email-hint',
		defaultMessage: 'Results are sent to this address.',
	},
	inviteCode: { id: 'app.skin-site.review.invite-code', defaultMessage: 'Invite code' },
	submit: { id: 'app.skin-site.review.submit', defaultMessage: 'Submit application' },
	submitting: { id: 'app.skin-site.review.submitting', defaultMessage: 'Submitting…' },
	backToList: { id: 'app.skin-site.review.back-to-list', defaultMessage: 'Back to forms' },
	required: { id: 'app.skin-site.review.required', defaultMessage: 'Required' },
	optional: { id: 'app.skin-site.review.optional', defaultMessage: 'Optional' },
	submitted: { id: 'app.skin-site.review.submitted', defaultMessage: 'Application submitted.' },
	resultPending: { id: 'app.skin-site.review.result.pending', defaultMessage: 'Under review' },
	resultPassed: { id: 'app.skin-site.review.result.passed', defaultMessage: 'Approved' },
	resultRejected: { id: 'app.skin-site.review.result.rejected', defaultMessage: 'Rejected' },
})

const emit = defineEmits<{ (e: 'back'): void }>()

const papers = ref<SkinSiteReviewPublicPaper[]>([])
const loading = ref(true)
const failed = ref(false)
const activePaper = ref<SkinSiteReviewPublicPaper | null>(null)
const email = ref('')
const inviteCode = ref('')
const answers = ref<Record<string, string | string[]>>({})
const submitting = ref(false)
const receipt = ref<SkinSiteReviewReceipt | null>(null)

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()))

const requiredAnswered = computed(() => {
	if (!activePaper.value) return false
	return (activePaper.value.questions ?? []).every((q) => {
		if (q.informationQuestion || q.optional) return true
		const value = answers.value[q.id]
		if (Array.isArray(value)) return value.length > 0
		return typeof value === 'string' ? value.trim().length > 0 : false
	})
})

const canSubmit = computed(() => emailValid.value && requiredAnswered.value && !submitting.value)

function defaultAnswer(q: SkinSiteReviewPublicQuestion): string | string[] {
	if (q.type === 'MULTIPLE' || q.type === 'SINGLE') {
		const preset = (q.options ?? []).filter((o) => o.defaultSelected).map((o) => o.id)
		return q.type === 'MULTIPLE' ? preset : (preset[0] ?? '')
	}
	return ''
}

function openPaper(paper: SkinSiteReviewPublicPaper) {
	activePaper.value = paper
	answers.value = {}
	for (const q of paper.questions ?? []) answers.value[q.id] = defaultAnswer(q)
	email.value = ''
	inviteCode.value = ''
	receipt.value = null
}

function closePaper() {
	activePaper.value = null
	answers.value = {}
	receipt.value = null
}

function toggleMultiple(q: SkinSiteReviewPublicQuestion, optionId: string, checked: boolean) {
	const current = Array.isArray(answers.value[q.id]) ? (answers.value[q.id] as string[]) : []
	answers.value[q.id] = checked
		? [...current.filter((id) => id !== optionId), optionId]
		: current.filter((id) => id !== optionId)
}
async function loadCatalog() {
	loading.value = true
	failed.value = false
	try {
		const result = await skinSiteReviewCatalog()
		if (!result.success) throw new Error(result.errorMessage)
		papers.value = result.payload?.papers ?? []
	} catch (error) {
		failed.value = true
		handleError(error)
	} finally {
		loading.value = false
	}
}

async function submitApplication() {
	if (!activePaper.value || !canSubmit.value) return
	submitting.value = true
	try {
		const payloadAnswers: Record<string, unknown> = {}
		for (const q of activePaper.value.questions ?? []) {
			if (q.informationQuestion) continue
			payloadAnswers[q.id] = answers.value[q.id] ?? ''
		}
		const result = await skinSiteSubmitReview({
			paperId: activePaper.value.id,
			email: email.value.trim(),
			answers: payloadAnswers,
			...(inviteCode.value.trim() ? { inviteCode: inviteCode.value.trim() } : {}),
		})
		if (!result.success) {
			handleError(new Error(result.errorMessage))
			return
		}
		receipt.value = result.payload
		addNotification({ type: 'success', title: formatMessage(messages.submitted) })
	} catch (error) {
		handleError(error)
	} finally {
		submitting.value = false
	}
}

function resultLabel(result?: string): string {
	switch (result) {
		case 'PASSED':
			return formatMessage(messages.resultPassed)
		case 'REJECTED':
			return formatMessage(messages.resultRejected)
		default:
			return formatMessage(messages.resultPending)
	}
}

onMounted(loadCatalog)
</script>
<template>
	<div class="flex flex-col gap-4">
		<button
			type="button"
			class="flex w-fit items-center gap-1 rounded-full bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110"
			@click="activePaper ? closePaper() : emit('back')"
		>
			← {{ activePaper ? formatMessage(messages.backToList) : formatMessage(messages.back) }}
		</button>

		<template v-if="!activePaper">
			<header class="flex flex-col gap-1">
				<h1 class="m-0 text-xl font-bold text-contrast">{{ formatMessage(messages.title) }}</h1>
				<p class="m-0 text-sm text-secondary">{{ formatMessage(messages.subtitle) }}</p>
			</header>

			<div v-if="loading" class="flex items-center gap-2 text-sm text-secondary">
				<SpinnerIcon class="size-4 animate-spin" />
				{{ formatMessage(messages.loading) }}
			</div>
			<p v-else-if="failed" class="m-0 text-sm text-secondary">
				{{ formatMessage(messages.failed) }}
			</p>
			<p v-else-if="!papers.length" class="m-0 text-sm text-secondary">
				{{ formatMessage(messages.empty) }}
			</p>
			<button
				v-for="paper in papers"
				:key="paper.id"
				type="button"
				class="flex flex-col items-start gap-1 rounded-xl border border-solid border-surface-5 bg-bg-raised p-3 text-left transition-colors hover:bg-button-bg"
				@click="openPaper(paper)"
			>
				<span class="text-sm font-semibold text-contrast">{{ paper.title }}</span>
				<span v-if="paper.description" class="text-xs text-secondary">{{ paper.description }}</span>
			</button>
		</template>

		<div
			v-else-if="receipt"
			class="flex flex-col items-center gap-3 rounded-2xl border border-solid border-surface-5 bg-bg-raised p-6 text-center"
		>
			<CheckCircleIcon class="size-10 text-brand" />
			<h2 class="m-0 text-lg font-bold text-contrast">{{ formatMessage(messages.submitted) }}</h2>
			<p class="m-0 text-sm text-secondary">{{ resultLabel(receipt.result) }}</p>
			<button
				type="button"
				class="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-contrast"
				@click="closePaper"
			>
				{{ formatMessage(messages.backToList) }}
			</button>
		</div>

		<template v-else>
			<h1 class="m-0 text-xl font-bold text-contrast">{{ activePaper.title }}</h1>

			<label class="flex flex-col gap-1">
				<span class="text-sm font-semibold text-contrast">{{ formatMessage(messages.email) }}</span>
				<StyledInput v-model="email" type="email" autocomplete="email" />
				<span class="text-xs text-secondary">{{ formatMessage(messages.emailHint) }}</span>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-sm font-semibold text-contrast">{{
					formatMessage(messages.inviteCode)
				}}</span>
				<StyledInput v-model="inviteCode" type="text" />
			</label>

			<div
				v-for="question in activePaper.questions ?? []"
				:key="question.id"
				class="flex flex-col gap-2 rounded-xl border border-solid border-surface-5 bg-bg-raised p-3"
			>
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-sm font-semibold text-contrast">{{ question.title }}</span>
					<span
						v-if="!question.optional && !question.informationQuestion"
						class="rounded-full bg-brand-highlight px-2 py-0.5 text-[10px] font-semibold text-contrast"
					>
						{{ formatMessage(messages.required) }}
					</span>
				</div>
				<span v-if="question.annotation" class="text-xs text-secondary">{{
					question.annotation
				}}</span>

				<span v-if="question.informationQuestion" class="text-xs text-secondary">
					{{ question.answer }}
				</span>

				<template v-else-if="question.type === 'SINGLE' || question.type === 'TRUE_FALSE'">
					<label
						v-for="option in question.options ?? []"
						:key="option.id"
						class="flex items-center gap-2 text-sm"
					>
						<input
							type="radio"
							:name="question.id"
							:value="option.id"
							:checked="answers[question.id] === option.id"
							@change="answers[question.id] = option.id"
						/>
						<span class="text-contrast">{{ option.description }}</span>
					</label>
				</template>

				<template v-else-if="question.type === 'MULTIPLE'">
					<label
						v-for="option in question.options ?? []"
						:key="option.id"
						class="flex items-center gap-2 text-sm"
					>
						<input
							type="checkbox"
							:checked="
								Array.isArray(answers[question.id]) &&
								(answers[question.id] as string[]).includes(option.id)
							"
							@change="
								toggleMultiple(question, option.id, ($event.target as HTMLInputElement).checked)
							"
						/>
						<span class="text-contrast">{{ option.description }}</span>
					</label>
				</template>

				<StyledInput
					v-else-if="question.type === 'FILL'"
					v-model="answers[question.id] as string"
					type="text"
					:maxlength="question.maxLength ?? 50"
				/>

				<textarea
					v-else
					v-model="answers[question.id] as string"
					rows="4"
					class="w-full rounded-lg border border-solid border-surface-5 bg-button-bg p-2 text-sm text-contrast"
					:maxlength="question.maxLength ?? 300"
				/>
			</div>

			<button
				type="button"
				class="w-fit self-end rounded-full bg-brand px-5 py-2 text-sm font-semibold text-contrast disabled:opacity-50"
				:disabled="!canSubmit"
				@click="submitApplication"
			>
				{{ formatMessage(submitting ? messages.submitting : messages.submit) }}
			</button>
		</template>
	</div>
</template>
