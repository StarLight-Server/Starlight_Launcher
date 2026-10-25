import assert from 'node:assert/strict'
import test from 'node:test'

import { createModalTransition } from './modal-transition.ts'

test('fast reopen invalidates the previous closing animation', () => {
	const transition = createModalTransition()
	assert.equal(transition.begin(false), undefined)
	const opening = transition.begin(true)!
	assert.equal(transition.begin(true), undefined)
	const closing = transition.begin(false)!
	assert.equal(opening(), false)
	assert.equal(transition.begin(false), undefined)
	const reopened = transition.begin(true)!
	assert.equal(closing(), false)
	assert.equal(reopened(), true)
	assert.equal(transition.isActive(), true)
})

test('closing before the opening animation and unmount invalidate stale callbacks', () => {
	const transition = createModalTransition()
	const opening = transition.begin(true)!
	const closing = transition.begin(false)!
	assert.equal(opening(), false)
	assert.equal(closing(), true)
	assert.equal(transition.isActive(), false)
	transition.dispose()
	assert.equal(closing(), false)
})
