<script setup lang="ts">
import {
	ButtonStyled,
	Checkbox,
	commonMessages,
	formatLoaderLabel,
	NewModal,
	useVIntl,
} from '@modrinth/ui'
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

import {
	confirmVersionChange,
	type VersionChangeDecision,
	type VersionChangeInstance,
	type VersionChangeOperation,
	type VersionChangePreview,
} from '@/helpers/version-change-consent'
import { versionChangeMessages as messages } from '@/helpers/version-change-messages'
import { compareSemanticVersions } from '@/helpers/version-compatibility'

const { formatMessage } = useVIntl()
const modal = ref<InstanceType<typeof NewModal>>()
const operation = ref<VersionChangeOperation>('linked_instance')
const preview = ref<VersionChangePreview>()
const remember = ref(false)
const instanceName = ref('')
let resolveDecision: ((decision: VersionChangeDecision) => void) | undefined
let active = false
let canceled = false
let disposed = false

const unknownComparison = computed(() => {
	const source = preview.value?.source.modLoaderVersion
	const target = preview.value?.target.modLoaderVersion
	return !source || !target || compareSemanticVersions(source, target) === null
})
const title = computed(() =>
	formatMessage(
		operation.value === 'linked_instance'
			? messages.linkedTitle
			: unknownComparison.value
				? messages.unknownTitle
				: messages.downgradeTitle,
	),
)
const body = computed(() =>
	formatMessage(
		operation.value === 'linked_instance'
			? messages.linkedBody
			: unknownComparison.value
				? messages.unknownBody
				: messages.downgradeBody,
	),
)
const sourceLabel = computed(() =>
	preview.value
		? `${formatLoaderLabel(preview.value.source.modLoader)} ${preview.value.source.modLoaderVersion ?? formatMessage(messages.unknownVersion)}`
		: '',
)
const targetLabel = computed(() =>
	preview.value
		? `${formatLoaderLabel(preview.value.target.modLoader)} ${preview.value.target.modLoaderVersion ?? formatMessage(messages.unknownVersion)}`
		: '',
)

function decide(decision: VersionChangeDecision) {
	const resolve = resolveDecision
	resolveDecision = undefined
	resolve?.(decision)
}

function cancel() {
	canceled = true
	decide(null)
}

async function confirm(
	instance: VersionChangeInstance & { name: string },
	change: VersionChangePreview,
) {
	if (active || disposed) return null
	active = true
	canceled = false
	preview.value = change
	instanceName.value = instance.name
	try {
		return await confirmVersionChange(
			instance,
			change,
			async (kind) => {
				if (canceled || disposed) return null
				operation.value = kind
				remember.value = false
				const decision = new Promise<VersionChangeDecision>((resolve) => {
					resolveDecision = resolve
				})
				await nextTick()
				if (canceled || disposed) decide(null)
				else modal.value?.show()
				return decision
			},
			{
				getItem: (key) => window.localStorage.getItem(key),
				setItem: (key, value) => window.localStorage.setItem(key, value),
			},
		)
	} finally {
		active = false
		modal.value?.hide()
	}
}

onBeforeUnmount(() => {
	disposed = true
	cancel()
})
defineExpose({ confirm })
</script>

<template>
	<NewModal
		ref="modal"
		:header="title"
		fade="warning"
		width="min(34rem, calc(95vw - 2rem))"
		:on-hide="cancel"
	>
		<div class="flex flex-col gap-4">
			<p class="m-0 font-semibold text-contrast">{{ instanceName }}</p>
			<p class="m-0 text-secondary">{{ body }}</p>
			<p class="m-0 break-words font-medium text-contrast">{{ sourceLabel }} → {{ targetLabel }}</p>
			<Checkbox v-model="remember" :label="formatMessage(messages.remember)" />
		</div>
		<template #actions>
			<ButtonStyled
				><button type="button" @click="modal?.hide()">
					{{ formatMessage(commonMessages.cancelButton) }}
				</button></ButtonStyled
			>
			<ButtonStyled color="orange"
				><button type="button" @click="decide({ remember })">
					{{ formatMessage(messages.allow) }}
				</button></ButtonStyled
			>
		</template>
	</NewModal>
</template>
