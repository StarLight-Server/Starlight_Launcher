<script setup lang="ts">
import { SpinnerIcon } from '@modrinth/assets'
import { defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { computed, onMounted, ref } from 'vue'

import {
	skinSiteCreateReviewPaperAdmin,
	skinSiteDecideReviewSubmission,
	skinSiteRegenerateReviewInvite,
	type SkinSiteReviewAnswer,
	type SkinSiteReviewConfigData,
	type SkinSiteReviewMailConfig,
	skinSiteReviewPaperAdmin,
	skinSiteReviewPaperList,
	type SkinSiteReviewPaperSummary,
	type SkinSiteReviewQuestion,
	type SkinSiteReviewResult,
	type SkinSiteReviewSubmission,
	skinSiteReviewSubmissionCount,
	skinSiteReviewSubmissions,
	skinSiteUpdateReviewPaperAdmin,
} from '@/helpers/skin-site-api'

const { formatMessage } = useVIntl()
const { handleError, addNotification } = injectNotificationManager()

const messages = defineMessages({
	title: { id: 'app.skin-site.admin.review.title', defaultMessage: 'Player review' },
	loading: { id: 'app.skin-site.admin.review.loading', defaultMessage: 'Loading…' },
	failed: {
		id: 'app.skin-site.admin.review.failed',
		defaultMessage: 'Could not load submissions.',
	},
	empty: { id: 'app.skin-site.admin.review.empty', defaultMessage: 'No submissions found.' },
	total: { id: 'app.skin-site.admin.review.total', defaultMessage: '{count} submissions' },
	filterAll: { id: 'app.skin-site.admin.review.filter-all', defaultMessage: 'All' },
	filterPending: { id: 'app.skin-site.admin.review.filter-pending', defaultMessage: 'Pending' },
	filterPassed: { id: 'app.skin-site.admin.review.filter-passed', defaultMessage: 'Passed' },
	filterRejected: { id: 'app.skin-site.admin.review.filter-rejected', defaultMessage: 'Rejected' },
	resultPending: { id: 'app.skin-site.admin.review.result-pending', defaultMessage: 'Pending' },
	resultPassed: { id: 'app.skin-site.admin.review.result-passed', defaultMessage: 'Passed' },
	resultRejected: { id: 'app.skin-site.admin.review.result-rejected', defaultMessage: 'Rejected' },
	modeAuto: { id: 'app.skin-site.admin.review.mode-auto', defaultMessage: 'Auto' },
	modeManual: { id: 'app.skin-site.admin.review.mode-manual', defaultMessage: 'Manual' },
	applicant: { id: 'app.skin-site.admin.review.applicant', defaultMessage: 'Applicant' },
	submittedAt: { id: 'app.skin-site.admin.review.submitted-at', defaultMessage: 'Submitted' },
	score: { id: 'app.skin-site.admin.review.score', defaultMessage: 'Score' },
	reviewer: { id: 'app.skin-site.admin.review.reviewer', defaultMessage: 'Reviewer' },
	details: { id: 'app.skin-site.admin.review.details', defaultMessage: 'Details' },
	hide: { id: 'app.skin-site.admin.review.hide', defaultMessage: 'Hide' },
	answers: { id: 'app.skin-site.admin.review.answers', defaultMessage: 'Answers' },
	questionNo: {
		id: 'app.skin-site.admin.review.question-no',
		defaultMessage: 'Question {n}',
	},
	noAnswers: { id: 'app.skin-site.admin.review.no-answers', defaultMessage: 'No answers.' },
	autoChecks: { id: 'app.skin-site.admin.review.auto-checks', defaultMessage: 'Automatic checks' },
	context: { id: 'app.skin-site.admin.review.context', defaultMessage: 'Submission context' },
	ip: { id: 'app.skin-site.admin.review.ip', defaultMessage: 'IP' },
	userAgent: { id: 'app.skin-site.admin.review.user-agent', defaultMessage: 'User agent' },
	activity: { id: 'app.skin-site.admin.review.activity', defaultMessage: 'Activity' },
	duration: { id: 'app.skin-site.admin.review.duration', defaultMessage: 'Duration' },
	hiddenTime: { id: 'app.skin-site.admin.review.hidden-time', defaultMessage: 'Hidden time' },
	screenSwitches: {
		id: 'app.skin-site.admin.review.screen-switches',
		defaultMessage: 'Screen switches',
	},
	history: { id: 'app.skin-site.admin.review.history', defaultMessage: 'Decision history' },
	accept: { id: 'app.skin-site.admin.review.accept', defaultMessage: 'Accept' },
	reject: { id: 'app.skin-site.admin.review.reject', defaultMessage: 'Reject' },
	reason: { id: 'app.skin-site.admin.review.reason', defaultMessage: 'Reason' },
	acceptDone: {
		id: 'app.skin-site.admin.review.accept-done',
		defaultMessage: 'Submission accepted.',
	},
	rejectDone: {
		id: 'app.skin-site.admin.review.reject-done',
		defaultMessage: 'Submission rejected.',
	},
	regenInvite: {
		id: 'app.skin-site.admin.review.regen-invite',
		defaultMessage: 'Regenerate invite',
	},
	inviteRegenerated: {
		id: 'app.skin-site.admin.review.invite-regenerated',
		defaultMessage: 'Invite code regenerated.',
	},
	inviteSent: {
		id: 'app.skin-site.admin.review.invite-sent',
		defaultMessage: 'Email sent.',
	},
	inviteNotSent: {
		id: 'app.skin-site.admin.review.invite-not-sent',
		defaultMessage: 'Email not sent.',
	},
	prev: { id: 'app.skin-site.admin.review.prev', defaultMessage: 'Previous' },
	next: { id: 'app.skin-site.admin.review.next', defaultMessage: 'Next' },
	page: { id: 'app.skin-site.admin.review.page', defaultMessage: 'Page {page}' },
	tabList: { id: 'app.skin-site.admin.review.tab-list', defaultMessage: 'Submissions' },
	tabPapers: { id: 'app.skin-site.admin.review.tab-papers', defaultMessage: 'Papers' },
	papersEmpty: {
		id: 'app.skin-site.admin.review.papers-empty',
		defaultMessage: 'No review papers yet.',
	},
	newPaper: { id: 'app.skin-site.admin.review.new-paper', defaultMessage: 'New paper' },
	editPaper: { id: 'app.skin-site.admin.review.edit-paper', defaultMessage: 'Edit' },
	paperTitle: { id: 'app.skin-site.admin.review.paper-title', defaultMessage: 'Title' },
	paperAnnotation: {
		id: 'app.skin-site.admin.review.paper-annotation',
		defaultMessage: 'Description',
	},
	paperEnabled: { id: 'app.skin-site.admin.review.paper-enabled', defaultMessage: 'Enabled' },
	paperMode: { id: 'app.skin-site.admin.review.paper-mode', defaultMessage: 'Mode' },
	paperPassScore: {
		id: 'app.skin-site.admin.review.paper-pass-score',
		defaultMessage: 'Pass score',
	},
	paperTargetPermissions: {
		id: 'app.skin-site.admin.review.paper-target-permissions',
		defaultMessage: 'Target permissions',
	},
	paperQuestions: {
		id: 'app.skin-site.admin.review.paper-questions',
		defaultMessage: 'Questions',
	},
	addQuestion: { id: 'app.skin-site.admin.review.add-question', defaultMessage: 'Add question' },
	questionTitle: {
		id: 'app.skin-site.admin.review.question-title',
		defaultMessage: 'Question title',
	},
	questionType: { id: 'app.skin-site.admin.review.question-type', defaultMessage: 'Type' },
	questionScore: { id: 'app.skin-site.admin.review.question-score', defaultMessage: 'Score' },
	questionAnnotation: {
		id: 'app.skin-site.admin.review.question-annotation',
		defaultMessage: 'Annotation',
	},
	addOption: { id: 'app.skin-site.admin.review.add-option', defaultMessage: 'Add option' },
	optionDescription: {
		id: 'app.skin-site.admin.review.option-description',
		defaultMessage: 'Option text',
	},
	optionCorrect: {
		id: 'app.skin-site.admin.review.option-correct',
		defaultMessage: 'Correct',
	},
	removeQuestion: {
		id: 'app.skin-site.admin.review.remove-question',
		defaultMessage: 'Remove',
	},
	paperCreated: {
		id: 'app.skin-site.admin.review.paper-created',
		defaultMessage: 'Paper created.',
	},
	paperSaved: { id: 'app.skin-site.admin.review.paper-saved', defaultMessage: 'Paper saved.' },
	mailTitle: { id: 'app.skin-site.admin.review.mail-title', defaultMessage: 'Pass mail' },
	mailEnabled: { id: 'app.skin-site.admin.review.mail-enabled', defaultMessage: 'Send mail on pass' },
	mailSubject: { id: 'app.skin-site.admin.review.mail-subject', defaultMessage: 'Subject' },
	mailMessage: { id: 'app.skin-site.admin.review.mail-message', defaultMessage: 'Body' },
	mailExtra: { id: 'app.skin-site.admin.review.mail-extra', defaultMessage: 'Extra text' },
	mailIncludeInvite: {
		id: 'app.skin-site.admin.review.mail-include-invite',
		defaultMessage: 'Include invite code',
	},
	preventDuplicate: {
		id: 'app.skin-site.admin.review.prevent-duplicate',
		defaultMessage: 'Reject duplicate submissions',
	},
	copyLink: { id: 'app.skin-site.admin.review.copy-link', defaultMessage: 'Copy link' },
	linkCopied: { id: 'app.skin-site.admin.review.link-copied', defaultMessage: 'Link copied.' },
	moveUp: { id: 'app.skin-site.admin.review.move-up', defaultMessage: 'Move up' },
	moveDown: { id: 'app.skin-site.admin.review.move-down', defaultMessage: 'Move down' },
	mailSubjectRequired: {
		id: 'app.skin-site.admin.review.mail-subject-required',
		defaultMessage: 'Subject is required when mail is enabled.',
	},
	mailMessageRequired: {
		id: 'app.skin-site.admin.review.mail-message-required',
		defaultMessage: 'Body is required when mail is enabled.',
	},
})

const availablePermissions: Array<{ value: string; label: string }> = [
	{ value: 'EXTERNAL_MEMBER', label: 'Mod服玩家' },
	{ value: 'INTERNAL_MEMBER', label: '原版服玩家' },
	{ value: 'SERVER_ADMIN', label: '服务器管理' },
	{ value: 'WEB_ADMIN', label: 'Web管理' },
	{ value: 'SPONSOR', label: '捐赠者' },
	{ value: 'DEVELOPER', label: '开发者' },
	{ value: 'SENIOR_MEMBER', label: '老资历' },
]

const prerequisitePermissionOptions: Array<{ value: string; label: string }> = [
	{ value: 'GUEST', label: '游客' },
	...availablePermissions,
]

const questionTypeOptions: Array<{ value: SkinSiteReviewQuestionType; label: string }> = [
	{ value: 'SINGLE', label: '单选题' },
	{ value: 'MULTIPLE', label: '多选题' },
	{ value: 'TRUE_FALSE', label: '判断题' },
	{ value: 'FILL', label: '填空题' },
	{ value: 'ESSAY', label: '简答题' },
]

const multipleScoreModeOptions: Array<{ value: 'EXACT' | 'PARTIAL' | 'PARTIAL_WITH_PENALTY'; label: string }> = [
	{ value: 'EXACT', label: '多选少选均不给分' },
	{ value: 'PARTIAL', label: '少选部分得分' },
	{ value: 'PARTIAL_WITH_PENALTY', label: '多选部分扣分' },
]

const PAGE_SIZE = 20

const items = ref<SkinSiteReviewSubmission[]>([])
const total = ref(0)
const offset = ref(0)
const loading = ref(true)
const failed = ref(false)

const filter = ref<'' | SkinSiteReviewResult | 'COMPLETED'>('PENDING')

const expandedId = ref<number | null>(null)
const decisions = ref<Record<number, { reason: string; working: boolean }>>({})

const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const hasPrev = computed(() => offset.value > 0)
const hasNext = computed(() => offset.value + PAGE_SIZE < total.value)

const FILTERS: Array<{ key: '' | SkinSiteReviewResult | 'COMPLETED'; label: () => string }> = [
	{ key: '', label: () => formatMessage(messages.filterAll) },
	{ key: 'PENDING', label: () => formatMessage(messages.filterPending) },
	{ key: 'PASSED', label: () => formatMessage(messages.filterPassed) },
	{ key: 'REJECTED', label: () => formatMessage(messages.filterRejected) },
]

function resultLabel(result: SkinSiteReviewResult): string {
	if (result === 'PASSED') return formatMessage(messages.resultPassed)
	if (result === 'REJECTED') return formatMessage(messages.resultRejected)
	return formatMessage(messages.resultPending)
}

function resultClass(result: SkinSiteReviewResult): string {
	if (result === 'PASSED') return 'bg-green text-contrast'
	if (result === 'REJECTED') return 'bg-red text-contrast'
	return 'bg-button-bg text-secondary'
}

function modeLabel(mode: string): string {
	return mode === 'AUTO' ? formatMessage(messages.modeAuto) : formatMessage(messages.modeManual)
}

function formatDateTime(ts?: number | null): string {
	if (!ts) return ''
	try {
		return new Date(ts).toLocaleString()
	} catch {
		return ''
	}
}

function formatDuration(ms?: number | null): string {
	if (!ms || ms < 0) return '—'
	const totalSeconds = Math.floor(ms / 1000)
	const m = Math.floor(totalSeconds / 60)
	const s = totalSeconds % 60
	return m > 0 ? m + 'm ' + s + 's' : s + 's'
}

function questionFor(submission: SkinSiteReviewSubmission, questionId: string) {
	return submission.paper?.questions?.find((q) => q.id === questionId)
}

function answerText(
	submission: SkinSiteReviewSubmission,
	answer: SkinSiteReviewAnswer,
): string {
	if (answer.text) return answer.text
	if (Array.isArray(answer.values) && answer.values.length) {
		const question = answer.questionId ? questionFor(submission, answer.questionId) : undefined
		const options = question?.options ?? []
		return answer.values
			.map((value) => options.find((o) => o.id === value)?.description ?? value)
			.join(', ')
	}
	return '—'
}

function decisionFor(id: number) {
	if (!decisions.value[id]) decisions.value[id] = { reason: '', working: false }
	return decisions.value[id]
}

async function load(reset = false) {
	if (reset) offset.value = 0
	loading.value = true
	failed.value = false
	try {
		const resultFilter = filter.value || undefined
		const listResult = await skinSiteReviewSubmissions({
			result: resultFilter,
			limit: PAGE_SIZE,
			offset: offset.value,
		})
		if (!listResult.success) throw new Error(listResult.errorMessage)
		items.value = listResult.payload ?? []
		const countResult = await skinSiteReviewSubmissionCount({ result: resultFilter })
		if (countResult.success && typeof countResult.payload === 'number') {
			total.value = countResult.payload
		}
	} catch (error) {
		failed.value = true
		handleError(error)
	} finally {
		loading.value = false
	}
}

async function setFilter(key: '' | SkinSiteReviewResult | 'COMPLETED') {
	filter.value = key
	await load(true)
}

async function prevPage() {
	if (!hasPrev.value) return
	offset.value = Math.max(0, offset.value - PAGE_SIZE)
	await load()
}

async function nextPage() {
	if (!hasNext.value) return
	offset.value += PAGE_SIZE
	await load()
}


async function decide(submission: SkinSiteReviewSubmission, accepted: boolean) {
	const state = decisionFor(submission.id)
	if (state.working) return
	state.working = true
	try {
		const result = await skinSiteDecideReviewSubmission(
			submission.id,
			accepted,
			{},
			submission.revision,
			state.reason,
		)
		if (!result.success) throw new Error(result.errorMessage)
		addNotification({
			type: 'success',
			title: formatMessage(accepted ? messages.acceptDone : messages.rejectDone),
		})
		expandedId.value = null
		await load()
	} catch (error) {
		handleError(error)
	} finally {
		state.working = false
	}
}

async function regenerateInvite(submission: SkinSiteReviewSubmission) {
	try {
		const result = await skinSiteRegenerateReviewInvite(submission.id)
		if (!result.success) throw new Error(result.errorMessage)
		addNotification({
			type: 'success',
			title: formatMessage(result.payload.emailSent ? messages.inviteSent : messages.inviteNotSent),
		})
		await load()
	} catch (error) {
		handleError(error)
	}
}

const detailOpen = ref(false)
const detailSubmission = ref<SkinSiteReviewSubmission | null>(null)

function openDetail(submission: SkinSiteReviewSubmission) {
	detailSubmission.value = submission
	decisionFor(submission.id)
	detailOpen.value = true
}

function closeDetail() {
	detailOpen.value = false
	detailSubmission.value = null
}

const tab = ref<'list' | 'papers'>('list')

const papers = ref<SkinSiteReviewPaperSummary[]>([])
const papersLoading = ref(false)
const paperEditorOpen = ref(false)
const editingPaperId = ref<string | null>(null)
const paperSaving = ref(false)
const paperForm = ref<SkinSiteReviewConfigData>({
	id: '',
	enabled: true,
	title: '',
	annotation: '',
	mode: 'MANUAL',
	passScore: 0,
	targetPermissions: [],
	version: 0,
	questions: [],
	updatedAt: 0,
	prerequisiteMode: 'ANY',
	prerequisitePermissions: [],
	mail: defaultMailConfig(),
})

function newPaper() {
	editingPaperId.value = null
	paperForm.value = {
		id: crypto.randomUUID(),
		enabled: true,
		title: '',
		annotation: '',
		mode: 'MANUAL',
		passScore: 0,
		targetPermissions: [],
		version: 0,
		questions: [],
		updatedAt: Date.now(),
		prerequisiteMode: 'ANY',
		prerequisitePermissions: [],
		mail: defaultMailConfig(),
	}
	paperEditorOpen.value = true
}

async function loadPapers() {
	papersLoading.value = true
	try {
		const result = await skinSiteReviewPaperList()
		if (result.success) papers.value = result.payload ?? []
	} catch (error) {
		handleError(error)
	} finally {
		papersLoading.value = false
	}
}

async function editPaper(paper: SkinSiteReviewPaperSummary) {
	try {
		const result = await skinSiteReviewPaperAdmin(paper.id)
		if (!result.success) throw new Error(result.errorMessage)
		paperForm.value = { ...result.payload, mail: result.payload.mail ?? defaultMailConfig() }
		editingPaperId.value = paper.id
		paperEditorOpen.value = true
	} catch (error) {
		handleError(error)
	}
}

function removeQuestion(index: number) {
	paperForm.value.questions.splice(index, 1)
}

function addOption(question: SkinSiteReviewQuestion) {
	question.options = question.options ?? []
	question.options.push({
		id: crypto.randomUUID(),
		description: '',
		correct: false,
		defaultSelected: false,
		score: 0,
	})
}

function removeOption(question: SkinSiteReviewQuestion, index: number) {
	question.options?.splice(index, 1)
}

function defaultMailConfig(): SkinSiteReviewMailConfig {
	return { enabled: false, subject: '', message: '', includeInviteCode: false, extraText: '' }
}

async function copyPaperLink(paperId: string) {
	try {
		await navigator.clipboard.writeText('https://skin.starlight.cool/review?paper=' + encodeURIComponent(paperId))
		addNotification({ type: 'success', title: formatMessage(messages.linkCopied) })
	} catch (error) {
		handleError(error)
	}
}

function moveQuestion(index: number, direction: number) {
	const target = index + direction
	if (target < 0 || target >= paperForm.value.questions.length) return
	const [question] = paperForm.value.questions.splice(index, 1)
	paperForm.value.questions.splice(target, 0, question)
}

function permissionLabel(value: string): string {
	return (
		availablePermissions.find((item) => item.value === value)?.label ??
		prerequisitePermissionOptions.find((item) => item.value === value)?.label ??
		value
	)
}

function isChoice(question: SkinSiteReviewQuestion): boolean {
	return ['SINGLE', 'MULTIPLE', 'TRUE_FALSE'].includes(question.type)
}

function supportsAutoReview(question: SkinSiteReviewQuestion): boolean {
	return ['SINGLE', 'MULTIPLE', 'TRUE_FALSE', 'ESSAY'].includes(question.type)
}

function supportsFatal(question: SkinSiteReviewQuestion): boolean {
	return paperForm.value.mode === 'AUTO'
		? question.type !== 'ESSAY'
		: supportsAutoReview(question)
}

function isAutomaticallyReviewed(question: SkinSiteReviewQuestion): boolean {
	return paperForm.value.mode === 'AUTO' || question.autoReview
}

function showOptionScore(question: SkinSiteReviewQuestion): boolean {
	if (
		question.type !== 'MULTIPLE' ||
		!isAutomaticallyReviewed(question) ||
		question.multipleScoreMode === 'EXACT'
	) {
		return false
	}
	return true
}

function setCorrectOption(question: SkinSiteReviewQuestion, optionId: string) {
	question.options?.forEach((option) => {
		option.correct = option.id === optionId
	})
}

function setDefaultOption(question: SkinSiteReviewQuestion, optionId: string) {
	if (
		question.type === 'MULTIPLE' ||
		!question.options?.find((option) => option.id === optionId)?.defaultSelected
	)
		return
	question.options?.forEach((option) => {
		if (option.id !== optionId) option.defaultSelected = false
	})
}

function moveOption(question: SkinSiteReviewQuestion, index: number, direction: number) {
	if (!question.options) return
	const target = index + direction
	if (target < 0 || target >= question.options.length) return
	const [option] = question.options.splice(index, 1)
	question.options.splice(target, 0, option)
}

function setOptionalQuestion(question: SkinSiteReviewQuestion) {
	if (!question.optional) return
	question.fatal = false
	question.autoReview = false
}

function setFatalQuestion(question: SkinSiteReviewQuestion) {
	if (!question.fatal) return
	question.optional = false
	if (paperForm.value.mode === 'MANUAL') question.autoReview = true
}

function addQuestionOfType(type: SkinSiteReviewQuestionType) {
	if (paperForm.value.mode === 'AUTO' && type === 'ESSAY') return
	if (paperForm.value.questions.length >= 50) return
	const isChoiceType = ['SINGLE', 'MULTIPLE', 'TRUE_FALSE'].includes(type)
	const baseOptions = isChoiceType
		? type === 'TRUE_FALSE'
			? [
					{ id: crypto.randomUUID(), description: '正确', correct: false, defaultSelected: false, score: 0 },
					{ id: crypto.randomUUID(), description: '错误', correct: false, defaultSelected: false, score: 0 },
				]
			: [
					{ id: crypto.randomUUID(), description: '', correct: false, defaultSelected: false, score: 0 },
					{ id: crypto.randomUUID(), description: '', correct: false, defaultSelected: false, score: 0 },
				]
		: []
	paperForm.value.questions.push({
		id: crypto.randomUUID(),
		type,
		title: '',
		annotation: '',
		score: 1,
		optional: false,
		fatal: false,
		autoReview: false,
		multipleScoreMode: 'EXACT',
		options: baseOptions,
		answer: null,
		maxLength: type === 'FILL' ? 50 : type === 'ESSAY' ? 300 : null,
		informationQuestion: false,
		informationAlias: null,
	})
}

function onQuestionTypeSelected(event: Event) {
	const el = event.target as HTMLSelectElement
	const value = el.value as SkinSiteReviewQuestionType
	if (value) addQuestionOfType(value)
	el.value = ''
}

function availableQuestionTypes(): SkinSiteReviewQuestionType[] {
	const all: SkinSiteReviewQuestionType[] = ['SINGLE', 'MULTIPLE', 'TRUE_FALSE', 'FILL', 'ESSAY']
	return paperForm.value.mode === 'AUTO' ? all.filter((t) => t !== 'ESSAY') : all
}

const totalScore = computed(() =>
	paperForm.value.questions.reduce((sum, q) => sum + Number(q.score || 0), 0),
)

const prerequisiteEnabled = computed({
	get: () => paperForm.value.prerequisitePermissions.length > 0,
	set: (enabled: boolean) => {
		paperForm.value.prerequisitePermissions = enabled ? ['EXTERNAL_MEMBER'] : []
	},
})

function validateBeforeSave(): string | null {
	if (!paperForm.value.title.trim() || !paperForm.value.questions.length)
		return '请填写试卷标题并至少添加一道题目。'
	if (!paperForm.value.targetPermissions.length)
		return '请至少选择一个审核通过后玩家可获得的身份。'
	if (prerequisiteEnabled.value && !paperForm.value.prerequisitePermissions.length)
		return '请至少选择一个前置身份。'
	if (paperForm.value.passScore < 1 || paperForm.value.passScore > totalScore.value)
		return '通过分数必须在 1 至 ' + totalScore.value + ' 之间。'
	for (const [index, q] of paperForm.value.questions.entries()) {
		if (!q.title.trim() || !Number.isInteger(q.score) || q.score < 0)
			return '请完整填写第 ' + (index + 1) + ' 题的题目与整数分数。'
	}
	const mail = paperForm.value.mail
	if (mail?.enabled) {
		if (!mail.subject.trim()) return formatMessage(messages.mailSubjectRequired)
		if (!mail.message.trim()) return formatMessage(messages.mailMessageRequired)
		if (mail.subject.length > 200) return '邮件标题不能超过 200 字。'
		if (mail.message.length > 5000) return '邮件正文不能超过 5000 字。'
		if (mail.extraText.length > 3000) return '邮件补充说明不能超过 3000 字。'
	}
	return null
}

async function savePaper() {
	if (paperSaving.value) return
	const validationError = validateBeforeSave()
	if (validationError) {
		addNotification({ type: 'error', title: validationError })
		return
	}
	paperSaving.value = true
	try {
		const data: SkinSiteReviewConfigData = {
			...paperForm.value,
			targetPermissions: paperForm.value.targetPermissions.filter(Boolean),
			prerequisitePermissions: paperForm.value.prerequisitePermissions.filter(Boolean),
			updatedAt: Date.now(),
		}
		const result =
			editingPaperId.value === null
				? await skinSiteCreateReviewPaperAdmin(data)
				: await skinSiteUpdateReviewPaperAdmin(editingPaperId.value, data)
		if (!result.success) throw new Error(result.errorMessage)
		addNotification({
			type: 'success',
			title: formatMessage(
				editingPaperId.value === null ? messages.paperCreated : messages.paperSaved,
			),
		})
		paperEditorOpen.value = false
		await loadPapers()
	} catch (error) {
		handleError(error)
	} finally {
		paperSaving.value = false
	}
}

async function switchTab(next: 'list' | 'papers') {
	tab.value = next
	if (next === 'papers' && !papers.value.length) await loadPapers()
}

onMounted(() => void load())
</script>
<template>
	<div class="flex w-full flex-col gap-4">
		<div class="flex flex-wrap gap-2 border-b border-solid border-surface-5 pb-2">
			<button
				type="button"
				class="rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
				:class="
					tab === 'list'
						? 'bg-brand text-contrast'
						: 'bg-button-bg text-secondary hover:text-contrast'
				"
				@click="switchTab('list')"
			>
				{{ formatMessage(messages.tabList) }}
			</button>
			<button
				type="button"
				class="rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
				:class="
					tab === 'papers'
						? 'bg-brand text-contrast'
						: 'bg-button-bg text-secondary hover:text-contrast'
				"
				@click="switchTab('papers')"
			>
				{{ formatMessage(messages.tabPapers) }}
			</button>
		</div>

		<template v-if="tab === 'list'">
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<h2 class="m-0 text-xl font-bold text-contrast">{{ formatMessage(messages.title) }}</h2>
				<p class="m-0 mt-1 text-sm text-secondary">
					{{ formatMessage(messages.total, { count: total }) }}
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<button
					v-for="f in FILTERS"
					:key="f.key || 'all'"
					type="button"
					class="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
					:class="
						filter === f.key
							? 'bg-brand text-contrast'
							: 'bg-button-bg text-secondary hover:text-contrast'
					"
					@click="setFilter(f.key)"
				>
					{{ f.label() }}
				</button>
			</div>
		</div>

		<div
			v-if="loading"
			class="flex min-h-48 items-center justify-center gap-2 text-sm text-secondary"
		>
			<SpinnerIcon class="size-4 animate-spin" />
			{{ formatMessage(messages.loading) }}
		</div>
		<p
			v-else-if="failed"
			class="m-0 rounded-lg border border-solid border-surface-5 bg-bg-raised p-4 text-sm text-secondary"
		>
			{{ formatMessage(messages.failed) }}
		</p>
		<p
			v-else-if="!items.length"
			class="m-0 rounded-lg border border-solid border-surface-5 bg-bg-raised p-4 text-sm text-secondary"
		>
			{{ formatMessage(messages.empty) }}
		</p>

		<template v-else>
			<div class="overflow-hidden rounded-lg border border-solid border-surface-5">
				<table class="w-full border-collapse text-left text-sm">
					<thead class="bg-bg-raised">
						<tr class="text-xs text-secondary">
							<th class="px-3 py-2 font-semibold">#</th>
							<th class="px-3 py-2 font-semibold">{{ formatMessage(messages.applicant) }}</th>
							<th class="px-3 py-2 font-semibold">{{ formatMessage(messages.resultPending) }}</th>
							<th class="px-3 py-2 font-semibold">{{ formatMessage(messages.score) }}</th>
							<th class="px-3 py-2 font-semibold">{{ formatMessage(messages.submittedAt) }}</th>
							<th class="px-3 py-2 font-semibold">{{ formatMessage(messages.details) }}</th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="submission in items"
							:key="submission.id"
							class="border-t border-solid border-surface-5 hover:bg-bg-raised"
						>
							<td class="px-3 py-2 text-xs text-secondary">{{ submission.id }}</td>
							<td class="px-3 py-2">
								<span class="font-semibold text-contrast">{{ submission.applicantName }}</span>
								<span
									class="ml-2 rounded-full bg-button-bg px-2 py-0.5 text-[10px] font-semibold text-secondary"
								>
									{{ modeLabel(submission.mode) }}
								</span>
							</td>
							<td class="px-3 py-2">
								<span
									class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
									:class="resultClass(submission.result)"
								>
									{{ resultLabel(submission.result) }}
								</span>
							</td>
							<td class="px-3 py-2 text-xs text-contrast">
								{{
									submission.score !== null && submission.score !== undefined
										? submission.score
										: '—'
								}}
							</td>
							<td class="px-3 py-2 text-xs text-secondary">
								{{ formatDateTime(submission.createdAt) }}
							</td>
							<td class="px-3 py-2">
								<button
									type="button"
									class="rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110"
									@click="openDetail(submission)"
								>
									{{ formatMessage(messages.details) }}
								</button>
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<div class="flex items-center justify-center gap-3 pt-1">
				<button
					type="button"
					class="rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
					:disabled="!hasPrev"
					@click="prevPage"
				>
					{{ formatMessage(messages.prev) }}
				</button>
				<span class="text-xs text-secondary">
					{{ formatMessage(messages.page, { page }) }} / {{ pageCount }}
				</span>
				<button
					type="button"
					class="rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
					:disabled="!hasNext"
					@click="nextPage"
				>
					{{ formatMessage(messages.next) }}
				</button>
			</div>
		</template>
		</template>

		<template v-else>
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p class="m-0 text-sm text-secondary">
					{{ formatMessage(messages.tabPapers) }}
				</p>
				<button
					type="button"
					class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110"
					@click="newPaper"
				>
					{{ formatMessage(messages.newPaper) }}
				</button>
			</div>

			<div
				v-if="papersLoading"
				class="flex min-h-32 items-center justify-center gap-2 text-sm text-secondary"
			>
				<SpinnerIcon class="size-4 animate-spin" />
				{{ formatMessage(messages.loading) }}
			</div>
			<p
				v-else-if="!papers.length"
				class="m-0 rounded-lg border border-solid border-surface-5 bg-bg-raised p-4 text-sm text-secondary"
			>
				{{ formatMessage(messages.papersEmpty) }}
			</p>
			<div v-else class="grid gap-4 lg:grid-cols-2">
				<article
					v-for="paper in papers"
					:key="paper.id"
					class="flex flex-col gap-3 rounded-lg border border-solid border-surface-5 bg-bg-raised p-4"
				>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="m-0 truncate text-base font-bold text-contrast">
									{{ paper.title }}
								</h3>
								<span
									class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
									:class="paper.enabled ? 'bg-green text-contrast' : 'bg-button-bg text-secondary'"
								>
									{{ paper.enabled ? '✓' : '—' }}
								</span>
							</div>
							<p
								v-if="paper.annotation"
								class="m-0 mt-1 line-clamp-2 text-xs whitespace-pre-wrap text-secondary"
							>
								{{ paper.annotation }}
							</p>
						</div>
						<div class="flex shrink-0 gap-1">
							<button
								type="button"
								class="rounded-lg bg-button-bg px-2 py-1 text-xs font-semibold text-secondary hover:brightness-110"
								@click="copyPaperLink(paper.id)"
							>
								{{ formatMessage(messages.copyLink) }}
							</button>
							<button
								type="button"
								class="rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110"
								@click="editPaper(paper)"
							>
								{{ formatMessage(messages.editPaper) }}
							</button>
						</div>
					</div>
					<div class="flex flex-wrap gap-2 text-[11px] text-secondary">
						<span class="rounded-full bg-bg px-2 py-0.5">
							{{ paper.mode === 'AUTO' ? formatMessage(messages.modeAuto) : formatMessage(messages.modeManual) }}
						</span>
						<span class="rounded-full bg-bg px-2 py-0.5">{{ paper.questionCount }} 题</span>
						<span class="rounded-full bg-bg px-2 py-0.5">总分 {{ paper.totalScore }}</span>
						<span class="rounded-full bg-bg px-2 py-0.5">通过分 {{ paper.passScore }}</span>
						<span
							v-for="perm in paper.targetPermissions"
							:key="perm"
							class="rounded-full bg-brand/20 px-2 py-0.5 text-contrast"
						>
							{{ permissionLabel(perm) }}
						</span>
					</div>
					<div class="text-[11px] text-secondary">
						{{ formatDateTime(paper.updatedAt) }}
					</div>
				</article>
			</div>
		</template>

		<div
			v-if="detailOpen && detailSubmission"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			@click.self="closeDetail"
		>
			<div
				class="flex max-h-[85vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-xl bg-bg p-6"
			>
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<h3 class="m-0 text-lg font-bold text-contrast">
							{{ formatMessage(messages.details) }} · #{{ detailSubmission.id }}
						</h3>
						<p class="m-0 mt-1 text-sm text-secondary">
							{{ detailSubmission.applicantName }}
						</p>
					</div>
					<button
						type="button"
						class="shrink-0 rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110"
						@click="closeDetail"
					>
						✕
					</button>
				</div>

				<div class="flex flex-wrap items-center gap-2">
					<span
						class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
						:class="resultClass(detailSubmission.result)"
					>
						{{ resultLabel(detailSubmission.result) }}
					</span>
					<span
						class="rounded-full bg-button-bg px-2 py-0.5 text-[10px] font-semibold text-secondary"
					>
						{{ modeLabel(detailSubmission.mode) }}
					</span>
					<span
						v-if="detailSubmission.score !== null && detailSubmission.score !== undefined"
						class="text-xs text-contrast"
					>
						{{ formatMessage(messages.score) }}: {{ detailSubmission.score }}
					</span>
				</div>

				<div
					v-if="detailSubmission.context"
					class="flex flex-col gap-1 rounded-lg bg-bg-raised p-3 text-xs text-secondary"
				>
					<span class="font-semibold text-contrast">
						{{ formatMessage(messages.context) }}
					</span>
					<span> {{ formatMessage(messages.ip) }}: {{ detailSubmission.context.ip ?? '—' }} </span>
					<span class="break-all">
						{{ formatMessage(messages.userAgent) }}:
						{{ detailSubmission.context.userAgent }}
					</span>
					<span v-if="detailSubmission.context.activity">
						{{ formatMessage(messages.duration) }}:
						{{ formatDuration(detailSubmission.context.activity.durationMs) }} ·
						{{ formatMessage(messages.hiddenTime) }}:
						{{ formatDuration(detailSubmission.context.activity.hiddenMs) }} ·
						{{ formatMessage(messages.screenSwitches) }}:
						{{ detailSubmission.context.activity.screenSwitches }}
					</span>
				</div>

				<div class="flex flex-col gap-2">
					<span class="text-sm font-semibold text-contrast">
						{{ formatMessage(messages.answers) }}
					</span>
					<p
						v-if="!detailSubmission.answers || !detailSubmission.answers.length"
						class="m-0 text-xs text-secondary"
					>
						{{ formatMessage(messages.noAnswers) }}
					</p>
					<div v-else class="flex flex-col gap-2">
						<div
							v-for="(answer, idx) in detailSubmission.answers"
							:key="answer.questionId || idx"
							class="flex flex-col gap-1 rounded-lg border border-solid border-surface-5 bg-bg-raised p-3"
						>
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-sm font-semibold text-contrast">
									{{ idx + 1 }}.
									{{
										questionFor(detailSubmission, answer.questionId)?.title ||
										formatMessage(messages.questionNo, { n: idx + 1 })
									}}
								</span>
								<span
									v-if="questionFor(detailSubmission, answer.questionId)?.informationQuestion"
									class="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-contrast"
								>
									{{ questionFor(detailSubmission, answer.questionId)?.informationAlias || 'info' }}
								</span>
								<span
									v-if="questionFor(detailSubmission, answer.questionId)?.score !== undefined"
									class="text-xs text-secondary"
								>
									({{ formatMessage(messages.score) }}:
									{{ questionFor(detailSubmission, answer.questionId)?.score }})
								</span>
							</div>
							<span
								v-if="questionFor(detailSubmission, answer.questionId)?.annotation"
								class="text-[11px] whitespace-pre-wrap break-words text-secondary"
							>
								{{ questionFor(detailSubmission, answer.questionId)?.annotation }}
							</span>
							<span
								class="mt-1 rounded-lg bg-bg px-3 py-2 text-sm break-words whitespace-pre-wrap text-contrast"
							>
								{{ answerText(detailSubmission, answer) }}
							</span>
							<span
								v-if="answer.awardedScore !== null && answer.awardedScore !== undefined"
								class="text-xs text-secondary"
							>
								{{ formatMessage(messages.score) }}: {{ answer.awardedScore }}
							</span>
						</div>
					</div>
				</div>

				<div
					v-if="Object.keys(detailSubmission.automaticResults || {}).length"
					class="flex flex-col gap-1"
				>
					<span class="text-sm font-semibold text-contrast">
						{{ formatMessage(messages.autoChecks) }}
					</span>
					<div class="flex flex-wrap gap-2">
						<span
							v-for="(passed, key) in detailSubmission.automaticResults"
							:key="key"
							class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
							:class="passed ? 'bg-green text-contrast' : 'bg-red text-contrast'"
						>
							{{ key }}: {{ passed ? '✓' : '✗' }}
						</span>
					</div>
				</div>

				<div
					v-if="detailSubmission.decisionHistory && detailSubmission.decisionHistory.length"
					class="flex flex-col gap-1"
				>
					<span class="text-sm font-semibold text-contrast">
						{{ formatMessage(messages.history) }}
					</span>
					<div
						v-for="(h, idx) in detailSubmission.decisionHistory"
						:key="idx"
						class="rounded-lg bg-bg-raised p-2 text-xs text-secondary"
					>
						{{ h.reviewer }} · {{ resultLabel(h.result) }} ·
						{{ formatDateTime(h.at) }}
						<span v-if="h.reason"> · {{ h.reason }}</span>
					</div>
				</div>

				<div class="flex flex-col gap-2 border-t border-solid border-surface-5 pt-3">
					<input
						v-model="decisionFor(detailSubmission.id).reason"
						type="text"
						:placeholder="formatMessage(messages.reason)"
						class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
					/>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class="rounded-lg bg-green px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
							:disabled="
								decisionFor(detailSubmission.id).working || detailSubmission.result === 'PASSED'
							"
							@click="decide(detailSubmission, true)"
						>
							{{ formatMessage(messages.accept) }}
						</button>
						<button
							type="button"
							class="rounded-lg bg-red px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
							:disabled="
								decisionFor(detailSubmission.id).working || detailSubmission.result === 'REJECTED'
							"
							@click="decide(detailSubmission, false)"
						>
							{{ formatMessage(messages.reject) }}
						</button>
						<button
							type="button"
							class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110"
							@click="regenerateInvite(detailSubmission)"
						>
							{{ formatMessage(messages.regenInvite) }}
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>

		<div
			v-if="paperEditorOpen"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			@click.self="paperEditorOpen = false"
		>
			<div
				class="flex max-h-[90vh] w-full max-w-4xl flex-col gap-4 overflow-y-auto rounded-xl bg-bg p-6"
			>
				<div class="flex items-start justify-between gap-3">
					<h3 class="m-0 text-lg font-bold text-contrast">
						{{ editingPaperId ? formatMessage(messages.editPaper) : formatMessage(messages.newPaper) }}
					</h3>
					<button
						type="button"
						class="shrink-0 rounded-lg bg-button-bg px-3 py-1 text-xs font-semibold text-contrast hover:brightness-110"
						@click="paperEditorOpen = false"
					>
						✕
					</button>
				</div>

				<div class="grid gap-4 lg:grid-cols-2">
					<label class="flex flex-col gap-1">
						<span class="text-xs font-semibold text-secondary">
							{{ formatMessage(messages.paperTitle) }}
						</span>
						<input
							v-model="paperForm.title"
							type="text"
							class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
						/>
					</label>
					<label class="flex flex-col gap-1">
						<span class="text-xs font-semibold text-secondary">
							{{ formatMessage(messages.paperAnnotation) }}
						</span>
						<textarea
							v-model="paperForm.annotation"
							rows="2"
							class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
						></textarea>
					</label>
				</div>

				<div class="grid gap-4 sm:grid-cols-3">
					<label class="flex flex-col gap-1">
						<span class="text-xs font-semibold text-secondary">
							{{ formatMessage(messages.paperMode) }}
						</span>
						<select
							v-model="paperForm.mode"
							class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
						>
							<option value="AUTO">{{ formatMessage(messages.modeAuto) }}</option>
							<option value="MANUAL">{{ formatMessage(messages.modeManual) }}</option>
						</select>
					</label>
					<label class="flex flex-col gap-1">
						<span class="text-xs font-semibold text-secondary">
							{{ formatMessage(messages.paperPassScore) }}
						</span>
						<input
							v-model.number="paperForm.passScore"
							type="number"
							min="1"
							:max="totalScore || undefined"
							class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
						/>
						<span class="text-[11px] text-secondary">当前总分 {{ totalScore }}</span>
					</label>
					<label class="flex items-center gap-2 pt-5">
						<input v-model="paperForm.enabled" type="checkbox" class="size-4" />
						<span class="text-sm text-contrast">{{ formatMessage(messages.paperEnabled) }}</span>
					</label>
				</div>

				<div class="flex flex-col gap-2">
					<span class="text-xs font-semibold text-secondary">
						{{ formatMessage(messages.paperTargetPermissions) }}
					</span>
					<div
						class="flex flex-wrap items-center gap-3 rounded-lg border border-solid border-surface-5 bg-bg-raised px-3 py-2"
					>
						<label
							v-for="perm in availablePermissions"
							:key="'t-' + perm.value"
							class="flex cursor-pointer items-center gap-1.5 text-xs text-contrast"
						>
							<input v-model="paperForm.targetPermissions" type="checkbox" :value="perm.value" class="size-3.5" />
							{{ perm.label }}
						</label>
					</div>
				</div>

				<div class="flex flex-col gap-2 rounded-lg border border-solid border-surface-5 p-3">
					<label class="flex cursor-pointer items-center gap-2">
						<input v-model="prerequisiteEnabled" type="checkbox" class="size-4" />
						<span class="text-sm font-semibold text-contrast">设置前置身份</span>
					</label>
					<div v-if="prerequisiteEnabled" class="flex flex-col gap-2 pt-1">
						<div class="flex flex-wrap items-end gap-3">
							<label class="flex flex-col gap-1">
								<span class="text-[11px] text-secondary">判断方式</span>
								<select
									v-model="paperForm.prerequisiteMode"
									class="rounded-lg border border-solid border-surface-5 bg-bg px-2 py-1 text-xs text-contrast outline-none focus:border-brand"
								>
									<option value="ANY">满足任一</option>
									<option value="ALL">满足全部</option>
								</select>
							</label>
							<div
								class="flex flex-1 flex-wrap items-center gap-3 rounded-lg border border-solid border-surface-5 bg-bg px-3 py-2"
							>
								<label
									v-for="perm in prerequisitePermissionOptions"
									:key="'p-' + perm.value"
									class="flex cursor-pointer items-center gap-1.5 text-xs text-contrast"
								>
									<input
										v-model="paperForm.prerequisitePermissions"
										type="checkbox"
										:value="perm.value"
										class="size-3.5"
									/>
									{{ perm.label }}
								</label>
							</div>
						</div>
					</div>
				</div>

				<label class="flex cursor-pointer items-center gap-2 rounded-lg border border-solid border-surface-5 p-3">
					<input v-model="paperForm.preventDuplicate" type="checkbox" class="size-4" />
					<span class="text-sm font-semibold text-contrast">
						{{ formatMessage(messages.preventDuplicate) }}
					</span>
				</label>

				<div class="flex flex-col gap-2 rounded-lg border border-solid border-surface-5 p-3">
					<label class="flex cursor-pointer items-center gap-2">
						<input v-model="paperForm.mail!.enabled" type="checkbox" class="size-4" />
						<span class="text-sm font-semibold text-contrast">
							{{ formatMessage(messages.mailEnabled) }}
						</span>
					</label>
					<div v-if="paperForm.mail!.enabled" class="flex flex-col gap-3 pt-1">
						<label class="flex flex-col gap-1">
							<span class="text-[11px] text-secondary">
								{{ formatMessage(messages.mailSubject) }}
							</span>
							<input
								v-model="paperForm.mail!.subject"
								type="text"
								class="rounded-lg border border-solid border-surface-5 bg-bg px-3 py-1.5 text-sm text-contrast outline-none focus:border-brand"
							/>
						</label>
						<label class="flex flex-col gap-1">
							<span class="text-[11px] text-secondary">
								{{ formatMessage(messages.mailMessage) }}
							</span>
							<textarea
								v-model="paperForm.mail!.message"
								rows="4"
								class="rounded-lg border border-solid border-surface-5 bg-bg px-3 py-1.5 text-sm text-contrast outline-none focus:border-brand"
							></textarea>
						</label>
						<label class="flex flex-col gap-1">
							<span class="text-[11px] text-secondary">
								{{ formatMessage(messages.mailExtra) }}
							</span>
							<textarea
								v-model="paperForm.mail!.extraText"
								rows="2"
								class="rounded-lg border border-solid border-surface-5 bg-bg px-3 py-1.5 text-xs text-contrast outline-none focus:border-brand"
							></textarea>
						</label>
						<label class="flex cursor-pointer items-center gap-2 text-xs text-contrast">
							<input v-model="paperForm.mail!.includeInviteCode" type="checkbox" class="size-3.5" />
							{{ formatMessage(messages.mailIncludeInvite) }}
						</label>
					</div>
				</div>

				<div class="flex flex-wrap items-center justify-between gap-2 border-t border-solid border-surface-5 pt-3">
					<span class="text-sm font-semibold text-contrast">
						{{ formatMessage(messages.paperQuestions) }} ({{ paperForm.questions.length }})
					</span>
					<select
						class="rounded-lg border border-solid border-surface-5 bg-bg-raised px-2 py-1.5 text-xs text-contrast outline-none focus:border-brand"
						@change="onQuestionTypeSelected"
					>
						<option value="">{{ formatMessage(messages.addQuestion) }}…</option>
						<option v-for="t in availableQuestionTypes()" :key="t" :value="t">
							{{ questionTypeOptions.find((q) => q.value === t)?.label }}
						</option>
					</select>
				</div>

				<p
					v-if="!paperForm.questions.length"
					class="m-0 rounded-lg bg-bg-raised p-3 text-xs text-secondary"
				>
					还没有题目，请从上方下拉框添加。
				</p>

				<article
					v-for="(question, qIndex) in paperForm.questions"
					:key="question.id"
					class="flex flex-col gap-3 rounded-lg border border-solid border-surface-5 bg-bg-raised p-4"
				>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div class="flex flex-wrap items-center gap-2">
							<span class="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-contrast">
								{{ qIndex + 1 }}
							</span>
							<span class="text-xs font-semibold text-contrast">
								{{ questionTypeOptions.find((q) => q.value === question.type)?.label }}
							</span>
							<span v-if="question.optional" class="rounded-full bg-button-bg px-2 py-0.5 text-[10px] text-secondary">
								选答
							</span>
							<span v-if="question.fatal" class="rounded-full bg-red px-2 py-0.5 text-[10px] text-contrast">
								生死题
							</span>
						</div>
						<div class="flex gap-1">
							<button
								type="button"
								class="rounded bg-button-bg px-2 py-1 text-[11px] text-secondary disabled:opacity-40"
								:disabled="qIndex === 0"
								@click="moveQuestion(qIndex, -1)"
							>
								↑
							</button>
							<button
								type="button"
								class="rounded bg-button-bg px-2 py-1 text-[11px] text-secondary disabled:opacity-40"
								:disabled="qIndex === paperForm.questions.length - 1"
								@click="moveQuestion(qIndex, 1)"
							>
								↓
							</button>
						<button
							type="button"
							class="rounded-lg bg-red/20 px-2 py-1 text-[11px] font-semibold text-red hover:brightness-110"
							@click="removeQuestion(qIndex)"
						>
							{{ formatMessage(messages.removeQuestion) }}
						</button>
						</div>
					</div>

					<div class="grid gap-3 lg:grid-cols-[1fr_7rem]">
						<label class="flex flex-col gap-1">
							<span class="text-[11px] text-secondary">{{ formatMessage(messages.questionTitle) }}</span>
							<textarea
								v-model="question.title"
								rows="2"
								class="rounded-lg border border-solid border-surface-5 bg-bg px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
							></textarea>
						</label>
						<label class="flex flex-col gap-1">
							<span class="text-[11px] text-secondary">{{ formatMessage(messages.questionScore) }}</span>
							<input
								v-model.number="question.score"
								type="number"
								min="0"
								class="rounded-lg border border-solid border-surface-5 bg-bg px-3 py-2 text-sm text-contrast outline-none focus:border-brand"
							/>
						</label>
					</div>

					<label class="flex flex-col gap-1">
						<span class="text-[11px] text-secondary">{{ formatMessage(messages.questionAnnotation) }}</span>
						<textarea
							v-model="question.annotation"
							rows="1"
							class="rounded-lg border border-solid border-surface-5 bg-bg px-3 py-1.5 text-xs text-contrast outline-none focus:border-brand"
						></textarea>
					</label>

					<div class="flex flex-wrap items-center gap-4">
						<label class="flex cursor-pointer items-center gap-1.5 text-xs text-contrast">
							<input v-model="question.informationQuestion" type="checkbox" class="size-3.5" />
							信息题
						</label>
						<input
							v-if="question.informationQuestion"
							v-model="question.informationAlias"
							type="text"
							placeholder="信息代称，如 QQ 号"
							class="rounded-lg border border-solid border-surface-5 bg-bg px-2 py-1 text-xs text-contrast outline-none focus:border-brand"
						/>
						<label
							v-if="paperForm.mode === 'MANUAL'"
							class="flex cursor-pointer items-center gap-1.5 text-xs text-contrast"
						>
							<input v-model="question.optional" type="checkbox" class="size-3.5" @change="setOptionalQuestion(question)" />
							选答题
						</label>
						<label v-if="supportsFatal(question)" class="flex cursor-pointer items-center gap-1.5 text-xs text-contrast">
							<input v-model="question.fatal" type="checkbox" class="size-3.5" @change="setFatalQuestion(question)" />
							生死题
						</label>
						<label
							v-if="paperForm.mode === 'MANUAL' && !question.optional && supportsAutoReview(question)"
							class="flex cursor-pointer items-center gap-1.5 text-xs text-contrast"
						>
							<input v-model="question.autoReview" type="checkbox" class="size-3.5" :disabled="question.fatal" />
							自动批复
						</label>
					</div>

					<div v-if="isChoice(question)" class="flex flex-col gap-2">
						<div class="flex items-center justify-between">
							<span class="text-xs font-semibold text-contrast">选项</span>
							<button
								v-if="question.type !== 'TRUE_FALSE'"
								type="button"
								class="rounded-lg bg-button-bg px-2 py-1 text-[11px] font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
								:disabled="(question.options?.length ?? 0) >= 10"
								@click="addOption(question)"
							>
								{{ formatMessage(messages.addOption) }}
							</button>
						</div>
						<label
							v-if="question.type === 'MULTIPLE' && isAutomaticallyReviewed(question)"
							class="flex flex-col gap-1"
						>
							<span class="text-[11px] text-secondary">多选题计分模式</span>
							<select
								v-model="question.multipleScoreMode"
								class="rounded-lg border border-solid border-surface-5 bg-bg px-2 py-1 text-xs text-contrast outline-none focus:border-brand"
							>
								<option v-for="m in multipleScoreModeOptions" :key="m.value" :value="m.value">
									{{ m.label }}
								</option>
							</select>
						</label>
						<div
							v-for="(option, optionIndex) in question.options"
							:key="option.id"
							class="grid items-center gap-2 sm:grid-cols-[auto_1fr_auto]"
						>
							<div class="flex flex-col gap-1">
								<label class="flex items-center gap-1 text-[11px] text-contrast">
									<input
										v-model="option.defaultSelected"
										type="checkbox"
										class="size-3"
										@change="setDefaultOption(question, option.id)"
									/>
									默认
								</label>
								<label
									v-if="paperForm.mode === 'AUTO' || question.autoReview"
									class="flex items-center gap-1 text-[11px] text-contrast"
								>
									<input
										v-if="question.type === 'MULTIPLE'"
										v-model="option.correct"
										type="checkbox"
										class="size-3"
									/>
									<input
										v-else
										type="radio"
										class="size-3"
										:name="'correct-' + question.id"
										:checked="option.correct"
										@change="setCorrectOption(question, option.id)"
									/>
									正确
								</label>
								<label
									v-if="showOptionScore(question)"
									class="flex items-center gap-1 text-[11px] text-contrast"
								>
									<span class="shrink-0">{{ option.correct ? '得分' : '扣分' }}</span>
									<input
										v-model.number="option.score"
										type="number"
										min="0"
										:max="question.score"
										step="0.1"
										class="w-16 rounded-lg border border-solid border-surface-5 bg-bg px-1.5 py-0.5 text-xs text-contrast"
									/>
								</label>
							</div>
							<input
								v-model="option.description"
								type="text"
								:placeholder="'选项 ' + (optionIndex + 1)"
								class="rounded-lg border border-solid border-surface-5 bg-bg px-2 py-1 text-xs text-contrast outline-none focus:border-brand"
							/>
							<div class="flex gap-1">
								<button
									type="button"
									class="rounded bg-button-bg px-1.5 py-0.5 text-[10px] text-secondary disabled:opacity-40"
									:disabled="optionIndex === 0"
									@click="moveOption(question, optionIndex, -1)"
								>
									↑
								</button>
								<button
									type="button"
									class="rounded bg-button-bg px-1.5 py-0.5 text-[10px] text-secondary disabled:opacity-40"
									:disabled="optionIndex === (question.options?.length ?? 0) - 1"
									@click="moveOption(question, optionIndex, 1)"
								>
									↓
								</button>
								<button
									v-if="question.type !== 'TRUE_FALSE'"
									type="button"
									class="rounded bg-red/20 px-1.5 py-0.5 text-[10px] text-red disabled:opacity-40"
									:disabled="(question.options?.length ?? 0) <= 2"
									@click="removeOption(question, optionIndex)"
								>
									✕
								</button>
							</div>
						</div>
					</div>

					<div
						v-if="question.type === 'FILL' || question.type === 'ESSAY'"
						class="grid gap-3 sm:grid-cols-[8rem_1fr]"
					>
						<label class="flex flex-col gap-1">
							<span class="text-[11px] text-secondary">作答字数上限</span>
							<input
								v-model.number="question.maxLength"
								type="number"
								min="1"
								:max="question.type === 'FILL' ? 150 : 300"
								class="rounded-lg border border-solid border-surface-5 bg-bg px-2 py-1 text-xs text-contrast"
							/>
						</label>
						<label v-if="paperForm.mode === 'AUTO' || question.autoReview" class="flex flex-col gap-1">
							<span class="text-[11px] text-secondary">标准答案（完全一致才判正确）</span>
							<input
								v-model="question.answer"
								type="text"
								class="rounded-lg border border-solid border-surface-5 bg-bg px-2 py-1 text-xs text-contrast outline-none focus:border-brand"
							/>
						</label>
					</div>
				</article>

				<div class="flex justify-end gap-2 border-t border-solid border-surface-5 pt-3">
					<button
						type="button"
						class="rounded-lg bg-button-bg px-4 py-2 text-sm font-semibold text-secondary hover:brightness-110"
						@click="paperEditorOpen = false"
					>
						取消
					</button>
					<button
						type="button"
						class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-contrast hover:brightness-110 disabled:opacity-50"
						:disabled="paperSaving"
						@click="savePaper"
					>
						{{ paperSaving ? formatMessage(messages.loading) : '保存' }}
					</button>
				</div>
			</div>
		</div>


</template>
