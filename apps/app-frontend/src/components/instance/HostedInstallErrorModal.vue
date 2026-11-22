<script setup lang="ts">
import { CheckIcon, CircleAlertIcon, CopyIcon } from '@modrinth/assets'
import {
	ButtonStyled,
	commonMessages,
	injectNotificationManager,
	NewModal,
	useVIntl,
} from '@modrinth/ui'
import { computed, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'

import SkinSiteLoginModal from '@/components/ui/skin-site/SkinSiteLoginModal.vue'
import {
	dismissHostedInstallFailure,
	hostedInstallFailures,
} from '@/composables/hosted-install-errors'

import { descriptions, messages, titles } from './hosted-install-error-messages.ts'

const { formatMessage } = useVIntl()
const { addNotification, handleError } = injectNotificationManager()
const router = useRouter()
const modal = ref<InstanceType<typeof NewModal>>()
const loginModal = ref<InstanceType<typeof SkinSiteLoginModal>>()
const displayed = shallowRef<(typeof hostedInstallFailures.value)[number]>()
const closing = ref(false)
const copied = ref(false)
const signedInFor = ref<number>()
let loginFailureId: number | undefined
const retryable = new Set([
	'network',
	'runtime',
	'integrity',
	'recovery',
	'storage',
	'disk-space',
	'permission',
	'busy',
	'unknown',
])
const canRetry = computed(() =>
	Boolean(
		displayed.value?.retry &&
		(retryable.has(displayed.value.kind) || signedInFor.value === displayed.value.id),
	),
)
const needsLogin = computed(
	() => displayed.value?.kind === 'login' || displayed.value?.kind === 'account',
)
const title = computed(() => formatMessage(titles[displayed.value?.kind ?? 'unknown']))

function presentNext() {
	if (!modal.value || closing.value) return
	if (displayed.value) {
		if (!hostedInstallFailures.value.some((failure) => failure.id === displayed.value?.id)) {
			void modal.value.hide()
		}
		return
	}
	const next = hostedInstallFailures.value[0]
	if (!next) return
	displayed.value = next
	copied.value = false
	signedInFor.value = undefined
	modal.value.show()
}

function onHide() {
	closing.value = true
}

function onAfterHide() {
	const id = displayed.value?.id
	displayed.value = undefined
	closing.value = false
	if (id !== undefined) dismissHostedInstallFailure(id)
	presentNext()
}

watch([hostedInstallFailures, modal], presentNext, { immediate: true, flush: 'post' })

async function retry() {
	const failure = displayed.value
	if (!failure?.retry || !canRetry.value || closing.value) return
	await modal.value?.hide()
	await router.push('/downloads').catch(handleError)
	let result: unknown
	try {
		result = await failure.retry()
	} catch {
		// The operation reports its final failure through the shared queue.
		return
	}
	if (typeof result === 'string') {
		await router.push(`/instance/${encodeURIComponent(result)}/`).catch(handleError)
	}
}

async function openDownloads() {
	if (closing.value) return
	await modal.value?.hide()
	await router.push('/downloads').catch(handleError)
}

function openLogin() {
	if (!displayed.value || !needsLogin.value || closing.value) return
	loginFailureId = displayed.value.id
	loginModal.value?.show()
}

function onSignedIn() {
	if (displayed.value?.id === loginFailureId) signedInFor.value = loginFailureId
	loginFailureId = undefined
}

async function copyDetails() {
	const failure = displayed.value
	if (!failure) return
	try {
		await navigator.clipboard.writeText(`${title.value}\n\n${failure.details}`)
		if (displayed.value?.id === failure.id) copied.value = true
	} catch {
		addNotification({ type: 'error', title: formatMessage(messages.copyFailed) })
	}
}
</script>

<template>
	<NewModal
		ref="modal"
		:header="title"
		:fade="displayed?.kind === 'recovery' ? 'danger' : 'warning'"
		width="min(36rem, calc(95vw - 2rem))"
		:on-hide="onHide"
		:on-after-hide="onAfterHide"
		scrollable
	>
		<div v-if="displayed" :key="displayed.id" class="flex min-w-0 flex-col gap-4">
			<div class="flex items-start gap-3" role="alert">
				<CircleAlertIcon class="mt-0.5 size-6 shrink-0 text-orange" aria-hidden="true" />
				<p class="m-0 text-secondary">
					{{
						formatMessage(
							signedInFor === displayed.id ? messages.signedIn : descriptions[displayed.kind],
						)
					}}
				</p>
			</div>
			<details class="min-w-0 rounded-lg border border-solid border-divider bg-surface-2 p-3">
				<summary class="cursor-pointer font-semibold text-contrast">
					{{ formatMessage(messages.details) }}
				</summary>
				<pre
					class="mb-0 mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap break-all font-mono text-xs text-secondary select-text"
					>{{ displayed.details }}</pre
				>
			</details>
			<ButtonStyled type="outlined" size="small">
				<button type="button" class="self-start" @click="copyDetails">
					<CheckIcon v-if="copied" aria-hidden="true" />
					<CopyIcon v-else aria-hidden="true" />
					{{ formatMessage(copied ? messages.copied : messages.copy) }}
				</button>
			</ButtonStyled>
		</div>
		<template #actions>
			<div class="flex flex-wrap justify-end gap-2">
				<ButtonStyled type="outlined">
					<button type="button" :disabled="closing" @click="modal?.hide()">
						{{ formatMessage(commonMessages.closeButton) }}
					</button>
				</ButtonStyled>
				<ButtonStyled :color="!needsLogin && !canRetry ? 'brand' : 'standard'">
					<button type="button" :disabled="closing" @click="openDownloads">
						{{ formatMessage(messages.downloads) }}
					</button>
				</ButtonStyled>
				<ButtonStyled v-if="needsLogin && signedInFor !== displayed?.id" color="brand">
					<button type="button" :disabled="closing" @click="openLogin">
						{{ formatMessage(messages.signIn) }}
					</button>
				</ButtonStyled>
				<ButtonStyled v-if="canRetry" color="brand">
					<button type="button" :disabled="closing" @click="retry">
						{{ formatMessage(messages.retry) }}
					</button>
				</ButtonStyled>
			</div>
		</template>
	</NewModal>
	<SkinSiteLoginModal ref="loginModal" @signed-in="onSignedIn" />
</template>
