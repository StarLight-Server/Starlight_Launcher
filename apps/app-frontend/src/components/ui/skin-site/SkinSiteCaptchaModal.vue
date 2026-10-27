<script setup lang="ts">
import {
	commonMessages,
	defineMessages,
	injectNotificationManager,
	NewModal,
	useVIntl,
} from '@modrinth/ui'
import { computed, ref } from 'vue'

import { requestCaptcha, verifyCaptcha } from '@/helpers/skin-site-api'

const { formatMessage } = useVIntl()
const { handleError } = injectNotificationManager()

const messages = defineMessages({
	title: { id: 'app.skin-site.captcha.title', defaultMessage: 'Let us check you are human' },
	subtitle: {
		id: 'app.skin-site.captcha.subtitle',
		defaultMessage: 'Drag the slider to rotate the image upright.',
	},
	submit: { id: 'app.skin-site.captcha.submit', defaultMessage: 'Submit' },
	loading: { id: 'app.skin-site.captcha.loading', defaultMessage: 'Loading captcha…' },
})

const emit = defineEmits<{ (e: 'verified', clientId: string): void; (e: 'cancel'): void }>()

const modal = ref<InstanceType<typeof NewModal>>()
const loading = ref(false)
const submitting = ref(false)
const image = ref('')
const challengeClientId = ref('')
const degree = ref(0)

/** The image is rotated by the server; the slider counter-rotates the preview. */
const previewRotation = computed(() => `${degree.value}deg`)

function resetState() {
	degree.value = 0
	image.value = ''
	challengeClientId.value = ''
}

async function loadCaptcha() {
	loading.value = true
	try {
		const result = await requestCaptcha()
		if (!result.success) throw new Error(result.errorMessage)
		image.value = result.payload.image ?? ''
		challengeClientId.value = result.payload.clientId
		degree.value = 0
	} catch (error) {
		handleError(error)
		modal.value?.hide()
		emit('cancel')
	} finally {
		loading.value = false
	}
}

async function show() {
	resetState()
	modal.value?.show()
	await loadCaptcha()
}

async function submit() {
	if (submitting.value || !challengeClientId.value) return
	submitting.value = true
	try {
		const result = await verifyCaptcha({
			clientId: challengeClientId.value,
			degree: degree.value,
		})
		if (!result.success) {
			handleError(new Error(result.errorMessage))
			await loadCaptcha()
			return
		}
		modal.value?.hide()
		emit('verified', result.payload)
	} catch (error) {
		handleError(error)
	} finally {
		submitting.value = false
	}
}

function cancel() {
	modal.value?.hide()
	emit('cancel')
}

defineExpose({ show })
</script>

<template>
	<NewModal ref="modal" :header="formatMessage(messages.title)" @hide="resetState">
		<div class="flex flex-col items-center gap-6">
			<p class="m-0 text-secondary">{{ formatMessage(messages.subtitle) }}</p>

			<div
				class="relative size-64 overflow-hidden rounded-2xl border-2 border-solid border-surface-5 bg-bg"
			>
				<img
					v-if="image"
					:src="image"
					alt=""
					class="size-full object-contain transition-transform duration-75"
					:style="{ transform: `rotate(${previewRotation})` }"
					draggable="false"
				/>
				<div v-else class="flex size-full items-center justify-center text-sm text-secondary">
					{{ formatMessage(messages.loading) }}
				</div>
			</div>

			<div class="w-full max-w-sm">
				<input
					v-model.number="degree"
					type="range"
					min="0"
					max="360"
					step="1"
					class="w-full accent-brand"
					:disabled="loading || submitting"
				/>
				<div class="mt-1 flex items-center justify-between text-xs text-secondary">
					<span>0°</span>
					<span class="font-semibold text-contrast">{{ degree }}°</span>
					<span>360°</span>
				</div>
			</div>
		</div>

		<template #actions>
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="rounded-full px-4 py-2 text-secondary hover:bg-button-bg"
					@click="cancel"
				>
					{{ formatMessage(commonMessages.cancelButton) }}
				</button>
				<button
					type="button"
					class="rounded-full bg-brand px-4 py-2 font-semibold text-contrast"
					:disabled="loading || submitting || !image"
					@click="submit"
				>
					{{ formatMessage(loading ? messages.loading : messages.submit) }}
				</button>
			</div>
		</template>
	</NewModal>
</template>
