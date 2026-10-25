<script setup lang="ts">
import {
	BookIcon,
	BugIcon,
	DownloadIcon,
	MapIcon,
	ShieldCheckIcon,
	UserIcon,
} from '@modrinth/assets'
import { defineMessages, useVIntl } from '@modrinth/ui'
import { computed } from 'vue'

import { get } from '@/helpers/settings.ts'

import SkinSiteSelectionRail from './SkinSiteSelectionRail.vue'

defineProps<{ active: string }>()

const { formatMessage } = useVIntl()

const emit = defineEmits<{
	(e: 'navigate', view: 'downloads' | 'review' | 'bugs' | 'map' | 'wiki' | 'players'): void
}>()

const messages = defineMessages({
	title: { id: 'app.skin-site.home.nav.title', defaultMessage: 'Skin site' },
	download: { id: 'app.skin-site.home.nav.download', defaultMessage: 'Downloads' },
	downloadDesc: {
		id: 'app.skin-site.home.nav.download-desc',
		defaultMessage: 'Browse files shared by the server.',
	},
	review: { id: 'app.skin-site.home.nav.review', defaultMessage: 'Player review' },
	reviewDesc: {
		id: 'app.skin-site.home.nav.review-desc',
		defaultMessage: 'Submit and review player applications.',
	},
	wiki: { id: 'app.skin-site.home.nav.wiki', defaultMessage: 'Server wiki' },
	wikiDesc: {
		id: 'app.skin-site.home.nav.wiki-desc',
		defaultMessage: 'Guides and documentation for the server.',
	},
	bugs: { id: 'app.skin-site.home.nav.bugs', defaultMessage: 'Bug tracker' },
	bugsDesc: {
		id: 'app.skin-site.home.nav.bugs-desc',
		defaultMessage: 'Report issues and follow their progress.',
	},
	map: { id: 'app.skin-site.home.nav.map', defaultMessage: 'Server map' },
	mapDesc: {
		id: 'app.skin-site.home.nav.map-desc',
		defaultMessage: 'Explore the live world map.',
	},
	profile: { id: 'app.skin-site.home.nav.profile', defaultMessage: 'Profile' },
	profileDesc: {
		id: 'app.skin-site.home.nav.profile-desc',
		defaultMessage: 'Manage your account and textures.',
	},
})

const defaultDestinations = ['downloads', 'review', 'wiki', 'bugs', 'map', 'players'] as const

const iconFor = (id: string) => {
	switch (id) {
		case 'downloads':
			return DownloadIcon
		case 'review':
			return ShieldCheckIcon
		case 'wiki':
			return BookIcon
		case 'bugs':
			return BugIcon
		case 'map':
			return MapIcon
		case 'players':
			return UserIcon
		default:
			return undefined
	}
}

const labelFor = (id: string) => {
	switch (id) {
		case 'downloads':
			return messages.download
		case 'review':
			return messages.review
		case 'wiki':
			return messages.wiki
		case 'bugs':
			return messages.bugs
		case 'map':
			return messages.map
		case 'players':
			return messages.profile
		default:
			return messages.download
	}
}

const descFor = (id: string) => {
	switch (id) {
		case 'downloads':
			return messages.downloadDesc
		case 'review':
			return messages.reviewDesc
		case 'wiki':
			return messages.wikiDesc
		case 'bugs':
			return messages.bugsDesc
		case 'map':
			return messages.mapDesc
		case 'players':
			return messages.profileDesc
		default:
			return messages.downloadDesc
	}
}

const settings = await get()

const destinations = computed(() => {
	const known = settings.skin_site_nav_order.filter((id) =>
		defaultDestinations.includes(id as (typeof defaultDestinations)[number]),
	)
	const missing = defaultDestinations.filter((id) => !known.includes(id))
	return [...known, ...missing] as (typeof defaultDestinations)[number][]
})

const items = computed(() =>
	destinations.value.map((id) => ({
		id,
		label: formatMessage(labelFor(id)),
		description: formatMessage(descFor(id)),
		icon: iconFor(id),
	})),
)

function navigate(id: string) {
	const destination = destinations.value.find((value) => value === id)
	if (destination) emit('navigate', destination)
}
</script>

<template>
	<SkinSiteSelectionRail
		:items="items"
		:selected="active"
		:label="formatMessage(messages.title)"
		@select="navigate"
	/>
</template>
