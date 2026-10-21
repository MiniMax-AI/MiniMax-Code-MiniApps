import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import '../ui/theme.css';
export function SettingsDialog({ onClose }: { onClose: () => void; initialVendor?: string }) {
  const [region, setRegion] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/product-resources', { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '无法读取下载设置');
      setRegion(result.region); setMessage(result.error || '已下载的资源可离线使用。');
    }).catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, []);
  const changeRegion = async (value: string) => {
    setBusy(true);
    try {
      const response = await fetch('/api/product-resources/region', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ region: value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '切换失败，请重试');
      setRegion(result.region); setMessage('下载源已更新；已缓存的资源不受影响。请重新执行刚才失败的操作。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '切换失败，请重试'); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>设置与关于</DialogTitle><DialogDescription>MiniMax Video · 下载设置与使用说明</DialogDescription></DialogHeader>
      <div className="miniapp-about__body">
        
        <p><strong>直接开始对话</strong><br />模型、账号和工具由 MiniMax Code 提供，无需重复配置。</p>
        <p><strong>修改前先预览</strong><br />助手的编辑会形成提案，确认后才应用到工程。</p>
        <p><strong>工程保存在本机</strong><br />手动编辑和导出使用本地工程。使用云端 AI 时，相关文字或素材可能发送给所选服务，具体取决于你在 MiniMax Code 中配置的能力。</p>
        <p><strong>资源下载</strong><br />艺术字体、音效和本地 AI 组件在首次使用时下载，默认中文字体随应用提供。</p>
        <div className="miniapp-welcome__actions" role="group" aria-label="资源下载源">
          <Button variant={region === 'cn' ? 'default' : 'outline'} aria-pressed={region === 'cn'} disabled={busy} onClick={() => void changeRegion('cn')}>中国大陆</Button>
          <Button variant={region === 'global' ? 'default' : 'outline'} aria-pressed={region === 'global'} disabled={busy} onClick={() => void changeRegion('global')}>海外</Button>
        </div>
        <p role="status">{message}</p>
        <p>切换下载源不会移动或删除工程和素材。首次下载需要联网；失败后可切换下载源，再重试原操作。</p>
        <p>基于 OpenChatCut 开源编辑器，遵循 AGPL-3.0-or-later 许可。</p>
      </div>
      <DialogFooter><Button onClick={onClose}>知道了</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
