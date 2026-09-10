# 快捷键速查表 ⌨️

> 说明：在 Windows 与 Linux 上使用 `Ctrl` 键，在 macOS 上对应使用 `Cmd`（`⌘`）键。猫步 MD 实现了对 Typora 核心快捷键的全面对齐与兼容。

---

## 标题与排版格式 (Typora 核心)

| 快捷键 | 动作 | 说明 |
| :--- | :--- | :--- |
| `Ctrl+1` ~ `Ctrl+6` | 1 ~ 6 级标题 (H1 ~ H6) | 将当前行转换为对应级别的标题 |
| `Ctrl+0` | 正文段落 (Normal Text) | 将当前标题或块重置为普通段落文本 |
| `Ctrl+=` / `Ctrl+-` | 提升 / 降低标题级别 | 逐级调整当前行标题层级（H2 ➔ H1） |
| `Ctrl+B` | **加粗 (Bold)** | 对选中文本添加双星号强调 |
| `Ctrl+I` | *斜体 (Italic)* | 对选中文本添加单星号强调 |
| `Ctrl+U` | <u>下划线 (Underline)</u> | 插入 HTML 下划线标记 |
| `Ctrl+Shift+X` / `Alt+Shift+5` | ~~删除线 (Strikethrough)~~ | 添加删除线波浪线标记 |
| `Ctrl+Shift+` ` | `行内代码 (Inline Code)` | 选中文本包裹反引号 |
| `Ctrl+K` | 插入超链接 (Insert Link) | 选中文本快速转换为超链接 |
| `Ctrl+Shift+I` | 插入图片 (Insert Image) | 呼出图片插入引导 |
| `Ctrl+\` | 清除格式 (Clear Formatting) | 移除选中区域的所有 Markdown 排版修饰 |

---

## 块级元素与表格

| 快捷键 | 动作 | 说明 |
| :--- | :--- | :--- |
| `Ctrl+T` | **插入就地表格 (Table)** | 快速插入 Markdown 表格，支持就地悬浮工具条操作 |
| `Tab` / `Shift+Tab` | 下一单元格 / 上一单元格 | 表格编辑时快速流转，末行末格按 Tab 自动新增行 |
| `Ctrl+Shift+K` | 插入代码块 (Code Block) | 插入三反引号独立代码块并支持语言高亮 |
| `Ctrl+Shift+M` | 插入数学公式块 (Math Block) | 插入独立 `$$ ... $$` KaTeX 公式块 |
| `Ctrl+Shift+Q` | 引用块 (Blockquote) | 当前行添加 `> ` 引用标记 |
| `Ctrl+Shift+[`, `Ctrl+Shift+]` | 有序 / 无序列表 | 快速切换为编号或圆点列表 |
| `Ctrl+Shift+Backspace` | 删除当前行 (Delete Line) | 快速删除光标所在整行（或表格当前行） |

---

## 视图与模式切换

| 快捷键 | 动作 | 说明 |
| :--- | :--- | :--- |
| **`Ctrl+/`** | **切换编辑 / 源码模式** | **Typora 经典招牌快捷键**，在实时渲染与纯文本源码间秒切 |
| `Ctrl+Shift+L` | **展开 / 收起侧边栏** | 切换左侧抽屉（文件树 / 大纲 / 搜索）显示状态 |
| `Ctrl+Shift+1` | 大纲视图 (Outline) | 展开大纲目录树 |
| `Ctrl+Shift+2` | 文件树视图 (Files) | 展开目录文件列表 |
| `Ctrl+Shift+3` | 全局搜索 (Search) | 快速搜索笔记库内容 |
| `F8` | 专注模式 (Focus Mode) | 淡化非当前编辑段落，聚焦当下句子 |
| `F9` | 打字机模式 (Typewriter Mode) | 保持当前正在输入的编辑行始终处于屏幕垂直居中 |
| `F11` | 全屏切换 (Fullscreen) | 沉浸式全屏书写，隐藏系统边框与任务栏 |

---

## 文件与系统控制

| 快捷键 | 动作 | 说明 |
| :--- | :--- | :--- |
| `Ctrl+N` | 新建 Markdown 文件 | 在当前窗口创建未命名标签页 |
| `Ctrl+Alt+N` | 新建纯文本文件 | 创建 `.txt` 纯文本格式 |
| `Ctrl+Shift+N` | 新建编辑器窗口 | 独立多窗口多任务编写 |
| `Ctrl+O` | 打开文件… | 呼出系统文件选择对话框 |
| `Ctrl+S` | 保存 (Save) | 保存当前文档至磁盘 |
| `Ctrl+Shift+S` | 另存为… (Save As) | 另存当前文档到新路径 |
| `Ctrl+W` | 关闭当前标签页 | 关闭当前正在浏览的文档 |
| `Ctrl+Shift+T` | 重新打开关闭的标签页 | 恢复最近意外关闭的笔记 |
| `Ctrl+P` | **快速文件切换 (Quick Switcher)** | 按文件名模糊搜索秒级跳转已开或本地文档 |
| `Ctrl+Shift+P` | **全局命令面板 (Command Palette)** | 呼出可搜索的全局动作与功能列表 |
| `Ctrl+,` | **设置面板 (Preferences)** | 打开外观主题、排版字号、快捷键与关于面板 |
| `Ctrl+Alt+0` | 重置界面缩放 | 将窗口视图比例重置回 100% |

---

## 猫步特权功能

| 快捷键 | 动作 | 说明 |
| :--- | :--- | :--- |
| `Ctrl+J` / `Ctrl+Shift+A` | **✨ 猫步 AI 智能助手** | 展开/折叠右侧 AI 抽屉，进行润色、扩写、问答 |
| `Ctrl+Shift+H` | **⏱️ 版本时光机 (AutoGit)** | 打开版本历史抽屉，可视化对比 Diff 并一键回滚 |
| `Ctrl+Alt+P` | **投影演讲模式 (Slideshow)** | 将当前 Markdown 演示文档化为全屏幻灯片放映 |
| `F1` / `Ctrl+Shift+?` | Markdown 帮助中心 | 查看语法提示与示例速查 |

> 💡 **自定义热键**：在「设置 (`Ctrl+,`) ➔ 快捷键」面板中，你可以点击任意条目的「更改」按钮，按下任意喜欢的键位进行个性化重设。
