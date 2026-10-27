<script setup lang="ts">
import { ChevronDownIcon, ChevronUpIcon } from '@modrinth/assets'
import { defineMessages, type MessageDescriptor, useVIntl } from '@modrinth/ui'
import type { Component } from 'vue'
import { computed, ref, watch } from 'vue'

export interface SettingsOrderItem {
	id: string
	icon?: Component
	label: MessageDescriptor
}

const props = defineProps<{
	items: SettingsOrderItem[]
	modelValue: string[]
}>()

const emit = defineEmits<{
	(e: 'update:modelValue', value: string[]): void
}>()

const { formatMessage } = useVIntl()

const messages = defineMessages({
	moveUp: { id: 'app.settings.order-list.move-up', defaultMessage: 'Move {name} up' },
	moveDown: { id: 'app.settings.order-list.move-down', defaultMessage: 'Move {name} down' },
})

const knownIds = computed(() => new Set(props.items.map((item) => item.id)))

const order = ref<string[]>(normalize(props.modelValue))

watch(
	() => props.modelValue,
	(value) => {
		const next = normalize(value)
		if (next.join('\0') !== order.value.join('\0')) order.value = next
	},
)

function normalize(value: string[]): string[] {
	const known = value.filter((id) => knownIds.value.has(id))
	const missing = props.items.map((item) => item.id).filter((id) => !known.includes(id))
	return [...known, ...missing]
}

function move(id: string, offset: number) {
	const index = order.value.indexOf(id)
	const target = index + offset
	if (index === -1 || target < 0 || target >= order.value.length) return
	const next = [...order.value]
	next.splice(target, 0, ...next.splice(index, 1))
	order.value = next
	emit('update:modelValue', next)
}

function itemFor(id: string) {
	return props.items.find((item) => item.id === id)
}
</script>

<template>
	<div class="flex w-full flex-col gap-1">
		<div
			v-for="(id, index) in order"
			:key="id"
			class="flex items-center gap-3 rounded-lg border border-solid border-surface-4 bg-surface-3 p-3"
		>
			<component :is="itemFor(id)?.icon" v-if="itemFor(id)?.icon" class="size-4 shrink-0" />
			<span class="flex-1 truncate text-sm font-semibold text-contrast">
				{{ formatMessage(itemFor(id)!.label) }}
			</span>
			<div class="flex shrink-0 items-center gap-1">
				<button
					type="button"
					class="flex size-7 items-center justify-center rounded-md text-secondary transition-colors hover:bg-surface-4 hover:text-contrast disabled:cursor-not-allowed disabled:opacity-40"
					:disabled="index === 0"
					:aria-label="formatMessage(messages.moveUp, { name: formatMessage(itemFor(id)!.label) })"
					@click="move(id, -1)"
				>
					<ChevronUpIcon />
				</button>
				<button
					type="button"
					class="flex size-7 items-center justify-center rounded-md text-secondary transition-colors hover:bg-surface-4 hover:text-contrast disabled:cursor-not-allowed disabled:opacity-40"
					:disabled="index === order.length - 1"
					:aria-label="
						formatMessage(messages.moveDown, { name: formatMessage(itemFor(id)!.label) })
					"
					@click="move(id, 1)"
				>
					<ChevronDownIcon />
				</button>
			</div>
		</div>
	</div>
</template>
