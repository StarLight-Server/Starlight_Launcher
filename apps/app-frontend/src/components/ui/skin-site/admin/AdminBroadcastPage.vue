<script setup lang="ts">
import { SpinnerIcon } from '@modrinth/assets'
import { defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { computed, onMounted, ref } from 'vue'

import {
	type SkinSiteAdminUser,
	skinSiteAdminUserList,
	type SkinSiteBroadcast,
	type SkinSiteBroadcastInput,
	skinSiteBroadcasts,
	skinSiteCreateBroadcast,
	skinSiteDeleteBroadcast,
	skinSiteUpdateBroadcast,
} from '@/helpers/skin-site-api'

const { formatMessage } = useVIntl()
const { handleError, addNotification } = injectNotificationManager()

const messages = defineMessages({
	title: { id: 'app.skin-site.admin.broadcast.title', defaultMessage: 'Announcements' },
	loading: { id: 'app.skin-site.admin.broadcast.loading', defaultMessage: 'Loading…' },
	failed: { id: 'app.skin-site.admin.broadcast.failed', defaultMessage: 'Could not load.' },
	empty: { id: 'app.skin-site.admin.broadcast.empty', defaultMessage: 'No announcements yet.' },
	create: { id: 'app.skin-site.admin.broadcast.create', defaultMessage: 'New announcement' },
	save: { id: 'app.skin-site.admin.broadcast.save', defaultMessage: 'Save' },
	cancel: { id: 'app.skin-site.admin.broadcast.cancel', defaultMessage: 'Cancel' },
	edit: { id: 'app.skin-site.admin.broadcast.edit', defaultMessage: 'Edit' },
	remove: { id: 'app.skin-site.admin.broadcast.remove', defaultMessage: 'Delete' },
	titleField: { id: 'app.skin-site.admin.broadcast.title-field', defaultMessage: 'Title' },
	subtitleField: { id: 'app.skin-site.admin.broadcast.subtitle-field', defaultMessage: 'Subtitle' },
	contentField: { id: 'app.skin-site.admin.broadcast.content-field', defaultMessage: 'Content' },
	expireAt: { id: 'app.skin-site.admin.broadcast.expire-at', defaultMessage: 'Expires at' },
	star: { id: 'app.skin-site.admin.broadcast.star', defaultMessage: 'Highlight' },
	level: { id: 'app.skin-site.admin.broadcast.level', defaultMessage: 'Importance' },
	image: { id: 'app.skin-site.admin.broadcast.image', defaultMessage: 'Image' },
	removeImage: { id: 'app.skin-site.admin.broadcast.remove-image', defaultMessage: 'Remove image' },
	created: { id: 'app.skin-site.admin.broadcast.created', defaultMessage: 'Announcement created.' },
	updated: { id: 'app.skin-site.admin.broadcast.updated', defaultMessage: 'Announcement updated.' },
	deleted: { id: 'app.skin-site.admin.broadcast.deleted', defaultMessage: 'Announcement deleted.' },
	confirmDelete: {
		id: 'app.skin-site.admin.broadcast.confirm-delete',
		defaultMessage: 'Delete “{title}”? This cannot be undone.',
	},
	uploader: { id: 'app.skin-site.admin.broadcast.uploader', defaultMessage: 'by {name}' },
})

const items = ref<SkinSiteBroadcast[]>([])
const uploaderNames = ref<Record<string, string>>({})
const loading = ref(true)
const failed = ref(false)
const saving = ref(false)
const deletingId = ref<number | null>(null)

const editorOpen = ref(false)
const editingId = ref<number | null>(null)
const form = ref({
	title: '',
	subtitle: '',
	content: '',
	expireAt: '',
	star: false,
	importantLevel: 0,
})
const imageFile = ref<File | null>(null)
const removeImage = ref(false)

const sorted = computed(() => [...items.value].sort((a, b) => b.id - a.id))

function formatDate(ts: number): string {
	try {
		return new Date(ts).toLocaleString()
	} catch {
		return ''
	}
}

function toDateInput(ts: number): string {
	try {
		const d = new Date(ts)
		const pad = (n: number) => String(n).padStart(2, '0')
		return (
			d.getFullYear() +
			'-' +
			pad(d.getMonth() + 1) +
			'-' +
			pad(d.getDate()) +
			'T' +
			pad(d.getHours()) +
			':' +
			pad(d.getMinutes())
		)
	} catch {
		return ''
	}
}

function resetForm() {
	form.value = {
		title: '',
		subtitle: '',
		content: '',
		expireAt: '',
		star: false,
		importantLevel: 0,
	}
	imageFile.value = null
	removeImage.value = false
	editingId.value = null
}

function openCreate() {
	resetForm()
	editorOpen.value = true
}

function openEdit(item: SkinSiteBroadcast) {
	form.value = {
		title: item.title,
		subtitle: item.subtitle,
		content: item.content,
		expireAt: toDateInput(item.expireAt),
		star: item.star,
		importantLevel: item.importantLevel,
	}
	imageFile.value = null
	removeImage.value = false
	editingId.value = item.id
	editorOpen.value = true
}

function closeEditor() {
	editorOpen.value = false
	resetForm()
}

function onImageChange(event: Event) {
	const input = event.target as HTMLInputElement
	imageFile.value = input.files?.[0] ?? null
}

function buildInput(): SkinSiteBroadcastInput {
	const ts = form.value.expireAt ? new Date(form.value.expireAt).getTime() : 0
	return {
		title: form.value.title.trim(),
		subtitle: form.value.subtitle.trim(),
		content: form.value.content,
		expireAt: Number.isFinite(ts) ? ts : 0,
		star: form.value.star,
		importantLevel: Number(form.value.importantLevel) || 0,
		imageFile: imageFile.value,
		removeImage: removeImage.value,
	}
}

const canSave = computed(
	() => form.value.title.trim().length > 0 && form.value.content.length > 0 && !saving.value,
)

function uploaderName(uuid: string): string {
	return uploaderNames.value[uuid] ?? uuid
}

async function loadUploaderNames() {
	try {
		const res = await skinSiteAdminUserList({ limit: 200, offset: 0 })
		if (!res.success) return
		const users: SkinSiteAdminUser[] = res.payload ?? []
		const map: Record<string, string> = {}
		for (const u of users) map[u.uuid] = u.username
		uploaderNames.value = map
	} catch {
		// 名称映射失败不影响公告列表展示
	}
}

async function load() {
	loading.value = true
	failed.value = false
	try {
		const [result] = await Promise.all([skinSiteBroadcasts(), loadUploaderNames()])
		if (!result.success) throw new Error(result.errorMessage)
		items.value = result.payload ?? []
	} catch (error) {
		failed.value = true
		handleError(error)
	} finally {
		loading.value = false
	}
}

async function save() {
	if (!canSave.value) return
	saving.value = true
	try {
		const input = buildInput()
		const result =
			editingId.value === null
				? await skinSiteCreateBroadcast(input)
				: await skinSiteUpdateBroadcast(editingId.value, input)
		if (!result.success) throw new Error(result.errorMessage)
		addNotification({
			type: 'success',
			title: formatMessage(editingId.value === null ? messages.created : messages.updated),
		})
		closeEditor()
		await load()
	} catch (error) {
		handleError(error)
	} finally {
		saving.value = false
	}
}

async function remove(item: SkinSiteBroadcast) {
	if (deletingId.value !== null) return
	if (!window.confirm(formatMessage(messages.confirmDelete, { title: item.title }))) return
	deletingId.value = item.id
	try {
		const result = await skinSiteDeleteBroadcast(item.id)
		if (!result.success) throw new Error(result.errorMessage)
		addNotification({ type: 'success', title: formatMessage(messages.deleted) })
		await load()
	} catch (error) {
		handleError(error)
	} finally {
		deletingId.value = null
	}
}

onMounted(() => void load())
</script>
<template>
	<div class="flex flex-col gap-4">
		<div class="flex flex-wrap items-center gap-3">
			<h2 class="m-0 text-lg font-bold text-contrast">{{ formatMessage(messages.title) }}</h2>
			<button
				type="button"
				class="ml-auto rounded-full bg-brand px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110"
				@click="openCreate"
			>
				{{ formatMessage(messages.create) }}
			</button>
		</div>

		<div v-if="loading" class="flex items-center gap-2 text-sm text-secondary">
			<SpinnerIcon class="size-4 animate-spin" />
			{{ formatMessage(messages.loading) }}
		</div>
		<p v-else-if="failed" class="m-0 text-sm text-secondary">
			{{ formatMessage(messages.failed) }}
		</p>
		<p v-else-if="!sorted.length" class="m-0 rounded-xl bg-bg-raised p-4 text-sm text-secondary">
			{{ formatMessage(messages.empty) }}
		</p>
		<div v-else class="flex flex-col gap-2">
			<div
				v-for="item in sorted"
				:key="item.id"
				class="flex flex-wrap items-center gap-3 rounded-xl bg-bg-raised p-3"
			>
				<span class="shrink-0 text-xs text-secondary">#{{ item.id }}</span>
				<div class="flex min-w-0 flex-1 flex-col">
					<span class="truncate text-sm font-semibold text-contrast">{{ item.title }}</span>
					<span v-if="item.subtitle" class="truncate text-xs text-secondary">
						{{ item.subtitle }}
					</span>
				</div>
				<span class="shrink-0 text-xs text-secondary">{{ formatDate(item.updateAt) }}</span>
				<span v-if="item.uploader" class="shrink-0 text-xs text-secondary">
					{{ formatMessage(messages.uploader, { name: uploaderName(item.uploader) }) }}
				</span>
				<button
					type="button"
					class="shrink-0 rounded-full bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110"
					@click="openEdit(item)"
				>
					{{ formatMessage(messages.edit) }}
				</button>
				<button
					type="button"
					class="shrink-0 rounded-full bg-red px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
					:disabled="deletingId !== null"
					@click="remove(item)"
				>
					{{ formatMessage(messages.remove) }}
				</button>
			</div>
		</div>

		<div
			v-if="editorOpen"
			class="flex flex-col gap-3 rounded-xl border border-solid border-surface-5 bg-bg-raised p-4"
		>
			<label class="flex flex-col gap-1">
				<span class="text-sm font-semibold text-contrast">
					{{ formatMessage(messages.titleField) }}
				</span>
				<input
					v-model="form.title"
					type="text"
					class="rounded-lg border border-solid border-surface-5 bg-bg px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-sm font-semibold text-contrast">
					{{ formatMessage(messages.subtitleField) }}
				</span>
				<input
					v-model="form.subtitle"
					type="text"
					class="rounded-lg border border-solid border-surface-5 bg-bg px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-sm font-semibold text-contrast">
					{{ formatMessage(messages.contentField) }}
				</span>
				<textarea
					v-model="form.content"
					rows="5"
					class="w-full resize-y rounded-lg border border-solid border-surface-5 bg-bg px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
				/>
			</label>

			<div class="flex flex-wrap items-end gap-3">
				<label class="flex flex-col gap-1">
					<span class="text-sm font-semibold text-contrast">
						{{ formatMessage(messages.expireAt) }}
					</span>
					<input
						v-model="form.expireAt"
						type="datetime-local"
						class="rounded-lg border border-solid border-surface-5 bg-bg px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-sm font-semibold text-contrast">
						{{ formatMessage(messages.level) }}
					</span>
					<input
						v-model.number="form.importantLevel"
						type="number"
						min="0"
						max="9"
						class="w-20 rounded-lg border border-solid border-surface-5 bg-bg px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
					/>
				</label>
				<label class="flex items-center gap-2 pb-2">
					<input v-model="form.star" type="checkbox" />
					<span class="text-sm text-contrast">{{ formatMessage(messages.star) }}</span>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-sm font-semibold text-contrast">
						{{ formatMessage(messages.image) }}
					</span>
					<input type="file" accept="image/*" @change="onImageChange" />
				</label>
				<label v-if="editingId !== null" class="flex items-center gap-2 pb-2">
					<input v-model="removeImage" type="checkbox" />
					<span class="text-sm text-contrast">{{ formatMessage(messages.removeImage) }}</span>
				</label>
			</div>

			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="rounded-full bg-button-bg px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110"
					@click="closeEditor"
				>
					{{ formatMessage(messages.cancel) }}
				</button>
				<button
					type="button"
					class="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-contrast disabled:opacity-50"
					:disabled="!canSave"
					@click="save"
				>
					{{ formatMessage(messages.save) }}
				</button>
			</div>
		</div>
	</div>
</template>
