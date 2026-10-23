import { useId, useState } from 'react';
import { VisuallyHidden } from 'react-aria';
import { language, saveLanguage, translate } from '../../i18n';

/** 本机浏览器的界面语言；提交前先持久保存，失败时留在当前表单。 */
export function LanguagePicker({ hideLabel = false }: { hideLabel?: boolean }) {
  const [failure, setFailure] = useState(false);
  const id = useId();
  const label = <label htmlFor={id}>{translate('语言')}</label>;
  return <div className="flex flex-col gap-2">
    {hideLabel ? <VisuallyHidden>{label}</VisuallyHidden> : label}
    <select id={id} data-language-picker defaultValue={language()} className="min-h-11 rounded-lg border border-separator-border bg-background-secondary-default p-2 text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      onChange={(event) => {
        if (saveLanguage(event.target.value)) window.location.reload();
        else { event.target.value = language(); setFailure(true); }
      }}>
      <option value="zh-CN">中文</option><option value="en">English</option><option value="th">ไทย</option>
    </select>
    <p className="text-sm text-text-secondary">{translate('切换语言会刷新页面，请先保存表单。')}</p>
    {failure ? <p role="alert">Language could not be saved. / ไม่สามารถบันทึกภาษาได้ / 无法保存语言</p> : null}
  </div>;
}
