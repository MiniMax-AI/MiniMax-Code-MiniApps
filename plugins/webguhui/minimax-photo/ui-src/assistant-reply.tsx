import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function AssistantReply({ text }: { text: string }) {
  // Host media is delivered through the validated image-result list, not Markdown.
  const readable = text.replace(/<media\b[^>]*(?:>|$)/gi, '').trim();
  return <div className="photo-ai-reply">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml
      urlTransform={(url) => /^https?:\/\//i.test(url) ? url : ''}
      components={{
        img: ({ alt }) => <span>{alt}</span>,
        a: ({ href, children }) => href
          ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          : <span>{children}</span>,
        table: ({ children }) => <div className="photo-ai-table"><table>{children}</table></div>,
      }}>
      {readable}
    </Markdown>
  </div>;
}
