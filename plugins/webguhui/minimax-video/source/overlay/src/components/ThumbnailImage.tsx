import { useState, type ImgHTMLAttributes } from 'react';
import { Icon } from './icons';

/** A failed preview must not leave a broken image or hide the card action. */
export function ThumbnailImage({ src, alt, onError, style, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [failedSrc, setFailedSrc] = useState<string>();
  if (!src || failedSrc === src) return <span role="img" aria-label={alt ? `${alt} · 预览暂不可用` : '预览暂不可用'} title="预览暂不可用" className={props.className} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, color: 'var(--cc-text-dim)', background: 'var(--cc-inset)' }}><Icon name="image" size={24} /></span>;
  return <img {...props} src={src} alt={alt} style={style} onError={event => { setFailedSrc(src); onError?.(event); }} />;
}
