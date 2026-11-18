import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {scenes,buildBrief} from '../miniapp/client/brief.mjs';

test('sandbox preview renders bundled markup without authenticated iframe requests',async()=>{
 const items=new Map();const buttons=[];
 const element=()=>({dataset:{},value:'',listeners:{},setAttribute(){},append(...els){buttons.push(...els.filter(x=>x.dataset?.scene));},addEventListener(k,v){this.listeners[k]=v;}});
 const document={getElementById(id){if(!items.has(id))items.set(id,element());return items.get(id);},createElement:element,querySelectorAll(){return buttons;}};
 let source=await readFile(new URL('../miniapp/client/app.mjs',import.meta.url),'utf8');
 source=source.replace(/^import .*;\n/gm,'');
 const templates={};for(const id of ['daily','invite','report'])templates[id]=await readFile(new URL('../miniapp/client/templates/'+id+'.html',import.meta.url),'utf8');
 vm.runInNewContext(source,{document,scenes,buildBrief,templates,window:{},navigator:{}});
 for(const id of ['daily','invite','report']){
  buttons.find(x=>x.dataset.scene===id).listeners.click();
  assert.equal(items.get('preview').srcdoc,templates[id]);
  assert.equal(items.get('preview').src,undefined);
 }
 buttons.find(x=>x.dataset.scene==='pages').listeners.click();assert.equal(items.get('preview').hidden,true);
});
