import {
	bindingMatchesKeyboardEvent,
	bindingMatchesMouseEvent,
	bindingMatchesWheelEvent,
	type KeyBinding,
	useModalStack,
} from '@modrinth/ui'
import { computed, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useNetworkStatus } from '@/composables/useNetworkStatus'
import { getNavShortcutEnabled } from '@/helpers/nav-shortcut-state'
import { getQuickScrollEnabled } from '@/helpers/scroll-top-state'
import {
	SCROLL_ACTIONS,
	SHORTCUT_ACTIONS,
	type ShortcutAction,
} from '@/helpers/shortcut-actions'
import { resolveAllBindings } from '@/helpers/shortcut-bindings'
import { useTheming } from '@/store/theme'

/** Editing surfaces keep these keys for themselves. */
function isEditableTarget(target: EventTarget | null) {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	)
}

function scrollsAtOwnLevel(element: Element) {
	const { overflowY } = getComputedStyle(element)
	return /(auto|scroll|overlay)/.test(overflowY) && element.scrollHeight > element.clientHeight
}

/** A container that scrolls the page itself rather than a widget on it. */
function isPageScroller(element: Element) {
	return scrollsAtOwnLevel(element) && element.clientHeight >= window.innerHeight / 2
}

/** Nearest scrolling ancestor, whatever its size. */
function nearestScrollContainer(target: EventTarget | null) {
	let element = target instanceof Element ? target : null
	while (element) {
		if (scrollsAtOwnLevel(element)) return element
		element = element.parentElement
	}
	return null
}

/**
 * The page's own scroller. Most pages scroll inside `.app-viewport`, but some
 * screens (settings, consoles, studios) turn that element's scrolling off and
 * host a full-height container inside it, so fall back to whatever fills the
 * middle of the viewport.
 */
function resolvePageScroller() {
	const viewport = document.querySelector<HTMLElement>('.app-viewport')
	if (!viewport) return null
	if (isPageScroller(viewport)) return viewport

	const bounds = viewport.getBoundingClientRect()
	let element: Element | null = document.elementFromPoint(
		bounds.left + bounds.width / 2,
		bounds.top + bounds.height / 2,
	)
	while (element) {
		if (isPageScroller(element)) return element
		element = element.parentElement
	}

	return viewport
}

export function setupKeyboardShortcuts() {
	const themeStore = useTheming()
	const { hasModal } = useModalStack()
	const route = useRoute()
	const router = useRouter()
	const { offline } = useNetworkStatus()

	themeStore.quickScrollEnabled = getQuickScrollEnabled()
	for (const shortcut of SHORTCUT_ACTIONS) {
		if (shortcut.group === 'nav') themeStore[shortcut.enabledField] = getNavShortcutEnabled(shortcut.id)
	}
	themeStore.shortcutBindings = resolveAllBindings()

	/** The combination an action answers to now: recorded if there is one, default otherwise. */
	function bindingFor(action: ShortcutAction): KeyBinding {
		return themeStore.shortcutBindings[action.id] ?? action.defaultBinding
	}

	/** Whether an action is switched on and reachable in the current state. */
	function shortcutIsAvailable(action: ShortcutAction): boolean {
		if (!themeStore[action.enabledField]) return false
		return !action.unavailable?.({
			worldsTabEnabled: themeStore.featureFlags.worlds_tab,
			offline: offline.value,
		})
	}

	function findShortcut<E extends Event>(
		event: E,
		matches: (binding: KeyBinding, event: E) => boolean,
		{ includeDisabled = false }: { includeDisabled?: boolean } = {},
	): ShortcutAction | null {
		if (hasModal.value) return null
		if (isEditableTarget(event.target)) return null

		for (const action of SHORTCUT_ACTIONS) {
			if (!includeDisabled && !shortcutIsAvailable(action)) continue
			if (matches(bindingFor(action), event)) return action
		}

		return null
	}

	/** Does what an action is for. Scrolling actions move the page's own scroller. */
	function runShortcut(action: ShortcutAction, event: Event) {
		if (action.target) {
			router.push(action.target(route))
			return
		}

		const focusedContainer = nearestScrollContainer(event.target)
		if (focusedContainer && !isPageScroller(focusedContainer)) return

		const scroller = resolvePageScroller()
		if (!scroller) return

		action.applyScroll?.(scroller)
	}

	function handleScrollShortcutKey(event: KeyboardEvent) {
		if (event.isComposing) return

		const match = findShortcut(event, bindingMatchesKeyboardEvent, { includeDisabled: true })
		if (match?.group !== 'scroll') return

		const focusedContainer = nearestScrollContainer(event.target)
		if (focusedContainer && !isPageScroller(focusedContainer)) return

		const scroller = resolvePageScroller()
		if (!scroller) return

		event.preventDefault()
		if (!shortcutIsAvailable(match)) return

		match.applyScroll?.(scroller)
	}

	function handleNavShortcutKey(event: KeyboardEvent) {
		if (event.isComposing) return

		const match = findShortcut(event, bindingMatchesKeyboardEvent)
		if (match?.group !== 'nav') return

		event.preventDefault()
		runShortcut(match, event)
	}

	const hasPointerBindings = computed(() =>
		SHORTCUT_ACTIONS.some((action) => bindingFor(action).device === 'mouse'),
	)

	function handleShortcutMouse(event: MouseEvent) {
		if (!hasPointerBindings.value) return

		const match = findShortcut(event, bindingMatchesMouseEvent)
		if (!match) return

		event.preventDefault()
		event.stopPropagation()
		runShortcut(match, event)
	}

	function handleShortcutWheel(event: WheelEvent) {
		if (!hasPointerBindings.value) return

		const match = findShortcut(event, bindingMatchesWheelEvent)
		if (!match) return

		event.preventDefault()
		event.stopPropagation()
		runShortcut(match, event)
	}

	function handleGlobalKeydown(event: KeyboardEvent) {
		const key = event.key.toLowerCase()
		const isFindShortcut = key === 'f' && (event.ctrlKey || event.metaKey)
		const isBlockedDevtoolsShortcut = event.key === 'F12' && !themeStore.devMode

		if (isFindShortcut || isBlockedDevtoolsShortcut) {
			event.preventDefault()
			event.stopPropagation()
		}

		handleScrollShortcutKey(event)
		handleNavShortcutKey(event)
	}

	window.addEventListener('keydown', handleGlobalKeydown, true)
	window.addEventListener('mousedown', handleShortcutMouse, true)
	// Not passive: a bound wheel direction has to keep the page from scrolling.
	window.addEventListener('wheel', handleShortcutWheel, { capture: true, passive: false })

	onUnmounted(() => {
		window.removeEventListener('keydown', handleGlobalKeydown, true)
		window.removeEventListener('mousedown', handleShortcutMouse, true)
		window.removeEventListener('wheel', handleShortcutWheel, { capture: true, passive: false })
	})

	return { bindingFor, shortcutIsAvailable, SCROLL_ACTIONS }
}