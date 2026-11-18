import {templates} from './templates.mjs';
import {scenes,buildBrief} from './brief.mjs';
const $=id=>document.getElementById(id);let current='daily';
function select(id){
 current=id;const s=scenes[id];
 $('scene-title').textContent=s.name;$('value').textContent=s.value;$('material').placeholder=s.hint;
 $('preview').srcdoc=templates[id]||'';
 $('preview').hidden=id==='pages';
 document.querySelectorAll('[data-scene]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.scene===id));});
 $('status').textContent='已选择'+s.name+'。现有草稿保留；点击“生成任务草稿”才会替换。';
}
for(const [id,s] of Object.entries(scenes)){
 const button=document.createElement('button');button.type='button';button.dataset.scene=id;
 const title=document.createElement('strong');title.textContent=s.name;
 const label=document.createElement('span');label.textContent=s.en;button.append(title,label);
 button.addEventListener('click',()=>select(id));$('scenes').append(button);
}
$('brief-form').addEventListener('submit',event=>{event.preventDefault();$('output').value=buildBrief(current,$('material').value,$('audience').value);$('status').textContent='草稿已生成，可编辑后填入对话；尚未上传或发布。';});
$('append').addEventListener('click',async()=>{
 const text=$('output').value.trim();if(!text){$('status').textContent='请先生成或填写任务草稿。';return;}
 const message=window.mcode?.miniapp?.message;
 if(!message?.append){$('status').textContent='当前环境无法填入对话，请复制草稿到 MiniMax Code。尚未发送。';return;}
 $('append').disabled=true;
 try{await message.append(text);$('status').textContent='已填入对话草稿，请在对话中检查并点击发送。页面尚未发布。';}
 catch(error){$('status').textContent=error?.message==='user_cancelled'?'已取消，未填入草稿。':error?.message==='result_unknown'?'结果未确认，请先检查对话输入框，不要重复填入。':'无法填入当前对话，请复制草稿后手动粘贴。';}
 finally{$('append').disabled=false;}
});
$('copy').addEventListener('click',async()=>{
 if(!$('output').value.trim()){$('status').textContent='请先生成或填写任务草稿。';return;}
 try{await navigator.clipboard.writeText($('output').value);$('status').textContent='草稿已复制；尚未发送或发布。';}
 catch{$('output').focus();$('output').select();$('status').textContent='请按系统复制快捷键复制已选中的草稿。';}
});
select('daily');
