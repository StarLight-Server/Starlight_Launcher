<script setup lang="ts">
import { SpinnerIcon } from '@modrinth/assets'
import { defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { computed, ref } from 'vue'

import {
	skinSiteModExistsByHash,
	skinSiteModExistsByName,
	skinSiteModHashFromFile,
	type SkinSiteModRuleTag,
	skinSiteUploadMod,
} from '@/helpers/skin-site-api'

const { formatMessage } = useVIntl()
const { handleError, addNotification } = injectNotificationManager()

defineProps<{ ruleTags: SkinSiteModRuleTag[] }>()
const emit = defineEmits<{ (e: 'finished'): void }>()

const messages = defineMessages({
	title: { id: 'app.skin-site.admin.mods.upload-title', defaultMessage: 'Upload mods' },
	dropHint: {
		id: 'app.skin-site.admin.mods.upload-drop',
		defaultMessage: 'Drag .jar files here, or click to choose',
	},
	dropSub: {
		id: 'app.skin-site.admin.mods.upload-sub',
		defaultMessage: 'Multiple files supported, up to {size} MB each',
	},
	tagsLabel: {
		id: 'app.skin-site.admin.mods.upload-tags',
		defaultMessage: 'Attach rule tags',
	},
	queue: { id: 'app.skin-site.admin.mods.upload-queue', defaultMessage: 'Files' },
	statusPending: {
		id: 'app.skin-site.admin.mods.upload-pending',
		defaultMessage: 'Pending',
	},
	statusChecking: {
		id: 'app.skin-site.admin.mods.upload-checking',
		defaultMessage: 'Checking…',
	},
	statusUploading: {
		id: 'app.skin-site.admin.mods.upload-uploading',
		defaultMessage: 'Uploading…',
	},
	statusConflict: {
		id: 'app.skin-site.admin.mods.upload-conflict',
		defaultMessage: 'Name exists',
	},
	statusSuccess: {
		id: 'app.skin-site.admin.mods.upload-success',
		defaultMessage: 'Done',
	},
	statusError: {
		id: 'app.skin-site.admin.mods.upload-error',
		defaultMessage: 'Failed',
	},
	existsAlready: {
		id: 'app.skin-site.admin.mods.upload-exists',
		defaultMessage: 'This file already exists on the server.',
	},
	nameConflictTitle: {
		id: 'app.skin-site.admin.mods.upload-name-conflict',
		defaultMessage: 'A mod with the same file name already exists',
	},
	nameConflictHint: {
		id: 'app.skin-site.admin.mods.upload-name-conflict-hint',
		defaultMessage: 'Overwrite the existing mod, or skip this file.',
	},
	overwrite: { id: 'app.skin-site.admin.mods.upload-overwrite', defaultMessage: 'Overwrite' },
	skip: { id: 'app.skin-site.admin.mods.upload-skip', defaultMessage: 'Skip' },
	close: { id: 'app.skin-site.admin.mods.upload-close', defaultMessage: 'Close' },
	allDone: {
		id: 'app.skin-site.admin.mods.upload-all-done',
		defaultMessage: 'All files processed.',
	},
	tooLarge: {
		id: 'app.skin-site.admin.mods.upload-too-large',
		defaultMessage: 'File too large: {name}',
	},
})

const MAX_MOD_SIZE_MB = 200
const MAX_RETRIES = 3

type TaskStatus = 'pending' | 'checking' | 'uploading' | 'conflict' | 'success' | 'error'

interface Task {
	file: File
	status: TaskStatus
	message?: string
	attempts: number
}

const queue = ref<Task[]>([])
const selectedTagIds = ref<Set<number>>(new Set())
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const conflictTask = ref<Task | null>(null)

const finishedCount = computed(
	() => queue.value.filter((t) => t.status === 'success' || t.status === 'error').length,
)
const allDone = computed(() => queue.value.length > 0 && finishedCount.value === queue.value.length)
const hasWork = computed(() => queue.value.length > 0)

function toggleTag(id: number) {
	const next = new Set(selectedTagIds.value)
	if (next.has(id)) next.delete(id)
	else next.add(id)
	selectedTagIds.value = next
}

function pickFiles() {
	if (busy.value) return
	fileInput.value?.click()
}

function onFileChange(event: Event) {
	const input = event.target as HTMLInputElement
	const files = Array.from(input.files ?? [])
	input.value = ''
	enqueue(files)
}

function onDrop(event: DragEvent) {
	event.preventDefault()
	if (busy.value) return
	enqueue(Array.from(event.dataTransfer?.files ?? []))
}

function enqueue(files: File[]) {
	const jars = files.filter((f) => f.name.toLowerCase().endsWith('.jar'))
	if (!jars.length) return
	const accepted: Task[] = []
	for (const file of jars) {
		if (file.size > MAX_MOD_SIZE_MB * 1024 * 1024) {
			addNotification({
				type: 'error',
				title: formatMessage(messages.tooLarge, { name: file.name }),
			})
			continue
		}
		accepted.push({ file, status: 'pending', attempts: 0 })
	}
	if (!accepted.length) return
	queue.value = [...queue.value, ...accepted]
	void runQueue()
}

async function runQueue() {
	if (busy.value) return
	busy.value = true
	try {
		for (;;) {
			const task = queue.value.find((t) => t.status === 'pending')
			if (!task) break
			await processTask(task)
			if (task.status === 'conflict') break
		}
	} finally {
		busy.value = false
	}
	if (allDone.value) {
		addNotification({ type: 'success', title: formatMessage(messages.allDone) })
		emit('finished')
	}
}

async function processTask(task: Task) {
	task.status = 'checking'
	task.message = undefined
	try {
		const hash = await skinSiteModHashFromFile(task.file)
		const exists = await skinSiteModExistsByHash(hash)
		if (exists.success) {
			task.status = 'error'
			task.message = formatMessage(messages.existsAlready)
			return
		}
		const nameExists = await skinSiteModExistsByName(task.file.name)
		if (nameExists.success) {
			task.status = 'conflict'
			conflictTask.value = task
			return
		}
		await upload(task, false)
	} catch (error) {
		task.status = 'error'
		task.message = error instanceof Error ? error.message : String(error)
		handleError(error)
	}
}

async function upload(task: Task, overwrite: boolean) {
	task.status = 'uploading'
	try {
		const res = await skinSiteUploadMod(task.file, Array.from(selectedTagIds.value), overwrite)
		if (res.success) {
			task.status = 'success'
			return
		}
		if (res.errorCode === 429) {
			task.attempts++
			if (task.attempts < MAX_RETRIES) {
				task.status = 'pending'
				task.message = 'rate limited, retrying'
				setTimeout(() => void runQueue(), 1500 * task.attempts)
			} else {
				task.status = 'error'
				task.message = res.errorMessage
			}
			return
		}
		if (res.errorType === 'HashDiff') {
			task.attempts++
			if (task.attempts < MAX_RETRIES) {
				task.status = 'pending'
				task.message = 'hash mismatch, retrying'
				setTimeout(() => void runQueue(), 800)
			} else {
				task.status = 'error'
				task.message = res.errorMessage
			}
			return
		}
		if (res.errorType === 'ModNameConflict') {
			task.status = 'conflict'
			conflictTask.value = task
			return
		}
		task.status = 'error'
		task.message = res.errorMessage
	} catch (error) {
		task.status = 'error'
		task.message = error instanceof Error ? error.message : String(error)
	}
}

async function resolveConflict(overwrite: boolean) {
	const task = conflictTask.value
	conflictTask.value = null
	if (!task) return
	if (overwrite) {
		busy.value = true
		try {
			await upload(task, true)
		} finally {
			busy.value = false
		}
	} else {
		task.status = 'error'
		task.message = formatMessage(messages.skip)
	}
	void runQueue()
}

function close() {
	if (busy.value) return
	queue.value = []
	conflictTask.value = null
	emit('finished')
}

function statusLabel(status: TaskStatus): string {
	switch (status) {
		case 'pending':
			return formatMessage(messages.statusPending)
		case 'checking':
			return formatMessage(messages.statusChecking)
		case 'uploading':
			return formatMessage(messages.statusUploading)
		case 'conflict':
			return formatMessage(messages.statusConflict)
		case 'success':
			return formatMessage(messages.statusSuccess)
		default:
			return formatMessage(messages.statusError)
	}
}

function statusClass(status: TaskStatus): string {
	switch (status) {
		case 'success':
			return 'bg-green text-contrast'
		case 'error':
			return 'bg-red text-contrast'
		case 'conflict':
			return 'bg-yellow text-contrast'
		default:
			return 'bg-button-bg text-secondary'
	}
}
</script>

<template>
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="close">
		<div class="flex max-h-[88vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-xl bg-bg p-6">
			<div class="flex items-start justify-between gap-3">
				<h3 class="m-0 text-lg font-bold text-contrast">{{ formatMessage(messages.title) }}</h3>
				<button
					type="button"
					class="shrink-0 rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
					:disabled="busy"
					@click="close"
				>
					✕
				</button>
			</div>

			<div
				class="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-surface-5 p-6 text-center transition-colors hover:bg-bg-raised"
				:class="busy ? 'cursor-not-allowed opacity-60' : ''"
				@dragover.prevent
				@dragenter.prevent
				@drop.prevent="onDrop"
				@click="pickFiles"
			>
				<input
					ref="fileInput"
					type="file"
					class="hidden"
					multiple
					accept=".jar"
					@change="onFileChange"
				/>
				<span class="text-sm font-semibold text-contrast">
					{{ formatMessage(messages.dropHint) }}
				</span>
				<span class="text-xs text-secondary">
					{{ formatMessage(messages.dropSub, { size: MAX_MOD_SIZE_MB }) }}
				</span>
			</div>

			<div v-if="ruleTags.length" class="flex flex-col gap-2">
				<span class="text-xs font-semibold text-secondary">
					{{ formatMessage(messages.tagsLabel) }}
				</span>
				<div class="flex flex-wrap gap-2">
					<button
						v-for="tag in ruleTags"
						:key="tag.id"
						type="button"
						class="rounded-full px-3 py-1 text-xs font-semibold transition-colors"
						:class="
							selectedTagIds.has(tag.id)
								? 'bg-brand text-contrast'
								: 'bg-button-bg text-secondary hover:text-contrast'
						"
						@click="toggleTag(tag.id)"
					>
						{{ tag.name }}
					</button>
				</div>
			</div>

			<div v-if="hasWork" class="flex flex-col gap-2">
				<span class="text-xs font-semibold text-secondary">
					{{ formatMessage(messages.queue) }} ({{ finishedCount }}/{{ queue.length }})
				</span>
				<div class="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
					<div
						v-for="(task, index) in queue"
						:key="task.file.name + index"
						class="flex flex-wrap items-center gap-2 rounded-lg bg-bg-raised px-3 py-2"
					>
						<span class="min-w-0 flex-1 truncate text-xs text-contrast">
							{{ task.file.name }}
						</span>
						<span class="shrink-0 text-[10px] text-secondary">
							{{ (task.file.size / 1024 / 1024).toFixed(2) }} MB
						</span>
						<span
							class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
							:class="statusClass(task.status)"
						>
							{{ statusLabel(task.status) }}
						</span>
						<span
							v-if="task.message"
							class="w-full truncate text-[10px] text-secondary"
							:title="task.message"
						>
							{{ task.message }}
						</span>
					</div>
				</div>
			</div>

			<div
				v-if="busy"
				class="flex items-center gap-2 text-xs text-secondary"
			>
				<SpinnerIcon class="size-3.5 animate-spin" />
				{{ formatMessage(messages.statusUploading) }}
			</div>

			<div class="flex justify-end gap-2 border-t border-solid border-surface-5 pt-3">
				<button
					type="button"
					class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110 disabled:opacity-50"
					:disabled="busy"
					@click="close"
				>
					{{ formatMessage(messages.close) }}
				</button>
			</div>
		</div>

		<div
			v-if="conflictTask"
			class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
		>
			<div class="flex w-full max-w-md flex-col gap-3 rounded-xl bg-bg p-6">
				<h4 class="m-0 text-base font-bold text-contrast">
					{{ formatMessage(messages.nameConflictTitle) }}
				</h4>
				<p class="m-0 text-xs break-all text-secondary">{{ conflictTask.file.name }}</p>
				<p class="m-0 text-xs text-secondary">{{ formatMessage(messages.nameConflictHint) }}</p>
				<div class="flex justify-end gap-2 pt-2">
					<button
						type="button"
						class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110"
						@click="resolveConflict(false)"
					>
						{{ formatMessage(messages.skip) }}
					</button>
					<button
						type="button"
						class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110"
						@click="resolveConflict(true)"
					>
						{{ formatMessage(messages.overwrite) }}
					</button>
				</div>
			</div>
		</div>
	</div>
</template>
