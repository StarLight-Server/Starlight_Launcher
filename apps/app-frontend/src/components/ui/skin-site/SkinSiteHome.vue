<script setup lang="ts">
import { ButtonStyled, defineMessages, useVIntl } from '@modrinth/ui'
import { computed, ref } from 'vue'

import { skinSiteUser } from '@/composables/skin-site-session'

import SkinSiteAdminView from './SkinSiteAdminView.vue'
import SkinSiteAnnouncements from './SkinSiteAnnouncements.vue'
import SkinSiteBugCreateModal from './SkinSiteBugCreateModal.vue'
import SkinSiteBugDetailView from './SkinSiteBugDetailView.vue'
import SkinSiteBugListView from './SkinSiteBugListView.vue'
import SkinSiteBugNotificationsView from './SkinSiteBugNotificationsView.vue'
import SkinSiteDonationCard from './SkinSiteDonationCard.vue'
import SkinSiteDownloadsView from './SkinSiteDownloadsView.vue'
import SkinSiteMapView from './SkinSiteMapView.vue'
import SkinSiteNavCards from './SkinSiteNavCards.vue'
import SkinSitePlayerPreview from './SkinSitePlayerPreview.vue'
import SkinSiteProfileModal from './SkinSiteProfileModal.vue'
import SkinSiteProfileView from './SkinSiteProfileView.vue'
import SkinSiteReviewView from './SkinSiteReviewView.vue'
import WikiView from './WikiView.vue'

const { formatMessage } = useVIntl()
const messages = defineMessages({
	account: { id: 'app.skin-site.home.settings', defaultMessage: 'Account' },
	admin: { id: 'app.skin-site.home.admin', defaultMessage: 'Admin' },
})
const profileModal = ref<InstanceType<typeof SkinSiteProfileModal>>()
const isAdmin = computed(() =>
	skinSiteUser.value?.permissions.some(
		(permission) => permission === 'WEB_ADMIN' || permission === 'SERVER_ADMIN',
	),
)

const view = ref<
	| 'home'
	| 'players'
	| 'downloads'
	| 'map'
	| 'review'
	| 'bugs'
	| 'bug-detail'
	| 'bug-notifications'
	| 'admin'
	| 'wiki'
>('home')
const selectedBugId = ref<number | null>(null)

function openBug(id: number) {
	selectedBugId.value = id
	view.value = 'bug-detail'
}

function backToBugList() {
	selectedBugId.value = null
	view.value = 'bugs'
}

const bugCreateModal = ref<InstanceType<typeof SkinSiteBugCreateModal>>()

function openBugNotifications() {
	view.value = 'bug-notifications'
}

function onBugCreated(id: number) {
	openBug(id)
}
</script>

<template>
	<div class="flex h-full min-h-0 w-full flex-col overflow-y-auto">
		<div class="skin-site-home mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
			<template v-if="view === 'players'">
				<div v-if="skinSiteUser" class="flex flex-wrap justify-end gap-2">
					<ButtonStyled
						><button type="button" @click="profileModal?.show()">
							{{ formatMessage(messages.account) }}
						</button></ButtonStyled
					>
					<ButtonStyled v-if="isAdmin"
						><button type="button" @click="view = 'admin'">
							{{ formatMessage(messages.admin) }}
						</button></ButtonStyled
					>
				</div>
				<SkinSiteProfileView @back="view = 'home'" />
			</template>
			<SkinSiteDownloadsView v-else-if="view === 'downloads'" @back="view = 'home'" />
			<SkinSiteMapView v-else-if="view === 'map'" @back="view = 'home'" />
			<SkinSiteReviewView v-else-if="view === 'review'" @back="view = 'home'" />
			<SkinSiteBugListView
				v-else-if="view === 'bugs'"
				@back="view = 'home'"
				@open="openBug"
				@create="bugCreateModal?.show()"
				@notifications="openBugNotifications"
			/>
			<SkinSiteBugNotificationsView
				v-else-if="view === 'bug-notifications'"
				@back="view = 'bugs'"
				@open="openBug"
			/>
			<SkinSiteAdminView v-else-if="view === 'admin'" @back="view = 'home'" />
			<WikiView v-else-if="view === 'wiki'" initial-title="The Land Of StarLight" />

			<SkinSiteBugDetailView
				v-else-if="view === 'bug-detail' && selectedBugId !== null"
				:issue-id="selectedBugId"
				@back="backToBugList"
			/>

			<template v-else>
				<div class="home-overview">
					<SkinSitePlayerPreview />
					<SkinSiteAnnouncements />
				</div>

				<SkinSiteDonationCard />
			</template>
			<div class="home-toolbar">
				<SkinSiteNavCards
					:active="view === 'bug-detail' || view === 'bug-notifications' ? 'bugs' : view"
					@navigate="(target) => (view = target === view ? 'home' : target)"
				/>
			</div>
		</div>
		<SkinSiteBugCreateModal ref="bugCreateModal" @created="onBugCreated" />
		<SkinSiteProfileModal ref="profileModal" />
	</div>
</template>

<style scoped>
.skin-site-home {
	box-sizing: border-box;
	min-height: 100%;
	container-type: inline-size;
}
.home-overview {
	display: grid;
	grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
	gap: 2rem;
	align-items: start;
}
.home-toolbar {
	position: sticky;
	bottom: 0;
	z-index: 10;
	margin-top: auto;
	padding-top: 0.75rem;
	background: var(--color-bg);
}
@container (max-width: 48rem) {
	.home-overview {
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
	}
}
</style>
