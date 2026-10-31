# Android 654：真实 SAF 保存与授权恢复验收

日期：2026-10-31。**本次限定场景通过**：触屏 Save、真实 DocumentsProvider 读写、取消目录选择保留 dirty 草稿/磁盘、完整 QA 设备冷启动后的授权/列表恢复、关闭标签后从树重新读盘、再保存 172 字节完整内容。主要操作记录为 [saf-ui-result.json](saf-ui-result.json)，文件哈希与复核断言见 [evidence-index.json](evidence-index.json)。复核者只读取已有 JSON、pulled 文本、APK 和截图，未操作设备或运行 GUI。

## 环境、版本与方法

* 全新独立 AVD：`catstep_qa_d11_20261031_isolated`，`emulator-5580`，Android 14/API 34，官方 SDK AOSP x86_64 镜像；未使用原 `maobu_test` 用户磁盘，未添加账号。650→654 是在这一 QA 设备内更新应用，不是每步重新擦除数据。
* 实际安装包：前端 **654**，`app.catstepmd` 1.0.12 debug，x86_64；保留 APK 为 `TEMP/catstep-android-d11-qa-20261031/artifacts/654/CatstepMD-654-x86_64-debug.apk`，319,257,329 字节，SHA256 `22549a7f8d907577a10affb03f3a089e9ec59d9a91ad009774868d73c9b1271d`。复核者重新计算保留 APK 哈希，与 [保留记录](retained-apk-654.json)、[验包](apk-verification-654.json) 和 UI 记录一致；验包含签名、ZIP CRC、身份和原生 x86_64 库检查。
* 目录仅为 `/sdcard/Documents/CatstepQA`，文档 `SAF-QA.md`。系统目录选择器授权的是独立 QA 子目录；经产品文件树创建文档，再由产品 Save 写入实际 Android DocumentsProvider，**没有 mock Provider**。
* UI 全由根代理通过 CUA 操作真实 Windows emulator 窗口。ADB 仅用于明确 `emulator-5580` 的 APK 安装、设备/boot 诊断、自建夹具目录和 pull；没有 `adb input`、screencap 或 UI 注入。

## 动作与实际结果

| 场景 | 实际动作及结果 | 证据 |
| --- | --- | --- |
| 首次 picker 取消/重开 | 取消系统目录选择后回到应用，再重开 picker；没有把“取消”当成已选目录 | [首次系统 picker](../after-fixes/android-saf-first-picker.png)、[取消返回](../after-fixes/android-saf-cancel-return.png)、[重开](../after-fixes/android-saf-reopen-after-cancel.png) |
| 独立目录授权与创建 | 在系统 Provider 确认仅授予 `CatstepQA` 子目录；返回产品文件树并创建 `SAF-QA.md` | [授权范围](../after-fixes/android-saf-grant-scope.png)、[返回产品](../after-fixes/android-saf-granted-return.png)、[产品草稿](../after-fixes/android-saf-edited-draft.png) |
| 650→654 draft 恢复 | 更新到带触屏保存入口的 654，原未保存正文恢复；不是重新灌入一份磁盘内容替代草稿 | [更新后草稿](../after-fixes/android-update-654-draft-restored.png)、[结果断言](saf-ui-result.json) |
| 第一次触屏保存 | 更多菜单中出现英文 `Save`，点击后 dirty 蓝点消失；真实文件为完整 122 字节 UTF-8 | [点击前](../after-fixes/android-touch-save-before-654.png)、[点击后](../after-fixes/android-touch-save-after-654.png)、[pull 结果](SAF-QA-first-save.md) |
| 已有工作区 picker 取消 | 追加 `CANCEL RESUME DRAFT 你好`，重开 picker 后取消；草稿及 dirty 蓝点仍在，磁盘仍与首次 122 字节完全相同 | [dirty 前](../after-fixes/android-saf-dirty-before-picker-654.png)、[系统 picker](../after-fixes/android-saf-existing-workspace-picker-654.png)、[取消返回后的 dirty](../after-fixes/android-saf-dirty-after-cancel-654.png)、[未变磁盘](SAF-QA-after-picker-cancel.md) |
| 取消后再次保存 | 再点击触屏 Save；完整原文加中文 draft 被保存为 150 字节，dirty 清除 | [保存后](../after-fixes/android-saf-after-cancel-save-654.png)、[150 字节文本](SAF-QA-after-cancel-save.md) |
| 完整设备冷启动 | 退出旧 emulator/qemu 并以相同 QA AVD、`-no-snapshot` 重启；旧 QEMU 28856 → 新 5940，旧 emulator 48732（exit 0）→ 新 51080。不是前端刷新或 snapshot 恢复 | [进程/启动断言](saf-ui-result.json)、[冷启动后恢复](../after-fixes/android-saf-cold-boot-restored-654.png) |
| 授权与实际读盘 | 冷启动后保留 QA tree 和文件列表；关闭已恢复标签，再从树重新打开 `SAF-QA.md`，读到 150 字节 Provider 内容 | [树与列表](../after-fixes/android-saf-cold-boot-tree-654.png)、[关闭后重开读取](../after-fixes/android-saf-cold-boot-reopened-read-654.png) |
| 冷启动后再写 | 追加 `COLD BOOT WRITE PASS`，点击 Save；dirty 清除，实际 Provider 文件为完整 172 字节 | [触屏保存](../after-fixes/android-saf-cold-boot-save-654.png)、[172 字节文本](SAF-QA-cold-boot-save.md) |

“关闭标签后从树重开”这一步避免把仅恢复于 localStorage/session 的正文当成 SAF 授权和读盘通过。`-no-snapshot` 禁用的是快照装载/保存，没有擦除 QA 用户磁盘；其持久文件与 tree grant 能在冷启动后恢复正是本轮验证目标。

## 四份实际文件的字节核对

| pull 文件 | 字节数 | SHA256 | 独立复核 |
| --- | --- | --- | --- |
| `SAF-QA-first-save.md` | 122 | `a96b0f09a257ff6d44a206be9c02cdd1e82184f12ad94cbfb194d6f02aa1bbca` | 完整初始正文、中文/emoji、代码两空格缩进与空行 |
| `SAF-QA-after-picker-cancel.md` | 122 | `a96b0f09a257ff6d44a206be9c02cdd1e82184f12ad94cbfb194d6f02aa1bbca` | 与第一次保存逐字节相同，取消没有把 dirty 草稿写盘 |
| `SAF-QA-after-cancel-save.md` | 150 | `c4119bd51850696bd8a3c80823e6a3d2d56862049a4bb4b0cd9640a60a475aac` | 完整初始正文 + `\nCANCEL RESUME DRAFT 你好\n` |
| `SAF-QA-cold-boot-save.md` | 172 | `840f40b7eee341fe3e2fe127852037662b0b3b23c994ac4b354a9b4cd341f81a` | 完整 150 字节正文 + `\nCOLD BOOT WRITE PASS\n` |

复核不是只匹配几个 marker：四份文件均可严格 UTF-8 解码、没有 BOM；完整字节与下列初始原文及逐步追加文本一致，代码缩进、空行、终止换行均参与比较。

````markdown
# SAF QA

中文保存：你好😀

| A | B |
| --- | --- |
| 中文 | saved |

```text
  keep whitespace

next line
```
````

## 修前发现与证据层级

650 首次建文档后磁盘 0B，发生在未能触发明确 Save 入口之前：dirty 笔记只有间接的关闭标签 Save 路径，手机更多菜单没有直接保存按钮。它实证的是 D13 触屏保存入口缺失，**不是已经调用 Provider 后写入失败**。物理 Ctrl+S 在 Qt emulator 中没有完成保存，未隔离 Qt 截键原因，不能据此归因为产品快捷键故障。654 的真实触屏 Save 和文件字节关闭了当前缺口；没有通过更改默认 autosave 掩盖问题。

`fixture-manifest.json` 中 `copiedToDevice=false/providerExercised=false` 对应最早被动准备的 232 字节“原始 笔记.md”，不是本次由产品创建、实际写入的 `SAF-QA.md`；这些历史准备状态未被改写。[build-result-654.json](build-result-654.json) 的 `apkInstalled=false/devicesStarted=false` 也只描述构建者阶段，随后根代理的 [安装记录](install-654-qa5580.txt) 和实际 UI 结果描述了后续执行，不互相矛盾。

## 准确边界

* 只验证一台全新 AOSP API34 x86_64 emulator 与其实际 DocumentsProvider；没有签收物理手机、OEM、云盘/只读 Provider 矩阵。
* 包为 debug、单 x86_64 实际原生 ABI；其他名为 arm64/armeabi 的旧空 native 产物在验包中明确 `eligibleForQaX8664=false`，没有当成可用 release 或多 ABI 验收。
* SAF 产品路径按 UTF-8 读写；没有声明具备桌面 Rust 路径的其他编码/BOM、CAS 或原子写保证。
* 未执行 provider 配额、撤销授权、只读/中途失败、SAF 重命名/删除、跨 tree dirty 保存的 UI 验收。
* CUA 直接拉起 emulator 曾出现 DLL 搜索失败；同一固定 launcher 经 Explorer 打开后工作。此差异原因仍未定，未修改系统/SDK 去消除症状，也不推定为产品缺陷。
* 共用宿主 SDK/ADB 是开发工具边界，独立的是 QA Android 用户磁盘/账号/AVD；不是 OS 安全沙箱。全平台最终签收仍为 false。
