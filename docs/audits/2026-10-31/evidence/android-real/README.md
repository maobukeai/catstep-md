# Android D11 独立环境准备与 APK 构建

本目录记录真实 Android 验收的准备步骤。D11 是审计问题编号；当前已安装的系统镜像是 **Android 14 / API 34 / x86_64 / default rev2**，并非 Android 11。

## 保护范围

只读取现有 `maobu_test.ini` 和 `maobu_test.avd/config.ini` 的设备元信息及 SHA256，不读取其 userdata、账号、应用文件、快照或密钥。前后两份元信息哈希一致。没有启动、修改、wipe 或安装应用到现有 AVD。

全新的 QA 根位于 `%LOCALAPPDATA%/Temp/catstep-android-d11-qa-20261031`，正式 QA AVD 名为 `catstep_qa_d11_20261031_isolated`。SDK 的系统镜像以只读共享方式引用，QA 自身的 `userdata.img` 由 `avdmanager` 从 SDK 原始镜像创建，未复制任何现有 AVD 的用户数据。`ANDROID_USER_HOME`、`ANDROID_EMULATOR_HOME` 和 `ANDROID_AVD_HOME` 全部指向 QA 根。环境变量仅影响脚本进程及其子进程，没有持久修改环境变量或 PATH。

仅在这份新建 QA 配置中将数据分区上限设为 2G、RAM 2048M、启用物理键盘输入并选择冷启动，给 debug APK 与测试文件保留空间。未对原 AVD 做硬件配置变更。

`prepare-passive-avd.ps1` 在已有目标目录时主动拒绝覆盖；没有使用 `--force`。首次配置同时设置了旧 `ANDROID_SDK_HOME` 与新 `ANDROID_USER_HOME`，本地 cmdline-tools 12 报 preference 路径冲突。删除脚本进程中的旧变量后创建成功。前两次失败仅在 QA 根留下两个空目录，原始日志保留。

`passive-avd-result.json`、`qa-avd-config-summary.txt` 与 `prepare-passive-avd-final.log` 是实际输出。创建后用 `emulator -list-avds` 验证隔离目录只识别这一台新 QA AVD；没有执行 emulator 启动命令。

`emulator -accel-check` 返回 `WHPX(10.0.26300) is installed and usable.`（见 `acceleration-check.txt`）。该命令只检查硬件加速，没有启动虚拟设备。专用中文空格路径 Markdown fixture 已准备在 QA 根的 `fixtures` 子目录，哈希见 `fixture-manifest.json`；尚未复制到任何设备。

## 仅构建配置

先核对实际 `pnpm exec tauri android build --help` 和官方 CLI 文档，再执行 `build-debug-apk.ps1`。命令只使用 `android build --debug --apk --target x86_64 --ci`；没有 `--open`、`android dev`、`android run` 或 `adb install`。

`build-override.json` 临时合并三个空 before hooks，复用主代理已通过门禁的 `app/dist`，避免再次执行前端构建覆盖其 GUI 正在使用的产物。没有修改产品主 `tauri.conf.json`。脚本记录 dist/index.html 前后哈希与生成目录文件哈希，便于识别 Tauri 自动生成内容。

项目配置：applicationId/namespace `app.catstepmd`，版本 `1.0.12`，versionCode `1000012`，minSdk 24，targetSdk/compileSdk 36，Gradle 8.13，AGP 8.11.0，Kotlin 1.9.25，NDK 26.3.11579264，JDK 21。APK 对应 x86_64 模拟器；debug 模式可调试，不能代替正式发布包的签名/压缩验收。

构建最终结果见 `build-result.json` 与 `build-debug-apk.log`。若成功，必须再由 `aapt2`/ZIP 确认 applicationId、版本、SDK、native ABI 与签名后才能宣称 APK 可安装。

最新 **654** 前端全部门禁通过后，已按根代理通知增量纯构建、完整验包并保留固定副本 `artifacts/654/CatstepMD-654-x86_64-debug.apk`。实际大小 319257329 bytes，SHA256 `22549a7f8d907577a10affb03f3a089e9ec59d9a91ad009774868d73c9b1271d`，applicationId/版本/minSdk/targetSdk 与下述包一致，仅含 x86_64 ELF64 machine62。ZIP CRC、APK v2 debug 签名与真实 SAF bridge 名检查均通过。dist/index.html 构建前后 SHA256 同为 `a80c3c25bd4bbead04b322f73a77b33368943cbe091d5b53beb62ed54637f58d`。见 `build-result-654.json`、`build-654-success.log`、`apk-verification-654.json`、`retained-apk-654.json` 和 `654-apk-*-badging/signature.txt`。本代理没有安装/重启/操作正在运行的 QA5580 或其草稿；后续安装及 Save 的实际验收由根代理执行。648/650 原包与验证均保留。

此前 **650** 前端门禁对应的同 ABI debug 包已增量构建并完整验包通过。固定副本在 QA 根 `artifacts/650/CatstepMD-650-x86_64-debug.apk`，SHA256 `e2771e71704b45a84808edd3d8475261d9542b2dcc91599d2b60f9d360e3d502`，319257329 bytes。对应 dist 前后 SHA256 同为 `173f2053b8b92b289b4d80a0f79aae21dcd3dba410fa015426872f92f9f4a09c`，包含 `App-CQGKk3ym.js`。证据为 `build-result-650.json`、`build-650-success.log`、`apk-verification-650.json` 和 `650-apk-*-badging/signature.txt`。

650 APK 总大小增加，但 ZIP central directory 中可见 `libapp_lib.so` 仍是 155850864 bytes，与 648 相同；见 `debug-size-observation.json`。其现象与增量 ZIP 的未引用旧数据相符，尚未验证打包器根因。没有把 debug APK 总大小当作前端或 release 原生库体积回归，也没有为此修改 Gradle/产品源码。

648 前端门禁对应的 debug APK 已于 11:57 实际构建成功（exit 0）。`apk-verification-648.json` 记录 `aapt2`、APK Signature Scheme v2、ZIP CRC 与 ELF header 检查全部通过。正确文件为 `app-universal-x86_64-debug.apk`（163391585 bytes，SHA256 `c65fa9334cca12dcd0e0347d117e8160d99a6d5e65becb89faa727b7956886e2`），仅包含 `lib/x86_64/libapp_lib.so`，DEX 中包含真实 `MainActivity` 的 SAF bridge 名。dist/index.html 前后 SHA256 都是 `2f83244fd16dc43b70cfdd0774d6636b3b6d3caffba349b7c9265fb72d5f7799`。稳定原包已复制到 QA 根的 `artifacts/648/CatstepMD-648-x86_64-debug.apk`，校验同哈希；见 `retained-apk-648.json`。

### 单 ABI 输出与正式发布脚本的只读核对

本轮固定 Gradle split 额外生成了两个 7535235 bytes 的 ARM APK，ZIP 内均没有任何 `.so`，不能用于 ARM 设备。所谓 `app-universal-universal-debug.apk` 本次也仅包含 x86_64，与正确的 x86_64 APK 哈希完全相同。不要将单目标包名中的 universal 理解为包含所有 CPU 架构。Tauri CLI 最后一行还显示了不存在的 `app-universal-debug.apk` 路径，实际文件应以 `output-metadata.json` 和验包结果为准。

`gen/android/app/build.gradle.kts`、`buildSrc/.../RustPlugin.kt` 是 Git 跟踪的可维护配置；整个 `gen/android` 并未被忽略。仅 build 缓存、Tauri 自动生成配置、jniLibs/assets 与 generated Kotlin 子目录被 `.gitignore` 排除。没有在 scripts/workflows 找到额外 Android template/patch 来源。环境准备与 APK 构建阶段没有手改 Gradle、工作流或产品源码。Tauri 自动生成了 `app/tauri.properties`、`app/proguard-tauri.pro` 等内容，并重写 AndroidManifest.xml 的行结束符；`git diff --numstat -- gen/android` 没有内容差异。

`scripts/build-android.sh:88,91` 与 `.github/workflows/release.yml:541` 都没有限定单一 target，正式命令按 CLI 默认构建多个目标。因此本次单 ABI 的空 ARM 包**不能证明正式全 ABI 构建也产出空 ARM 包**，本轮没有执行 release 构建或发布。

原上传脚本 `.github/workflows/release.yml:553-564` 仅根据目录中的 `/arm64-v8a/`、`/armeabi-v7a/`、`/x86_64/` 判定 ABI。实际 split 的 ABI 在文件名，四个文件都位于 `universal/debug/` 下。将实际 metadata 中四个路径代入这段分类算法，全部输出同一个 `CatstepMD_1.0.12_universal.apk`；动态重放证据见 `release-classifier-replay.json`。同一 universal product flavor 也有 release 变体，因此 release 保持相同目录结构时会出现 `--clobber` 同名覆盖风险。原上传脚本未解析 output metadata，也未检查原生库/ABI。

根代理随后授权最小修复这一发布逻辑缺陷，已增加 `scripts/lib/prepare_android_release.py`，按 release output metadata 的 ABI filters 命名，核对 package/version、所有 APK 的 core native ELF/ABI、universal 三个必需 ABI、单一 AAB 与对应 core native ABI，并在全量通过后才原子准备五个唯一公共文件及 manifest。CI 只上传该显式 manifest，上传前再次一次性核对所有 hash/size；原公开文件名与签名配置不变。没有运行 `gh`、上传或创建 release。

正式 `unittest` **19 项全过（无跳过）**，包含真实 universal 目录布局的旧分类碰撞、空 native、ELF/metadata ABI 不符、重复公共目标/ZIP entry、包名/版本不符、路径遍历/绝对路径/符号链接越界、多 AAB、缺架构、debug 元数据拒绝、manifest 文件被篡改、现有输出目录保留，以及中文空格路径的真实离线 CLI 调用。见 `release-helper-tests.txt`。YAML 与上传 heredoc 的 Python 语法/import 已离线检查；对实际 650 debug 包执行 native 检查，两个空 ARM 包均被拒绝，见 `release-helper-real-debug-check.json`。用真实 650 outputs 执行完整 release CLI，也按预期 exit 1 且不创建 prepared 目录，见 `release-helper-real-debug-cli-rejection.json`。独立代理只读交叉审阅未发现本次修复的必须追加阻断项。

边界：helper 检查 core `libapp_lib.so` 的 ELF 头与 ABI，不等于完整动态装载/全部依赖库/签名验证；AAB 的包名版本未解析 protobuf。完整多 ABI release 编译/签名/上传尚未执行，不能用上述小 ZIP 回归替代；网络中途失败仍可能导致 draft 上部分资产更新，未将上传改为事务。

### Windows NDK 中文路径的实际构建障碍

首轮源码编译完成到链接阶段，NDK 26 的 Windows `clang.cmd`/LLVM 无法打开中文项目路径下的对象文件，退出 101。保留为 `build-attempt1-unicode-link-failure.log` 与 `build-attempt1-result.json`。

第二轮通过任务临时目录的 junction 给 `CARGO_TARGET_DIR` 提供 ASCII 路径，`cargo metadata` 确认 target_directory 保留别名，新的对象路径也已变 ASCII。但链接命令仍混入旧缓存对应的中文 `.rlib` 绝对路径，导致同类失败；见 `build-attempt2-alias-link-failure.log`。仅换别名并复用旧缓存不足以解决这一环境问题。

第三轮改为真正新建的 `%LOCALAPPDATA%/Temp/catstep-android-d11-qa-20261031/rust-target-ascii`，不复制旧缓存，由本次构建从头生成依赖。`CARGO_TARGET_DIR` 仍只在构建进程设置，不修改产品源码或系统配置。源文件保留原项目路径；三个 hooks 继续为 null，使用主代理最新 645 测试门禁之后稳定的 dist。

此方法实际通过 Rust 编译/NDK 链接（12m02s），只产生两个 Android 条件分支下的 unused 警告。随后 Java wrapper 的官方 Gradle 下载连接持续为 0 bytes，改由 PowerShell 从 Gradle 官方 GitHub release 下载同版本 ZIP，并与官方 services.gradle.org SHA256 `20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78` 匹配后，放入本次新建的 wrapper distribution cache。只终止了经命令行/项目路径核验的本次阻塞 wrapper 进程；见 `gradle-download-verification.json` 和第三轮日志。

第四轮复用完整 ASCII target，因最终 648 dist 变化重新编译应用，3.53s 完成 Rust，然后 Gradle 完成 APK。本地 AGP 8.11 class 中核对其 Windows `android.overridePathCheck` 参数后，仅为构建子进程设 `ORG_GRADLE_PROJECT_android.overridePathCheck=true`；未修改 gradle.properties、系统环境变量或用户配置。该参数会打印 experimental 提示，其作用是允许项目源码保留中文路径，实际编译输出仍在 ASCII 目录。JDK21 对 source/target8、上游 Kotlin deprecated API、debug so 未剥符号等警告保留在构建日志中，未将它们冒充失败。

## 本代理构建阶段的运行边界

本代理的环境准备/构建阶段没有启动设备/模拟器、没有 GUI 操作、没有 `adb input`，不能把准备环境或编译成功记作 D11 已通过。根代理随后另行接手独立 QA AVD 的真实 UI 验收；**SAF 系统 picker、DocumentsProvider、URI 持久授权、重启后读写、取消与失败路径的最终状态，以主报告与根代理的运行证据为准**。

后续验收应只使用上述新 QA AVD：在新系统中创建专用测试目录和 Markdown fixture，经产品“打开文件夹”启动系统 `ACTION_OPEN_DOCUMENT_TREE`，确认真实系统 provider 返回 tree URI；验证列目录/读/改/新建/重命名/删除、取消 picker、授权持久化与进程重启，不访问或复用 `maobu_test` 的数据。这里没有加入任何 mock provider。

请选择新建的 `Documents/Catstep QA/中文 空格` 子目录作为测试 tree。Android 11+ 的系统规则不允许 tree picker 授权内部存储根、`Download` 根以及 `Android/data`、`Android/obb`；这些目录的系统限制应与产品故障分开记录。[Android 官方 SAF 说明](https://developer.android.com/training/data-storage/shared/documents-files#access-restrictions)

官方来源见 `sources.json`。
