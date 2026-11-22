export type HostedInstallErrorKind =
	| 'login'
	| 'account'
	| 'access'
	| 'network'
	| 'runtime'
	| 'storage'
	| 'disk-space'
	| 'permission'
	| 'busy'
	| 'integrity'
	| 'conflict'
	| 'configuration'
	| 'recovery'
	| 'manual-download'
	| 'unknown'

export function hostedErrorMessage(cause: unknown): string {
	const message =
		typeof cause === 'string'
			? cause
			: cause !== null && typeof cause === 'object' && 'message' in cause
				? cause.message
				: undefined
	// Do not stringify arbitrary objects: they can contain credentials or request data.
	return typeof message === 'string' && message.trim() ? message.trim() : 'Unknown error'
}

/** Classify final operation failures only, after any automatic retry or recovery. */
export function classifyHostedInstallError(cause: unknown): HostedInstallErrorKind | null {
	const message = hostedErrorMessage(cause)
	// Recovery failure takes precedence even when the original cause was cancellation.
	if (
		/recovery (?:failed|is pending)|Invalid modpack recovery directory|Recovery journal belongs|恢复[^\n]*失败/i.test(
			message,
		)
	)
		return 'recovery'

	const detail = message.replace(/^(?:(?:Error|Invalid input):\s*)+/i, '')
	if (
		/^已停止整合包下载(?:[；;]|$)/.test(detail) ||
		/^Minecraft 游戏组件安装失败：(?:安装任务已取消|Install was canceled)(?:[；;]|$)/.test(
			detail,
		) ||
		detail === '任务状态已变化或正在应用安装文件，当前操作不可用' ||
		detail === '整合包下载任务已结束，请重试'
	)
		return null

	if (message.includes('您需要登录正版或皮肤站账号后才能操作')) return 'account'
	// A refused pack endpoint alone does not establish that the skin-site login expired.
	if (/皮肤站登录有效|无法确认登录状态|无法复核登录状态|整合包接口拒绝访问/.test(message))
		return 'access'
	if (
		/均拒绝登录凭据|请先(?:在启动器中)?登录 StarLight 皮肤站|StarLight 登录凭据(?:无效|不可用)|StarLight 登录状态(?:需要刷新|已变化)/.test(
			message,
		)
	)
		return 'login'
	if (/\bHTTP\s+(?:401|403)\b/.test(message) && !message.includes('Minecraft 游戏组件安装失败')) {
		return 'access'
	}

	if (
		/no space left on device|disk (?:is )?full|not enough space on the disk|磁盘空间不足|磁盘已满|\bENOSPC\b/i.test(
			message,
		)
	)
		return 'disk-space'
	if (
		/permission denied|access is denied|拒绝访问|没有写入权限|无写入权限|\bEACCES\b|\bEPERM\b/i.test(
			message,
		)
	)
		return 'permission'
	if (
		/Close Minecraft before synchronizing|请先关闭该实例的所有游戏窗口|An installation is already using this instance|此实例已有整合包下载任务|being used by another process|另一个程序正在使用此文件|文件被占用|\bEBUSY\b/i.test(
			message,
		)
	)
		return 'busy'
	if (/requires a manual download|需要手动下载/i.test(message)) return 'manual-download'
	if (message.includes('Minecraft 游戏组件安装失败')) return 'runtime'

	if (
		/管理员尚未指定已发布的默认整合包|Invalid modpack (?:ID|publication)|Server returned an older modpack publication|Modpack loader version is unavailable|Unsafe modpack path|Modpack has too many files|Invalid hash, size or duplicate modpack path|Modpack file\/directory conflict|Missing modpack download source|Invalid CurseForge filename|CurseForge file has no SHA-1|category=json|JSON response error|标签 Mod (?:数量过多|清单包含无效或重复标识|缺少完整的 Mod 标识|包含无效标识|存在重复标识|替换路径无效)/i.test(
			message,
		)
	)
		return 'configuration'
	if (
		/failed verification|hash (?:mismatch|error)|Incorrect Sha1 hash for download|checksum|校验失败|校验不通过|CurseForge returned a mismatched file/i.test(
			message,
		)
	)
		return 'integrity'
	if (
		/Existing file conflicts with the modpack|File changed during sync|Case-only filename changes|Modpack path is a (?:junction or )?symlink|重复声明了|标签 Mod 与整合包文件冲突|旧 JAR 同时包含多个 Mod|不能开启 StarLight 自动同步|Hosted modpacks require a launcher-managed instance/i.test(
			message,
		)
	)
		return 'conflict'
	if (
		/StarLight metadata request failed|StarLight 服务端请求失败|下载整合包文件失败|\bHTTP\s+[45]\d\d\b|\bnetwork\b|\btimeout\b|timed out|connection (?:failed|refused|reset)|error sending request|网络|连接失败|连接超时|下载中断/i.test(
			message,
		)
	)
		return 'network'
	if (
		/\bI\/O\b|\bIO error\b|创建[^\n]*失败|写入[^\n]*失败|复制整合包缓存文件失败|备份整合包文件失败|同步[^\n]*临时文件失败|提交[^\n]*失败|检查整合包目标文件失败|应用 StarLight 整合包文件失败|扫描 StarLight 整合包内容失败|清理 StarLight 整合包安装日志失败|Missing Mod cache directory/i.test(
			message,
		)
	)
		return 'storage'

	return 'unknown'
}
