import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(pathToFileURL(path.join(process.cwd(),'package.json')));
const ts=require('typescript');
export async function load(url,context,nextLoad){
 if(url.endsWith('.ts')){const source=await fs.readFile(new URL(url),'utf8');return {format:'module',source:ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};}
 return nextLoad(url,context);
}
