<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
	skinSiteWikiAttachment,
	type SkinSiteWikiAttachmentInfo,
	skinSiteWikiAttachmentUrl,
} from '@/helpers/skin-site-api'

const props = defineProps<{ name: string; caption?: string | null }>()

const attachment = ref<SkinSiteWikiAttachmentInfo | null>(null)
const loading = ref(true)
const viewerOpen = ref(false)

const contentUrl = computed(() =>
	attachment.value ? skinSiteWikiAttachmentUrl(attachment.value.id) : '#',
)
const imageCaption = computed(() => {
	const caption = props.caption?.trim() ?? ''
	return caption === props.name || caption === attachment.value?.name ? '' : caption
})

onMounted(async () => {
	try {
		const res = await skinSiteWikiAttachment(props.name)
		if (res.success) attachment.value = res.payload
	} catch {
		// ignore
	} finally {
		loading.value = false
	}
})
</script>

<template>
	<span
		v-if="loading"
		class="inline-flex min-h-20 min-w-32 items-center justify-center rounded-lg border border-solid border-surface-5"
	>
		<span class="text-xs text-secondary">…</span>
	</span>
	<figure v-else-if="attachment?.image" class="my-5 inline-block max-w-full">
		<button type="button" class="block max-w-full cursor-zoom-in rounded-lg" @click="viewerOpen = true">
			<img
				class="max-h-[70vh] max-w-full rounded-lg border border-solid border-surface-5 object-contain shadow-md"
				:src="contentUrl"
				:alt="caption || attachment.name"
				loading="lazy"
				decoding="async"
			/>
		</button>
		<figcaption v-if="imageCaption" class="mt-2 text-center text-sm text-secondary">
			{{ imageCaption }}
		</figcaption>
	</figure>
	<a
		v-else-if="attachment"
		class="inline-flex items-center gap-1 text-brand underline-offset-2 hover:underline"
		:href="contentUrl"
		download
	>
		{{ caption || attachment.name }}
	</a>
	<span v-else class="text-red">附件“{{ name }}”不存在</span>

	<div
		v-if="viewerOpen"
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
		@click.self="viewerOpen = false"
	>
		<img :src="contentUrl" :alt="caption || attachment?.name" class="max-h-[92vh] max-w-[92vw] object-contain" />
	</div>
</template>
