<template>
	<InstanceModeSettings :instance-id="instanceId" :disabled="syncing" class="mb-5" />
	<div v-if="modeQuery.data.value === 'local'" class="flex flex-col gap-3">
		<h2 class="m-0">{{ formatMessage(messages.localTitle) }}</h2>
		<p class="m-0 text-secondary">{{ formatMessage(messages.localPacks) }}</p>
		<div class="flex flex-wrap gap-3">
			<ButtonStyled
				><button type="button" @click="router.push('/browse/modpack')">
					{{ formatMessage(messages.browse) }}
				</button></ButtonStyled
			>
			<ButtonStyled
				><button type="button" @click="importLocal">
					{{ formatMessage(messages.importLocal) }}
				</button></ButtonStyled
			>
		</div>
	</div>
	<template v-if="modeQuery.data.value === 'starlight'">
		<section class="flex flex-col gap-4" :aria-busy="loading || syncing">
			<div class="flex items-center justify-between gap-4">
				<div>
					<h2 class="m-0">{{ formatMessage(messages.title) }}</h2>
					<p>{{ formatMessage(messages.description) }}</p>
				</div>
				<ButtonStyled
					><button type="button" :disabled="loading || syncing" @click="load(true)">
						{{ formatMessage(messages.refresh) }}
					</button></ButtonStyled
				>
			</div>
			<p v-if="loading" role="status">{{ formatMessage(messages.loading) }}</p>
			<p v-if="error" role="alert" class="text-red">{{ error }}</p>
			<p v-if="binding">
				{{
					formatMessage(messages.bound, {
						name: binding.publication.manifest.name,
						version: binding.publication.manifest.version,
					})
				}}
			</p>
			<HostedPackProgress :instance-id="instanceId" :active="syncing" />
			<div v-if="result" role="status" class="rounded-xl bg-bg-raised p-4">
				<p>
					{{
						formatMessage(messages.complete, {
							version: result.version,
							count: result.changedFiles,
							size: (result.downloadedBytes / 1048576).toFixed(2),
						})
					}}
				</p>
				<details v-if="result.preservedFiles.length">
					<summary>
						{{ formatMessage(messages.preserved, { count: result.preservedFiles.length }) }}
					</summary>
					<ul>
						<li v-for="path in result.preservedFiles" :key="path">{{ path }}</li>
					</ul>
				</details>
			</div>

			<article
				v-if="pack"
				class="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-bg-raised p-4"
			>
				<div>
					<h3 class="m-0">{{ pack.manifest.name }}</h3>
					<p class="mb-0">
						{{ pack.manifest.version }} · Minecraft {{ pack.manifest.runtime.gameVersion }} ·
						{{ pack.manifest.runtime.loader }}
					</p>
				</div>
				<ButtonStyled color="brand"
					><button type="button" :disabled="!ready || syncing || loading" @click="sync">
						{{ formatMessage(binding ? messages.update : messages.install) }}
					</button></ButtonStyled
				>
			</article>
		</section>
	</template>
</template>
<script setup lang="ts">
import { ButtonStyled, defineMessages, useVIntl } from '@modrinth/ui'
import { computed, inject, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import HostedPackProgress from '@/components/instance/HostedPackProgress.vue'
import InstanceModeSettings from '@/components/instance/InstanceModeSettings.vue'
import { reportHostedInstallFailure } from '@/composables/hosted-install-errors'
import { markHostedCreationCompleted } from '@/composables/useHostedCreation'
import { useHostedSync } from '@/composables/useHostedSync'
import { useInstanceMode } from '@/composables/useInstanceMode'
import {
	type HostedBinding,
	hostedBinding,
	hostedDefault,
	type HostedPublication,
} from '@/helpers/hosted-packs'
import { injectDownloadManager } from '@/providers/download-manager'
const props = defineProps<{ instanceId: string }>()
const modeQuery = useInstanceMode(() => props.instanceId)
const router = useRouter()
const showCreation = inject<(options: { skipSetupType: boolean; initialMode: 'import' }) => void>(
	'showCreationModalWithOptions',
)
function importLocal() {
	showCreation?.({ skipSetupType: true, initialMode: 'import' })
}
const { formatMessage } = useVIntl()
const messages = defineMessages({
	localTitle: { id: 'app.instance-mode.local-packs-title', defaultMessage: 'Local modpacks' },
	localPacks: {
		id: 'app.instance-mode.local-packs',
		defaultMessage:
			'Choose any modpack to install as a local instance. Existing files and worlds are kept when you switch to Local; StarLight changes will no longer be synchronized.',
	},
	browse: { id: 'app.instance-mode.browse', defaultMessage: 'Browse modpacks' },
	importLocal: { id: 'app.instance-mode.import', defaultMessage: 'Import as a local instance' },
	title: { id: 'app.hosted-packs.title', defaultMessage: 'Server-managed modpack' },
	description: {
		id: 'app.hosted-packs.description',
		defaultMessage:
			'The administrator selects this modpack and its versions. Every launch checks for updates and downloads changes before starting. A valid StarLight login and network connection are required.',
	},
	refresh: { id: 'app.hosted-packs.refresh', defaultMessage: 'Refresh' },
	loading: { id: 'app.hosted-packs.loading', defaultMessage: 'Loading published modpacks…' },
	bound: { id: 'app.hosted-packs.bound', defaultMessage: 'Installed: {name} · {version}' },
	syncing: {
		id: 'app.hosted-packs.syncing',
		defaultMessage: 'Comparing files and synchronizing changes…',
	},
	complete: {
		id: 'app.hosted-packs.complete',
		defaultMessage: 'Synced to {version}. Changed {count} files; downloaded {size} MiB.',
	},
	preserved: {
		id: 'app.hosted-packs.preserved',
		defaultMessage: 'Preserved {count} locally modified or personal files',
	},
	empty: {
		id: 'app.hosted-packs.empty',
		defaultMessage: 'No modpacks have been approved for publication yet.',
	},
	update: { id: 'app.hosted-packs.update', defaultMessage: 'Synchronize now' },
	install: { id: 'app.hosted-packs.install', defaultMessage: 'Retry automatic installation' },
})
const pack = ref<HostedPublication | null>(null)
const binding = ref<HostedBinding | null>(null)
const task = useHostedSync(() => props.instanceId)
const result = task.result
const manager = injectDownloadManager()
const loading = ref(false)
const syncing = computed(
	() =>
		task.busy.value ||
		manager.legacyDownloads.value.some(
			(bar) =>
				bar.bar_type?.type === 'hosted_pack_sync' &&
				bar.bar_type.instance_id === props.instanceId &&
				!bar.bar_type.error,
		),
)
const ready = ref(false)
const loadError = ref('')
const error = computed(() => loadError.value || task.error.value)
let generation = 0
async function load(notify = false) {
	if (modeQuery.data.value !== 'starlight') return
	const current = ++generation
	const instanceId = props.instanceId
	loading.value = true
	ready.value = false
	loadError.value = ''
	try {
		const [official, installed] = await Promise.all([hostedDefault(), hostedBinding(instanceId)])
		if (current !== generation) return
		pack.value = official
		binding.value = installed
		ready.value = true
	} catch (cause) {
		if (current === generation) {
			loadError.value = String(cause)
			// Automatic page refreshes retain their inline error; only explicit actions interrupt.
			if (notify) reportHostedInstallFailure(cause, { instanceId })
		}
	} finally {
		if (current === generation) loading.value = false
	}
}
async function sync() {
	if (syncing.value || !ready.value || modeQuery.data.value !== 'starlight') return
	loadError.value = ''
	const result = await task.sync()
	if (result) markHostedCreationCompleted(props.instanceId)
}
watch(syncing, (busy, wasBusy) => {
	if (!busy && wasBusy) void load()
})
watch(
	() => [props.instanceId, modeQuery.data.value] as const,
	() => {
		generation++
		loading.value = false
		ready.value = false
		loadError.value = ''
		pack.value = null
		binding.value = null
		void load()
	},
	{ immediate: true },
)
</script>
