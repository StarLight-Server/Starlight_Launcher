import { invoke } from '@tauri-apps/api/core'
import { ref } from 'vue'

import { hostedCreate } from '../helpers/hosted-packs.ts'
import { reportHostedInstallFailure } from './hosted-install-errors.ts'
import { forgetHostedSync, runHostedSync } from './useHostedSync.ts'

const installing = ref(false)
const installError = ref('')
const createdInstance = ref<string>()
const completed = ref(false)
let generation = 0

function errorMessage(cause: unknown) {
	return cause instanceof Error ? cause.message : String(cause)
}

export function forgetHostedCreation(instanceId: string) {
	forgetHostedSync(instanceId)
	if (createdInstance.value !== instanceId) return
	generation++
	createdInstance.value = undefined
	completed.value = false
	installError.value = ''
}

export function markHostedCreationCompleted(instanceId: string) {
	if (createdInstance.value !== instanceId) return
	installError.value = ''
	completed.value = true
}

export function markHostedCreationFailed(instanceId: string, cause: unknown) {
	if (createdInstance.value !== instanceId) return
	completed.value = false
	installError.value = errorMessage(cause)
}

export function useHostedCreation() {
	function acknowledge(instanceId: string) {
		if (completed.value && createdInstance.value === instanceId) {
			createdInstance.value = undefined
			completed.value = false
		}
	}
	async function install(gameDirRoot?: string | null) {
		if (installing.value) return
		installing.value = true
		installError.value = ''
		const attempt = generation
		try {
			if (createdInstance.value) {
				const instance = await invoke<unknown | null>('plugin:instance|instance_get', {
					instanceId: createdInstance.value,
				})
				if (attempt !== generation) return
				if (!instance) {
					createdInstance.value = undefined
					completed.value = false
				}
			}
			if (completed.value) return createdInstance.value
			createdInstance.value ??= await hostedCreate(gameDirRoot)
			const instanceId = createdInstance.value
			await runHostedSync(instanceId, () => install(gameDirRoot))
			if (attempt !== generation) return
			markHostedCreationCompleted(instanceId)
			return instanceId
		} catch (cause) {
			if (attempt === generation) {
				const error = reportHostedInstallFailure(cause, {
					instanceId: createdInstance.value,
					retry: () => install(gameDirRoot),
				})
				if (createdInstance.value) markHostedCreationFailed(createdInstance.value, error)
				else installError.value = error.message
			}
		} finally {
			installing.value = false
		}
	}
	return { installing, installError, createdInstance, completed, acknowledge, install }
}
