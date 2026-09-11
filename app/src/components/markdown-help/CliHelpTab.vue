<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  searchQuery?: string;
}>();

const today = new Date().toISOString().slice(0, 10);
const cliExampleNew = `solomd new "daily-${today}" "今日重点待办："`;

const copiedNotice = ref<string | null>(null);
let copyTimer = 0;

async function copyExample(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copiedNotice.value = text;
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      copiedNotice.value = null;
    }, 1500);
  } catch {}
}
</script>

<template>
  <div class="cli-wrap">
    <p class="cli-intro">
      猫步 MD 自带跨平台命令行工具 <code>solomd</code>，支持在终端中秒级极速新建、查找、浏览与管道交互 Markdown 笔记。
    </p>

    <section class="cli-section">
      <h3 class="cli-section__title">快速安装 / Install</h3>
      <pre
        class="cli-code"
        @click="copyExample('curl -fsSL https://raw.githubusercontent.com/maobukeai/catstep-md/main/scripts/install-cli.sh | bash')"
        title="点击复制命令"
      >curl -fsSL https://raw.githubusercontent.com/maobukeai/catstep-md/main/scripts/install-cli.sh | bash</pre>
      <p class="cli-hint">
        安装完成后即可在系统任意终端执行 <code>solomd help</code> 验证。
      </p>
    </section>

    <section class="cli-section">
      <h3 class="cli-section__title">常用命令速查 / Commands</h3>
      <table class="cli-table">
        <tbody>
          <tr>
            <td class="cli-cmd"><code>solomd open &lt;title|path&gt;</code></td>
            <td>在猫步 MD 桌面端打开指定笔记</td>
          </tr>
          <tr>
            <td class="cli-cmd"><code>solomd new &lt;title&gt; [text]</code></td>
            <td>创建新笔记并即刻在编辑器中打开</td>
          </tr>
          <tr>
            <td class="cli-cmd"><code>solomd list [folder]</code></td>
            <td>列出当前知识库或指定目录下的所有 Markdown 文件</td>
          </tr>
          <tr>
            <td class="cli-cmd"><code>solomd search &lt;query&gt;</code></td>
            <td>使用底层 ripgrep 极速毫秒级全文模糊检索</td>
          </tr>
          <tr>
            <td class="cli-cmd"><code>solomd cat &lt;title|path&gt;</code></td>
            <td>在终端中打印笔记原始内容（可管道给 grep/fzf）</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="cli-section">
      <h3 class="cli-section__title">实用终端范例 / Examples</h3>
      <pre class="cli-code" @click="copyExample(cliExampleNew)" title="点击复制">{{ cliExampleNew }}</pre>
      <pre class="cli-code" @click="copyExample('solomd search 待办事项')" title="点击复制">solomd search 待办事项</pre>
      <pre class="cli-code" @click="copyExample('solomd open ./docs/architecture.md')" title="点击复制">solomd open ./docs/architecture.md</pre>
    </section>
  </div>
</template>

<style scoped>
@import './markdown-help.css';
</style>
