import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';

import {
  useAgentPanelStore,
  getAgentSessionStorageKey,
  loadSavedSessions,
  AGENT_STORAGE_KEY_BASE,
} from '../stores/agentPanel';
import { useWorkspaceStore } from '../stores/workspace';

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

function uninstallStorage() {
  delete (globalThis as any).localStorage;
}

beforeEach(() => {
  installStorage();
  setActivePinia(createPinia());
});

afterEach(() => {
  uninstallStorage();
});

test('getAgentSessionStorageKey: returns base key for null/empty and scoped key for folder', () => {
  assert.equal(getAgentSessionStorageKey(null), AGENT_STORAGE_KEY_BASE);
  assert.equal(getAgentSessionStorageKey(''), AGENT_STORAGE_KEY_BASE);
  assert.equal(getAgentSessionStorageKey('   '), AGENT_STORAGE_KEY_BASE);
  assert.equal(getAgentSessionStorageKey('C:/notes'), `${AGENT_STORAGE_KEY_BASE}::C:/notes`);
  assert.equal(getAgentSessionStorageKey('C:\\notes'), `${AGENT_STORAGE_KEY_BASE}::C:/notes`);
  assert.equal(getAgentSessionStorageKey('C:/notes/'), `${AGENT_STORAGE_KEY_BASE}::C:/notes`);
  assert.equal(getAgentSessionStorageKey('/home/user/notes'), `${AGENT_STORAGE_KEY_BASE}::/home/user/notes`);
  assert.equal(getAgentSessionStorageKey('/'), `${AGENT_STORAGE_KEY_BASE}::/`);
  assert.equal(getAgentSessionStorageKey('D:/📚我的笔记/test'), `${AGENT_STORAGE_KEY_BASE}::D:/📚我的笔记/test`);
});

test('loadSavedSessions: returns initial session when empty', () => {
  const result = loadSavedSessions('C:/vault');
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].title, '新会话');
  assert.equal(result.activeId, result.sessions[0].id);
});

test('loadSavedSessions: migrates legacy sessions into the active workspace key', () => {
  const legacySessions = [
    {
      id: 'legacy-1',
      title: '旧会话',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [{ id: 'm1', role: 'user', content: 'hello legacy', createdAt: 1000 }],
    },
  ];
  localStorage.setItem(AGENT_STORAGE_KEY_BASE, JSON.stringify(legacySessions));

  // Loading for workspace 'C:/vault-a' should migrate legacy data
  const resultA = loadSavedSessions('C:/vault-a');
  assert.equal(resultA.sessions.length, 1);
  assert.equal(resultA.sessions[0].id, 'legacy-1');

  // Scoped key now has the data
  const scopedRaw = localStorage.getItem(`${AGENT_STORAGE_KEY_BASE}::C:/vault-a`);
  assert.ok(scopedRaw);
  assert.equal(JSON.parse(scopedRaw!)[0].id, 'legacy-1');

  // Legacy key has been cleaned up
  assert.equal(localStorage.getItem(AGENT_STORAGE_KEY_BASE), null);

  // A different workspace 'C:/vault-b' should now get fresh sessions, not legacy
  const resultB = loadSavedSessions('C:/vault-b');
  assert.notEqual(resultB.sessions[0].id, 'legacy-1');

  // Post-migration: chats in no-workspace (null folder) must not be stolen by fresh workspaces
  const noWsSessions = [
    {
      id: 'no-ws-1',
      title: '未打开工作区会话',
      createdAt: 2000,
      updatedAt: 2000,
      messages: [{ id: 'm2', role: 'user', content: 'hello no workspace', createdAt: 2000 }],
    },
  ];
  localStorage.setItem(AGENT_STORAGE_KEY_BASE, JSON.stringify(noWsSessions));

  // Loading for brand new workspace 'C:/vault-c'
  const resultC = loadSavedSessions('C:/vault-c');
  assert.notEqual(resultC.sessions[0].id, 'no-ws-1', 'Fresh workspace must not steal no-workspace sessions');

  // The no-workspace session must remain intact in AGENT_STORAGE_KEY_BASE
  const noWsRaw = localStorage.getItem(AGENT_STORAGE_KEY_BASE);
  assert.ok(noWsRaw);
  assert.equal(JSON.parse(noWsRaw!)[0].id, 'no-ws-1', 'No-workspace sessions must not be wiped');
});

test('loadForWorkspace: isolates sessions across different workspaces', () => {
  const panel = useAgentPanelStore();
  panel.loadForWorkspace('C:/workspace-1');
  assert.equal(panel.currentWorkspaceFolder, 'C:/workspace-1');

  panel.addMessage({ role: 'user', content: 'Prompt in workspace 1' });
  panel.addMessage({ role: 'assistant', content: 'Reply in workspace 1' });
  assert.equal(panel.messages.length, 2);

  // Switch to workspace 2
  panel.loadForWorkspace('C:/workspace-2');
  assert.equal(panel.currentWorkspaceFolder, 'C:/workspace-2');
  assert.equal(panel.messages.length, 0);

  panel.addMessage({ role: 'user', content: 'Prompt in workspace 2' });
  assert.equal(panel.messages.length, 1);

  // Switch back to workspace 1
  panel.loadForWorkspace('C:/workspace-1');
  assert.equal(panel.currentWorkspaceFolder, 'C:/workspace-1');
  assert.equal(panel.messages.length, 2);
  assert.equal(panel.messages[0].content, 'Prompt in workspace 1');
  assert.equal(panel.messages[1].content, 'Reply in workspace 1');
});

test('loadForWorkspace: halts streaming state during workspace swap', () => {
  const panel = useAgentPanelStore();
  panel.loadForWorkspace('C:/ws-a');
  panel.isStreaming = true;

  panel.loadForWorkspace('C:/ws-b');
  assert.equal(panel.isStreaming, false);
  assert.equal(panel.stopRequested, false);
});

test('workspaceStore.setFolder: triggers agent panel session isolation', () => {
  const ws = useWorkspaceStore();
  const panel = useAgentPanelStore();

  ws.setFolder('C:/vault-x');
  panel.addMessage({ role: 'user', content: 'Vault X notes' });
  assert.equal(panel.messages.length, 1);

  ws.setFolder('C:/vault-y');
  assert.equal(panel.messages.length, 0);
  panel.addMessage({ role: 'user', content: 'Vault Y notes' });
  assert.equal(panel.messages.length, 1);

  // Switch back to Vault X
  ws.setFolder('C:/vault-x');
  assert.equal(panel.messages.length, 1);
  assert.equal(panel.messages[0].content, 'Vault X notes');
});
