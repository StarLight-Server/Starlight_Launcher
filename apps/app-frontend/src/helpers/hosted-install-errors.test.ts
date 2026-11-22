import assert from 'node:assert/strict'
import test from 'node:test'

import {
	classifyHostedInstallError,
	hostedErrorMessage,
	type HostedInstallErrorKind,
} from './hosted-install-errors.ts'

test('error messages survive Error, Tauri and plain string boundaries', () => {
	for (const cause of [
		new Error('Connection failed'),
		{ message: 'Connection failed' },
		'Connection failed',
	]) {
		assert.equal(hostedErrorMessage(cause), 'Connection failed')
	}
	assert.equal(hostedErrorMessage({ message: '  下载失败  ', field_name: 'network' }), '下载失败')
	assert.equal(hostedErrorMessage({ token: 'must-not-be-shown' }), 'Unknown error')
	assert.equal(hostedErrorMessage(null), 'Unknown error')
})

const cases: [string, HostedInstallErrorKind | null][] = [
	['Invalid input: 已停止整合包下载；已下载的缓存会保留，可重试继续', null],
	['Minecraft 游戏组件安装失败：安装任务已取消；请在“下载”中查看详情后重试', null],
	['Minecraft 游戏组件安装失败：Install was canceled；请在“下载”中查看详情后重试', null],
	[
		'Invalid input: Minecraft 游戏组件安装失败：Install was canceled；请在“下载”中查看详情后重试',
		null,
	],
	['任务状态已变化或正在应用安装文件，当前操作不可用', null],
	['整合包下载任务已结束，请重试', null],
	['您需要登录正版或皮肤站账号后才能操作', 'account'],
	['请先在启动器中登录 StarLight 皮肤站，再下载整合包。', 'login'],
	['StarLight 登录凭据不可用，请重新登录。', 'login'],
	['StarLight 登录状态已变化，请重试整合包同步', 'login'],
	[
		'整合包和用户接口均拒绝登录凭据（用户接口 HTTP 401）。请重新登录；若仍失败，请检查服务端鉴权及 CDN 配置',
		'login',
	],
	[
		'皮肤站登录有效，但整合包接口返回错误，且没有提供具体原因。请用请求编号查询服务端或 CDN 日志（整合包 HTTP 403）',
		'access',
	],
	['整合包接口拒绝访问，暂时无法复核登录状态（用户接口 HTTP 503）', 'access'],
	['整合包接口拒绝访问，用户接口返回内容异常，无法确认登录状态', 'access'],
	['HTTP 401 for GET https://example.test/mods/abc.jar', 'access'],
	['StarLight 服务端返回：拒绝访问（整合包 HTTP 403；接口 /default）', 'access'],
	['Minecraft 游戏组件安装失败：HTTP 403 for GET https://example.test/file', 'runtime'],
	['整合包接口拒绝访问（整合包 HTTP 403）', 'access'],
	['StarLight 服务端返回：此整合包暂不开放下载（整合包 HTTP 403）', 'access'],
	[
		'StarLight metadata request failed: stage=send; category=timeout; cause=operation timed out',
		'network',
	],
	['下载整合包文件失败：mods/example.jar: HTTP 404 for GET https://example.test/file', 'network'],
	['StarLight 服务端请求失败（整合包 HTTP 502；接口 /default）', 'network'],
	[
		'Minecraft 游戏组件安装失败：HTTP 404 for GET https://libraries.minecraft.net/missing.jar；请在“下载”中查看详情后重试',
		'runtime',
	],
	['Minecraft 游戏组件安装失败：安装任务意外中断；请在“下载”中查看详情后重试', 'runtime'],
	[
		'应用 StarLight 整合包文件失败；实例目录：D:\\Games\\StarLight: No space left on device (os error 28)',
		'disk-space',
	],
	['Minecraft 游戏组件安装失败：磁盘空间不足。 (os error 112)', 'disk-space'],
	[
		'提交整合包文件失败；临时文件：temp；目标文件：mods/test.jar: Access is denied. (os error 5)',
		'permission',
	],
	['应用 StarLight 整合包文件失败；实例目录：D:\\Games: 拒绝访问。 (os error 5)', 'permission'],
	['应用 StarLight 整合包文件失败；实例目录：D:\\Games: I/O error', 'storage'],
	['Close Minecraft before synchronizing its modpack', 'busy'],
	['请先关闭该实例的所有游戏窗口，再同步整合包', 'busy'],
	['An installation is already using this instance', 'busy'],
	['此实例已有整合包下载任务', 'busy'],
	[
		'The process cannot access the file because it is being used by another process. (os error 32)',
		'busy',
	],
	['Cached CurseForge file failed verification', 'integrity'],
	['Hash mismatch: expected abc, got def', 'integrity'],
	[
		'下载整合包文件失败：mods/example.jar: Incorrect Sha1 hash for download: abc != def',
		'integrity',
	],
	['Existing file conflicts with the modpack: mods/test.jar. Use an empty instance.', 'conflict'],
	[
		'保留的 Mod「mods/one.jar」与整合包文件「mods/two.jar」重复声明了「example」。请先统一 AutoModSync 与整合包的版本或规则，再重试。',
		'conflict',
	],
	['标签 Mod 与整合包文件冲突：mods/example.jar', 'conflict'],
	['File changed during sync: config/example.toml', 'conflict'],
	['管理员尚未指定已发布的默认整合包，请联系服务器管理员', 'configuration'],
	['Modpack loader version is unavailable for this Minecraft version', 'configuration'],
	['Invalid hash, size or duplicate modpack path', 'configuration'],
	[
		'StarLight metadata request failed: stage=decode; category=json; JSON response error: kind=Data',
		'configuration',
	],
	['This CurseForge file requires a manual download', 'manual-download'],
	[
		'Sync failed: 已停止整合包下载；已下载的缓存会保留，可重试继续; recovery failed: Access is denied. Retry before launching.',
		'recovery',
	],
	[
		'Sync failed: download failed; recovery is pending until the active installation stops: An installation is already using this instance',
		'recovery',
	],
	['Unexpected local database failure', 'unknown'],
]

for (const [message, expected] of cases) {
	test(`classifies final hosted failure as ${expected ?? 'silent'}: ${message}`, () => {
		assert.equal(classifyHostedInstallError({ message }), expected)
	})
}

test('unrelated error details mentioning cancellation do not hide a real failure', () => {
	assert.equal(classifyHostedInstallError('Failed to parse mods/canceled.jar'), 'unknown')
	assert.equal(classifyHostedInstallError('恢复安装前的文件失败：安装任务已取消'), 'recovery')
	assert.equal(
		classifyHostedInstallError(
			'Sync failed: Minecraft 游戏组件安装失败：Install was canceled；请在“下载”中查看详情后重试; recovery failed: Access is denied. Retry before launching.',
		),
		'recovery',
	)
})
