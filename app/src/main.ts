import { createApp, type Component } from 'vue';
import { createPinia } from 'pinia';
import { useSettingsStore } from './stores/settings';
import { loadLanguage, type Lang } from './i18n';
import './styles/tokens.css';
import './styles/cjk-font.css';
import './styles/main.css';
import './styles/hljs-theme.css';
import 'katex/dist/katex.min.css';

const params = new URLSearchParams(window.location.search);
const isSlideshow = params.get('slideshow') === '1';
// The quick-capture box is a second webview on the same bundle rather than a
// separate entry point: it needs the settings and workspace stores (theme,
// language, current folder) and gets them from the shared localStorage for
// free this way.
const isQuickCapture = params.get('quickCapture') === '1';
const isPipTimer = params.get('pipTimer') === '1';

if (isPipTimer) {
  document.documentElement.classList.add('is-pip-timer');
  document.documentElement.style.background = 'transparent';
  if (document.body) {
    document.body.style.background = 'transparent';
  }
}

async function getRootComponent(): Promise<Component> {
  if (isSlideshow) {
    return (await import('./components/Slideshow.vue')).default;
  }
  if (isQuickCapture) {
    return (await import('./components/QuickCapture.vue')).default;
  }
  if (isPipTimer) {
    return (await import('./components/PomodoroPiP.vue')).default;
  }
  return (await import('./App.vue')).default;
}

async function bootstrap() {
  const [rootComponent] = await Promise.all([getRootComponent()]);

  const app = createApp(rootComponent);
  const pinia = createPinia();
  app.use(pinia);

  const settings = useSettingsStore(pinia);
  const currentLang = (settings.language as Lang) || 'en';
  await loadLanguage(currentLang);
  if (currentLang !== 'en') {
    loadLanguage('en');
  }

  app.mount('#app');
}

bootstrap();
