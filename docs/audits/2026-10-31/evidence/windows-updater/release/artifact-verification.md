# Windows 修复包产物核验

结论：x64、ARM64 两架构发布候选均通过本次只读核验，无发布阻断项。本记录核验构建产物，不代表已在用户电脑执行实际安装。

## 来源与资产完整性

- 源码提交：`e4a6a1285e272da62737e6df5ed33f49de242a49`。
- 原生构建：[GitHub Actions run 41192825074](https://github.com/maobukeai/catstep-md/actions/runs/41192825074)，两架构均成功。
- 两份 `build-provenance.json` 的仓库、提交、run ID、版本 `1.0.13`、目标 triple 均与本次构建相符。
- 直接计算下载到本地的四项资产 SHA-256，与 provenance、各架构附带的两行清单全部一致；文件大小亦一致。
- ZIP 恰好包含六个唯一文件：`CatstepMD.exe`、`catstep-mcp.exe`、`icons/file_icon.ico`、`resources/dicts/en_US.aff`、`resources/dicts/en_US.dic`、`README.txt`。逐项内容摘要均匹配 provenance 的 `portable_inputs`。
- 实际读取主程序和 MCP 的 PE 头：x64 为 `0x8664`，ARM64 为 `0xaa64`；未以文件名代替架构检查。

| 资产 | 字节数 |
| --- | ---: |
| CatstepMD_1.0.13_x64_en-US.msi | 16879616 |
| CatstepMD_1.0.13_x64-portable.zip | 16368374 |
| CatstepMD_1.0.13_arm64_en-US.msi | 16371712 |
| CatstepMD_1.0.13_arm64-portable.zip | 15898476 |

```text
ce9b95b492a7f52f5fe153a0a5af5e31e5820160ce486ee2ef546999b260c623  CatstepMD_1.0.13_x64_en-US.msi
b35bafb8b251dacf99c0dd375e184e400ada00709d38038646ab69152f92852e  CatstepMD_1.0.13_x64-portable.zip
96a956709bbe09219a5eedc425f1919c00a8509e081fcf9fdddeb20cd22b9708  CatstepMD_1.0.13_arm64_en-US.msi
571fe9144116b6245b1626f6316c8f4cddde3c27f4228dd30e8a9667d6fb050e  CatstepMD_1.0.13_arm64-portable.zip
```

## MSI 同版本覆盖升级

使用 Windows Installer COM 的 `OpenDatabase(path, 0)` 只读模式读取 MSI 表及 SummaryInformation，没有调用安装、修复、注册或提交接口。

| 字段 | x64 新包 | ARM64 新包 |
| --- | --- | --- |
| ProductVersion | 1.0.13 | 1.0.13 |
| ProductCode | `{4D424E44-57B3-4221-9335-65592A50A5CD}` | `{9E1C49FB-CE1F-495C-999C-20B58685BF75}` |
| PackageCode | `{154E33A1-218F-4867-A07E-5925E622205F}` | `{3BE4D5B8-432C-4C68-973A-15E75A3045A9}` |
| Summary Template | `x64;0` | `Arm64;0` |
| 主程序 FileVersion | 1.0.13.0 | 1.0.13.0 |

两架构的 ProductCode、PackageCode 均与备份的旧版 v1.0.13 不同；UpgradeCode 均保持 `{C0974FF6-FFD4-5865-8141-68B3CF8A1D78}`。两包实际升级表均满足：VersionMin=`0` 且非 NULL，VersionMax 为 NULL（无上限），Attributes=`257`（迁移功能并包含下界，非 OnlyDetect），Remove 为 NULL（移除全部功能），ActionProperty=`WIX_UPGRADE_DETECTED`。

两包均为 `ALLUSERS=1`、`REINSTALLMODE=amus`，执行顺序为 InstallInitialize=1500 → RemoveExistingProducts=1501 → InstallFiles=4000。上述新 ProductCode 和升级范围包含已安装的 `1.0.13`，具备同版本 MajorUpgrade 的元数据条件；未通过本次只读检查声称实际 MSI 安装已完成。

## MSI 内容与便携包比对

7-Zip 只读提取 MSI 内嵌 CAB 的五项有效载荷，再依据 MSI File 表映射文件名。MCP、图标、`.aff`、`.dic` 的完整字节及 SHA-256，均与同架构便携包一致。

主 EXE 的原始 SHA-256 不同，已逐字节确认两架构均只有 Tauri 打包类型标记的三个字节差异：便携包是 `__TAURI_BUNDLE_TYPE_VAR_UNK`，MSI 内为 `__TAURI_BUNDLE_TYPE_VAR_MSI`。x64 差异偏移为 `0x158de20..0x158de22`，ARM64 为 `0x142cc48..0x142cc4a`。只在比较数据中归一化该单一标记后，整个 EXE 完全一致；实际发布文件未作任何修改。本机 `tauri-utils-2.9.3/src/platform.rs:343-360` 的原始代码明确说明该变量由构建时二进制补丁修改，并列出 `UNK`、`MSI` 等对应值。

| 主程序 SHA-256 | x64 | ARM64 |
| --- | --- | --- |
| 便携包内原始值 | `637e3447d5235ace9186d0928720e46a9e1eac4b0bf12ebc4bec157d2447cc35` | `dbc314724b93f847260c5b44ed6f5e3c50f6c7d0f4efd9f063a7f0c71f1fed4a` |
| MSI 内原始值 | `88240032330fe869eeb725a6278185f1538d75ba634dfbadc4f34e9214c098d6` | `7921f5769f0d032687a424bbae2a67f1b7a38d2100f4a43cac99d8bda3d81130` |

## 操作边界

本核验仅读取 provenance、ZIP、PE、MSI 数据库和自有临时目录中的提取文件。未运行 `msiexec` 或安装器、未打开产品 GUI、未改产品源码和已有安装、未上传发布资产。公开 GitHub 下载回验及完整 24 项发布清单的一致性由发布代理另行记录。
