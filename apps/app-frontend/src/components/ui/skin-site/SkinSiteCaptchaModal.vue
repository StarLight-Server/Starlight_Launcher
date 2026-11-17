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
			<p class="m-0 text-center text-secondary">{{ formatMessage(messages.subtitle) }}</p>

			<div class="captcha-ring rounded-full p-1 shadow-lg">
				<div
					class="size-44 overflow-hidden rounded-full border-4 border-solid border-bg bg-surface-2"
				>
					<img
						v-if="image"
						:src="image"
						alt=""
						class="size-full rounded-full object-cover"
						:style="{ transform: `rotate(${previewRotation})` }"
						draggable="false"
					/>
					<div
						v-else
						class="flex size-full items-center justify-center text-center text-sm text-secondary"
					>
						{{ formatMessage(messages.loading) }}
					</div>
				</div>
			</div>

			<div class="w-full max-w-xs">
				<input
					v-model.number="degree"
					type="range"
					min="0"
					max="360"
					step="1"
					class="captcha-slider"
					:aria-label="formatMessage(messages.subtitle)"
					:aria-valuetext="`${degree}°`"
					:style="{ '--captcha-progress': `${(degree / 360) * 100}%` }"
					:disabled="loading || submitting"
				/>
				<div aria-hidden="true" class="mx-3 mt-2 flex justify-between text-xs text-secondary">
					<span>0°</span>
					<span>90°</span>
					<span>180°</span>
					<span>270°</span>
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

<style scoped>
.captcha-ring {
	background: linear-gradient(135deg, var(--color-brand), var(--color-brand-shadow));
}

.captcha-slider {
	-webkit-appearance: none;
	appearance: none;
	display: block;
	width: 100%;
	height: 1.75rem;
	min-height: 0;
	margin: 0;
	padding: 0;
	border: 0;
	background: transparent;
	box-shadow: none;
	cursor: pointer;
}

.captcha-slider::-webkit-slider-runnable-track {
	height: 0.5rem;
	border-radius: 9999px;
	background: linear-gradient(
		to right,
		var(--color-brand) var(--captcha-progress),
		var(--surface-4) var(--captcha-progress)
	);
}

.captcha-slider::-webkit-slider-thumb {
	-webkit-appearance: none;
	appearance: none;
	width: 1.5rem;
	height: 1.5rem;
	margin-top: -0.5rem;
	background: var(--color-bg);
	border-radius: 50%;
	cursor: grab;
	border: 0.3rem solid var(--color-brand);
	box-shadow: 0 2px 6px rgb(0 0 0 / 25%);
}

.captcha-slider::-webkit-slider-thumb:active {
	cursor: grabbing;
}

.captcha-slider::-moz-range-track {
	height: 0.5rem;
	border-radius: 9999px;
	background: linear-gradient(
		to right,
		var(--color-brand) var(--captcha-progress),
		var(--surface-4) var(--captcha-progress)
	);
}

.captcha-slider::-moz-range-thumb {
	width: 0.9rem;
	height: 0.9rem;
	background: var(--color-bg);
	border-radius: 50%;
	cursor: grab;
	border: 0.3rem solid var(--color-brand);
	box-shadow: 0 2px 6px rgb(0 0 0 / 25%);
}

.captcha-slider::-moz-range-thumb:active {
	cursor: grabbing;
}

.captcha-slider:focus-visible {
	outline: 2px solid var(--color-brand);
	outline-offset: 3px;
	border-radius: 9999px;
}

.captcha-slider:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}
</style>
