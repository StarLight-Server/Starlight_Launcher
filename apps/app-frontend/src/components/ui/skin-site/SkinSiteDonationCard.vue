<script setup lang="ts">
import { ChevronRightIcon, HeartIcon, SpinnerIcon } from '@modrinth/assets'
import { ButtonStyled, commonMessages, defineMessages, useVIntl } from '@modrinth/ui'
import { onMounted, onUnmounted, ref } from 'vue'

import {
	type SkinSitePublicDonationSummary,
	skinSitePublicDonationSummary,
} from '@/helpers/skin-site-api'

import { formatDonationAmount } from './donation-format'
import SkinSiteDonationModal from './SkinSiteDonationModal.vue'

const { formatMessage } = useVIntl()

const messages = defineMessages({
	title: { id: 'app.skin-site.home.donation.title', defaultMessage: 'Donation thanks' },
	total: { id: 'app.skin-site.home.donation.total', defaultMessage: 'Total raised' },
	donors: { id: 'app.skin-site.home.donation.donors', defaultMessage: '{count} donors' },
	unavailable: {
		id: 'app.skin-site.home.donation.unavailable',
		defaultMessage: 'Donation summary unavailable.',
	},
	loading: { id: 'app.skin-site.home.donation.loading', defaultMessage: 'Loading…' },
})

const summary = ref<SkinSitePublicDonationSummary | null>(null)
const loading = ref(false)
const failed = ref(false)
const donationModal = ref<InstanceType<typeof SkinSiteDonationModal>>()

let summaryRevision = 0
async function loadSummary() {
	if (loading.value) return
	const revision = ++summaryRevision
	loading.value = true
	failed.value = false
	try {
		const result = await skinSitePublicDonationSummary()
		if (revision !== summaryRevision) return
		if (result.success && result.payload) summary.value = result.payload
		else failed.value = true
	} catch {
		if (revision === summaryRevision) failed.value = true
	} finally {
		if (revision === summaryRevision) loading.value = false
	}
}
function applySummary(value: SkinSitePublicDonationSummary) {
	summaryRevision++
	summary.value = value
	loading.value = false
	failed.value = false
}
onMounted(loadSummary)
onUnmounted(() => {
	summaryRevision++
})
</script>

<template>
	<section class="flex min-w-0 flex-col gap-2">
		<button type="button" class="donation-card" @click="donationModal?.show()">
			<span class="donation-icon"><HeartIcon class="size-6" /></span>
			<div class="flex min-w-0 flex-1 flex-col">
				<span class="text-sm font-semibold text-contrast">{{ formatMessage(messages.title) }}</span>
				<span v-if="loading" class="flex items-center gap-1 text-xs text-secondary">
					<SpinnerIcon class="size-3 animate-spin" />
					{{ formatMessage(messages.loading) }}
				</span>
				<span v-else-if="failed" class="text-xs text-secondary">
					{{ formatMessage(messages.unavailable) }}
				</span>
				<span v-else-if="summary" class="text-xs text-secondary">{{
					formatMessage(messages.donors, { count: summary.donorCount })
				}}</span>
			</div>
			<strong v-if="summary" class="donation-amount">{{
				formatDonationAmount(summary.totalAmount)
			}}</strong>
			<ChevronRightIcon class="size-5 shrink-0 text-secondary" />
		</button>
		<div v-if="failed" class="flex justify-end">
			<ButtonStyled
				><button type="button" :disabled="loading" @click="loadSummary">
					{{ formatMessage(commonMessages.retryButton) }}
				</button></ButtonStyled
			>
		</div>
		<SkinSiteDonationModal ref="donationModal" @summary-updated="applySummary" />
	</section>
</template>

<style scoped>
.donation-card {
	display: flex;
	width: 100%;
	min-width: 0;
	align-items: center;
	gap: 1rem;
	padding: 1.25rem;
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-xl);
	background: var(--color-raised-bg);
	color: var(--color-contrast);
	text-align: left;
	font: inherit;
	cursor: pointer;
	transition:
		border-color 180ms,
		background 180ms;
}
.donation-card:hover {
	border-color: var(--color-brand);
	background: var(--color-button-bg);
}
.donation-card:focus-visible {
	outline: 2px solid var(--color-brand);
	outline-offset: 3px;
}
.donation-icon {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 0.75rem;
	border-radius: var(--radius-lg);
	background: var(--color-brand-highlight);
	color: var(--color-brand);
}
.donation-amount {
	font-variant-numeric: tabular-nums;
	font-size: 1.25rem;
	white-space: nowrap;
}
@media (max-width: 520px) {
	.donation-card {
		gap: 0.625rem;
		padding: 1rem;
	}
	.donation-amount {
		font-size: 1rem;
	}
	.donation-icon {
		display: none;
	}
}
</style>
