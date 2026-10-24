import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { apiGet, apiSend, errorMessage } from '../../api';
import { language, translate } from '../../i18n';
import { Note } from '../components/note';

type WatchState = { available: boolean; state: string; popups: number };
const KEY = ['web-watch'] as const;
const stateLabels: Record<string, string> = {
  closed: '尚未打开观看窗口', opening: '正在打开观看窗口', loading: '正在加载网页',
  ready: '观看窗口已就绪', error: '网页观看窗口加载失败，请关闭后重试',
};

export function WebWatchPanel() {
  const [url, setUrl] = useState('');
  const client = useQueryClient();
  const status = useQuery({ queryKey: KEY,
    queryFn: ({ signal }) => apiGet<WatchState>('/api/web-watch', signal),
    refetchInterval: query => ['opening', 'loading', 'ready'].includes(query.state.data?.state ?? '') ? 1000 : false,
  });
  const action = useMutation({
    mutationFn: (kind: 'open' | 'close') => apiSend<WatchState>('/api/web-watch', {
      action: kind, url, language: language() === 'zh-CN' ? 'zh' : language(),
    }),
    onSuccess: result => client.setQueryData(KEY, result),
  });
  const running = ['opening', 'loading', 'ready'].includes(status.data?.state ?? '');
  const submit = (event: FormEvent) => { event.preventDefault(); if (!action.isPending) action.mutate('open') };
  return <section className="peach-react" aria-label="网页观看">
    <div className="flex min-w-0 flex-col gap-3" data-web-watch="">
      <h3 className="text-title-2-medium text-text-primary">网页观看</h3>
      <p className="text-body-2-regular text-text-secondary">在这台 Mac 的独立窗口观看网页视频，拦截常见广告域名和新窗口。</p>
      <p className="text-body-2-regular text-text-secondary">当前页面内导航限于输入的网站。视频内嵌广告可能仍会显示。</p>
      <form onSubmit={submit} className="flex min-w-0 flex-col gap-3">
        <Input type="url" label="网页地址" placeholder="https://…" value={url} onChange={setUrl}
          isRequired maxLength={4096} isDisabled={running || action.isPending} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!status.data?.available || running || action.isPending || !url.trim()}>
            打开观看窗口
          </Button>
          <Button type="button" variant="secondary" disabled={(!running && status.data?.state !== 'error') || action.isPending}
            onClick={() => action.mutate('close')}>关闭观看窗口</Button>
        </div>
      </form>
      <p role="status" className="text-body-2-regular text-text-secondary">
        {translate(status.data ? stateLabels[status.data.state] ?? '正在读取状态' : '正在读取状态')}
      </p>
      {status.data && !status.data.available ? <Note tone="info">网页观看目前支持安装了 WebKit 组件的 Mac。</Note> : null}
      {action.error || status.error ? <Note tone="error">{errorMessage(action.error || status.error)}</Note> : null}
    </div>
  </section>;
}
