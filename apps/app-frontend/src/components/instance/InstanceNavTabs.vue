<script setup lang="ts">
import { GripVerticalIcon, PencilIcon, RefreshCwIcon } from '@modrinth/assets'
import { ButtonStyled, commonMessages, defineMessages, NavTabs, useVIntl } from '@modrinth/ui'
import type { Component } from 'vue'
import { computed, ref, shallowRef, watch } from 'vue'
import Draggable from 'vuedraggable'

interface InstanceTab {
	id: string
	label: string
	href: string
	icon?: Component
	onboardingId?: string
}

const props = defineProps<{
	links: InstanceTab[]
	defaultOrder: readonly string[]
	saveOrder: (order: string[]) => Promise<void>
}>()
const { formatMessage } = useVIntl()
const messages = defineMessages({
	edit: { id: 'app.instance.tabs.edit-order', defaultMessage: 'Edit navigation order' },
	hint: {
		id: 'app.instance.tabs.reorder-hint',
		defaultMessage: 'Drag to reorder. This order applies to all instances on this device.',
	},
	restore: { id: 'app.instance.tabs.restore-order', defaultMessage: 'Restore default order' },
	failed: {
		id: 'app.instance.tabs.save-order-failed',
		defaultMessage: 'Could not save the navigation order. Your changes are still here; try again.',
	},
})

const editing = ref(false)
const saveFailed = ref(false)
const saving = ref(false)
const draft = shallowRef<InstanceTab[]>([])

function orderLinks(value: unknown): InstanceTab[] {
	const remaining = new Map(props.links.map((link) => [link.id, link]))
	const result: InstanceTab[] = []
	if (Array.isArray(value)) {
		for (const id of value) {
			const link = remaining.get(id)
			if (!link) continue
			result.push(link)
			remaining.delete(id)
		}
	}
	return [...result, ...remaining.values()]
}

const orderedLinks = computed(() => props.links)

function startEditing() {
	if (saving.value) return
	draft.value = [...orderedLinks.value]
	saveFailed.value = false
	editing.value = true
}

function cancelEditing() {
	if (saving.value) return
	editing.value = false
	saveFailed.value = false
	draft.value = []
}

function resetOrder() {
	if (saving.value) return
	draft.value = orderLinks(props.defaultOrder)
	saveFailed.value = false
}

async function saveOrder() {
	if (saving.value) return
	const nextOrder = orderLinks(draft.value.map((link) => link.id)).map((link) => link.id)
	saving.value = true
	saveFailed.value = false
	try {
		await props.saveOrder(nextOrder)
		editing.value = false
		draft.value = []
	} catch {
		saveFailed.value = true
	} finally {
		saving.value = false
	}
}

function moveTab(index: number, offset: number) {
	if (saving.value) return
	const destination = index + offset
	if (destination < 0 || destination >= draft.value.length) return
	const next = [...draft.value]
	const [item] = next.splice(index, 1)
	next.splice(destination, 0, item)
	draft.value = next
}

watch(() => props.links.map((link) => link.href).join('|'), cancelEditing)
</script>

<template>
	<div class="instance-navigation">
		<div v-if="!editing" class="flex min-w-0 items-center gap-2">
			<NavTabs :links="orderedLinks" class="min-w-0 max-w-full" />
			<ButtonStyled circular type="transparent">
				<button
					v-tooltip="formatMessage(messages.edit)"
					type="button"
					:aria-label="formatMessage(messages.edit)"
					@click="startEditing"
				>
					<PencilIcon aria-hidden="true" />
				</button>
			</ButtonStyled>
		</div>
		<div v-else class="instance-navigation-editor">
			<Draggable
				v-model="draft"
				item-key="id"
				tag="div"
				role="group"
				:aria-label="formatMessage(messages.edit)"
				class="instance-navigation-sort"
				direction="horizontal"
				:animation="220"
				:disabled="saving"
				easing="cubic-bezier(0.22, 1, 0.36, 1)"
				:force-fallback="true"
				:fallback-tolerance="5"
				ghost-class="instance-tab-ghost"
				chosen-class="instance-tab-chosen"
			>
				<template #item="{ element: tab, index }">
					<button
						:key="tab.id"
						type="button"
						class="instance-tab-sort-item"
						@keydown.alt.left.prevent="moveTab(index, -1)"
						@keydown.alt.right.prevent="moveTab(index, 1)"
					>
						<GripVerticalIcon class="size-4 text-secondary" aria-hidden="true" />
						<component :is="tab.icon" v-if="tab.icon" class="size-5" aria-hidden="true" />
						{{ tab.label }}
					</button>
				</template>
			</Draggable>
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
				<p class="m-0 flex-1 text-sm text-secondary">{{ formatMessage(messages.hint) }}</p>
				<div class="flex flex-wrap items-center gap-2">
					<ButtonStyled type="transparent">
						<button type="button" :disabled="saving" @click="resetOrder">
							<RefreshCwIcon aria-hidden="true" /> {{ formatMessage(messages.restore) }}
						</button>
					</ButtonStyled>
					<ButtonStyled>
						<button type="button" :disabled="saving" @click="cancelEditing">
							{{ formatMessage(commonMessages.cancelButton) }}
						</button>
					</ButtonStyled>
					<ButtonStyled color="brand">
						<button type="button" :disabled="saving" @click="saveOrder">
							{{ formatMessage(commonMessages.saveButton) }}
						</button>
					</ButtonStyled>
				</div>
			</div>
			<p v-if="saveFailed" role="alert" class="m-0 text-sm text-red">
				{{ formatMessage(messages.failed) }}
			</p>
		</div>
	</div>
</template>

<style scoped>
.instance-navigation {
	min-width: 0;
}

.instance-navigation-editor {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.instance-navigation-sort {
	display: flex;
	gap: 0.25rem;
	width: fit-content;
	max-width: 100%;
	box-sizing: border-box;
	overflow-x: auto;
	padding: 0.375rem;
	border: 1px solid var(--surface-4);
	border-radius: 1rem;
	background: var(--color-bg-raised);
}

.instance-tab-sort-item {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	gap: 0.5rem;
	padding: 0.625rem 0.875rem;
	border: 0;
	border-radius: 999px;
	background: var(--color-button-bg);
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.875rem;
	font-weight: 700;
	white-space: nowrap;
	cursor: grab;
	touch-action: pan-y;
}

.instance-tab-sort-item:hover {
	filter: brightness(1.12);
}

.instance-tab-chosen {
	cursor: grabbing;
}

.instance-tab-ghost {
	opacity: 0.3;
	background: var(--color-brand-highlight);
}
</style>
