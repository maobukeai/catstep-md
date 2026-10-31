import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const root = process.argv[2];
const req = createRequire(path.join(root,'app/package.json'));
const ts = req('typescript');
function load(rel,mocks={}) {
  const source=fs.readFileSync(path.join(root,rel),'utf8').replaceAll('import.meta.env.DEV','false');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports', output)(s=>mocks[s]??{},mod,mod.exports);
  return mod.exports;
}
const computed=fn=>({get value(){return fn();}});
const noop=()=>{};
globalThis.localStorage={getItem:()=>null,setItem:noop};
globalThis.window = new EventTarget();
const settings={perWorkspaceTabs:true,restoreSession:true,autoSaveOnBlur:true,viewMode:'edit'};
const goal=load('app/src/composables/useWritingGoals.ts',{vue:{computed}});
function defineStore(id,options){return()=>{const store=options.state();for(const [k,v] of Object.entries(options.actions??{}))store[k]=v.bind(store);for(const[k,v]of Object.entries(options.getters??{}))Object.defineProperty(store,k,{get:()=>v.call(store,store)});return store;};}
const tabsmod=load('app/src/stores/tabs.ts',{'pinia':{defineStore},'./settings':{useSettingsStore:()=>settings},'./windows':{AUX_LABEL_PREFIX:'solomd-window-'},'../composables/useWritingGoals':goal,'../lib/settings-storage':{readPersistedSettings:()=>settings}});
let tabs=tabsmod.useTabsStore();
const toasts={success:noop,error:noop,warning:noop,info:noop};
let disk='';let writeGate=null;let readGate=null;
const commands={writeNote:async(p,c)=>{disk=c;if(writeGate)await writeGate.promise;},readNote:async()=>readGate?await readGate.promise:{content:disk,encoding:'UTF-8',had_bom:false},watchFile:async()=>{},unwatchFile:async()=>{}};
let index={byPath:new Map(),refresh:async()=>{}};
const common={'vue':{computed,inject:()=>null,nextTick:async()=>{}},'../lib/commands':commands,'../stores/tabs':{useTabsStore:()=>tabs},'../stores/settings':{useSettingsStore:()=>settings},'../stores/workspace':{useWorkspaceStore:()=>({pushRecent:noop,currentFolder:'C:/notes'})},'../stores/toasts':{useToastsStore:()=>toasts},'../stores/recentEdits':{useRecentEditsStore:()=>({recordEdit:noop})},'../stores/windows':{useWindowsStore:()=>({})},'../i18n':{useI18n:()=>({t:x=>x})},'../lib/platform':{isIOS:()=>false,isAndroid:()=>false,isWindowsDesktop:()=>true,isTauri:()=>true},'../lib/saf-fs':{isSafPath:()=>false},'./useRecovery':{purgeRecoverySnapshot:async()=>{}},'../stores/workspaceIndex':{useWorkspaceIndexStore:()=>index}};
const files=load('app/src/composables/useFiles.ts',common).useFiles();
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const add=(id,content,saved=content)=>{const tab={id,filePath:`C:/notes/${id}.md`,fileName:`${id}.md`,content,savedContent:saved,language:'markdown',encoding:'UTF-8',hadBom:false,lineEnding:'lf'};tabs.tabs.push(tab);tabs.activeId=id;return tab;};
const results=[];
{
 tabs.tabs=[];const tab=add('save','v1','v0');writeGate=defer();const pending=files.saveTab(tab,{silent:true});tab.content='v2 typed while saving';writeGate.resolve();await pending;writeGate=null;
 assert.equal(disk,'v1');assert.equal(tab.savedContent,tab.content);assert.notEqual(disk,tab.content);results.push({case:'save marks later unwritten edits clean',disk,content:tab.content,savedContent:tab.savedContent,dirty:tabs.isDirty(tab.id)});
}
{
 tabs.tabs=[];const tab=add('goal','---\ngoal: 100\n---\nBody','');await files.saveTab(tab,{silent:true});assert(!disk.includes('goal_set_at'));assert(tab.content.includes('goal_set_at'));assert(!tabs.isDirty(tab.id));results.push({case:'goal stamp after write creates false clean state',disk,content:tab.content,savedContent:tab.savedContent});
}
{
 tabs.tabs=[];const tab=add('blur','old');disk='old';const flush=()=>{tab.content='new typed within debounce';};window.addEventListener('solomd:flush-content-sync',flush);await files.autoSaveDirtyTabs();window.removeEventListener('solomd:flush-content-sync',flush);assert.equal(disk,'old');assert.equal(tab.content,'old');results.push({case:'blur autosave checks stale clean state before any editor flush',disk,content:tab.content});
}
{
 tabs.tabs=[];const tab=add('property','old body plus UNSAVED EDIT','old body');const props=load('app/src/composables/useProperties.ts',{...common,'../lib/commands':{updateFrontmatterProperty:async()=> '---\ntitle: changed\n---\nold body'}}).useProperties();await props.update('title','changed');assert(!tab.content.includes('UNSAVED'));assert(!tabs.isDirty(tab.id));results.push({case:'property edit destroys dirty in-memory body',content:tab.content,dirty:tabs.isDirty(tab.id)});
}
{
 tabs.tabs=[];const a=add('A','A disk'),b=add('B','B body plus UNSAVED EDIT','B body');tabs.activeId='A';const gate=defer();const props=load('app/src/composables/useProperties.ts',{...common,'../lib/commands':{updateFrontmatterProperty:async()=>await gate.promise}}).useProperties();const pending=props.update('title','changed');tabs.activeId='B';gate.resolve('---\ntitle: changed\n---\nA disk');await pending;assert(b.content.includes('A disk'));assert(!tabs.isDirty('B'));results.push({case:'property response for A overwrites active B',a:a.content,b:b.content,bDirty:tabs.isDirty('B')});
}
{
 tabs.tabs=[];const tab=add('reload','local clean');let callback;const mounts=[];readGate=defer();load('app/src/composables/useFileWatcher.ts',{...common,vue:{watch:()=>noop,onMounted:fn=>mounts.push(fn),onBeforeUnmount:noop},'@tauri-apps/api/event':{listen:async(name,fn)=>{callback=fn;return noop;}}}).useFileWatcher(async()=>{throw Error('dialog should not be called on initial clean');});for(const mount of mounts)await mount();callback({payload:tab.filePath});tab.content='UNSAVED typed while external read pending';readGate.resolve({content:'external disk',encoding:'UTF-8',had_bom:false});await new Promise(r=>setImmediate(r));readGate=null;assert.equal(tab.content,'external disk');assert(!tabs.isDirty(tab.id));results.push({case:'automatic reload overwrites edit made after initial clean check',content:tab.content,dirty:tabs.isDirty(tab.id)});
}
{
 tabs.tabs=[];const tab=add('old/note','dirty edit','disk text');const src=fs.readFileSync(path.join(root,'app/src/components/FileTree.vue'),'utf8');const fn=src.slice(src.indexOf('async function repointOpenTabs('),src.indexOf('/** Would moving'));
 const js=ts.transpileModule(fn,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const repoint=new Function('tabs','readNote',js+'; return repointOpenTabs;')(tabs,commands.readNote);
 await repoint('C:/notes/old','C:/notes/new');assert.equal(tab.filePath,'C:/notes/old/note.md');results.push({case:'folder rename leaves descendant open tab at missing old path',path:tab.filePath});
}
{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))};
 tabs=tabsmod.useTabsStore();tabs.openFromDisk({filePath:'C:/notes/restored.md',content:'old saved body',encoding:'UTF-8',language:'markdown',hadBom:false});tabs.persist();disk='NEWER EDIT made outside while app is closed';
 tabs=tabsmod.useTabsStore();assert.equal(tabs.activeTab.content,'old saved body');assert(!tabs.isDirty(tabs.activeId));
 results.push({case:'session hydration revives cached clean content without disk reconciliation',disk,restored:tabs.activeTab.content,dirty:tabs.isDirty(tabs.activeId)});
}
console.log(JSON.stringify(results,null,2));

