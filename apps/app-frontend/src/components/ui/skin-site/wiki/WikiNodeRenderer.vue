<script setup lang="ts">
import type { SkinSiteWikiNode } from '@/helpers/skin-site-api'

import { safeExternalUrl, safeWikiColor } from './wiki-color'
import WikiAttachmentNode from './WikiAttachmentNode.vue'
import WikiNotice from './WikiNotice.vue'

defineOptions({ name: 'WikiNodeRenderer' })

defineProps<{ nodes: SkinSiteWikiNode[] }>()
const emit = defineEmits<{ (e: 'navigate', title: string): void }>()

function headingTag(level?: number | null): string {
	return 'h' + Math.min(6, Math.max(1, level ?? 2))
}

function navigate(title?: string | null) {
	emit('navigate', title ?? '')
}
</script>

<template>
	<template v-for="(node, index) in nodes" :key="node.type + '-' + index">
		<component
			:is="headingTag(node.level)"
			v-if="node.type === 'heading'"
			class="wiki-heading scroll-mt-24"
			:style="{ textAlign: node.align ?? undefined }"
		>
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</component>
		<p
			v-else-if="node.type === 'paragraph'"
			class="my-3 leading-7 break-words whitespace-pre-wrap"
			:style="{ textAlign: node.align ?? undefined }"
		>
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</p>
		<strong v-else-if="node.type === 'strong'" class="font-bold">
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</strong>
		<small v-else-if="node.type === 'small'">
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</small>
		<span
			v-else-if="node.type === 'color'"
			:style="{ color: safeWikiColor(node.color ?? '') ?? undefined }"
		>
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</span>
		<em v-else-if="node.type === 'emphasis'" class="italic">
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</em>
		<u v-else-if="node.type === 'underline'">
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</u>
		<s v-else-if="node.type === 'strike'">
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</s>
		<mark v-else-if="node.type === 'highlight'" class="rounded bg-yellow/25 px-0.5 text-contrast">
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</mark>
		<code v-else-if="node.type === 'inlineCode'" class="rounded bg-button-bg px-1 font-mono text-sm">
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</code>
		<span
			v-else-if="node.type === 'spoiler'"
			class="cursor-help rounded bg-contrast text-contrast transition-colors hover:bg-transparent hover:text-inherit"
			:title="node.tooltip || '我知道你在偷看'"
			tabindex="0"
		>
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</span>
		<br v-else-if="node.type === 'break'" />
		<hr v-else-if="node.type === 'rule'" class="my-6 border-surface-5" />
		<button
			v-else-if="node.type === 'internalLink'"
			type="button"
			class="font-medium underline-offset-2 hover:underline"
			:class="node.exists === false ? 'text-red' : 'text-brand'"
			:title="node.exists === false ? '该词条尚未创建' : undefined"
			@click="navigate(node.title)"
		>
			<WikiNodeRenderer v-if="node.children.length" :nodes="node.children" @navigate="navigate" />
			<template v-else>{{ node.text }}</template>
		</button>
		<a
			v-else-if="node.type === 'externalLink'"
			class="text-brand underline-offset-2 hover:underline"
			:href="safeExternalUrl(node.href)"
			target="_blank"
			rel="noopener noreferrer nofollow"
		>
			<WikiNodeRenderer v-if="node.children.length" :nodes="node.children" @navigate="navigate" />
			<template v-else>{{ node.text }}</template>
		</a>
		<ul v-else-if="node.type === 'unorderedList'" class="my-3 list-disc pl-7">
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</ul>
		<ol
			v-else-if="node.type === 'orderedList'"
			:start="node.start ?? undefined"
			class="my-3 list-decimal pl-7"
		>
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</ol>
		<li v-else-if="node.type === 'listItem'" class="my-1">
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</li>
		<blockquote
			v-else-if="node.type === 'quote'"
			class="my-4 border-l-4 border-brand/60 bg-brand/5 px-4 py-2"
		>
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</blockquote>
		<pre
			v-else-if="node.type === 'code'"
			class="my-4 overflow-x-auto rounded-lg border border-solid border-surface-5 bg-bg-raised p-4 font-mono text-sm"
		><code>{{ node.text }}</code></pre>
		<div v-else-if="node.type === 'table'" class="my-5 overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<tbody>
					<WikiNodeRenderer
						v-if="node.children.length"
						:nodes="node.children"
						@navigate="navigate"
					/>
					<tr v-for="(row, rowIndex) in node.rows" :key="rowIndex">
						<td v-for="(cell, cellIndex) in row" :key="cellIndex" class="border border-solid border-surface-5 px-2 py-1">
							<WikiNodeRenderer :nodes="cell" @navigate="navigate" />
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<tr v-else-if="node.type === 'tableRow'">
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</tr>
		<component
			:is="node.type === 'tableHeader' ? 'th' : 'td'"
			v-else-if="node.type === 'tableCell' || node.type === 'tableHeader'"
			class="border border-solid border-surface-5 px-2 py-1"
			:colspan="node.colspan ?? 1"
			:rowspan="node.rowspan ?? 1"
		>
			<WikiNodeRenderer :nodes="node.children" @navigate="navigate" />
		</component>
		<WikiAttachmentNode
			v-else-if="node.type === 'attachment' && node.title"
			:name="node.title"
			:caption="node.text"
		/>
		<WikiNotice
			v-else-if="node.type === 'notice' && node.title"
			:title="node.title"
			:description="node.text"
			:variant="node.variant"
		>
			<WikiNodeRenderer v-if="node.children.length" :nodes="node.children" @navigate="navigate" />
			<p v-else-if="node.text" class="whitespace-pre-wrap">{{ node.text }}</p>
		</WikiNotice>
		<span v-else>{{ node.text }}</span>
	</template>
</template>

<style scoped>
.wiki-heading {
	margin-top: 1.65rem;
	margin-bottom: 0.7rem;
	border-bottom: 1px solid color-mix(in oklab, currentColor 16%, transparent);
	padding-bottom: 0.4rem;
	font-weight: 750;
	line-height: 1.25;
}

h1.wiki-heading {
	font-size: 2rem;
}

h2.wiki-heading {
	font-size: 1.55rem;
}

h3.wiki-heading {
	font-size: 1.25rem;
}
</style>
