# 托管整合包与增量同步

皮肤站后台的「Mod 管理 → 管理整合包」接收完整 ZIP。上传后产生草稿，先显示新增、修改、删除、覆盖策略、游戏组件和启动参数的变化。管理员选择「认可变更并发布」后，发布状态与审计记录在同一数据库事务提交，用户才可获取该版本。更新时需要选择已有整合包；与当前版本内容相同的 ZIP 不产生新版本。

启动器支持两种实例类型，可在创建页、实例设置或「Mod → 管理整合包」中选择：

- **StarLight 实例**：自动同步 StarLight 服务器发布的变更，游玩 StarLight 服务器必选。创建时直接拉取管理员指定的默认整合包，自动安装对应的游戏版本和加载器，不提供版本选择。每次启动必须登录 StarLight 皮肤站并联网检查，先完成增量更新再启动；检查或下载失败时停止启动，不提供跳过检查的离线启动。
- **本地实例**：跳过 StarLight 同步检查，启动更快，可自选整合包，适合第三方服务器和本地个人游玩。切换为本地时保留已有文件、存档和官方整合包绑定，停止后续自动同步；重新切回 StarLight 时先按服务器默认整合包完成安装，成功后才保存类型；失败时保留原类型。

类型保存在实例配置的 `launch_overrides.instance_mode`（`starlight` / `local`），随配置保存、复制和恢复。不需要数据库结构迁移。兼容没有该字段的旧实例：存在官方整合包绑定则按 StarLight 实例处理，否则按本地实例处理。新建实例默认显式保存为本地类型；从其他启动器导入（包括旧 StarLight / Axolotl 配置）也按本地实例处理。外部关联、共享目录和第三方平台管理的实例不能开启 StarLight 自动同步。

同一实例的类型切换、同步和启动准备互斥，锁保持到游戏进程创建完成。不同实例不互相等待，本地实例启动不请求 StarLight 更新。新手引导在创建方式之前介绍类型选择；创建页、实例设置和 Mod 管理共用类型选择组件。

两端内容切换栏初始为 Mod，保存各自上次选择。StarLight 创建入口一键安装，安装状态和原实例 ID 跨页面保留，失败可重试原实例；完成后进入实例详情。整合包管理仅显示服务器指定内容和检查/重试入口，不允许玩家换包、换游戏版本或加载器。

## ZIP 格式依据

- [HMCL 的 MCBBS 清单实现](https://github.com/HMCL-dev/HMCL/blob/main/HMCLCore/src/main/java/org/jackhuang/hmcl/modpack/mcbbs/McbbsModpackManifest.java)：优先识别 `mcbbs.packmeta`，兼容带 `addons` 的旧 `manifest.json`；安装 `overrides/` 文件，校验 `addon` 的 SHA-1，保留 `force` 策略，解析 CurseForge 文件引用与启动参数。
- [MultiMC 官方导出说明](https://github.com/MultiMC/Launcher/wiki/Export-Instance)：识别 `instance.cfg`、`mmc-pack.json` 的标准组件，以及 `.minecraft/` 或旧 `minecraft/` 内容目录。支持单层或多层外包目录，只允许 ZIP 内有一个明确的实例。
- 两种来源均支持原版、Forge、NeoForge、Fabric、Quilt 主加载器。MultiMC 的自定义 `patches`、`jarmods`、支持库、启动脚本、覆盖 JVM 参数，以及 MCBBS 自定义支持库和未适配组件会明确拒绝。它们需要另外的运行配置适配，不能被静默忽略。

## 差异协议

外部 ZIP 只作为导入格式。服务端生成统一清单：运行组件、启动参数、文件相对路径、SHA-256、字节数、覆盖策略和外部文件引用。对比解压后的内容，不比较 ZIP 二进制、时间戳或压缩率。

每个新增或变化的文件作为一个完整对象传输，未变化文件不下载。这里的粒度是文件级，不是 JAR 内的二进制补丁。对象按 SHA-256 去重；发布版本可直接从任意旧版本更新，不要求逐个应用中间补丁。CurseForge 引用通过启动器现有接口解析并校验下载，复用已有本地文件或缓存。

路由前缀为 `/starlight/mod/packs`。所有玩家读取路由均要求 `Authorization: Bearer <token>`，接受有效的站内登录 JWT 或有效的本站 Yggdrasil 玩家 access token（沿用账号封禁、撤销、过期检查）。下载为 `private, no-store`，Range 和条件请求同样先经过鉴权。启动器凭据仅用于固定的本站 API/文件地址，不传给 CurseForge 等外部下载源。启动器通过内嵌皮肤站的受限消息桥按需取得当前 JWT，原生下载端只在内存中短暂持有；退出、切换账号或会话断开时清除。安装、切换为 StarLight 和启动前更新均使用站内 JWT，不依赖所选 Minecraft 玩家。游戏启动身份由游戏登录流程单独处理。认证采用 Ktor 的 [FirstSuccessful 多提供器校验](https://api.ktor.io/ktor-server/ktor-server-plugins/ktor-server-auth/io.ktor.server.auth/-authentication-strategy/index.html)。

管理员必须在「Mod 管理 → 管理整合包」指定一个已审核发布的默认包；没有默认包时明确报错，不猜测列表顺序。默认包随该包最新已审核版本更新；管理员切换默认包后，已有 StarLight 实例下次同步会迁移至新默认包，并继续遵守旧文件删除及个人文件保留规则。

| 请求 | 内容 |
| --- | --- |
| `GET /` | 每个整合包的最新已发布版本 |
| `GET /default` | 管理员指定整合包的最新已发布版本（未设置时为 null） |
| `GET /sync-state` | 默认包标志 `packId:releaseId`，只查询已发布版本，不读取完整清单 |
| `GET /tagged-mods/{releaseId}` | 当前整合包 Mod 标签的文件清单及需要覆盖的包内 Mod 路径 |
| `GET /tagged-files/{sha256}` | 已登记的标签 Mod 不可变快照，仍须有效登录 token |
| `GET /admin/mod-tag` / `POST /admin/mod-tag` | 读取或保存整合包 Mod 标签，保存同时记录管理员审计 |
| `GET /{packId}` | 指定整合包的最新已发布清单 |
| `GET /files/{releaseId}/{sha256}` | 该已发布版本中存在的文件对象 |
| `GET /admin` | 管理员的草稿和版本记录 |
| `GET /admin/default` | 当前默认整合包 |
| `POST /admin/default/{packId}` | 指定已发布默认包并写入审计 |
| `POST /admin/upload?version=...&packId=...` | 上传一个完整 ZIP；新建时省略 `packId` |
| `POST /admin/{id}/publish` | 认可变更、写入审计并发布 |
| `DELETE /admin/{id}` | 撤销未发布草稿 |

数据表为 `launcher_modpack_release`、`launcher_modpack_audit`，新增的 `launcher_modpack_default_audit` 保存默认包选择及管理员、时间。默认设置成功的同一条持久化审计记录即成为新的默认来源，不修改历史发布审计。文件位于 `runtimeUpdatePath` 同级的 `launcher-modpacks/objects`，不能直接挂载为公共静态目录。对象下载必须同时满足登录校验、已发布状态和清单成员校验。重复发布同一草稿不重复写入审计；发布基线已变化的旧草稿不能发布。

## 本地应用与恢复

实例保存 `.starlight-pack.json` 作为上次同步清单。先验证并缓存全部变动文件，再通过持久化操作记录替换文件；失败或中断后恢复已替换的旧文件和实例配置。安装任务尚未停止时不开始恢复。运行中的游戏禁止同步。

成功同步后才保存 `syncMarker`。每次启动先请求轻量标志；本地标志、包 ID、发布 ID 均匹配且实例已安装时，复用本地包清单与加载器信息，跳过整合包清单请求及未变化包文件的哈希检查。首次使用、缺少标志、安装失败、发布新版本或切换默认包均不能走此捷径。草稿上传不改变标志。本地整合包文件的手动改动不会因为标志相同而触发完整修复。

管理员在「Mod 管理 → 管理整合包 → 整合包 Mod 标签」选择已有常用标签。标签按现有规则集合匹配 Mod，每次启动独立获取最新清单并检查标签文件 SHA-256；包标志相同也不跳过这一步。服务端保存内容快照，上传新 Mod 不会破坏正在下载的旧快照。设置审计保存于 `launcher_modpack_tag_audit`，快照登记于 `launcher_tagged_mod_object`，文件位于 `launcher-modpacks/tagged-mods`，不得公开挂载。

整合包自带 Mod 是安装基线，之后再校验标签 Mod。标签快照与整合包 JAR 的 SHA-256 相同时保留整合包原文件和原文件名，不重复下载或改名。对 AutoModSync 或用户已安装的其他文件名也执行内容匹配：按大小筛选后验证完整 SHA-256，CurseForge 外部引用则验证服务端 SHA-1；匹配后复用现有路径，缺少缓存也不重新下载。目标路径被不同内容占用时，可将其他已校验本地副本先写入临时缓存并再次验证，再交给原有恢复事务处理。

新下载的标签 Mod 默认路径仍为 `mods/{modId}.starlight.jar`；AutoModSync 按内容识别此类文件，无须互相改名。复用的外部文件以 `.starlight-pack.json` 中的 `borrowedFiles` 记录归属，并在后续同步中保留；旧清单缺少该字段时按空列表兼容。不能仅凭 `.starlight.jar` 后缀删除文件，因为 AutoModSync 使用相同后缀。标签取消或 Mod 移出标签后，只自动移除启动器记录的、未被外部修改且非借用的旧文件；借用文件和已修改文件保留。保留文件若与将要恢复的整合包文件重复声明 Mod ID，则在修改实例文件前明确报错，要求统一两边版本或同步规则，避免安装两个冲突版本。

只有内容确实不同时，标签 Mod 才优先替换同标识的旧 Mod。完整识别一个 JAR 声明的所有 Mod；部分覆盖多 Mod JAR 时明确报错，不擅自删除其他 Mod。相同标识且内容不同的旧文件与新文件统一在下载校验完成后通过恢复日志替换。用户其他 Mod 不作为删除目标。CurseForge 引用保存项目、文件及 Mod 身份，清理缓存后仍能使用原下载源恢复。运行中实例的检查会只读归一化当前文件名与旧清单，已校验的 AutoModSync 改名不应误报更新。

标签下载使用启动器有效并发设置，上限 16 个文件，复用现有下载重试、连接管理与完整性校验。独立弹窗逐个显示文件字节进度，下载页同时显示这些任务；所有文件成功下载、替换后才允许启动，任一失败则保留错误并阻止启动。再次尝试会清理上一轮弹窗进度和失败任务。

此弹窗在需要更新时自动出现，不引入新的首次使用操作，因此不增加引导步骤；现有下载页引导及弹窗「查看下载」入口继续适用。

删除只作用于上次清单管理且未被本地修改的文件。存档、截图、日志、备份、个人选项和服务器列表保留；`force=false` 的已修改本地文件也保留，并在手动同步结果中列出。其他用户添加的文件不作为删除目标。内部缓存与备份不会被 ZIP 覆盖，路径越界、大小写冲突、符号链接和 Windows 联接路径会被拒绝。跨版本只改变文件名大小写的更新目前需要新实例。

单次 ZIP 上限 4 GiB，最多 100,000 个条目，单文件最多 2 GiB，总解压大小最多 16 GiB。反向代理如另有限制，应同步配置上传请求上限。对象、历史版本和本地备份目前保留，尚未实现自动回收。

## 验证入口

- 服务端：`gradlew test --tests '*Modpack*'`，覆盖格式识别、内容校验、路径限制、文件差异、策略预览、审核前隔离、重复审核、过期草稿、默认包审计及无凭据/无效凭据请求的隔离。
- 启动器：`cargo test -p theseus --lib api::pack::hosted::tests`，覆盖路径限制、冲突检测和修改/新增/删除文件的中断恢复。
- 桌面命令与权限：`cargo check -p theseus_gui`。
