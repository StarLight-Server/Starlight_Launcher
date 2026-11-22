<script setup lang="ts">
import {
	ButtonStyled,
	commonMessages,
	defineMessages,
	injectNotificationManager,
	NewModal,
	useVIntl,
} from '@modrinth/ui'
import { invoke } from '@tauri-apps/api/core'
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { reportHostedInstallFailure } from '@/composables/hosted-install-errors'
import { useHostedCreation } from '@/composables/useHostedCreation'
import { getInstanceMode } from '@/helpers/hosted-packs'
import { list } from '@/helpers/instance'

const { formatMessage } = useVIntl()
const { handleError } = injectNotificationManager()
const router = useRouter()
const { install, installing, acknowledge } = useHostedCreation()
const modal = ref<InstanceType<typeof NewModal>>()
const instanceId = ref<string>()
const checking = ref(false)
const messages = defineMessages({
	join: { id: 'app.skin-site.quick-join.button', defaultMessage: 'Join the StarLight server' },
	install: {
		id: 'app.skin-site.quick-join.install',
		defaultMessage: 'The StarLight client will be downloaded and started automatically. Continue?',
	},
	continue: { id: 'app.skin-site.quick-join.continue', defaultMessage: 'Continue' },
	downloadOnly: {
		id: 'app.skin-site.quick-join.download-only',
		defaultMessage: 'Continue without starting the game',
	},
})

async function openJoin() {
	if (checking.value) return
	if (installing.value) {
		await router.push('/downloads')
		return
	}
	checking.value = true
	try {
		const instances = await list()
		const modes = await Promise.all(instances.map((instance) => getInstanceMode(instance.id)))
		instanceId.value = instances.find((_, index) => modes[index] === 'starlight')?.id
		if (instanceId.value) {
			await router.push({
				path: `/instance/${encodeURIComponent(instanceId.value)}/`,
				query: { quickConfirm: '1' },
			})
		} else {
			modal.value?.show()
		}
	} catch (error) {
		handleError(error)
	} finally {
		checking.value = false
	}
}

async function openInstance(id: string, launch: boolean) {
	return router.push({
		path: `/instance/${encodeURIComponent(id)}/`,
		query: launch ? { quickLaunch: '1' } : {},
	})
}

async function proceed(launch: boolean) {
	modal.value?.hide()
	try {
		const root = await invoke<string>('get_launcher_root_dir')
		const pending = install(root || undefined)
		await router.push('/downloads')
		const id = await pending
		if (!id) return
		const failure = await openInstance(id, launch)
		if (!failure) acknowledge(id)
	} catch (error) {
		reportHostedInstallFailure(error, { retry: () => proceed(false) })
	}
}
</script>

<template>
	<ButtonStyled color="brand" size="large">
		<button type="button" class="w-full justify-center" :disabled="checking" @click="openJoin">
			<svg viewBox="22 22 84 84" fill="none" aria-hidden="true">
				<path
					d="M64 27c3.5 25.3 11.7 33.5 37 37-25.3 3.5-33.5 11.7-37 37-3.5-25.3-11.7-33.5-37-37C52.3 60.5 60.5 52.3 64 27Z"
					stroke="currentColor"
					stroke-width="5"
					stroke-linejoin="round"
				/>
			</svg>
			{{ formatMessage(messages.join) }}
		</button>
	</ButtonStyled>
	<NewModal ref="modal" :header="formatMessage(messages.join)">
		<p class="m-0 text-secondary">
			{{ formatMessage(messages.install) }}
		</p>
		<template #actions>
			<div class="flex flex-wrap justify-end gap-2">
				<ButtonStyled type="outlined"
					><button type="button" @click="modal?.hide()">
						{{ formatMessage(commonMessages.cancelButton) }}
					</button></ButtonStyled
				>
				<ButtonStyled
					><button type="button" @click="proceed(false)">
						{{ formatMessage(messages.downloadOnly) }}
					</button></ButtonStyled
				>
				<ButtonStyled color="brand"
					><button type="button" @click="proceed(true)">
						{{ formatMessage(messages.continue) }}
					</button></ButtonStyled
				>
			</div>
		</template>
	</NewModal>
</template>
