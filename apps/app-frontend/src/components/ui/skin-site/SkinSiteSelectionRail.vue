<script setup lang="ts">
import { Avatar } from '@modrinth/ui'
import { useResizeObserver } from '@vueuse/core'
import type { Component } from 'vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'

export interface SelectionItem {
	id: string
	label: string
	description?: string
	icon?: Component
	avatar?: string
}

const props = withDefaults(
	defineProps<{
		items: SelectionItem[]
		selected: string | null
		label: string
		vertical?: boolean
		disabled?: boolean
	}>(),
	{ vertical: false, disabled: false },
)
const emit = defineEmits<{ select: [id: string] }>()
const viewport = ref<HTMLElement>()
const rail = ref<HTMLElement>()
const indicator = ref({ x: 0, y: 0, width: 0, height: 0 })
const ready = ref(false)
const active = computed(() => props.items.some((item) => item.id === props.selected))

async function updateIndicator(reveal = false) {
	await nextTick()
	const button = rail.value?.querySelector<HTMLElement>('[aria-pressed="true"]')
	if (!button) return
	indicator.value = {
		x: button.offsetLeft,
		y: button.offsetTop,
		width: button.offsetWidth,
		height: button.offsetHeight,
	}
	if (reveal && props.vertical && viewport.value) {
		const container = viewport.value
		const bounds = button.getBoundingClientRect()
		const top = container.getBoundingClientRect().top + container.clientTop
		const above = bounds.top - top
		const below = bounds.bottom - top - container.clientHeight
		if (above < 0 || below > 0) {
			const reducedMotion =
				typeof window !== 'undefined' &&
				window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
			container.scrollTo({
				top: Math.max(0, container.scrollTop + (above < 0 ? above : below)),
				behavior: reducedMotion ? 'auto' : 'smooth',
			})
		}
	}
	if (!ready.value)
		requestAnimationFrame(() => {
			ready.value = true
		})
}
watch([() => props.selected, () => props.items.map((item) => item.id).join('\0')], () =>
	updateIndicator(true),
)
onMounted(() => updateIndicator(true))
useResizeObserver(rail, () => updateIndicator())
</script>

<template>
	<div ref="viewport" class="selection-rail" :class="{ vertical }" :aria-label="label" role="group">
		<div ref="rail" class="selection-track">
			<span
				v-show="active"
				aria-hidden="true"
				class="selection-indicator"
				:class="{ ready }"
				:style="{
					transform: `translate3d(${indicator.x}px, ${indicator.y}px, 0)`,
					width: `${indicator.width}px`,
					height: `${indicator.height}px`,
				}"
			/>
			<button
				v-for="item in items"
				:key="item.id"
				v-tooltip="{
					content: item.description ? `${item.label} · ${item.description}` : item.label,
					placement: vertical ? 'right' : 'top',
				}"
				type="button"
				class="selection-button"
				:aria-label="item.label"
				:aria-pressed="selected === item.id"
				:disabled="disabled"
				@click="emit('select', item.id)"
			>
				<Avatar
					v-if="vertical"
					:src="item.avatar"
					:alt="item.label"
					size="2rem"
					pixelated
					:unframed-natural-width="36"
				/>
				<component :is="item.icon" v-else-if="item.icon" class="size-5 shrink-0" />
				<span v-if="!vertical" class="selection-label">{{ item.label }}</span>
			</button>
		</div>
	</div>
</template>

<style scoped>
.selection-rail {
	min-width: 0;
	padding: 0.375rem;
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-xl);
	background: var(--color-raised-bg);
}
.selection-track {
	position: relative;
	display: flex;
	gap: 0.375rem;
}
.selection-rail:not(.vertical) {
	container-type: inline-size;
}
.selection-button {
	position: relative;
	z-index: 1;
	display: flex;
	flex: 1;
	min-width: 0;
	align-items: center;
	justify-content: center;
	gap: 0.625rem;
	padding: 0.875rem 0.75rem;
	border: 0;
	border-radius: var(--radius-lg);
	background: transparent;
	color: var(--color-secondary);
	font: inherit;
	font-size: 0.875rem;
	font-weight: 600;
	cursor: pointer;
	transition:
		color 180ms,
		background 180ms,
		transform 180ms;
}
.selection-button:hover {
	color: var(--color-contrast);
	background: var(--color-button-bg);
}
.selection-button[aria-pressed='true'] {
	color: var(--color-contrast);
}
.selection-button:active {
	transform: scale(0.94);
}
.selection-button:focus-visible {
	outline: 2px solid var(--color-brand);
	outline-offset: -2px;
}
.selection-button:disabled {
	cursor: wait;
}
.selection-indicator {
	position: absolute;
	top: 0;
	left: 0;
	border-radius: var(--radius-lg);
	background: color-mix(in srgb, var(--color-contrast) 13%, var(--color-raised-bg));
	pointer-events: none;
}
.selection-indicator.ready {
	transition:
		transform 480ms cubic-bezier(0.22, 1.4, 0.36, 1),
		width 350ms ease,
		height 350ms ease;
}
.vertical {
	align-self: start;
	box-sizing: border-box;
	min-height: 0;
	max-height: 100%;
	overflow-y: auto;
	overscroll-behavior: contain;
	scrollbar-width: thin;
}
.vertical .selection-track {
	flex-direction: column;
}
.vertical .selection-button {
	flex: none;
	padding: 0.75rem;
}
.selection-label {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
@container (max-width: 40rem) {
	.selection-label {
		display: none;
	}
}
@media (prefers-reduced-motion: reduce) {
	.selection-indicator.ready,
	.selection-button {
		transition: none;
	}
}
</style>
