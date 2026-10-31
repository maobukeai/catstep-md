# 表格布局修复包：Windows 产物核验

核验日期：2026 年 11 月 1 日（UTC+8）。结论：最终 x64、ARM64 四项候选资产均通过核验，无发布阻断。本记录仅验收最终冻结源码对应的产物，不代表已在用户电脑完成实际安装，也不代替公开发布后的下载回验。

## 来源及完整性

- 唯一验收源码：`44fdcfe44ee52daeb32738aa4102c01cfd62528e`。
- 原生构建：[GitHub Actions run 41224270415](https://github.com/maobukeai/catstep-md/actions/runs/41224270415)，最终状态为 `completed / success`，两架构 job 均成功后才下载各自资产。
- 两份 provenance 的仓库、提交、run ID、版本 `1.0.13`、Windows runner 架构和目标 triple 均符合本次构建。
- 下载后的四个文件均实际计算 SHA-256，并比对 provenance、各架构附带的清单及文件大小，全部一致。
- 便携包恰有六个唯一文件：`CatstepMD.exe`、`catstep-mcp.exe`、`icons/file_icon.ico`、`resources/dicts/en_US.aff`、`resources/dicts/en_US.dic`、`README.txt`。六项内容摘要全部匹配 provenance 输入记录。
- 实际读取两个 EXE 的 PE 头：x64 为 `0x8664`，ARM64 为 `0xaa64`，与目标 triple 及 provenance 声明一致。

| 资产 | 字节数 |
| --- | ---: |
| CatstepMD_1.0.13_x64_en-US.msi | 16879616 |
| CatstepMD_1.0.13_x64-portable.zip | 16369592 |
| CatstepMD_1.0.13_arm64_en-US.msi | 16371712 |
| CatstepMD_1.0.13_arm64-portable.zip | 15900709 |

```text
2f6502efa68f91d9c1a809246cc878a5f61f56ba02787fd915ea93c9efe76a22  CatstepMD_1.0.13_x64_en-US.msi
260719d3da963f412a63aeeccf5b7d2d74250f86aa925c76432fc62288f28483  CatstepMD_1.0.13_x64-portable.zip
738f976dc94021f27716efdf876d5ab1091089c44595d438794910482884b2f4  CatstepMD_1.0.13_arm64_en-US.msi
847e6544c66ab422c73bff6f76489c2b667f3c4a03cc94ba29e2123ccc98e14f  CatstepMD_1.0.13_arm64-portable.zip
```

## 与当前发布包比较同版本升级条件

比较基线为此前从官方公开地址下载的当前 v1.0.13 包（更新器修复包）；本次发布前重新计算文件摘要并与最新 API digest/size 比对后建立备份，不是最初未修复的 v1.0.13。MSI 数据均通过 Windows Installer COM 的 `OpenDatabase(path, 0)` 只读获取。

| 字段 | x64 | ARM64 |
| --- | --- | --- |
| 基线 ProductCode | `{4D424E44-57B3-4221-9335-65592A50A5CD}` | `{9E1C49FB-CE1F-495C-999C-20B58685BF75}` |
| 新 ProductCode | `{1BE1041A-C545-4DCE-8050-FEB5A33E69B2}` | `{FBFD64A6-70B0-4BBE-AC1C-1DDF624542A7}` |
| 基线 PackageCode | `{154E33A1-218F-4867-A07E-5925E622205F}` | `{3BE4D5B8-432C-4C68-973A-15E75A3045A9}` |
| 新 PackageCode | `{3B1F2B40-F3EF-4D79-A7E2-99B9781E0750}` | `{210F99F0-3AB5-4960-9398-81A25CF25EA7}` |
| ProductVersion / EXE FileVersion | `1.0.13` / `1.0.13.0` | `1.0.13` / `1.0.13.0` |
| Summary Template | `x64;0` | `Arm64;0` |

两架构新 ProductCode、PackageCode 均不同于当前发布基线。Property 和 Upgrade 表的 UpgradeCode 均保持 `{C0974FF6-FFD4-5865-8141-68B3CF8A1D78}`。

两包实际 Upgrade 行均为 VersionMin=`0` 且非 NULL、VersionMax 为 NULL（无上限）、Attributes=`257`（迁移功能并包含下界，非 OnlyDetect）、Remove 为 NULL（移除全部功能），ActionProperty=`WIX_UPGRADE_DETECTED`。两包均保留 `ALLUSERS=1`、`REINSTALLMODE=amus`，并在初始化前安排 FindRelatedProducts；执行顺序为 InstallInitialize=1500 → RemoveExistingProducts=1501 → InstallFiles=4000。

因此，新包具有覆盖当前已安装 `1.0.13` 的 MajorUpgrade 元数据条件。此项是只读表结构验收，未执行真实安装来声称全流程成功。

## MSI 与便携包内容比较

只读解包 MSI 内嵌 CAB 的五项载荷，并依据 File、Component、Directory 表还原相对安装路径。主程序位于安装根目录且为真实文件 KeyPath，MCP、图标、两份词典的路径与便携包一致。上述四项附属载荷的完整字节及 SHA-256 均与同架构便携包一致。README 仅属于便携包，不计入 MSI 五项载荷。

主程序只存在 Tauri 标准打包标记的三个字节差异：便携包为 `__TAURI_BUNDLE_TYPE_VAR_UNK`，MSI 内为 `__TAURI_BUNDLE_TYPE_VAR_MSI`。x64 主程序大小为 28306944 字节，差异位于 `0x158e1e0..0x158e1e2`；ARM64 为 26210304 字节，差异位于 `0x142d048..0x142d04a`。只在内存中的比较数据归一化该单一标记后，两架构各自的整个主程序完全相同；发布文件未作修改。

原始 SHA-256 如下，未用归一化摘要替代发布资产校验：

```text
x64 portable EXE  48048c5adee256895ae0b94d1ea1456ae0c2a1e9b037b841b07f3130f0a68c33
x64 MSI EXE       b896fa944dffe42c100888e967e1f05597118a3db27429607ba2fc988bb73c62
ARM64 portable    8a08656a51765c6c0055349e27c1cff90d371e1b321ccd66577ab41a502c22ab
ARM64 MSI EXE     b4109c09a56130aceca21b1c624556908ca21a34824899c2ed5da6ec3bf136c6
```

## 证据与边界

实际逐项校验输出：[x64 日志](x64-artifact-verification.txt)、[ARM64 日志](arm64-artifact-verification.txt)。两个验证进程均为 exit 0，并输出最终提交及 run ID 的 `ALL_CHECKS_PASSED`。

本次核验只读取构建资产、PE、ZIP、MSI 数据库及自有临时提取目录，没有运行安装器、打开产品 GUI、修改产品源码或上传发布资产。公开 GitHub 资产替换、完整发布清单和下载回验由发布代理另行完成。
