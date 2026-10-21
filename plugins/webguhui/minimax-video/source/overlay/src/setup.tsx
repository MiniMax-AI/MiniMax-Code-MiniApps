import './index.css';
import './miniappTypography.css';
import './components/ui/theme.css';
import './setup.css';
import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button} from './components/ui/button';
import {initSkins} from './skins';
document.documentElement.classList.add('miniapp-host');
initSkins();
type Status = {state:string; message:string; platform:string; region?:string; token:string};
function Setup() {
  const [status,setStatus]=useState<Status>();
  const [error,setError]=useState('');
  useEffect(()=>{
    let stopped=false;
    const poll=async()=>{try {
      const response=await fetch('/__setup/status',{cache:'no-store'});
      if(response.status===404) {location.reload();return;}
      if(!response.ok) throw Error('暂时无法连接，请稍后重试');
      const value=await response.json() as Status;
      if(!stopped) {setStatus(value);setError(''); if(value.state==='ready')location.reload();}
    } catch(e) {if(!stopped)setError(e instanceof Error?e.message:'连接失败');}};
    void poll(); const timer=setInterval(()=>void poll(),1500);
    return ()=>{stopped=true;clearInterval(timer);};
  },[]);
  const install=async(region:string)=>{
    if(!status)return;
    try {const response=await fetch('/__setup/install',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Token':status.token},body:JSON.stringify({region})});
      if(!response.ok)throw Error('无法开始准备，请重试');
      setStatus({...status,state:'installing',message:'正在准备下载…'});
    } catch(e) {setError(e instanceof Error?e.message:'连接失败');}
  };
  const busy=!status || status.state==='installing';
  return <main className="miniapp-setup"><section className="cc-shadcn miniapp-setup__card">
    <h1>MiniMax Video</h1><h2>准备视频编辑环境</h2>
    <p>首次使用需要下载视频处理组件。完成后保存在这台电脑，后续打开无需重复下载。</p>
    <p>系统：{status?.platform ?? '正在识别'}</p>
    <div className="miniapp-setup__choices">
      <Button disabled={busy} onClick={()=>void install('cn')}>中国大陆下载源</Button>
      <Button variant="outline" disabled={busy} onClick={()=>void install('global')}>海外下载源</Button>
    </div>
    <p>中国大陆使用 npmmirror；海外使用 npm 和 GitHub 官方源。下载失败可切换重试。</p>
    <p role="status" aria-live="polite">{status?.message}</p>
    {error && <p role="alert">{error}</p>}
  </section></main>;
}
createRoot(document.getElementById('root')!).render(<Setup/>);
