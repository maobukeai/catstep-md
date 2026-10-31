/** Run from app/ with the project resolve loader and temp TS transpile loader. Read-only audit; fake DOM only dispatches the real TableWidget handlers. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const appDir=process.cwd();
const require=createRequire(pathToFileURL(path.join(appDir,'package.json')));
const load=rel=>import(pathToFileURL(path.join(appDir,rel)).href);
const {liveBlocksExtension}=await load('src/lib/cm-live-blocks.ts');
const {EditorState}=await import(pathToFileURL(path.join(path.dirname(require.resolve('@codemirror/state')), 'index.js')).href);
const {useEditorTable}=await load('src/composables/useEditorTable.ts');
const {ref}=await import(pathToFileURL(path.join(appDir,'node_modules/vue/index.mjs')).href);
const {renderMarkdown,preprocessMarkdown}=await load('src/lib/markdown.ts');
const {parseTable,serializeTable,insertColumn,deleteColumn,moveColumn}=await load('src/lib/markdown-table.ts');
const results=[];
function widgets(src){const ext=liveBlocksExtension();const state=EditorState.create({doc:src,extensions:ext});const out=[];state.field(ext[0]).between(0,state.doc.length,(from,to,d)=>out.push({from,to,widget:d.spec.widget}));return out;}
const tick=String.fromCharCode(96);
const codeDoc='Intro\n\n'+tick.repeat(3)+'markdown\n| A | B |\n| --- | --- |\n| x | y |\n'+tick.repeat(3)+'\n';
const embedded=widgets(codeDoc).map(x=>x.widget.constructor.name);
assert.ok(embedded.includes('TableWidget'));
results.push({probe:'ordinary_code_fence_contains_live_table',confirmed:true,actual:embedded});
const shapes={noOuterPipes:'A | B\n--- | ---\nx | y',headerOnly:'| A | B |\n| --- | --- |',shortDelimiter:'| A | B |\n| - | - |\n| x | y |',blockquote:'> | A | B |\n> | --- | --- |\n> | x | y |'};
for(const [name,src]of Object.entries(shapes)){assert.ok(renderMarkdown(src).includes('<table'));const actual=widgets('Intro\n\n'+src+'\n\nTail').length;assert.equal(actual,0);results.push({probe:'preview_live_table_parity_'+name,confirmed:true,previewTable:true,liveWidgets:actual});}
const mismatch='| A | B |\n| --- | --- | --- |\n| x | y |';const actualCols=widgets('Intro\n\n'+mismatch)[0].widget.parsedModel.header.length;assert.equal(actualCols,3);results.push({probe:'mismatched_table_delimiter',confirmed:true,previewHeaderColumns:(renderMarkdown(mismatch).match(/<th[ >]/g)||[]).length,liveHeaderColumns:actualCols});
const quoted=parseTable(shapes.blockquote);for(const [name,operation]of Object.entries({insert:insertColumn,delete:deleteColumn,move:moveColumn})){const value=serializeTable(operation(quoted,0,1));assert.ok(!value.startsWith('>'));results.push({probe:'blockquote_prefix_lost_'+name,confirmed:true,actual:value});}
const indented='  '+tick.repeat(3)+'html\n    <div>literal</div>\n  '+tick.repeat(3);const transformed=preprocessMarkdown(indented);assert.notEqual(transformed,indented);results.push({probe:'indented_code_html_modified',confirmed:true,source:indented,actual:transformed});
class El {
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attrs={};this.handlers={};this._text='';this.classList={add(){},remove(){}};}
 set innerHTML(x){this.children=[];this._text=x.replace(/<[^>]+>/g,'');} get innerHTML(){return this._text;}
 set textContent(x){this._text=x;} get textContent(){return this._text;}
 appendChild(el){this.children.push(el);return el;}
 setAttribute(k,v){this.attrs[k]=v;} getAttribute(k){return this.attrs[k];}
 addEventListener(k,fn){(this.handlers[k]??=[]).push(fn);}
 emit(k,e={}){for(const fn of this.handlers[k]??[])fn(e);}
 all(){return this.children.flatMap(x=>[x,...x.all()]);}
 querySelectorAll(sel){let roots=[this];for(const term of sel.split(' ')){roots=roots.flatMap(r=>r.all().filter(x=>term.startsWith('[')?[...term.matchAll(/data-(row|col)="([^"]+)"/g)].every(m=>x.dataset[m[1]]===m[2]):x.tagName===term));}return roots;}
 querySelector(sel){return this.querySelectorAll(sel)[0]??null;}
 getBoundingClientRect(){return {top:200,bottom:300,left:50};}
 focus(){document.activeElement=this;this.emit('focus');}
}
globalThis.document={createElement:t=>new El(t),activeElement:null,querySelector:()=>null};let observer=()=>{};
globalThis.window={innerWidth:1000,innerHeight:800,dispatchEvent:e=>observer(e),getSelection:()=>null};
function scenario(){const ext=liveBlocksExtension();let state=EditorState.create({doc:'Prefix\n\n| A | B |\n| --- | --- |\n| x | y |\n\nTail',extensions:ext});let wrap;const widget=()=>{let w;state.field(ext[0]).between(0,state.doc.length,(_f,_t,d)=>w??=d.spec.widget);return w;};const view={get state(){return state;},dispatch(spec){state=state.update(spec).state;const w=widget();if(w&&!w.updateDOM(wrap,view))wrap=w.toDOM(view);},focus(){}};wrap=widget().toDOM(view);return {view,get wrap(){return wrap;}};}
{
const s=scenario();s.view.dispatch({changes:{from:0,insert:'INSERTED\n'}});const cell=s.wrap.querySelector('[data-row="0"][data-col="0"]');cell.focus();cell.textContent='EDITED';cell.emit('input');const actual=s.view.state.doc.toString();assert.ok(!actual.includes('Prefix'));results.push({probe:'table_handlers_retain_old_offsets_after_prepend',confirmed:true,harness:'real CM StateField and widget handlers; fake DOM',actual});
}
{
const s=scenario();const o={getView:()=>s.view,isPlainWindowsEditor:()=>false,plainText:ref(''),plainCaretOffset:()=>0,plainSetCaret(){},recordPlainHistory(){},replaceDocRange(){},emitPlainCursorAndSelection(){},plainLineHeightPx:()=>20,t:x=>x,toasts:{info(){}},openTableEditor(){}};const api=useEditorTable(o);observer=e=>{if(e.type==='solomd:table-toolbar-show')api.onTableToolbarShow(e);};const cell=s.wrap.querySelector('[data-row="0"][data-col="0"]');cell.focus();cell.textContent='EDITEDLONG';cell.emit('input');const before=s.view.state.doc.toString();api.onInPlaceTableAction('alignCenter');const actual=s.view.state.doc.toString();assert.ok(actual.includes('|  x  |'));assert.ok(actual.includes('EDITEDLONG'));results.push({probe:'toolbar_uses_stale_focus_snapshot_after_typing',confirmed:true,harness:'real CM StateField, widget handlers and useEditorTable; fake DOM',before,actual});
}
console.log(JSON.stringify({date:'2026-10-31',totalProbes:results.length,results},null,2));


