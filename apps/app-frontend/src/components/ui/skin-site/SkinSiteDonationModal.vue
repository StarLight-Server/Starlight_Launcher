<script setup lang="ts">
import { HeartIcon, SpinnerIcon, StarIcon } from '@modrinth/assets'
import {
	Avatar,
	ButtonStyled,
	commonMessages,
	defineMessages,
	NewModal,
	useVIntl,
} from '@modrinth/ui'
import { onUnmounted, ref } from 'vue'

import {
	skinSiteDonationList,
	type SkinSitePublicDonationEntry,
	type SkinSitePublicDonationSummary,
} from '@/helpers/skin-site-api'

import { formatDonationAmount } from './donation-format'

const { formatMessage } = useVIntl()
const emit = defineEmits<{ summaryUpdated: [summary: SkinSitePublicDonationSummary] }>()
const messages = defineMessages({
	title: { id: 'app.skin-site.home.donation.title', defaultMessage: 'Donation thanks' },
	total: { id: 'app.skin-site.home.donation.total', defaultMessage: 'Total raised' },
	donors: { id: 'app.skin-site.home.donation.donors', defaultMessage: '{count} donors' },
	thanks: {
		id: 'app.skin-site.home.donation.thanks',
		defaultMessage: 'Thank you to everyone who helps keep StarLight running.',
	},
	empty: { id: 'app.skin-site.home.donation.empty', defaultMessage: 'No donations yet.' },
	failed: {
		id: 'app.skin-site.home.donation.list-failed',
		defaultMessage: 'Could not load donations.',
	},
	more: { id: 'app.skin-site.home.donation.more', defaultMessage: 'Load more' },
})
const modal = ref<InstanceType<typeof NewModal>>()
const items = ref<SkinSitePublicDonationEntry[]>([])
const summary = ref<SkinSitePublicDonationSummary | null>(null)
const loading = ref(false)
const failed = ref(false)
const hasMore = ref(false)
let generation = 0

async function load(reset = false) {
	if (loading.value && !reset) return
	const request = ++generation
	if (reset) {
		items.value = []
		summary.value = null
		hasMore.value = false
	}
	loading.value = true
	failed.value = false
	try {
		const result = await skinSiteDonationList(items.value.length)
		if (request !== generation) return
		if (!result.success) throw new Error(result.errorMessage)
		items.value = [...items.value, ...result.payload.items]
		summary.value = result.payload.summary
		emit('summaryUpdated', result.payload.summary)
		hasMore.value = result.payload.hasMore
	} catch {
		if (request === generation) failed.value = true
	} finally {
		if (request === generation) loading.value = false
	}
}
function show() {
	modal.value?.show()
	void load(true)
}
onUnmounted(() => {
	generation++
})
defineExpose({ show })
</script>

<template>
	<NewModal
		ref="modal"
		:header="formatMessage(messages.title)"
		max-width="42rem"
		width="42rem"
		scrollable
	>
		<div class="flex flex-col gap-6">
			<div class="donation-summary">
				<HeartIcon class="size-7 text-brand" />
				<span class="text-sm text-secondary">{{ formatMessage(messages.total) }}</span>
				<strong v-if="summary" class="text-3xl text-contrast tabular-nums">{{
					formatDonationAmount(summary.totalAmount)
				}}</strong>
				<span v-if="summary" class="text-sm text-secondary">{{
					formatMessage(messages.donors, { count: summary.donorCount })
				}}</span>
				<p class="m-0 text-sm text-secondary">{{ formatMessage(messages.thanks) }}</p>
			</div>
			<div
				v-if="loading && !items.length"
				class="flex justify-center p-6 text-secondary"
				role="status"
			>
				<SpinnerIcon class="size-6 animate-spin" />
			</div>
			<ol v-if="items.length" class="donation-list">
				<li v-for="donor in items" :key="donor.id" class="donor-row">
					<span class="donor-rank" :class="{ podium: donor.rank <= 3 }"
						><StarIcon v-if="donor.rank <= 3" class="size-4" /><span v-else>#</span
						>{{ donor.rank }}</span
					>
					<Avatar :src="donor.avatar ?? undefined" :alt="donor.username" size="2.25rem" />
					<span class="min-w-0 flex-1 truncate font-semibold text-contrast">{{
						donor.username
					}}</span>
					<strong class="shrink-0 tabular-nums text-contrast">{{
						formatDonationAmount(donor.amount)
					}}</strong>
				</li>
			</ol>
			<p v-else-if="!loading && !failed" class="m-0 py-4 text-center text-sm text-secondary">
				{{ formatMessage(messages.empty) }}
			</p>
			<div
				v-if="failed"
				class="flex items-center justify-center gap-3 text-sm text-secondary"
				role="alert"
			>
				<span>{{ formatMessage(messages.failed) }}</span>
				<button
					type="button"
					class="border-0 bg-transparent text-brand cursor-pointer"
					@click="load()"
				>
					{{ formatMessage(commonMessages.retryButton) }}
				</button>
			</div>
		</div>
		<template v-if="hasMore && !failed" #actions>
			<ButtonStyled
				><button type="button" :disabled="loading" @click="load()">
					<SpinnerIcon v-if="loading" class="size-4 animate-spin" />{{
						formatMessage(messages.more)
					}}
				</button></ButtonStyled
			>
		</template>
	</NewModal>
</template>

<style scoped>
.donation-summary {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.625rem;
	padding: 1.5rem;
	border-radius: var(--radius-xl);
	background: var(--color-bg);
	text-align: center;
}
.donation-list {
	margin: 0;
	padding: 0;
	list-style: none;
}
.donor-row {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: 0.875rem;
	padding: 1rem 0;
	border-bottom: 1px solid var(--color-divider);
	font-size: 0.875rem;
}
.donor-row:last-child {
	border: 0;
}
.donor-rank {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	width: 2.5rem;
	flex-shrink: 0;
	color: var(--color-secondary);
	font-variant-numeric: tabular-nums;
}
.donor-rank.podium {
	color: var(--color-brand);
}
</style>
